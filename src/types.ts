export type AnnotationKind = 'highlight' | 'note' | 'bookmark';

export interface Book {
  asin: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  /** As shown by Amazon, e.g. "Sunday, October 18, 2026". */
  lastAnnotated: string | null;
}

/** A highlight or note as listed on the notebook page. */
export interface NotebookAnnotation {
  id: string;
  asin: string;
  kind: 'highlight' | 'note';
  /** Highlight text, or the note text for a freestanding note. */
  text: string;
  /** Note attached to a highlight. */
  note: string | null;
  color: string | null;
  location: number | null;
  page: string | null;
  /** Position decoded from Amazon's id; only used for ordering. */
  position: number | null;
}

export interface NotebookPage {
  annotations: NotebookAnnotation[];
  nextPageToken: string | null;
  contentLimitState: string | null;
  /** Number of rows found on the page, including ones we could not parse. */
  rowCount: number;
}

/** An entry from the web reader's getAnnotations response. */
export interface ReaderAnnotation {
  type: 'highlight' | 'note' | 'bookmark';
  start: number;
  end: number;
  context: string | null;
  note: string | null;
  color: string | null;
  modifiedAt: number | null;
}

/** A row ready to be written to the database. */
export interface AnnotationRecord {
  id: string;
  asin: string;
  kind: AnnotationKind;
  text: string;
  note: string | null;
  color: string | null;
  location: number | null;
  page: string | null;
  position: number | null;
  createdAt: number | null;
  isPartial: boolean;
  source: 'notebook' | 'reader';
  raw: string;
}
