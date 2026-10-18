# Kindle Notes: Requirements

## Goal

Kindle Notes is a small tool for your computer.
It gets all your Kindle highlights, notes, and bookmarks from your Amazon account.
It keeps the data in one database that you own.
You can read the data in a web page. Claude can also search the data through an MCP server.

## Constraints

- The tool does not use a USB connection to the Kindle device. All the data comes from `read.amazon.com`.
- Amazon does not supply an API for this data.
  The tool uses the same pages as your web browser, with your session.
- The tool does not touch the Amazon password. You log in to Amazon in a browser window that you can see.
  The tool then uses that session again.
- All the data stays on your computer. The tool does not use services from other companies.

## Needs and acceptance criteria

| # | Need | Design | Acceptance criterion |
|---|------|--------|----------------------|
| N1 | Connect to my Kindle account. | `kindle-notes login` opens Chrome. You log in one time. | The sync does not ask for a login again until the session expires. |
| N2 | Save all highlights. | The sync examines each book in the notebook. | The quantity of highlights for each book is equal to the quantity on the notebook page. |
| N3 | Save notes. | The tool keeps each note with its highlight. A note without a highlight is a separate item. | The web page and the MCP server show each note with its highlight. |
| N4 | Save bookmarks. | The tool reads the bookmarks from the web reader. | The bookmarks show in the web page and in the MCP server. |
| N5 | Keep the data current. | The sync updates items and does not make duplicates. | Two syncs, one after the other, give the same quantities. |
| N6 | Do not lose data. | When you remove a highlight on Amazon, the tool keeps it with the label "deleted". | You can see a removed highlight with its label. |
| N7 | Read the data easily. | A local web page with a list of books, highlights for each book, search, filters, and a random highlight. | You can find a highlight with a maximum of 3 clicks or 1 search. |
| N8 | Let Claude search my notes. | An MCP server with tools to search, list books, show a book, show new items, and show a random highlight. | Claude Code can answer "What did I highlight about X?". |
| N9 | Know when the sync stops because of an error. | The tool shows clear errors when Amazon changes its pages or when the session expires. | The sync stops with an exit code that is not zero and with a clear message. |

## Out of scope for version 1

- The full text of highlights after the export limit. Amazon does not send this text.
- Changes to highlights, or changes to the data on Amazon.
- A server on the internet, or more than one user.
- Handwritten notebooks of the Kindle Scribe.

## Engineering principles

- The code base is small. It uses TypeScript in strict mode and a small number of dependencies.
- One SQLite file is the only source of data. The web page and the MCP server only read from it.
- One module contains all the Amazon-specific code.
  Unit tests examine this module with sample HTML files. Thus a change to an Amazon page is easy to repair.
- The tool sends one request to Amazon at a time, with a pause between requests.
- The tests do not connect to Amazon.

## Verification

We did these checks on 2026-10-18 with an Amazon account that has 6 books.

| # | Result |
|---|--------|
| N1 | Pass. `login` opens a Chrome window that you can see. `sync` then uses the saved session in a hidden window. |
| N2 | Pass. The tool saved 385 highlights. The notebook pages show 385 highlights. The pagination was correct for books with 2 pages. |
| N3 | Pass. The tool saved 49 notes: 46 notes with a highlight and 3 notes without a highlight. This quantity is equal to the quantity on the pages. |
| N4 | Pass. The tool saved 15 bookmarks in the sequence of the book. |
| N5 | Pass. A second sync gave 0 new items and 0 changed items. |
| N6 | Pass. Unit tests examine the "deleted" label and the 50% limit. |
| N7 | Pass. We examined the web page at desktop width, at phone width, and in dark mode. The browser console showed no errors. |
| N8 | Pass. We did a test of the MCP server over stdio with the real database. |
| N9 | Pass. With an empty browser profile, the sync stopped with exit code 2 and a clear message. |

During the verification, we found one problem and repaired it.
The reader text can start with the word before a dash.
Thus the first sync made 6 incorrect partial highlights.
