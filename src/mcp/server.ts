// Read-only MCP server over the local database. It never contacts Amazon.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { paths } from '../config.js';
import { openReadOnly, type DB } from '../db/db.js';
import * as repo from '../db/repo.js';
import { formatAnnotation, formatBook } from '../format.js';
import type { AnnotationKind } from '../types.js';

const KIND = z.enum(['highlight', 'note', 'bookmark']);
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

/** Open lazily so the server starts (and can explain the problem) even before the first sync. */
function withDb<T>(fn: (db: DB) => T): T {
  const db = openReadOnly(paths.db);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function resolveBook(db: DB, book: string): { asin: string } | { error: string } {
  const matches = repo.findBooks(db, book);
  if (matches.length === 1) return { asin: matches[0]!.asin };
  if (matches.length === 0) return { error: `No book matches "${book}". Use list_books to see available books.` };
  return { error: `"${book}" matches several books; pass one of these ASINs:\n${matches.map(formatBook).join('\n')}` };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'kindle-notes', version: '0.1.0' });

  const safe =
    <A>(fn: (args: A) => string) =>
    async (args: A) => {
      try {
        return text(fn(args));
      } catch (err) {
        return { ...text((err as Error).message), isError: true };
      }
    };

  server.registerTool(
    'search_notes',
    {
      description:
        "Full-text search across the user's Kindle highlights, notes and bookmarks. Words are matched as prefixes; all words must match (falls back to any word). Kinds: highlight = passage the user marked, note = text the user wrote, bookmark = a saved place (text is the passage near it).",
      inputSchema: {
        query: z.string().min(1).describe('Words to look for, e.g. "habits identity"'),
        book: z.string().optional().describe('Limit to one book: ASIN or part of the title/author'),
        kinds: z.array(KIND).optional().describe('Only these kinds'),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    safe(({ query, book, kinds, limit }: { query: string; book?: string; kinds?: AnnotationKind[]; limit: number }) =>
      withDb((db) => {
        let asin: string | undefined;
        if (book) {
          const r = resolveBook(db, book);
          if ('error' in r) return r.error;
          asin = r.asin;
        }
        const rows = repo.search(db, query, { asin, kinds, limit });
        if (rows.length === 0) return `No matches for "${query}".`;
        return `${rows.length} match(es):\n\n` + rows.map((r) => formatAnnotation(r, { withBook: true })).join('\n\n');
      }),
    ),
  );

  server.registerTool(
    'list_books',
    { description: 'List all books that have highlights, notes or bookmarks, most recently annotated first.', inputSchema: {} },
    safe(() =>
      withDb((db) => {
        const books = repo.listBooks(db);
        return books.length ? books.map(formatBook).join('\n') : 'No books yet. The user needs to run `kindle-notes sync`.';
      }),
    ),
  );

  server.registerTool(
    'get_book_notes',
    {
      description:
        "All highlights, notes and bookmarks of one book in reading order. Use offset/limit to page through long books. PARTIAL items are highlights whose full text Amazon withholds (publisher export limit).",
      inputSchema: {
        book: z.string().min(1).describe('ASIN or part of the title/author'),
        kinds: z.array(KIND).optional(),
        limit: z.number().int().min(1).max(200).default(60),
        offset: z.number().int().min(0).default(0),
        include_deleted: z.boolean().default(false).describe('Include items the user deleted on Amazon'),
      },
    },
    safe(
      ({ book, kinds, limit, offset, include_deleted }: { book: string; kinds?: AnnotationKind[]; limit: number; offset: number; include_deleted: boolean }) =>
        withDb((db) => {
          const r = resolveBook(db, book);
          if ('error' in r) return r.error;
          const info = repo.findBooks(db, r.asin)[0]!;
          const { rows, total } = repo.getBookAnnotations(db, r.asin, { kinds, limit, offset, includeDeleted: include_deleted });
          const end = offset + rows.length;
          const header = `${formatBook(info)}\nShowing ${rows.length ? offset + 1 : 0}–${end} of ${total}${end < total ? ` (call again with offset ${end} for more)` : ''}.`;
          return [header, ...rows.map((a) => formatAnnotation(a))].join('\n\n');
        }),
    ),
  );

  server.registerTool(
    'recent_notes',
    {
      description: 'Most recent highlights/notes/bookmarks across all books, newest first.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        days: z.number().int().min(1).optional().describe('Only the last N days'),
        kinds: z.array(KIND).optional(),
      },
    },
    safe(({ limit, days, kinds }: { limit: number; days?: number; kinds?: AnnotationKind[] }) =>
      withDb((db) => {
        const rows = repo.recent(db, { limit, days, kinds });
        return rows.length ? rows.map((r) => formatAnnotation(r, { withBook: true })).join('\n\n') : 'Nothing found in that period.';
      }),
    ),
  );

  server.registerTool(
    'random_highlight',
    {
      description: 'One random highlight, optionally from a given book. Good for resurfacing ideas.',
      inputSchema: { book: z.string().optional().describe('ASIN or part of the title/author') },
    },
    safe(({ book }: { book?: string }) =>
      withDb((db) => {
        let asin: string | undefined;
        if (book) {
          const r = resolveBook(db, book);
          if ('error' in r) return r.error;
          asin = r.asin;
        }
        const row = repo.randomHighlight(db, asin);
        return row ? formatAnnotation(row, { withBook: true }) : 'No highlights yet.';
      }),
    ),
  );

  server.registerTool(
    'sync_status',
    { description: 'Totals and when the local copy was last synced from Amazon (to tell if data may be stale).', inputSchema: {} },
    safe(() =>
      withDb((db) => {
        const s = repo.status(db);
        const last = s.lastSync
          ? `Last sync: ${new Date(s.lastSync.startedAt).toISOString()} (${s.lastSync.status})${s.lastSync.errors.length ? `; errors: ${s.lastSync.errors.join('; ')}` : ''}`
          : 'Never synced.';
        return `${s.books} books, ${s.highlights} highlights (${s.partial} partial), ${s.notes} notes, ${s.bookmarks} bookmarks.\n${last}\nTo refresh, the user runs \`kindle-notes sync\`.`;
      }),
    ),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
