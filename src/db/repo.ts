import type { DB } from './db.js';
import type { AnnotationKind, AnnotationRecord, Book } from '../types.js';

// ---------- Write side (sync only) ----------

export function upsertBook(db: DB, book: Book, now = Date.now()) {
  db.prepare(
    `INSERT INTO books (asin, title, author, cover_url, last_annotated, first_seen_at, synced_at)
     VALUES (@asin, @title, @author, @coverUrl, @lastAnnotated, @now, @now)
     ON CONFLICT(asin) DO UPDATE SET
       title = excluded.title, author = excluded.author, cover_url = excluded.cover_url,
       last_annotated = excluded.last_annotated, synced_at = excluded.synced_at`,
  ).run({ ...book, now });
}

export interface SaveOptions {
  /** The notebook fetch for this book completed: rows it no longer lists can be marked deleted. */
  reconcileNotebook: boolean;
  /** The reader step completed: bookmarks/partials it no longer lists can be removed. */
  reconcileReader: boolean;
  now?: number;
}

export interface SaveResult {
  added: number;
  updated: number;
  removed: number;
  warnings: string[];
}

/** Write one book's annotations in a single transaction. */
export function saveBookAnnotations(db: DB, asin: string, records: AnnotationRecord[], opts: SaveOptions): SaveResult {
  const now = opts.now ?? Date.now();
  const result: SaveResult = { added: 0, updated: 0, removed: 0, warnings: [] };

  const select = db.prepare('SELECT text, note, color, location, page, position, is_partial, created_at, deleted_at FROM annotations WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO annotations (id, asin, kind, text, note, color, location, page, position, created_at, is_partial, source, raw, first_seen_at, updated_at)
     VALUES (@id, @asin, @kind, @text, @note, @color, @location, @page, @position, @createdAt, @isPartial, @source, @raw, @now, @now)`,
  );
  const update = db.prepare(
    `UPDATE annotations SET text = @text, note = @note, color = @color, location = @location, page = @page,
       position = @position, created_at = COALESCE(@createdAt, created_at), is_partial = @isPartial,
       raw = @raw, deleted_at = NULL, updated_at = CASE WHEN @changed THEN @now ELSE updated_at END
     WHERE id = @id`,
  );

  db.transaction(() => {
    for (const r of records) {
      const params = { ...r, isPartial: r.isPartial ? 1 : 0, now };
      const existing = select.get(r.id) as Record<string, unknown> | undefined;
      if (!existing) {
        insert.run(params);
        result.added++;
        continue;
      }
      const changed =
        existing.text !== r.text || existing.note !== r.note || existing.color !== r.color || existing.deleted_at !== null;
      update.run({ ...params, changed: changed ? 1 : 0 });
      if (changed) result.updated++;
    }

    const seen = new Set(records.map((r) => r.id));
    const reconcile = (source: 'notebook' | 'reader') => {
      const active = db
        .prepare('SELECT id, is_partial FROM annotations WHERE asin = ? AND source = ? AND deleted_at IS NULL')
        .all(asin, source) as Array<{ id: string; is_partial: number }>;
      // Partial highlights are derived copies; when the full one shows up they just go away.
      const hardDelete = db.prepare('DELETE FROM annotations WHERE id = ?');
      for (const m of active.filter((a) => a.is_partial && !seen.has(a.id))) {
        hardDelete.run(m.id);
        result.removed++;
      }

      const real = active.filter((a) => !a.is_partial);
      const missing = real.filter((a) => !seen.has(a.id));
      if (missing.length === 0) return;
      // Guard against a parsing problem wiping a book: refuse to remove more than half.
      if (real.length >= 4 && missing.length > real.length / 2) {
        result.warnings.push(
          `${asin}: ${missing.length} of ${real.length} ${source} items are not on Amazon. The tool did not set the deleted label. Examine the book on Amazon.`,
        );
        return;
      }
      const softDelete = db.prepare('UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?');
      for (const m of missing) {
        softDelete.run(now, now, m.id);
        result.removed++;
      }
    };
    if (opts.reconcileNotebook) reconcile('notebook');
    if (opts.reconcileReader) reconcile('reader');
  })();

  return result;
}

export function startSyncRun(db: DB): number {
  return Number(db.prepare(`INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`).run(Date.now()).lastInsertRowid);
}

export function finishSyncRun(
  db: DB,
  id: number,
  r: { status: 'ok' | 'partial' | 'failed'; books: number; added: number; updated: number; removed: number; errors: string[] },
) {
  db.prepare(
    `UPDATE sync_runs SET finished_at = ?, status = ?, books = ?, added = ?, updated = ?, removed = ?, errors = ? WHERE id = ?`,
  ).run(Date.now(), r.status, r.books, r.added, r.updated, r.removed, r.errors.length ? JSON.stringify(r.errors) : null, id);
}

// ---------- Read side (UI, MCP) ----------

export interface BookSummary {
  asin: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  /** Date of the newest highlight/note/bookmark we know of (ms). */
  lastActivity: number | null;
  highlights: number;
  notes: number;
  bookmarks: number;
}

export interface AnnotationRow {
  id: string;
  asin: string;
  bookTitle: string;
  bookAuthor: string | null;
  kind: AnnotationKind;
  text: string;
  note: string | null;
  color: string | null;
  location: number | null;
  page: string | null;
  createdAt: number | null;
  isPartial: boolean;
  source: 'notebook' | 'reader';
  deleted: boolean;
}

const ROW_COLUMNS = `
  a.id, a.asin, b.title AS bookTitle, b.author AS bookAuthor, a.kind, a.text, a.note, a.color,
  a.location, a.page, a.created_at AS createdAt, a.is_partial AS isPartial, a.source,
  a.deleted_at IS NOT NULL AS deleted`;

type RawRow = Omit<AnnotationRow, 'isPartial' | 'deleted'> & { isPartial: number; deleted: number };
const toRow = (r: RawRow): AnnotationRow => ({ ...r, isPartial: !!r.isPartial, deleted: !!r.deleted });

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Read a date as Amazon shows it, e.g. "Sunday, October 18, 2026". Gives UTC midnight (ms), or null. */
export function parseAmazonDate(text: string | null): number | null {
  const m = text?.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  return month < 0 ? null : Date.UTC(Number(m[3]), month, Number(m[2]));
}

/**
 * Newest books first. The date is the newest item date, or the "last annotated" date from Amazon.
 * A sync with --no-bookmarks gets no item dates, so the Amazon date is often the only one.
 * If there is no date, the tool uses the time that it first saw an item.
 */
export function listBooks(db: DB): BookSummary[] {
  const rows = db
    .prepare(
      `SELECT b.asin, b.title, b.author, b.cover_url AS coverUrl, b.last_annotated AS lastAnnotated,
         COALESCE(SUM(a.kind = 'highlight'), 0) AS highlights,
         COALESCE(SUM(a.kind = 'note' OR (a.kind = 'highlight' AND a.note IS NOT NULL)), 0) AS notes,
         COALESCE(SUM(a.kind = 'bookmark'), 0) AS bookmarks,
         MAX(a.created_at) AS newestItem, MAX(a.first_seen_at) AS firstSeen
       FROM books b LEFT JOIN annotations a ON a.asin = b.asin AND a.deleted_at IS NULL
       GROUP BY b.asin`,
    )
    .all() as Array<Omit<BookSummary, 'lastActivity'> & { lastAnnotated: string | null; newestItem: number | null; firstSeen: number | null }>;
  return rows
    .map(({ lastAnnotated, newestItem, firstSeen, ...b }) => {
      const amazon = parseAmazonDate(lastAnnotated);
      const known = [newestItem, amazon].filter((n): n is number => n != null);
      return { ...b, lastActivity: known.length ? Math.max(...known) : firstSeen };
    })
    .sort((x, y) => (y.lastActivity ?? -Infinity) - (x.lastActivity ?? -Infinity) || x.title.localeCompare(y.title) || (x.asin < y.asin ? -1 : 1));
}

/** Resolve a book by exact ASIN or by a case-insensitive title/author fragment. */
export function findBooks(db: DB, query: string): BookSummary[] {
  const q = query.trim().toLowerCase();
  const all = listBooks(db);
  const exact = all.filter((b) => b.asin.toLowerCase() === q);
  if (exact.length) return exact;
  return all.filter((b) => b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q));
}

export interface ListOptions {
  kinds?: AnnotationKind[];
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

function filters(opts: { kinds?: AnnotationKind[]; includeDeleted?: boolean }, params: unknown[]): string {
  const where: string[] = [];
  if (!opts.includeDeleted) where.push('a.deleted_at IS NULL');
  if (opts.kinds?.length) {
    where.push(`a.kind IN (${opts.kinds.map(() => '?').join(',')})`);
    params.push(...opts.kinds);
  }
  return where.length ? ' AND ' + where.join(' AND ') : '';
}

/** A book's annotations in reading order. */
export function getBookAnnotations(db: DB, asin: string, opts: ListOptions = {}): { rows: AnnotationRow[]; total: number } {
  const params: unknown[] = [asin];
  const where = filters(opts, params);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM annotations a WHERE a.asin = ?${where}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT ${ROW_COLUMNS} FROM annotations a JOIN books b ON b.asin = a.asin
       WHERE a.asin = ?${where}
       ORDER BY a.position IS NULL, a.position, a.location, a.created_at
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit ?? -1, opts.offset ?? 0) as RawRow[];
  return { rows: rows.map(toRow), total };
}

/**
 * Turn free text into a safe FTS5 query: every word becomes a quoted term, so characters
 * like " - : ( ) or words like AND/NOT can never cause a syntax error.
 */
export function toFtsQuery(input: string, mode: 'all' | 'any' = 'all'): string | null {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);
  if (terms.length === 0) return null;
  return terms.join(mode === 'all' ? ' AND ' : ' OR ');
}

export interface SearchOptions {
  asin?: string;
  kinds?: AnnotationKind[];
  limit?: number;
  includeDeleted?: boolean;
}

export function search(db: DB, query: string, opts: SearchOptions = {}): AnnotationRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const run = (fts: string) => {
    const params: unknown[] = [fts];
    let where = filters(opts, params);
    if (opts.asin) {
      where += ' AND a.asin = ?';
      params.push(opts.asin);
    }
    return db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM annotations_fts f
         JOIN annotations a ON a.rowid = f.rowid JOIN books b ON b.asin = a.asin
         WHERE annotations_fts MATCH ?${where}
         ORDER BY bm25(annotations_fts) LIMIT ?`,
      )
      .all(...params, limit) as RawRow[];
  };

  try {
    const all = toFtsQuery(query, 'all');
    if (!all) return [];
    let rows = run(all);
    // No result with every word? Try any word, still ranked by relevance.
    if (rows.length === 0 && query.trim().includes(' ')) rows = run(toFtsQuery(query, 'any')!);
    return rows.map(toRow);
  } catch {
    // Last resort if the FTS engine still rejects the query.
    const params: unknown[] = [`%${query}%`, `%${query}%`];
    let where = filters(opts, params);
    if (opts.asin) {
      where += ' AND a.asin = ?';
      params.push(opts.asin);
    }
    return (
      db
        .prepare(
          `SELECT ${ROW_COLUMNS} FROM annotations a JOIN books b ON b.asin = a.asin
           WHERE (a.text LIKE ? OR a.note LIKE ?)${where} LIMIT ?`,
        )
        .all(...params, limit) as RawRow[]
    ).map(toRow);
  }
}

