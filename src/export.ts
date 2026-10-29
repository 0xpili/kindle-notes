// Markdown export: one file for each book. The same database always gives the same files.
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db/db.js';
import { getBookAnnotations, listBooks, type AnnotationRow, type BookSummary } from './db/repo.js';
import { formatDate, formatWhere } from './format.js';

/** The export keeps the names of the files that it wrote in this file. It deletes only these files. */
export const MANIFEST = '.kindle-notes-export';
const MAX_NAME = 120;

/** Make a text safe for a file name on macOS, Linux, and Windows. */
export function sanitizeFileName(text: string): string {
  const clean = text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '');
  const cut = Array.from(clean).slice(0, MAX_NAME).join('').trim();
  return cut || 'Untitled';
}

export function bookBaseName(b: Pick<BookSummary, 'title' | 'author'>): string {
  return sanitizeFileName(b.author ? `${b.author} - ${b.title}` : b.title);
}

/**
 * Give each book a file name. If two books get the same name (case is ignored),
 * all of them get the ASIN at the end. The result does not depend on the sequence of the books.
 */
export function assignFileNames(books: Array<Pick<BookSummary, 'asin' | 'title' | 'author'>>): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const b of books) {
    const key = bookBaseName(b).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), b.asin]);
  }
  const names = new Map<string, string>();
  for (const b of books) {
    const base = bookBaseName(b);
    const clash = groups.get(base.toLowerCase())!.length > 1;
    names.set(b.asin, `${clash ? `${base} (${sanitizeFileName(b.asin)})` : base}.md`);
  }
  return names;
}

/** Keep the text on its lines in a Markdown quote. */
const quote = (t: string) => t.split(/\r?\n/).map((l) => (l ? `> ${l}` : '>')).join('\n');

export function formatBookMarkdown(b: Pick<BookSummary, 'asin' | 'title' | 'author'>, rows: AnnotationRow[]): string {
  const out = [`# ${b.title}`, ''];
  if (b.author) out.push(`- Author: ${b.author}`);
  out.push(`- ASIN: ${b.asin}`, '');
  for (const a of rows) {
    const kind = a.kind === 'highlight' ? 'Highlight' : a.kind === 'note' ? 'Note' : 'Bookmark';
    const meta = [formatWhere(a), a.kind === 'highlight' ? a.color : null, formatDate(a.createdAt), a.isPartial ? 'partial' : null]
      .filter(Boolean)
      .join(' · ');
    out.push(`## ${kind}${meta ? ` · ${meta}` : ''}`, '');
    if (a.kind === 'note') out.push(a.text, '');
    else if (a.text) out.push(quote(a.text), '');
    if (a.note) out.push(`Note: ${a.note}`, '');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

export interface ExportResult {
  books: number;
  written: number;
  unchanged: number;
  removed: number;
  highlights: number;
  notes: number;
  bookmarks: number;
}

function readManifest(dir: string): string[] {
  const file = path.join(dir, MANIFEST);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((n) => n.endsWith('.md') && n === path.basename(n));
}

/** Write one Markdown file for each book. Delete only files that an earlier export wrote and that are now old. */
export function exportMarkdown(db: DB, dir: string): ExportResult {
  const books = listBooks(db).sort((x, y) => (x.asin < y.asin ? -1 : x.asin > y.asin ? 1 : 0));
  const names = assignFileNames(books);
  fs.mkdirSync(dir, { recursive: true });
  const r: ExportResult = { books: books.length, written: 0, unchanged: 0, removed: 0, highlights: 0, notes: 0, bookmarks: 0 };

  for (const b of books) {
    const { rows } = getBookAnnotations(db, b.asin);
    for (const a of rows) {
      if (a.kind === 'highlight') r.highlights++;
      else if (a.kind === 'note') r.notes++;
      else r.bookmarks++;
    }
    const file = path.join(dir, names.get(b.asin)!);
    const text = formatBookMarkdown(b, rows);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) r.unchanged++;
    else {
      fs.writeFileSync(file, text);
      r.written++;
    }
  }

  const current = new Set(names.values());
  for (const old of readManifest(dir)) {
    if (current.has(old)) continue;
    const file = path.join(dir, old);
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) {
      fs.unlinkSync(file);
      r.removed++;
    }
  }
  fs.writeFileSync(path.join(dir, MANIFEST), [...current].sort().join('\n') + '\n');
  return r;
}
