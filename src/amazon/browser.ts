// Controls a real Chrome with a dedicated profile. The user logs in themselves; we only
// reuse the session cookies stored in that profile. Playwright is imported lazily so the
// UI and MCP server never load it.
import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { AMAZON_READ_URL, paths } from '../config.js';

export class SessionExpiredError extends Error {
  constructor() {
    super('The Amazon session expired, or you did not log in. Run `kindle-notes login`.');
    this.name = 'SessionExpiredError';
  }
}

export class ProfileInUseError extends Error {
  constructor() {
    super('A different process uses the kindle-notes browser profile. Make sure that `login` or `sync` does not run in a different window.');
    this.name = 'ProfileInUseError';
  }
}

export function isSignInUrl(url: string): boolean {
  return /\/ap\/signin|\/ax\/claim|\/ap\/mfa|\/ap\/cvf/.test(url);
}

export async function openBrowser(opts: { headless: boolean }): Promise<BrowserContext> {
  const { chromium } = await import('playwright');
  fs.mkdirSync(paths.browserProfile, { recursive: true, mode: 0o700 });
  const launch = (channel?: string) =>
    chromium.launchPersistentContext(paths.browserProfile, {
      channel,
      headless: opts.headless,
      viewport: opts.headless ? { width: 1280, height: 900 } : null,
    });
  try {
    // Prefer the installed Google Chrome: it is what Amazon expects to see.
    return await launch('chrome');
  } catch (err) {
    const msg = String((err as Error).message);
    if (/ProcessSingleton|already in use|SingletonLock/i.test(msg)) throw new ProfileInUseError();
    if (/chrome.*(not found|is not installed)|Chromium distribution 'chrome'/i.test(msg)) return launch(undefined);
    throw err;
  }
}

export async function firstPage(ctx: BrowserContext): Promise<Page> {
  return ctx.pages()[0] ?? (await ctx.newPage());
}

/**
 * Open a visible window on the Kindle notebook and wait until the user has logged in.
 * Resolves once the library is visible.
 */
export async function interactiveLogin(log: (msg: string) => void, timeoutMs = 10 * 60_000): Promise<void> {
  const ctx = await openBrowser({ headless: false });
  try {
    const page = await firstPage(ctx);
    await page.goto(`${AMAZON_READ_URL}/notebook`);
    log('A Chrome window opened. Log in to Amazon in that window. This tool does not see your password.');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (page.isClosed()) throw new Error('The login window closed before the login was complete.');
      const ready = await page
        .evaluate(() => location.pathname.startsWith('/notebook') && !!document.querySelector('#kp-notebook-library'))
        .catch(() => false);
      if (ready) return;
      if (Date.now() > deadline) throw new Error('The login did not occur in the time limit. Run `kindle-notes login` again.');
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}
