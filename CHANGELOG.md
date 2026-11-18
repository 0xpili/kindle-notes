# Changelog

All important changes to this project are in this file.
The project uses [Semantic Versioning](https://semver.org).

## Unreleased

- `export`: Writes one Markdown file for each book. The same database always gives the same files.
- `sync`: If Amazon asks for your password, the sync opens Chrome for the login. Then the sync continues.
  Amazon asks for the password when the last login is more than 1 hour old.
- `sync --no-login`: The sync does not open Chrome. It stops with exit code 2.
- The messages show the command that you used, for example `node dist/cli.js`.
- Install from the Git repository with `npm link`. The project is not on npm.
- Security: the MCP server marks all book text as data, not instructions.
- Security: the web server rejects data requests from other websites and malformed requests.
- Security: the tool sets owner-only permissions on the data folder and the browser profile.

## 0.1.0 - 2026-10-18

The first release.

- `login`: Opens Chrome. The user logs in to Amazon.
- `sync`: Copies highlights, notes, and bookmarks from `read.amazon.com` to a local SQLite database.
- `ui`: A local web page to read and search the data.
- `mcp`: An MCP server with 6 read-only tools.
- `status`: Shows the quantities and the result of the last sync.
