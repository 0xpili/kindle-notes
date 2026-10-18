import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openWritable } from '../src/db/db.js';
import * as repo from '../src/db/repo.js';
import type { AnnotationRecord } from '../src/types.js';

let dir: string;
const rec = (id: string, text: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id, asin: 'B1', kind: 'highlight', text, note: null, color: 'yellow', location: 10, page: null,
  position: 1500, createdAt: 1790000000000, isPartial: false, source: 'notebook', raw: '{}', ...extra,
});

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-srv-'));
  process.env.KINDLE_NOTES_HOME = dir;
  const db = openWritable(path.join(dir, 'kindle.db'));
  repo.upsertBook(db, { asin: 'B1', title: 'Deep Work', author: 'Cal Newport', coverUrl: null, lastAnnotated: null });
  repo.upsertBook(db, { asin: 'B2', title: 'Deep Questions', author: 'Someone', coverUrl: null, lastAnnotated: null });
  repo.saveBookAnnotations(db, 'B1', [
    rec('h1', 'Focus is the new IQ.', { note: 'key idea' }),
    rec('bookmark:B1:5', 'Chapter two starts', { kind: 'bookmark', source: 'reader', position: 2000 }),
  ], { reconcileNotebook: true, reconcileReader: true });
  db.close();
});
afterAll(() => {
  delete process.env.KINDLE_NOTES_HOME;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('MCP server', () => {
  let client: Client;
  beforeAll(async () => {
    const { createServer } = await import('../src/mcp/server.js');
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer().connect(a);
    client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: r.content[0]!.text, isError: !!r.isError };
  };

  it('lists the expected tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_book_notes', 'list_books', 'random_highlight', 'recent_notes', 'search_notes', 'sync_status']);
  });

  it('search_notes returns readable matches with the book', async () => {
    const r = await call('search_notes', { query: 'focus' });
    expect(r.text).toContain('Deep Work');
    expect(r.text).toContain('Focus is the new IQ.');
    expect(r.text).toContain('Note: key idea');
  });

  it('get_book_notes includes bookmarks and asks to disambiguate vague titles', async () => {
    expect((await call('get_book_notes', { book: 'deep work' })).text).toContain('Bookmarked near');
    expect((await call('get_book_notes', { book: 'deep' })).text).toContain('matches several books');
  });

  it('validates input', async () => {
    const r = await call('search_notes', { query: '' });
    expect(r.isError).toBe(true);
  });

  it('sync_status reports totals', async () => {
    expect((await call('sync_status')).text).toMatch(/2 books, 1 highlights.*1 bookmarks/s);
  });
});

describe('web server', () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    const { createApp } = await import('../src/web/server.js');
    server = createApp(path.join(dir, 'kindle.db'), 0);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    // Rebuild with the real port so the Host check allows it.
    server.close();
    server = createApp(path.join(dir, 'kindle.db'), port);
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  });
  afterAll(() => server.close());

  const get = (p: string, host = `127.0.0.1:${port}`) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      }).on('error', reject);
    });

  it('serves the API', async () => {
    const books = JSON.parse((await get('/api/books')).body);
    expect(books.map((b: { asin: string }) => b.asin)).toContain('B1');
    const results = JSON.parse((await get('/api/search?q=focus')).body);
    expect(results[0].id).toBe('h1');
    const book = JSON.parse((await get('/api/book?asin=B1&kinds=bookmark')).body);
    expect(book.rows.map((r: { kind: string }) => r.kind)).toEqual(['bookmark']);
  });

  it('serves the page with a strict content security policy', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('rejects other Host headers (DNS rebinding)', async () => {
    expect((await get('/api/books', 'evil.example:80')).status).toBe(403);
  });
});
