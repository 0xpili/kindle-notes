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
