// Parsers for read.amazon.com pages. All Amazon-specific selectors live in this file,
// so when Amazon changes its markup this is the only place to fix (see tests/parse.test.ts).
import * as cheerio from 'cheerio';
import type { Book, NotebookAnnotation, NotebookPage, ReaderAnnotation } from '../types.js';

export class PageFormatError extends Error {
  constructor(message: string) {
    super(`Amazon page format changed: ${message}. Refer to CONTRIBUTING.md to repair the parser.`);
    this.name = 'PageFormatError';
  }
}

/** Amazon annotation ids are base64 of "customerId:ASIN:position:TYPE:uuid". */
export function decodeAnnotationId(id: string): { asin: string; position: number; type: string } | null {
  try {
    const parts = Buffer.from(id, 'base64').toString('utf8').split(':');
    if (parts.length !== 5) return null;
    const position = Number(parts[2]);
    if (!parts[1] || !Number.isFinite(position)) return null;
    return { asin: parts[1], position, type: parts[3] ?? '' };
  } catch {
    return null;
  }
}

const clean = (s: string) => s.replace(/ /g, ' ').trim();

export function hasLibrary(html: string): boolean {
  return cheerio.load(html)('#kp-notebook-library').length > 0;
}

export function parseLibrary(html: string): { books: Book[]; nextPageToken: string | null } {
  const $ = cheerio.load(html);
  const library = $('#kp-notebook-library');
  if (library.length === 0) throw new PageFormatError('library container #kp-notebook-library not found');

  const books: Book[] = [];
  library.find('.kp-notebook-library-each-book').each((_, el) => {
    const node = $(el);
    const asin = node.attr('id');
    const title = clean(node.find('h2').first().text());
    if (!asin || !title) return;
    const byline = clean(node.find('p').first().text());
    books.push({
      asin,
      title,
      author: byline.replace(/^By:\s*/i, '') || null,
      coverUrl: node.find('img.kp-notebook-cover-image').attr('src') ?? null,
      lastAnnotated: (node.find(`#kp-notebook-annotated-date-${asin}`).attr('value') ?? '') || null,
    });
  });
  const next = library.find('.kp-notebook-library-next-page-start').attr('value');
  return { books, nextPageToken: next || null };
}

function parseHeader(header: string): { color: string | null; location: number | null; page: string | null } {
  const text = clean(header);
  const color = /^(\w+)\s+highlight/i.exec(text)?.[1]?.toLowerCase() ?? null;
  const location = /Location:\s*([\d,]+)/i.exec(text)?.[1];
  const page = /Page:\s*([\w-]+)/i.exec(text)?.[1] ?? null;
  return { color, location: location ? Number(location.replace(/,/g, '')) : null, page };
}

export function parseAnnotationsPage(html: string, asin: string): NotebookPage {
  const $ = cheerio.load(html);
  const annotations: NotebookAnnotation[] = [];
  const rows = $('div.a-row.a-spacing-base[id]').filter((_, el) => decodeAnnotationId($(el).attr('id') ?? '') !== null);

  rows.each((_, el) => {
    const row = $(el);
    const id = row.attr('id')!;
    const decoded = decodeAnnotationId(id)!;
    const locInput = Number(row.find('#kp-annotation-location').attr('value'));
    const highlightText = clean(row.find('[id^="highlight-"] #highlight').text());
    const noteText = clean(row.find('[id^="note-"] #note').text());

    if (highlightText) {
      const header = parseHeader(row.find('#annotationHighlightHeader').text());
      annotations.push({
        id,
        asin,
        kind: 'highlight',
        text: highlightText,
        note: noteText || null,
        color: header.color ?? colorFromClass(row.find('[id^="highlight-"]').attr('class')),
        location: header.location ?? (Number.isFinite(locInput) ? locInput : null),
        page: header.page,
        position: decoded.position,
      });
    } else if (noteText) {
      const header = parseHeader(row.find('#annotationNoteHeader').text());
      annotations.push({
        id,
        asin,
        kind: 'note',
        text: noteText,
        note: null,
        color: null,
        location: header.location ?? (Number.isFinite(locInput) ? locInput : null),
        page: header.page,
        position: decoded.position,
      });
    }
  });

  const value = (selector: string) => $(selector).first().attr('value') || null;
  return {
    annotations,
    nextPageToken: value('input.kp-notebook-annotations-next-page-start'),
    contentLimitState: value('input.kp-notebook-content-limit-state'),
    rowCount: rows.length,
  };
}

function colorFromClass(cls: string | undefined): string | null {
  return /kp-notebook-highlight-(\w+)/.exec(cls ?? '')?.[1] ?? null;
}

interface RawReaderAnnotation {
  type?: string;
  start?: number;
  end?: number;
  context?: string | null;
  note?: string | null;
  highlightColor?: string | null;
  modifiedTimestamp?: number | null;
}

export function parseReaderAnnotations(json: unknown): ReaderAnnotation[] {
  const list = (json as { annotations?: RawReaderAnnotation[] } | null)?.annotations;
  if (!Array.isArray(list)) throw new PageFormatError('reader annotations response has no "annotations" array');
  const out: ReaderAnnotation[] = [];
  for (const a of list) {
    const type = a.type?.replace(/^kindle\./, '');
    if (type !== 'highlight' && type !== 'note' && type !== 'bookmark') continue;
    if (typeof a.start !== 'number') continue;
    out.push({
      type,
      start: a.start,
      end: typeof a.end === 'number' ? a.end : a.start,
      context: a.context?.trim() || null,
      note: a.note?.trim() || null,
      color: a.highlightColor ?? null,
      modifiedAt: a.modifiedTimestamp ?? null,
    });
  }
  return out;
}
