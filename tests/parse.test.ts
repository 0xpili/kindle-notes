import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PageFormatError, decodeAnnotationId, hasLibrary, parseAnnotationsPage, parseLibrary, parseReaderAnnotations } from '../src/amazon/parse.js';

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseLibrary', () => {
  it('reads books with title, author, cover and date', () => {
    const { books, nextPageToken } = parseLibrary(fixture('library.html'));
    expect(nextPageToken).toBeNull();
    expect(books).toEqual([
      {
        asin: 'B0TESTBOOK',
        title: 'Writing & Thinking',
        author: 'Ada Writer',
        coverUrl: 'https://m.media-amazon.com/images/I/FAKE._SY160.jpg',
        lastAnnotated: 'Sunday, October 18, 2026',
      },
      expect.objectContaining({ asin: 'B0OTHERBK1', author: 'Bo Author and Cy Coauthor' }),
    ]);
  });

  it('fails loudly when the library container is missing (e.g. a sign-in page)', () => {
    expect(hasLibrary('<html><form id="ap_email"></form></html>')).toBe(false);
    expect(() => parseLibrary('<html></html>')).toThrow(PageFormatError);
  });
});

describe('parseAnnotationsPage', () => {
  const page1 = parseAnnotationsPage(fixture('annotations-page1.html'), 'B0TESTBOOK');

  it('reads highlights, attached notes and freestanding notes', () => {
    expect(page1.rowCount).toBe(3);
    expect(page1.annotations.map((a) => [a.kind, a.text, a.note])).toEqual([
      ['highlight', 'The first idea is that good writing is clear thinking made visible.', null],
      ['highlight', 'Simplicity is the “hardest” thing   to achieve.', 'remember this'],
      ['note', 'A freestanding thought about the chapter.', null],
    ]);
  });

  it('reads color, page and location', () => {
    const [first, , note] = page1.annotations;
    expect(first).toMatchObject({ color: 'yellow', page: '2', location: 214 });
    expect(note).toMatchObject({ color: null, page: '230' });
  });

  it('keeps stable Amazon ids and decodes their position', () => {
    const [first] = page1.annotations;
    expect(decodeAnnotationId(first!.id)).toMatchObject({ asin: 'B0TESTBOOK', type: 'HIGHLIGHT' });
    expect(first!.position).toBeGreaterThan(0);
  });

  it('returns pagination tokens', () => {
    expect(page1.nextPageToken).toBe('FAKE_NEXT_TOKEN');
    expect(page1.contentLimitState).toBe('FAKESTATE%3D%3D');
    const page2 = parseAnnotationsPage(fixture('annotations-page2.html'), 'B0TESTBOOK');
    expect(page2.nextPageToken).toBeNull();
    expect(page2.annotations[0]).toMatchObject({ kind: 'highlight', location: 754, page: null });
  });

  it('decodeAnnotationId rejects garbage', () => {
    expect(decodeAnnotationId('not-an-id')).toBeNull();
    expect(decodeAnnotationId('')).toBeNull();
  });
});

describe('parseReaderAnnotations', () => {
  it('reads highlights, notes and bookmarks', () => {
    const items = parseReaderAnnotations(JSON.parse(fixture('reader-annotations.json')));
    const count = (t: string) => items.filter((i) => i.type === t).length;
    expect([count('highlight'), count('note'), count('bookmark')]).toEqual([4, 2, 2]);
    expect(items.find((i) => i.type === 'bookmark')).toMatchObject({ start: 40000, context: 'Chapter four begins with a story about' });
  });

  it('ignores unknown types and rejects unexpected shapes', () => {
    expect(parseReaderAnnotations({ annotations: [{ type: 'kindle.other', start: 1 }] })).toEqual([]);
    expect(() => parseReaderAnnotations({ message: 'nope' })).toThrow(PageFormatError);
  });
});
