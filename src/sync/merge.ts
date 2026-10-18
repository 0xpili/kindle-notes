// Combine notebook data (full text) with reader data (bookmarks, dates, export-capped
// highlights) into rows for the database. Pure: no I/O.
import type { AnnotationRecord, NotebookAnnotation, ReaderAnnotation } from '../types.js';

/** Normalize text so the reader's truncated context can be compared to notebook text. */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when the reader's (possibly cut) context is the start of the notebook text. */
function contextMatches(context: string, fullText: string): boolean {
  const c = normalize(context);
  const t = normalize(fullText);
  if (!c || !t) return false;
  if (t.startsWith(c) || c.startsWith(t)) return true;
  // The reader may include the word before the highlight when they are joined by a dash
  // ("possible-they are ..." vs notebook "they are ..."). Accept the notebook text's start
  // appearing early in the context.
  const head = t.slice(0, Math.min(t.length, 30));
  const at = head.length >= 12 ? c.indexOf(head) : -1;
  return at > 0 && at <= 30;
}

/**
 * Reader positions use different units than notebook positions. Given matched pairs
 * (reader start -> notebook position), estimate a notebook position for a reader-only
 * item by linear interpolation, so bookmarks sort into reading order.
 */
export function estimatePosition(pairs: Array<[number, number]>, readerStart: number): number | null {
  if (pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 1) {
    const [r, n] = sorted[0]!;
    return r > 0 ? Math.round((readerStart * n) / r) : null;
  }
  let lo = sorted[0]!;
  let hi = sorted[1]!;
  for (let i = 0; i < sorted.length - 1; i++) {
    lo = sorted[i]!;
    hi = sorted[i + 1]!;
    if (readerStart <= hi[0]) break;
  }
  if (hi[0] === lo[0]) return lo[1];
  const est = lo[1] + ((readerStart - lo[0]) * (hi[1] - lo[1])) / (hi[0] - lo[0]);
  return Math.max(0, Math.round(est));
}

/** Kindle locations are notebook positions / 150 (verified: 101706 -> location 679). */
export const positionToLocation = (position: number) => Math.floor(position / 150) + 1;

export interface MergeResult {
  records: AnnotationRecord[];
  /** Reader highlights that had no notebook match (stored as partial). */
  partialCount: number;
  bookmarkCount: number;
}

/**
 * @param reader null when the reader step failed or was skipped: then only notebook
 *   rows are produced and no dates are set.
 */
export function mergeBook(asin: string, notebook: NotebookAnnotation[], reader: ReaderAnnotation[] | null): MergeResult {
  const ordered = [...notebook].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const createdAt = new Map<string, number>();
  const records: AnnotationRecord[] = [];
  let partialCount = 0;
  let bookmarkCount = 0;

  const readerRows: AnnotationRecord[] = [];
  if (reader) {
    const readerSorted = [...reader].sort((a, b) => a.start - b.start);
    const usedHighlights = new Set<string>();
    const usedNotes = new Set<string>();
    const highlights = ordered.filter((a) => a.kind === 'highlight');
    const pairs: Array<[number, number]> = [];

    for (const r of readerSorted) {
      if (r.type === 'highlight') {
        // Both lists are in reading order; take the first unused notebook highlight that matches.
        const match = r.context ? highlights.find((h) => !usedHighlights.has(h.id) && contextMatches(r.context!, h.text)) : undefined;
        if (match) {
          usedHighlights.add(match.id);
          if (r.modifiedAt) createdAt.set(match.id, r.modifiedAt);
          if (match.position != null) pairs.push([r.start, match.position]);
        } else if (r.context) {
          partialCount++;
          readerRows.push({
            id: `reader:${asin}:${r.start}`,
            asin,
            kind: 'highlight',
            text: r.context,
            note: null,
            color: r.color,
            location: null,
            page: null,
            position: null,
            createdAt: r.modifiedAt,
            isPartial: true,
            source: 'reader',
            raw: JSON.stringify(r),
          });
        }
      } else if (r.type === 'note' && r.note) {
        // Only used to date the note; the notebook already has the text.
        const target = normalize(r.note);
        const match = ordered.find((a) => !usedNotes.has(a.id) && normalize(a.kind === 'note' ? a.text : (a.note ?? '')) === target);
        if (match && r.modifiedAt) {
          usedNotes.add(match.id);
          if (match.kind === 'note' || !createdAt.has(match.id)) createdAt.set(match.id, r.modifiedAt);
        }
      } else if (r.type === 'bookmark') {
        bookmarkCount++;
        readerRows.push({
          id: `bookmark:${asin}:${r.start}`,
          asin,
          kind: 'bookmark',
          text: r.context ?? '',
          note: null,
          color: null,
          location: null,
          page: null,
          position: null,
          createdAt: r.modifiedAt,
          isPartial: false,
          source: 'reader',
          raw: JSON.stringify(r),
        });
      }
    }

    // Estimate reading-order position for reader-only rows from the matched pairs.
    for (const row of readerRows) {
      const start = (JSON.parse(row.raw) as ReaderAnnotation).start;
      const pos = estimatePosition(pairs, start);
      row.position = pos;
      row.location = pos == null ? null : positionToLocation(pos);
      records.push(row);
    }
  }

  for (const a of ordered) {
    records.push({
      id: a.id,
      asin,
      kind: a.kind,
      text: a.text,
      note: a.note,
      color: a.color,
      location: a.location,
      page: a.page,
      position: a.position,
      createdAt: createdAt.get(a.id) ?? null,
      isPartial: false,
      source: 'notebook',
      raw: JSON.stringify(a),
    });
  }

  return { records, partialCount, bookmarkCount };
}
