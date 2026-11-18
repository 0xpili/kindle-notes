import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openWritable, type DB } from '../src/db/db.js';
import * as repo from '../src/db/repo.js';
import { MANIFEST, assignFileNames, exportMarkdown, formatBookMarkdown, sanitizeFileName } from '../src/export.js';
import type { AnnotationRecord, Book } from '../src/types.js';

const book: Book = { asin: 'B1', title: 'The Quiet Garden', author: 'Ana Example', coverUrl: null, lastAnnotated: null };
const rec = (id: string, text: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id, asin: 'B1', kind: 'highlight', text, note: null, color: 'yellow', location: 10, page: null,
  position: 1500, createdAt: null, isPartial: false, source: 'notebook', raw: '{}', ...extra,
});
const all = { reconcileNotebook: true, reconcileReader: true };

let dir: string;
let out: string;
let db: DB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-export-'));
  out = path.join(dir, 'out');
  db = openWritable(path.join(dir, 'kindle.db'));
  repo.upsertBook(db, book);
  repo.saveBookAnnotations(db, 'B1', [
    rec('h2', 'Second line.', { position: 900, location: 90, page: '12', color: 'blue', note: 'My note', createdAt: Date.UTC(2026, 0, 2) }),
    rec('h1', 'First line.\nWith two lines.', { position: 100 }),
    rec('n1', 'A free note.', { kind: 'note', color: null, position: 950, location: 95 }),
  ], all);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('sanitizeFileName', () => {
  it('removes characters that are not safe in file names', () => {
    expect(sanitizeFileName('A/B: C? "D" <E>|F*\\G')).toBe('A-B- C- -D- -E--F--G');
    expect(sanitizeFileName('  ..hidden  \n name. ')).toBe('hidden name');
    expect(sanitizeFileName('???')).toBe('Untitled');
    expect(sanitizeFileName('')).toBe('Untitled');
    expect(Array.from(sanitizeFileName('x'.repeat(500))).length).toBe(120);
  });

  it('adds the ASIN when two books get the same name', () => {
    const names = assignFileNames([
      { asin: 'B2', title: 'Same', author: 'Who' },
      { asin: 'B3', title: 'same', author: 'who' },
      { asin: 'B4', title: 'Other', author: null },
    ]);
    expect([...names.values()]).toEqual(['Who - Same (B2).md', 'who - same (B3).md', 'Other.md']);
  });
});

describe('formatBookMarkdown', () => {
  it('shows the book data and the items in reading order', () => {
    const rows = repo.getBookAnnotations(db, 'B1').rows;
    expect(formatBookMarkdown(book, rows)).toBe(
      [
        '# The Quiet Garden', '', '- Author: Ana Example', '- ASIN: B1', '',
        '## Highlight · location 10 · yellow', '', '> First line.', '> With two lines.', '',
        '## Highlight · page 12 · blue · 2026-01-02', '', '> Second line.', '', 'Note: My note', '',
        '## Note · location 95', '', 'A free note.', '',
      ].join('\n'),
    );
  });
});

describe('exportMarkdown', () => {
  it('gives byte-identical files for the same database', () => {
    exportMarkdown(db, out);
    const first = fs.readFileSync(path.join(out, 'Ana Example - The Quiet Garden.md'));
    const r = exportMarkdown(db, out);
    expect(r).toMatchObject({ books: 1, written: 0, unchanged: 1, removed: 0, highlights: 2, notes: 1 });
    expect(fs.readFileSync(path.join(out, 'Ana Example - The Quiet Garden.md')).equals(first)).toBe(true);
  });

  it('deletes only the old files that it wrote', () => {
    repo.upsertBook(db, { ...book, asin: 'B2', title: 'Gone Soon' });
    exportMarkdown(db, out);
    fs.writeFileSync(path.join(out, 'mine.md'), 'keep');
    fs.writeFileSync(path.join(dir, 'outside.md'), 'keep');
    fs.appendFileSync(path.join(out, MANIFEST), '../outside.md\nmine2.txt\n');
    db.prepare("DELETE FROM books WHERE asin = 'B2'").run();
    const r = exportMarkdown(db, out);
    expect(r.removed).toBe(1);
    expect(fs.readdirSync(out).sort()).toEqual([MANIFEST, 'Ana Example - The Quiet Garden.md', 'mine.md']);
    expect(fs.existsSync(path.join(dir, 'outside.md'))).toBe(true);
  });
});
