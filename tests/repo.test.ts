import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoDatabaseError, openReadOnly, openWritable, type DB } from '../src/db/db.js';
import * as repo from '../src/db/repo.js';
import type { AnnotationRecord, Book } from '../src/types.js';

const book: Book = { asin: 'B1', title: 'Atomic Things', author: 'J. Clear', coverUrl: null, lastAnnotated: null };
const rec = (id: string, text: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id, asin: 'B1', kind: 'highlight', text, note: null, color: 'yellow', location: 10, page: null,
  position: 1500, createdAt: null, isPartial: false, source: 'notebook', raw: '{}', ...extra,
});
const all = { reconcileNotebook: true, reconcileReader: true };

let dir: string;
let db: DB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-test-'));
  db = openWritable(path.join(dir, 'kindle.db'));
  repo.upsertBook(db, book);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('saveBookAnnotations', () => {
  it('is idempotent: syncing twice does not duplicate', () => {
    const rows = [rec('h1', 'Habits are the compound interest of self-improvement.'), rec('h2', 'You do not rise to the level of your goals.')];
    expect(repo.saveBookAnnotations(db, 'B1', rows, all)).toMatchObject({ added: 2, updated: 0 });
    expect(repo.saveBookAnnotations(db, 'B1', rows, all)).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(repo.status(db).highlights).toBe(2);
  });

  it('keeps an existing date when the new sync has none', () => {
    repo.saveBookAnnotations(db, 'B1', [rec('h1', 'x', { createdAt: 123 })], all);
    repo.saveBookAnnotations(db, 'B1', [rec('h1', 'x', { createdAt: null })], all);
    expect(repo.getBookAnnotations(db, 'B1').rows[0]?.createdAt).toBe(123);
  });

  it('soft-deletes removed items and restores them if they come back', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => rec(id, `text ${id}`));
    repo.saveBookAnnotations(db, 'B1', rows, all);
    expect(repo.saveBookAnnotations(db, 'B1', rows.slice(0, 3), all).removed).toBe(1);
    expect(repo.getBookAnnotations(db, 'B1').total).toBe(3);
    expect(repo.getBookAnnotations(db, 'B1', { includeDeleted: true }).rows.find((r) => r.id === 'd')?.deleted).toBe(true);
    repo.saveBookAnnotations(db, 'B1', rows, all);
    expect(repo.getBookAnnotations(db, 'B1').total).toBe(4);
  });

  it('refuses to delete more than half of a book (likely a parsing problem)', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => rec(id, `text ${id}`));
    repo.saveBookAnnotations(db, 'B1', rows, all);
    const r = repo.saveBookAnnotations(db, 'B1', rows.slice(0, 1), all);
    expect(r.removed).toBe(0);
    expect(r.warnings).toHaveLength(1);
    expect(repo.getBookAnnotations(db, 'B1').total).toBe(4);
  });

  it('leaves reader items alone when the reader step did not run', () => {
    repo.saveBookAnnotations(db, 'B1', [rec('n1', 'n'), rec('bookmark:B1:5', 'near here', { kind: 'bookmark', source: 'reader' })], all);
    repo.saveBookAnnotations(db, 'B1', [rec('n1', 'n')], { reconcileNotebook: true, reconcileReader: false });
    expect(repo.status(db).bookmarks).toBe(1);
  });

  it('removes a partial highlight once the full one replaces it', () => {
    const full = rec('n1', 'n');
    const partial = rec('reader:B1:9', 'partial text', { isPartial: true, source: 'reader' });
    repo.saveBookAnnotations(db, 'B1', [full, partial], all);
    repo.saveBookAnnotations(db, 'B1', [full], all);
    expect(repo.getBookAnnotations(db, 'B1', { includeDeleted: true }).total).toBe(1);
  });

  it('always cleans up partials, even many at once (seen on real data)', () => {
    const bm = rec('bookmark:B1:1', 'near', { kind: 'bookmark', source: 'reader' });
    const partials = [1, 2, 3, 4].map((n) => rec(`reader:B1:${n}`, `p${n}`, { isPartial: true, source: 'reader' }));
    repo.saveBookAnnotations(db, 'B1', [bm, ...partials], all);
    const r = repo.saveBookAnnotations(db, 'B1', [bm], all);
    expect(r).toMatchObject({ removed: 4, warnings: [] });
    expect(repo.status(db).partial).toBe(0);
  });
});

