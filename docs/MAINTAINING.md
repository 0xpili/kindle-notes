# Maintainer safety guide

This guide is for the maintainer of the repository.
Other persons can open issues and pull requests.
Some of these persons can try to get control of your computer, your accounts, or your AI tools.
Obey these rules.

## What other persons cannot do

- Other persons cannot push to the repository. They can only open pull requests.
- Other persons cannot merge a pull request. Only the maintainer can merge.
- CI does not run on a pull request from a new contributor until you approve it.
- The GitHub token of CI can only read the repository. CI has no secrets.
- Rules on the `main` branch prevent force pushes and deletion of the branch.

## Pull requests

WARNING: Do not run code from a pull request before you read all the changes.
A pull request can contain code that steals your Amazon session or your GitHub token.

1. Read all the changed files on GitHub before you do other steps.
2. If the "Sensitive files" check shows an error, examine each file in the list line by line.
3. Approve the CI run only after you read the changes.
4. Merge only with "Squash and merge".

Make sure that a pull request does not do these things:

- It does not add a dependency without a clear reason.
- It does not change `package.json` scripts, `pnpm-lock.yaml`, or `onlyBuiltDependencies` without a clear reason.
- It does not add files in `.github/`, `.claude/`, `.cursor/`, `.vscode/`, or `.devcontainer/`.
- It does not add `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.mcp.json`.
- It does not send data to a host other than `read.amazon.com`.
- It does not add code that reads the browser profile or the cookies.

## AI tools

WARNING: Do not open a pull request branch with an AI agent before you read the changes.
Files such as `CLAUDE.md`, `.claude/settings.json`, and `.mcp.json` can tell the agent to run commands.

- Do not let an AI agent read issues or pull requests and then act with write access.
  Text in an issue can contain instructions for the agent. This is a prompt injection attack.
- Do not let an AI agent merge pull requests or publish releases.
- When an AI agent reads text from other persons, give it only read access.

## Dependencies

- Dependabot opens pull requests for updates each week.
- Read the release notes of a dependency before you merge its update.
- pnpm runs install scripts only for the packages in `onlyBuiltDependencies`.
  At this time, `better-sqlite3` is the only package in this list.

## Your accounts

- Use two-factor authentication on GitHub.
- Do not paste cookies, tokens, or Amazon pages in issues, pull requests, or commits.
- A person can ask you to run a command or to send a file. Do not do it before you know the reason.

## Security reports

Private vulnerability reports go to the Security tab of the repository.
Do not discuss a vulnerability in a public issue before the repair is available.
