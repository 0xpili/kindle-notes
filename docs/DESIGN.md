# Kindle Notes: Design

This document gives the design of Kindle Notes.
Read it together with [REQUIREMENTS.md](REQUIREMENTS.md).
We examined the data sources with an Amazon account on 2026-10-18.

## Data sources

The tool sends all requests through a Chrome browser that Playwright controls.
The browser uses its own profile in `~/.kindle-notes/browser-profile`.
The user logs in to Amazon in this browser. The tool does not see the password.

### 1. Library

The tool gets `https://read.amazon.com/notebook` (HTML).

- Each book is a `div.kp-notebook-library-each-book` element. The `id` attribute is the ASIN.
- The `h2` element has the title. The `p` element has the text "By: author".
- The `img.kp-notebook-cover-image` element has the cover.
- The notebook shows only books that have highlights or notes.
- The `input.kp-notebook-library-next-page-start` element shows if more books are on a different page.
  We did not do a test of this pagination. If the tool cannot read the next page, the sync stops with an error.

### 2. Notebook annotations for each book

The tool gets `/notebook?asin=ASIN&contentLimitState=STATE&token=TOKEN` (an HTML fragment).
We did a test of the pagination with books that have more than 100 highlights.

- Each annotation is a `div.a-row.a-spacing-base` element.
  The `id` attribute is base64 text for `customerId:ASIN:position:HIGHLIGHT|NOTE:uuid`.
  This identifier does not change. The tool uses it as the primary key.
- `input#kp-annotation-location` has the Kindle location.
- `#annotationHighlightHeader` has the color and the location or the page.
  Example: "Yellow highlight | Location: 679".
- `[id^=highlight-] span#highlight` has the text of the highlight.
- `[id^=note-] span#note` has the note of the highlight. If there is no note, the element is empty.
- A row without a highlight is a note without a highlight. It has the header `#annotationNoteHeader`.
- `input.kp-notebook-annotations-next-page-start` and `input.kp-notebook-content-limit-state` have the values for the next page.

### 3. Reader annotations for each book

The tool opens `https://read.amazon.com/?asin=ASIN` in a hidden browser window.
The web reader sends a request to `/service/mobile/reader/getAnnotations`.
This request must have a device token for the session.
Thus the tool does not send the request. The tool only reads the response that the web reader gets.
The tool uses 1 to 3 seconds for each book.

The response is JSON. Each item in `annotations[]` has these fields:

- `type`: `kindle.highlight`, `kindle.note`, or `kindle.bookmark`
- `start` and `end`: the position in the book
- `context`: the text. The web reader cuts the text after approximately 100 characters.
- `note` and `modifiedTimestamp`.

This source gives the bookmarks, the dates, and the highlights that the export limit hides.

## Rules to merge the two sources

### Text comparison

- The notebook is the source of the full text of highlights and notes.
- The positions in the two sources use different units.
  Example: for one highlight, the notebook position is 101706 and the reader position is 21350.
  Thus the tool compares the text, not the position.
- Before the tool compares the text, it changes the text:
  - It changes curved quotes to straight quotes.
  - It removes the spaces that are not necessary.
  - It changes all characters to lowercase.
- A reader highlight agrees with a notebook highlight if the notebook text starts with the reader text.
- The reader text can also start with the word before a dash, for example "possible—they are".
  The tool accepts this condition if the notebook text starts in the first 30 characters of the reader text.

### Sequence and dates

- The tool examines the two lists in the sequence of the book.
- The tool uses each notebook highlight only one time. Thus two highlights with the same text do not cause an error.
- If a reader highlight agrees with a notebook highlight, the tool copies the date to the notebook highlight.
- The tool uses reader notes only to find the date of a notebook note. The tool does not make new rows from reader notes.

### Partial highlights and bookmarks

- If a reader highlight does not agree with a notebook highlight, the tool keeps it as a partial highlight.
  Its identifier is `reader:ASIN:start`.
- The identifier of a bookmark is `bookmark:ASIN:start`. Its text is the reader text near the bookmark.
- The tool calculates the approximate position of bookmarks and partial highlights.
  It uses linear interpolation between the highlights that agree.
- The Kindle location is the notebook position divided by 150, plus 1.

### Errors in the reader step

- If the reader step causes an error for a book, the tool saves the notebook data.
- The tool does not change the bookmarks and partial highlights of that book.
- The tool does not replace a date with an empty value.

