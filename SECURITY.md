# Security policy

## Report a vulnerability

Do not open an issue for a security problem. All persons can see issues.
Use the "Report a vulnerability" button on the Security tab of the GitHub repository.
We will tell you the result of our examination in a maximum of 7 days.

## Security design

- The tool does not see or keep your Amazon password.
- The browser profile in `~/.kindle-notes/browser-profile` contains your Amazon session cookies.
  Do not give other persons access to this folder. Do not copy it to a different computer.
- To remove the session, delete the `~/.kindle-notes/browser-profile` folder.
- The web server accepts connections only from `127.0.0.1`.
  It accepts only the `Host` values `127.0.0.1:PORT` and `localhost:PORT`.
- The web server does not answer data requests that other websites start.
- The MCP server and the web page only read the local database.
- The MCP server marks all book text as data. This decreases the risk of prompt injection from text in a book.
- The tool sets the permission of the data folder to 0700 and the database to 0600.
