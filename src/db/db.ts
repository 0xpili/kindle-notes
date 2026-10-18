import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

export class NoDatabaseError extends Error {
  constructor(file: string) {
    super(`There is no data in ${file}. Run \`kindle-notes login\`, then run \`kindle-notes sync\`.`);
    this.name = 'NoDatabaseError';
  }
}

// Each entry upgrades the schema by one version. Never edit an entry once released; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE books (
    asin TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    cover_url TEXT,
    last_annotated TEXT,
    first_seen_at INTEGER NOT NULL,
    synced_at INTEGER
  );

  CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    asin TEXT NOT NULL REFERENCES books(asin),
    kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note', 'bookmark')),
    text TEXT NOT NULL,
    note TEXT,
    color TEXT,
    location INTEGER,
    page TEXT,
    position INTEGER,
    created_at INTEGER,
    is_partial INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL CHECK (source IN ('notebook', 'reader')),
    raw TEXT,
    first_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX annotations_book ON annotations(asin, position);
  CREATE INDEX annotations_recent ON annotations(created_at);

  CREATE VIRTUAL TABLE annotations_fts USING fts5(
    text, note, content='annotations', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER annotations_ai AFTER INSERT ON annotations BEGIN
    INSERT INTO annotations_fts(rowid, text, note) VALUES (new.rowid, new.text, new.note);
  END;
  CREATE TRIGGER annotations_ad AFTER DELETE ON annotations BEGIN
    INSERT INTO annotations_fts(annotations_fts, rowid, text, note) VALUES ('delete', old.rowid, old.text, old.note);
  END;
  CREATE TRIGGER annotations_au AFTER UPDATE OF text, note ON annotations BEGIN
    INSERT INTO annotations_fts(annotations_fts, rowid, text, note) VALUES ('delete', old.rowid, old.text, old.note);
    INSERT INTO annotations_fts(rowid, text, note) VALUES (new.rowid, new.text, new.note);
  END;

  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL,
    books INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0,
    errors TEXT
  );
  `,
];

function configure(db: DB) {
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
}

/** Open for writing (sync). Creates the file and runs migrations. */
export function openWritable(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  fs.chmodSync(file, 0o600);
  db.pragma('journal_mode = WAL');
  configure(db);
  migrate(db);
  return db;
}

/** Open for reading (UI, MCP). Fails clearly if there is no data yet. */
export function openReadOnly(file: string): DB {
  if (!fs.existsSync(file)) throw new NoDatabaseError(file);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  configure(db);
  return db;
}

export function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
