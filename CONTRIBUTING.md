# Contributing

Thank you for your help with Kindle Notes.

## Procedure: Prepare your computer

1. Install Node.js 22 or higher.
2. Install pnpm.
3. Clone the repository.
4. Run `pnpm install`.
5. Run `pnpm test`. Make sure that no test shows an error.

## Procedure: Send a change

1. Make a branch.
2. Make your change.
3. Add tests for your change.
4. Run `pnpm typecheck` and `pnpm test`. Make sure that there are no errors.
5. Open a pull request. In the pull request, tell us the problem and the solution.

## Rules for pull requests

- Keep each pull request small, with one change.
- Do not change files in `.github/` without an issue that explains the reason.
- We do not accept pull requests that add configuration files for AI tools for code.
  Examples: `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.mcp.json`.
- A pull request that changes dependencies, `package.json`, or `pnpm-lock.yaml` must give the reason.
- CI runs on your first pull request after a maintainer approves it.

## Rules for the code

- Keep all Amazon selectors in `src/amazon/parse.ts`.
- Keep the parsers and the merge functions without side effects. Thus unit tests can examine them easily.
- Do not let the web page or the MCP server connect to Amazon. Only the `sync` command connects to Amazon.
- Do not add a dependency if a small function can do the same work.
- Write all documentation in Simplified Technical English (ASD-STE100).

## Procedure: Repair the parser after an Amazon change

If the sync stops with "Amazon page format changed", do these steps:

1. Save the Amazon page that caused the error.
2. Remove all personal data from the page. Replace the text of the highlights and notes.
   Replace the customer identifier in the base64 annotation identifiers.
3. Add the page to `tests/fixtures`.
4. Add a test that uses the page. Make sure that the test shows an error.
5. Repair `src/amazon/parse.ts`.
6. Make sure that no test shows an error.

WARNING: Do not add real highlights, notes, account identifiers, or cookies to the repository.
Other persons can see all files in the repository.

## Tests

The tests do not connect to Amazon.
Do not add tests that use a real Amazon account.