/** Newest first. Items without an Amazon date use the time we first saw them. */
export function recent(db: DB, opts: { limit?: number; days?: number; kinds?: AnnotationKind[] } = {}): AnnotationRow[] {
  const params: unknown[] = [];
  let where = filters({ kinds: opts.kinds }, params);
  if (opts.days) {
    where += ' AND COALESCE(a.created_at, a.first_seen_at) >= ?';
    params.push(Date.now() - opts.days * 86_400_000);
  }
  return (
    db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM annotations a JOIN books b ON b.asin = a.asin
         WHERE 1 = 1${where}
         ORDER BY COALESCE(a.created_at, a.first_seen_at) DESC LIMIT ?`,
      )
      .all(...params, Math.min(opts.limit ?? 20, 200)) as RawRow[]
  ).map(toRow);
}

export function randomHighlight(db: DB, asin?: string): AnnotationRow | null {
  const row = db
    .prepare(
      `SELECT ${ROW_COLUMNS} FROM annotations a JOIN books b ON b.asin = a.asin
       WHERE a.kind = 'highlight' AND a.deleted_at IS NULL ${asin ? 'AND a.asin = ?' : ''}
       ORDER BY random() LIMIT 1`,
    )
    .get(...(asin ? [asin] : [])) as RawRow | undefined;
  return row ? toRow(row) : null;
}

export interface Status {
  books: number;
  highlights: number;
  notes: number;
  bookmarks: number;
  partial: number;
  lastSync: { startedAt: number; finishedAt: number | null; status: string; errors: string[] } | null;
}

export function status(db: DB): Status {
  const c = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM books) AS books,
         COALESCE(SUM(kind = 'highlight'), 0) AS highlights,
         COALESCE(SUM(kind = 'note' OR (kind = 'highlight' AND note IS NOT NULL)), 0) AS notes,
         COALESCE(SUM(kind = 'bookmark'), 0) AS bookmarks,
         COALESCE(SUM(is_partial), 0) AS partial
       FROM annotations WHERE deleted_at IS NULL`,
    )
    .get() as Omit<Status, 'lastSync'>;
  const s = db
    .prepare(`SELECT started_at, finished_at, status, errors FROM sync_runs ORDER BY id DESC LIMIT 1`)
    .get() as { started_at: number; finished_at: number | null; status: string; errors: string | null } | undefined;
  return {
    ...c,
    lastSync: s
      ? { startedAt: s.started_at, finishedAt: s.finished_at, status: s.status, errors: s.errors ? JSON.parse(s.errors) : [] }
      : null,
  };
}
