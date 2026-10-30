# Using typstr from LLM agents (MCP)

typstr includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so
LLM agents such as Claude Code, Claude Desktop, Cursor or VS Code can work in typstr on
a user's behalf: read and edit files, compile and fix errors, export, handle review
comments and create projects.

Users find step-by-step setup instructions in the web interface under
**Settings → AI agents (MCP)**.

## Endpoint and authentication

- URL: `https://<your-typstr-host>/api/mcp`
- Transport: Streamable HTTP, stateless (`POST` only; `GET`/`DELETE` answer 405).
- Authentication: a personal access token in the `Authorization: Bearer typstr_pat_…`
  header. Session cookies are not accepted on this endpoint.

Users create tokens in **Settings → AI agents (MCP)**. A token:

- acts as its user, with that user's project permissions;
- is either *read and write* or *read only* (a read-only token can only make `GET`
  requests, plus rendering a document; its MCP connection does not list the editing
  tools);
- may expire after 30, 90 or 365 days, or never;
- is stored only as a SHA-256 hash and shown once, when created;
- cannot create other tokens, sign in, use admin endpoints or the MCP endpoint
  recursively;
- can be revoked at any time and stops working immediately.

The same tokens also work for typstr's REST API (`Authorization: Bearer …`).

Token management endpoints (browser session only):
`GET/POST /api/account/tokens`, `DELETE /api/account/tokens/:id`.

## Tools

| Tool | Purpose |
| --- | --- |
| `typstr_whoami` | The user and token scope of the connection |
| `typstr_list_projects`, `typstr_get_project` | Projects, file tree, main file, members |
| `typstr_read_file` | Read a text file or a line range; images are returned as images |
| `typstr_search` | Text or regular-expression search in a project |
| `typstr_write_file`, `typstr_edit_file` | Replace a file / one exact passage (creates files and folders as needed) |
| `typstr_create_folder`, `typstr_move_file`, `typstr_delete_file` | File management (delete moves to the trash) |
| `typstr_compile` | Compile the main document and report diagnostics |
| `typstr_export` | Export PDF, docx, LaTeX or HTML as an embedded resource |
| `typstr_list_comments`, `typstr_add_comment`, `typstr_reply_comment` | Review threads |
| `typstr_set_comment_status`, `typstr_assign_comment` | Resolve/reopen; assign members and a main responsible |
| `typstr_create_project`, `typstr_list_templates`, `typstr_share_project` | Projects, templates, invitations |
| `typstr_api_request` | Any other `/api/…` endpoint the web interface uses |

Every tool calls typstr's REST API with the caller's token, so permissions, rate limits
and the token scope apply exactly as in the web interface. File writes go through the
collaboration server, so collaborators with the file open see them live, and they are
recorded in the project activity as made "through the API".

## Client configuration

Claude Code:

```sh
claude mcp add --transport http typstr https://<host>/api/mcp \
  --header "Authorization: Bearer <token>"
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "typstr": { "url": "https://<host>/api/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

VS Code (`.vscode/mcp.json`):

```json
{
  "inputs": [{ "type": "promptString", "id": "typstr-token", "description": "typstr access token", "password": true }],
  "servers": { "typstr": { "type": "http", "url": "https://<host>/api/mcp", "headers": { "Authorization": "Bearer ${input:typstr-token}" } } }
}
```

Clients that only start local (stdio) servers, such as Claude Desktop, can use the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```json
{
  "mcpServers": {
    "typstr": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<host>/api/mcp", "--header", "Authorization:${TYPSTR_AUTH}"],
      "env": { "TYPSTR_AUTH": "Bearer <token>" }
    }
  }
}
```

## Operations

- `RATE_LIMIT_MCP_MAX` (default 120 per minute per user) limits MCP requests; the API
  calls the tools make are subject to the usual per-endpoint limits as well.
- The endpoint sits under `/api/`, so no extra reverse-proxy configuration is needed.
  Failed token authentications answer 401 and can be watched by intrusion-prevention
  tools like other failed logins.
- Documents and comments may contain text written by other people; agents can be misled
  by instructions hidden in them (prompt injection). Read-only tokens limit the impact,
  and every file keeps a revision history.
