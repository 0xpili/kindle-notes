// Local web UI: a tiny JSON API over the database plus static files. Binds to 127.0.0.1 only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../config.js';
import { NoDatabaseError, openReadOnly, type DB } from '../db/db.js';
import * as repo from '../db/repo.js';
import type { AnnotationKind } from '../types.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC: Record<string, string> = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/app.css': 'app.css',
};
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const KINDS = new Set<AnnotationKind>(['highlight', 'note', 'bookmark']);

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https://m.media-amazon.com https://images-na.ssl-images-amazon.com; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function parseKinds(v: string | null): AnnotationKind[] | undefined {
  if (!v) return undefined;
  const kinds = v.split(',').filter((k): k is AnnotationKind => KINDS.has(k as AnnotationKind));
  return kinds.length ? kinds : undefined;
}

export function createApp(dbFile = paths.db, port: number) {
  let db: DB | null = null;
  const getDb = () => (db ??= openReadOnly(dbFile));
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(JSON.stringify(body));
  };

  const api: Record<string, (q: URLSearchParams, db: DB) => unknown> = {
    '/api/status': (_q, d) => repo.status(d),
    '/api/books': (_q, d) => repo.listBooks(d),
    '/api/book': (q, d) =>
      repo.getBookAnnotations(d, q.get('asin') ?? '', { kinds: parseKinds(q.get('kinds')), includeDeleted: q.get('deleted') === '1' }),
    '/api/search': (q, d) =>
      repo.search(d, q.get('q') ?? '', { asin: q.get('asin') || undefined, kinds: parseKinds(q.get('kinds')), limit: 100 }),
    '/api/recent': (q, d) => repo.recent(d, { limit: 50, kinds: parseKinds(q.get('kinds')) }),
    '/api/random': (q, d) => repo.randomHighlight(d, q.get('asin') || undefined),
  };

  const server = http.createServer((req, res) => {
    // Reject requests for other host names (protects against DNS-rebinding attacks).
    if (!allowedHosts.has(req.headers.host ?? '')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    // The data API only answers the page itself, not requests started by other websites
    // (browsers send Sec-Fetch-Site). Opening the page from a link stays possible.
    const site = req.headers['sec-fetch-site'];
    if (req.url?.startsWith('/api/') && site && site !== 'same-origin' && site !== 'none') {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }

    const handler = api[url.pathname];
    if (handler) {
      try {
        json(res, 200, handler(url.searchParams, getDb()));
      } catch (err) {
        if (err instanceof NoDatabaseError) {
          json(res, 503, { error: 'There is no data. Run `kindle-notes sync`.' });
        } else {
          console.error(err);
          json(res, 500, { error: 'Internal error. Refer to the terminal for details.' });
        }
      }
      return;
    }

    const file = STATIC[url.pathname];
    if (file) {
      const full = path.join(PUBLIC_DIR, file);
      res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(full)]}; charset=utf-8`, ...SECURITY_HEADERS });
      fs.createReadStream(full).pipe(res);
      return;
    }
    res.writeHead(404).end('Not found');
  });
  // A malformed request must not stop the server.
  server.on('clientError', (_err, socket) => socket.destroy());
  return server;
}

export function runWebServer(port: number): Promise<http.Server> {
  const server = createApp(paths.db, port);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
