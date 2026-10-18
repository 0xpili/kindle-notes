import { openBrowser, firstPage, SessionExpiredError } from '../amazon/browser.js';
import { NotebookClient, getReaderAnnotations } from '../amazon/client.js';
import { paths } from '../config.js';
import { openWritable } from '../db/db.js';
import { finishSyncRun, saveBookAnnotations, startSyncRun, upsertBook } from '../db/repo.js';
import type { ReaderAnnotation } from '../types.js';
import { mergeBook } from './merge.js';

export interface SyncOptions {
  bookmarks: boolean;
  onlyAsin?: string;
  log: (msg: string) => void;
}

export interface SyncSummary {
  books: number;
  added: number;
  updated: number;
  removed: number;
  errors: string[];
  warnings: string[];
}

export async function runSync(opts: SyncOptions): Promise<SyncSummary> {
  const db = openWritable(paths.db);
  const runId = startSyncRun(db);
  const summary: SyncSummary = { books: 0, added: 0, updated: 0, removed: 0, errors: [], warnings: [] };
  const ctx = await openBrowser({ headless: true }).catch((err) => {
    finishSyncRun(db, runId, { status: 'failed', ...summary, errors: [String(err.message)] });
    db.close();
    throw err;
  });

  try {
    const notebookPage = await firstPage(ctx);
    const readerPage = opts.bookmarks ? await ctx.newPage() : null;
    const client = new NotebookClient(notebookPage);
    await client.open();

    let books = await client.getLibrary();
    if (opts.onlyAsin) books = books.filter((b) => b.asin === opts.onlyAsin);
    opts.log(`The notebook has ${books.length} book(s) with annotations.`);

    for (const [i, book] of books.entries()) {
      const label = `[${i + 1}/${books.length}] ${book.title}`;
      try {
        const notebook = await client.getBookAnnotations(book.asin);
        let reader: ReaderAnnotation[] | null = null;
        if (readerPage) {
          try {
            reader = await getReaderAnnotations(readerPage, book.asin);
          } catch (err) {
            if (err instanceof SessionExpiredError) throw err;
            summary.warnings.push(`${book.title}: the tool did not update the bookmarks and dates (${(err as Error).message.split('\n')[0]})`);
          }
        }
        const merged = mergeBook(book.asin, notebook, reader);
        upsertBook(db, book);
        const saved = saveBookAnnotations(db, book.asin, merged.records, {
          reconcileNotebook: true,
          reconcileReader: reader !== null,
        });
        summary.books++;
        summary.added += saved.added;
        summary.updated += saved.updated;
        summary.removed += saved.removed;
        summary.warnings.push(...saved.warnings);
        const extra = [
          merged.bookmarkCount ? `${merged.bookmarkCount} bookmarks` : '',
          merged.partialCount ? `${merged.partialCount} partial (export limit)` : '',
        ].filter(Boolean);
        opts.log(`${label}: ${notebook.length} highlights/notes${extra.length ? ', ' + extra.join(', ') : ''} (+${saved.added} new)`);
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        const msg = `${book.title}: ${(err as Error).message.split('\n')[0]}`;
        summary.errors.push(msg);
        opts.log(`${label}: FAILED. ${msg}`);
      }
    }

    finishSyncRun(db, runId, { status: summary.errors.length ? 'partial' : 'ok', ...summary });
    return summary;
  } catch (err) {
    finishSyncRun(db, runId, { status: 'failed', ...summary, errors: [...summary.errors, (err as Error).message] });
    throw err;
  } finally {
    await ctx.close().catch(() => {});
    db.close();
  }
}