## Database

The tool uses SQLite in `~/.kindle-notes/kindle.db`.
To use a different folder, set the `KINDLE_NOTES_HOME` environment variable.
The tool uses `better-sqlite3`, because the SQLite module of Node.js does not have FTS5 on all computers.
`PRAGMA user_version` keeps the version of the schema.

```
books(asin PK, title, author, cover_url, last_annotated, first_seen_at, synced_at)
annotations(id PK, asin FK, kind, text, note, color, location, page, position,
            created_at, is_partial, source, raw, first_seen_at, updated_at, deleted_at)
annotations_fts   -- FTS5 index of text and note. Triggers keep it current.
sync_runs(id, started_at, finished_at, status, books, added, updated, removed, errors)
```

- The `raw` column keeps the source data. If we repair a parser, we can process the data again without a new sync.
- The tool writes each book in one transaction. If the sync stops, the books before it stay in the database.
- When a notebook item is not on Amazon any more, the tool sets `deleted_at`. The tool does not remove the row.
- If an item comes back, the tool clears `deleted_at`.
- The tool removes a partial highlight when the full highlight replaces it. A partial highlight is only a copy.
- The tool does not set `deleted_at` for more than 50% of the items of a book in one sync.
  This condition usually shows a problem with the parser. The tool shows a message.
- The database uses WAL mode and `busy_timeout`.
  The web page and the MCP server open the database in read-only mode.
  Thus they can read data during a sync.
- The search changes each word of the user to a quoted FTS5 term.
  Thus characters such as `"`, `-`, and `:` cannot cause an error.
  If FTS5 finds no item with all the words, the search finds items with one or more of the words.

## Components

```
src/
  config.ts            Folders, URL, and the time between requests
  types.ts             Shared types
  amazon/parse.ts      Parsers for Amazon pages (functions without side effects)
  amazon/browser.ts    Starts Chrome, login procedure, session errors
  amazon/client.ts     Gets the library and the annotation pages. Reads the reader response.
  sync/merge.ts        Merges the notebook data and the reader data (no side effects)
  sync/sync.ts         Controls the sync and writes sync_runs
  db/db.ts             Opens the database and updates the schema
  db/repo.ts           Writes and reads the data
  format.ts            Text format for the MCP server
  mcp/server.ts        MCP server (stdio, read-only)
  web/server.ts        HTTP server on 127.0.0.1
  web/public/          The web page (HTML, CSS, and JavaScript, without a build step)
  cli.ts               Command-line interface
```

Only the `sync` command connects to Amazon.
The web page and the MCP server only read the database.
The tool loads Playwright only for `login` and `sync`. Thus the web page and the MCP server start quickly.

## Safety and quality

- TypeScript in strict mode, ES modules, and Node.js 22 or higher.
- The tests use sample pages in `tests/fixtures`. The sample pages have the structure of real Amazon pages, but they do not have personal data.
- All Amazon selectors are in `src/amazon/parse.ts`.
- If a page does not have the correct structure, the tool stops with "Amazon page format changed". It does not save incorrect data.
- After each request, the tool examines the URL. If Amazon sends the sign-in page, the tool stops with exit code 2.
- The tool sends one request at a time, with 700 ms between requests. If a request causes an error, the tool sends it again a maximum of 2 times.
- If the tool cannot get one book, the sync continues with the other books. At the end, the sync stops with exit code 1.
- If `login` and `sync` use the browser profile at the same time, the tool shows a clear error.
- The web server accepts only the `Host` values `127.0.0.1:PORT` and `localhost:PORT`. This prevents DNS rebinding attacks.
- The web page writes all text with `textContent`. It does not use `innerHTML`.
- The web page has a strict Content Security Policy.
- The MCP server examines all inputs with zod.
- The tool makes the data folder with permission 0700 and the database with permission 0600.

## Known limits

- Amazon does not send the full text of highlights after the export limit.
- Books with only bookmarks are not in the notebook. Thus the tool does not find them.
  A new option can examine all books from `/kindle-library/search`. It will use approximately 2 seconds for each book.
- Personal documents from "Send to Kindle" are usually not in the notebook.
- You can use the tool only with amazon.com.
- The web page gets the cover images from the Amazon image server. These are the only external requests of the web page.
- The tool opens each book in the web reader. Amazon then changes the "last annotated" date of the book.
