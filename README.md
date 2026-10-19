# Kindle Notes

[![CI](https://github.com/0xpili/kindle-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/0xpili/kindle-notes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Kindle Notes copies your Kindle highlights, notes, and bookmarks from your Amazon account to a database on your computer.
You can then read the data in a local web page.
Claude and other AI assistants can also search the data through an MCP server.

- You do not connect the Kindle device with a USB cable. The data comes from `read.amazon.com`.
- The tool does not see or keep your Amazon password. You log in to Amazon in a Chrome window. The tool then uses that session again.
- All the data stays on your computer, in the `~/.kindle-notes/` folder.

> Kindle Notes is not an Amazon product. Amazon did not examine or accept this tool.
> Refer to [Disclaimer](#disclaimer).

## Requirements

- macOS or Linux
- Node.js 22 or higher
- pnpm. To install pnpm, run `npm install -g pnpm`.
- Git
- Google Chrome
- An account on amazon.com

## Procedure: Install

1. Clone the repository:

   ```bash
   git clone https://github.com/0xpili/kindle-notes.git
   cd kindle-notes
   ```

2. Install the dependencies:

   ```bash
   pnpm install
   ```

3. Build the tool:

   ```bash
   pnpm build
   ```

4. Add the `kindle-notes` command to your computer:

   ```bash
   npm link
   ```

5. Make sure that the command works:

   ```bash
   kindle-notes help
   ```

If you do not do step 4, use `node dist/cli.js` in place of `kindle-notes` in all commands.
Run these commands in the `kindle-notes` folder.

If Google Chrome is not on your computer, install the Chromium browser for Playwright:

```bash
npx playwright install chromium
```

## Procedure: Get a new version

1. Go to the `kindle-notes` folder.
2. Run these commands:

   ```bash
   git pull
   pnpm install
   pnpm build
   ```

You do not have to do `npm link` again.
Your data in `~/.kindle-notes/` does not change.

## Procedure: Remove the tool

1. In the `kindle-notes` folder, run `npm unlink -g kindle-notes`.
2. Delete the `kindle-notes` folder.
3. To delete your data and your Amazon session, delete the `~/.kindle-notes/` folder.

## Procedure: Get your notes

1. Run `kindle-notes login`. A Chrome window opens.
2. Log in to Amazon in the Chrome window. When the Kindle notebook page shows, the window closes.
3. Run `kindle-notes sync`. The tool copies all your data. The sync uses approximately 3 to 4 seconds for each book.
4. Run `kindle-notes ui`.
5. Open http://127.0.0.1:4477 in your web browser.

To get new notes from Amazon, run `kindle-notes sync` again.
You can do the sync many times. The sync adds new items and changes the items that changed on Amazon.
The sync does not make duplicate items.

Amazon asks for your password again when your last login is more than 1 hour old.
If you run the sync in a terminal, the sync opens Chrome.
Type your password in the Chrome window. The sync then continues.

If the sync runs without a terminal, the sync stops with exit code 2.
A scheduled job is an example of a sync without a terminal.
Run `kindle-notes login` or `kindle-notes sync` in a terminal, then the next scheduled sync will work for 1 hour.

## Commands

| Command | Function |
|---|---|
| `kindle-notes login` | Opens Chrome. You log in to Amazon. |
| `kindle-notes sync` | Copies all highlights, notes, and bookmarks to the database. |
| `kindle-notes sync --no-bookmarks` | Copies only highlights and notes. This option is faster. It does not get bookmarks or dates. |
| `kindle-notes sync --book <ASIN>` | Copies the data of one book. |
| `kindle-notes sync --no-login` | Does not open Chrome if Amazon asks for your password. The sync stops with exit code 2. |
| `kindle-notes ui [--port 4477]` | Starts the web page at http://127.0.0.1:4477. |
| `kindle-notes mcp` | Starts the MCP server (stdio). |
| `kindle-notes status` | Shows the quantity of items and the result of the last sync. |

## The web page

The web page has these parts:

- A list of books, with covers. Use the filter box to find a book.
- The highlights of the book that you select, in the sequence of the book.
- Buttons to show all items, only highlights, only notes, or only bookmarks.
- A search box. Press `/` to go to the search box.
- A "Random" button. This button shows one highlight that the tool selects at random.
- A "Copy" button on each item.

The web page has a light mode and a dark mode.

## Procedure: Connect the MCP server to Claude

1. Install Kindle Notes. Refer to [Install](#procedure-install).
2. Do the procedure in [Get your notes](#procedure-get-your-notes).
3. Run this command:

   ```bash
   claude mcp add kindle-notes -- kindle-notes mcp
   ```

4. Start a new Claude Code session.

If you did not do `npm link`, use the full path to `dist/cli.js`:

```bash
claude mcp add kindle-notes -- node /full/path/to/kindle-notes/dist/cli.js mcp
```

For other MCP clients, use this configuration:

```json
{
  "mcpServers": {
    "kindle-notes": { "command": "kindle-notes", "args": ["mcp"] }
  }
}
```

The MCP server has these tools. The tools only read the local database. The tools do not connect to Amazon.

| Tool | Function |
|---|---|
| `search_notes` | Finds words in highlights, notes, and bookmarks. |
| `list_books` | Shows all books and the quantity of items in each book. |
| `get_book_notes` | Shows all items of one book, in the sequence of the book. |
| `recent_notes` | Shows the newest items. |
| `random_highlight` | Shows one highlight that the tool selects at random. |
| `sync_status` | Shows the time of the last sync. |

Examples of text that you can write to Claude:

- "What did I highlight about habits?"
- "Make a summary of my notes on the book Deep Work."
- "Show my bookmarks in my last book."

## How the tool gets the data

| Data | Source |
|---|---|
| Highlights (full text, color, page, location) and notes | The Kindle notebook pages on `read.amazon.com` |
| Bookmarks, dates, and highlights that the export limit hides | The Kindle web reader. The tool opens each book in a hidden browser window. |

For more data, refer to [docs/DESIGN.md](docs/DESIGN.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

## Limits

- **Export limit:** The publisher of a book sets a limit on the text that Amazon exports.
  For a highlight after this limit, Amazon gives only part of the text.
  The tool keeps this part and shows the label "partial".
- **Books with only bookmarks:** Amazon does not show these books in the notebook. The tool cannot find them.
- **Personal documents:** Amazon usually does not show documents from "Send to Kindle" in the notebook.
- **Amazon regions:** At this time, you can use the tool only with amazon.com accounts.
- **Changes to Amazon pages:** The tool uses Amazon pages that Amazon does not document.
  If Amazon changes these pages, the sync stops with the message "Amazon page format changed".
  The sync does not save incorrect data. To repair the tool, change `src/amazon/parse.ts`.

CAUTION: The sync opens each book in the Kindle web reader to get the bookmarks.
Amazon then shows the date of the sync as the "last annotated" date of each book.
The tool does not turn pages. But we did not do a test of this on a Kindle device.
To prevent this change, use `kindle-notes sync --no-bookmarks`.

## Development

```bash
pnpm install
pnpm test        # Tests that use sample pages. The tests do not connect to Amazon.
pnpm typecheck
pnpm build
```

Refer to [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Kindle Notes is not an Amazon product.
Amazon did not examine or accept this tool.
"Kindle" and "Amazon" are trademarks of Amazon.com, Inc. or its affiliates.

The tool reads your data from your Amazon account, with your session.
Make sure that your use of the tool obeys the Amazon Conditions of Use.
You use the tool at your own risk.

## License

[MIT](LICENSE)
