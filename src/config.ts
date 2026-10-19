import os from 'node:os';
import path from 'node:path';

/** All app data lives here. Override with KINDLE_NOTES_HOME (used by tests). */
export function homeDir(): string {
  return process.env.KINDLE_NOTES_HOME ?? path.join(os.homedir(), '.kindle-notes');
}

export const paths = {
  get db() {
    return path.join(homeDir(), 'kindle.db');
  },
  get browserProfile() {
    return path.join(homeDir(), 'browser-profile');
  },
};

export const AMAZON_READ_URL = 'https://read.amazon.com';

/** Pause between requests to Amazon, to stay polite. */
export const REQUEST_DELAY_MS = 700;

export const DEFAULT_UI_PORT = 4477;

/**
 * The command the user typed to start the tool, for use in messages.
 * "kindle-notes" when installed, or "node dist/cli.js" (relative to the current folder) when run from source.
 */
export function cliCommand(): string {
  const script = process.argv[1] ?? '';
  if (!/cli\.js$/.test(script)) return 'kindle-notes';
  const rel = path.relative(process.cwd(), script);
  return `node ${rel.startsWith('..') ? script : rel}`;
}
