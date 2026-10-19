#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_UI_PORT, cliCommand, paths } from './config.js';

const HELP = () => `kindle-notes: Copies your Kindle highlights, notes, and bookmarks to your computer.

Commands:
  kindle-notes login                 Opens Chrome. Log in to Amazon.
  kindle-notes sync [options]        Copies all data from read.amazon.com to the local database.
                                     If Amazon asks for your password, the sync opens Chrome for the login.
      --no-bookmarks                 Does not open the web reader. This is faster, but you get no bookmarks or dates.
      --book <ASIN>                  Copies the data of one book only.
  kindle-notes ui [--port ${DEFAULT_UI_PORT}]      Starts the web page at http://127.0.0.1:${DEFAULT_UI_PORT}.
  kindle-notes mcp                   Starts the MCP server (stdio) for Claude.
  kindle-notes status                Shows the quantities and the result of the last sync.

The database is ${paths.db}.
To use a different folder, set KINDLE_NOTES_HOME.
If the tool is not installed, use "${cliCommand()}" in place of "kindle-notes".`;

const EXIT_SESSION = 2;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const log = (m: string) => console.log(m);

  switch (command) {
    case 'login': {
      const { interactiveLogin } = await import('./amazon/browser.js');
      await interactiveLogin(log);
      log(`The login is complete. Now run \`${cliCommand()} sync\`.`);
      return 0;
    }

    case 'sync': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'no-bookmarks': { type: 'boolean', default: false },
          book: { type: 'string' },
          'no-login': { type: 'boolean', default: false },
        },
      });
      const { runSync } = await import('./sync/sync.js');
      // Open the login window only when a person is at the terminal (not in a scheduled job).
      const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !values['no-login'];
      const s = await runSync({ bookmarks: !values['no-bookmarks'], onlyAsin: values.book, interactiveLogin: interactive, log });
      log(`\nThe sync is complete: ${s.books} book(s), ${s.added} new, ${s.updated} changed, ${s.removed} removed.`);
      for (const w of s.warnings) log(`warning: ${w}`);
      for (const e of s.errors) console.error(`error: ${e}`);
      return s.errors.length ? 1 : 0;
    }

    case 'ui': {
      const { values } = parseArgs({ args: rest, options: { port: { type: 'string', default: String(DEFAULT_UI_PORT) } } });
      const port = Number(values.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`The port is not correct: ${values.port}`);
      const { runWebServer } = await import('./web/server.js');
      await runWebServer(port);
      log(`Kindle Notes: open http://127.0.0.1:${port} in your web browser. To stop, press Ctrl+C.`);
      return new Promise(() => {}); // run until interrupted
    }

    case 'mcp': {
      const { runMcpServer } = await import('./mcp/server.js');
      await runMcpServer();
      return new Promise(() => {});
    }

    case 'status': {
      const { openReadOnly } = await import('./db/db.js');
      const { status } = await import('./db/repo.js');
      const db = openReadOnly(paths.db);
      const s = status(db);
      db.close();
      log(`${s.books} books · ${s.highlights} highlights (${s.partial} partial) · ${s.notes} notes · ${s.bookmarks} bookmarks`);
      if (s.lastSync) {
        log(`Last sync: ${new Date(s.lastSync.startedAt).toLocaleString()} — ${s.lastSync.status}`);
        for (const e of s.lastSync.errors) log(`  error: ${e}`);
      } else log('No sync was done.');
      return 0;
    }

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      log(HELP());
      return 0;

    default:
      console.error(`The command is not known: ${command}\n\n${HELP()}`);
      return 64;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`error: ${err.message}`);
    process.exit(err.name === 'SessionExpiredError' ? EXIT_SESSION : 1);
  },
);
