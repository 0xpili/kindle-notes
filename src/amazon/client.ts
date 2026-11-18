// Fetches notebook data through the logged-in browser page (same cookies, same origin).
import type { Page } from 'playwright';
import { AMAZON_READ_URL, REQUEST_DELAY_MS } from '../config.js';
import type { Book, NotebookAnnotation, ReaderAnnotation } from '../types.js';
import { SessionExpiredError, isSignInUrl } from './browser.js';
import { PageFormatError, hasLibrary, parseAnnotationsPage, parseLibrary, parseReaderAnnotations } from './parse.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_PAGES_PER_BOOK = 100;

/** Amazon gives the library token already URL-encoded. Do not encode it again. */
export function libraryPageUrl(token: string): string {
  return `/notebook?library=list&token=${token}`;
}

interface FetchResult {
  status: number;
  url: string;
  text: string;
}

export class NotebookClient {
  constructor(
    private readonly page: Page,
    private readonly delayMs = REQUEST_DELAY_MS,
  ) {}

  /** Load the notebook once so later fetches run on read.amazon.com with the session. */
  async open(): Promise<void> {
    await this.page.goto(`${AMAZON_READ_URL}/notebook`, { waitUntil: 'domcontentloaded' });
    if (isSignInUrl(this.page.url())) throw new SessionExpiredError();
  }

  private async get(pathAndQuery: string, attempt = 1): Promise<FetchResult> {
    await sleep(this.delayMs);
    let res: FetchResult;
    try {
      res = await this.page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        return { status: r.status, url: r.url, text: await r.text() };
      }, pathAndQuery);
    } catch (err) {
      if (attempt < 3) return this.get(pathAndQuery, attempt + 1);
      throw err;
    }
    if (isSignInUrl(res.url) || res.status === 401 || res.status === 403) throw new SessionExpiredError();
    if (res.status >= 500 && attempt < 3) {
      await sleep(this.delayMs * 2 ** attempt);
      return this.get(pathAndQuery, attempt + 1);
    }
    if (res.status !== 200) throw new Error(`Amazon returned HTTP ${res.status} for ${pathAndQuery}`);
    return res;
  }

  async getLibrary(): Promise<Book[]> {
    const first = await this.get('/notebook');
    if (!hasLibrary(first.text)) {
      if (/ap_email|signin|auth-portal/i.test(first.text)) throw new SessionExpiredError();
      throw new PageFormatError('notebook page has no library container');
    }
    const { books, nextPageToken } = parseLibrary(first.text);
    let token = nextPageToken;
    for (let i = 0; token && i < 50; i++) {
      // Not verified (test account fits on one page); fail loudly rather than skip books.
      const more = await this.get(libraryPageUrl(token));
      const page = parseLibrary(`<div id="kp-notebook-library">${more.text}</div>`);
      if (page.books.length === 0) {
        throw new PageFormatError('library has more pages but the next page could not be read; please report this');
      }
      books.push(...page.books);
      token = page.nextPageToken;
    }
    return books;
  }

  async getBookAnnotations(asin: string): Promise<NotebookAnnotation[]> {
    const out: NotebookAnnotation[] = [];
    let token = '';
    let state = '';
    for (let n = 0; n < MAX_PAGES_PER_BOOK; n++) {
      const res = await this.get(
        `/notebook?asin=${encodeURIComponent(asin)}&contentLimitState=${encodeURIComponent(state)}&token=${encodeURIComponent(token)}`,
      );
      const page = parseAnnotationsPage(res.text, asin);
      if (n === 0 && page.rowCount === 0 && !res.text.includes('kp-notebook-content-limit-state')) {
        throw new PageFormatError(`annotations page for ${asin} has an unexpected format`);
      }
      out.push(...page.annotations);
      if (!page.nextPageToken) return out;
      token = page.nextPageToken;
      state = page.contentLimitState ?? '';
    }
    throw new Error(`Stopped after ${MAX_PAGES_PER_BOOK} pages for ${asin}`);
  }
}

/**
 * Bookmarks and dates come from the web reader. Its API needs a per-session device token,
 * so we open the book in the reader and listen to the response the reader itself requests.
 */
export async function getReaderAnnotations(page: Page, asin: string, timeoutMs = 45_000): Promise<ReaderAnnotation[]> {
  const responseP = page.waitForResponse(
    (r) => r.url().includes('/service/mobile/reader/getAnnotations') && r.url().includes(`asin=${asin}`),
    { timeout: timeoutMs },
  );
  await page.goto(`${AMAZON_READ_URL}/?asin=${encodeURIComponent(asin)}`, { waitUntil: 'domcontentloaded' });
  if (isSignInUrl(page.url())) throw new SessionExpiredError();
  const res = await responseP;
  if (res.status() !== 200) throw new Error(`reader annotations returned HTTP ${res.status()}`);
  return parseReaderAnnotations(await res.json());
}