describe('search', () => {
  beforeEach(() => {
    repo.saveBookAnnotations(db, 'B1', [
      rec('h1', 'Habits are the compound interest of self-improvement.'),
      rec('h2', 'Every action is a vote for the type of person you wish to become.', { note: 'identity' }),
      rec('h3', 'Café culture and naïve ideas.'),
    ], all);
  });

  it('finds words in text and notes, by prefix', () => {
    expect(repo.search(db, 'compound').map((r) => r.id)).toEqual(['h1']);
    expect(repo.search(db, 'identity').map((r) => r.id)).toEqual(['h2']);
    expect(repo.search(db, 'improv').map((r) => r.id)).toEqual(['h1']);
  });

  it('ignores accents', () => {
    expect(repo.search(db, 'cafe naive').map((r) => r.id)).toEqual(['h3']);
  });

  it('falls back to any word when not all words match', () => {
    expect(repo.search(db, 'habits zebra').map((r) => r.id)).toEqual(['h1']);
  });

  it('never throws on special characters or FTS keywords', () => {
    for (const q of ['"', 'a AND', 'NOT', 'vote: (person', '-habits', '*', 'NEAR(x y)', "it's"]) {
      expect(() => repo.search(db, q)).not.toThrow();
    }
    expect(repo.search(db, '   ')).toEqual([]);
  });

  it('hides deleted items', () => {
    repo.saveBookAnnotations(db, 'B1', [rec('h2', 'Every action is a vote', { note: 'identity' }), rec('h3', 'Café')], all);
    expect(repo.search(db, 'compound')).toEqual([]);
  });
});

describe('reads', () => {
  it('finds books by asin, title or author', () => {
    repo.upsertBook(db, { ...book, asin: 'B2', title: 'Other Book', author: 'Someone' });
    expect(repo.findBooks(db, 'b1').map((b) => b.asin)).toEqual(['B1']);
    expect(repo.findBooks(db, 'atomic').map((b) => b.asin)).toEqual(['B1']);
    expect(repo.findBooks(db, 'o').length).toBe(2);
  });

  it('reads the Amazon date', () => {
    expect(repo.parseAmazonDate('Sunday, October 18, 2026')).toBe(Date.UTC(2026, 9, 18));
    expect(repo.parseAmazonDate('not a date')).toBeNull();
    expect(repo.parseAmazonDate(null)).toBeNull();
  });

  it('lists the newest books first, also with no item dates', () => {
    repo.upsertBook(db, { ...book, lastAnnotated: 'Monday, March 3, 2008' });
    repo.upsertBook(db, { ...book, asin: 'B2', title: 'New Book', lastAnnotated: 'Tuesday, September 15, 2026' });
    repo.upsertBook(db, { ...book, asin: 'B3', title: 'Mid Book', lastAnnotated: null });
    repo.saveBookAnnotations(db, 'B3', [rec('m', 'x', { asin: 'B3', createdAt: Date.UTC(2015, 0, 1) })], all);
    expect(repo.listBooks(db).map((b) => b.asin)).toEqual(['B2', 'B3', 'B1']);
  });

  it('pages through a book in reading order', () => {
    repo.saveBookAnnotations(db, 'B1', [rec('late', 'z', { position: 900 }), rec('early', 'a', { position: 100 }), rec('mid', 'm', { position: 500 })], all);
    expect(repo.getBookAnnotations(db, 'B1').rows.map((r) => r.id)).toEqual(['early', 'mid', 'late']);
    expect(repo.getBookAnnotations(db, 'B1', { limit: 1, offset: 1 }).rows.map((r) => r.id)).toEqual(['mid']);
  });

  it('counts notes attached to highlights', () => {
    repo.saveBookAnnotations(db, 'B1', [rec('h', 'x', { note: 'mine' }), rec('n', 'free note', { kind: 'note' })], all);
    expect(repo.listBooks(db)[0]).toMatchObject({ highlights: 1, notes: 2, bookmarks: 0 });
  });

  it('read-only open explains what to do when there is no data', () => {
    expect(() => openReadOnly(path.join(dir, 'missing.db'))).toThrow(NoDatabaseError);
  });

  it('a read-only connection sees new data written during a sync', () => {
    const reader = openReadOnly(path.join(dir, 'kindle.db'));
    expect(repo.status(reader).highlights).toBe(0);
    repo.saveBookAnnotations(db, 'B1', [rec('h', 'x')], all);
    expect(repo.status(reader).highlights).toBe(1);
    reader.close();
  });
});
