// Plain-text rendering shared by the MCP server and the CLI.
import type { AnnotationRow, BookSummary } from './db/repo.js';

export function formatDate(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString().slice(0, 10) : null;
}

export function formatWhere(a: Pick<AnnotationRow, 'page' | 'location' | 'source'>): string | null {
  if (a.page) return `page ${a.page}`;
  if (a.location != null) return `${a.source === 'reader' ? '~' : ''}location ${a.location}`;
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Wrap in quotes unless the highlight already starts with one. */
const quoted = (t: string) => (/^["“‘']/.test(t) ? t : `“${t}”`);

export function formatAnnotation(a: AnnotationRow, opts: { withBook?: boolean } = {}): string {
  const meta = [
    a.kind === 'highlight' && a.color ? `${a.color} highlight` : a.kind,
    formatWhere(a),
    formatDate(a.createdAt),
    a.isPartial ? 'PARTIAL: text cut by Amazon export limit' : null,
    a.deleted ? 'deleted on Amazon' : null,
  ].filter(Boolean);
  const lines = [];
  if (opts.withBook) lines.push(`📖 ${a.bookTitle}${a.bookAuthor ? ` — ${a.bookAuthor}` : ''}`);
  lines.push(`[${meta.join(' · ')}]`);
  if (a.kind === 'bookmark') lines.push(a.text ? `Bookmarked near: “${a.text}…”` : 'Bookmark');
  else lines.push(a.kind === 'note' ? `Note: ${a.text}` : quoted(a.text));
  if (a.note) lines.push(`Note: ${a.note}`);
  return lines.join('\n');
}

export function formatBook(b: BookSummary): string {
  const counts = [plural(b.highlights, 'highlight'), plural(b.notes, 'note'), plural(b.bookmarks, 'bookmark')].join(', ');
  const last = formatDate(b.lastActivity);
  return `${b.title}${b.author ? ` — ${b.author}` : ''} (asin ${b.asin}): ${counts}${last ? `; latest ${last}` : ''}`;
}
