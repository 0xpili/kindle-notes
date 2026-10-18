import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAnnotationsPage, parseReaderAnnotations } from '../src/amazon/parse.js';
import { estimatePosition, mergeBook, normalize } from '../src/sync/merge.js';
import type { NotebookAnnotation } from '../src/types.js';

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const notebook = [
  ...parseAnnotationsPage(fixture('annotations-page1.html'), 'B0TESTBOOK').annotations,
  ...parseAnnotationsPage(fixture('annotations-page2.html'), 'B0TESTBOOK').annotations,
];
const reader = parseReaderAnnotations(JSON.parse(fixture('reader-annotations.json')));

describe('normalize', () => {
  it('folds quotes, dashes, spaces and case', () => {
    expect(normalize('  “Hello”—World’s\n end ')).toBe(`"hello"-world's end`);
  });
});

describe('mergeBook', () => {
  const { records, partialCount, bookmarkCount } = mergeBook('B0TESTBOOK', notebook, reader);
  const byText = (t: string) => records.find((r) => r.text.startsWith(t));

  it('keeps every notebook item with its full text', () => {
    expect(records.filter((r) => r.source === 'notebook')).toHaveLength(notebook.length);
  });

  it('dates notebook highlights from the matching reader highlight (curly vs straight quotes)', () => {
    expect(byText('The first idea')?.createdAt).toBe(1790560172000);
    expect(byText('Simplicity is')?.createdAt).toBe(1790646552000);
    expect(byText('Teams are given')?.createdAt).toBe(1790800000000);
  });

  it('dates freestanding notes from the reader note', () => {
    expect(byText('A freestanding thought')?.createdAt).toBe(1790700000000);
  });

  it('stores unmatched reader highlights as partial with a stable id', () => {
    expect(partialCount).toBe(1);
    const partial = records.find((r) => r.isPartial)!;
    expect(partial).toMatchObject({ id: 'reader:B0TESTBOOK:70400', kind: 'highlight', source: 'reader' });
  });

  it('stores bookmarks with stable ids and an estimated reading position', () => {
    expect(bookmarkCount).toBe(2);
    const bookmarks = records.filter((r) => r.kind === 'bookmark');
    expect(bookmarks.map((b) => b.id)).toEqual(['bookmark:B0TESTBOOK:40000', 'bookmark:B0TESTBOOK:80000']);
    for (const b of bookmarks) expect(b.position).not.toBeNull();
  });

  it('does not create rows from reader notes', () => {
    expect(records.filter((r) => r.kind === 'note')).toHaveLength(1);
  });

  it('without reader data: notebook only, no dates', () => {
    const r = mergeBook('B0TESTBOOK', notebook, null);
    expect(r.records).toHaveLength(notebook.length);
    expect(r.records.every((x) => x.createdAt === null)).toBe(true);
  });

  it('matches duplicate highlight texts one-to-one in reading order', () => {
    const base: NotebookAnnotation = { id: 'a', asin: 'X', kind: 'highlight', text: 'Same words here.', note: null, color: 'yellow', location: 1, page: null, position: 100 };
    const nb = [base, { ...base, id: 'b', position: 900 }];
    const rd = [
      { type: 'highlight' as const, start: 10, end: 20, context: 'Same words', note: null, color: null, modifiedAt: 1 },
      { type: 'highlight' as const, start: 90, end: 99, context: 'Same words', note: null, color: null, modifiedAt: 2 },
    ];
    const r = mergeBook('X', nb, rd);
    expect(r.partialCount).toBe(0);
    expect(r.records.find((x) => x.id === 'a')?.createdAt).toBe(1);
    expect(r.records.find((x) => x.id === 'b')?.createdAt).toBe(2);
  });
});

describe('mergeBook dash prefix (seen on real data)', () => {
  it('matches when the reader context includes the word before an em dash', () => {
    const nb: NotebookAnnotation[] = [{ id: 'a', asin: 'X', kind: 'highlight', text: 'they are not experts in the enabling technologies, so they can’t be expected to know', note: null, color: 'yellow', location: 1, page: null, position: 100 }];
    const rd = [{ type: 'highlight' as const, start: 10, end: 20, context: 'possible—they are not experts in the enabling technologies, so they can\'t be expected to k', note: null, color: null, modifiedAt: 5 }];
    const r = mergeBook('X', nb, rd);
    expect(r.partialCount).toBe(0);
    expect(r.records[0]?.createdAt).toBe(5);
  });

  it('does not match unrelated text that merely shares a short start', () => {
    const nb: NotebookAnnotation[] = [{ id: 'a', asin: 'X', kind: 'highlight', text: 'The end.', note: null, color: null, location: 1, page: null, position: 100 }];
    const rd = [{ type: 'highlight' as const, start: 10, end: 20, context: 'Something—The end. And more', note: null, color: null, modifiedAt: 5 }];
    expect(mergeBook('X', nb, rd).partialCount).toBe(1);
  });
});

describe('estimatePosition', () => {
  it('interpolates between matched pairs and extrapolates at the ends', () => {
    const pairs: Array<[number, number]> = [[100, 1000], [200, 3000]];
    expect(estimatePosition(pairs, 150)).toBe(2000);
    expect(estimatePosition(pairs, 50)).toBe(0);
    expect(estimatePosition(pairs, 300)).toBe(5000);
    expect(estimatePosition([], 10)).toBeNull();
  });
});
