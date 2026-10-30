import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../api/client'
import styles from './AgentsPanel.module.css'

interface ApiToken {
  id: string
  name: string
  scope: 'read' | 'write'
  hint: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
}

type ClientId = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'other'

const CLIENTS: Array<{ id: ClientId; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'other', label: 'Other clients' },
]

const TOOLS: Array<[string, string]> = [
  ['typstr_list_projects, typstr_get_project', 'Your projects, their files, main document and members'],
  ['typstr_read_file, typstr_search', 'Read files (or a line range) and search a project'],
  ['typstr_write_file, typstr_edit_file', 'Create or change files; collaborators see the change live'],
  ['typstr_create_folder, typstr_move_file, typstr_delete_file', 'Organise files (deleting moves to the trash)'],
  ['typstr_compile, typstr_export', 'Compile to check for errors; export PDF, Word, LaTeX or HTML'],
  ['typstr_list_comments, typstr_add_comment, typstr_reply_comment', 'Review threads, replies'],
  ['typstr_set_comment_status, typstr_assign_comment', 'Resolve threads, assign people and a main responsible'],
  ['typstr_create_project, typstr_list_templates, typstr_share_project', 'New projects, templates, invitations'],
  ['typstr_api_request', 'Anything else the web interface can do, through typstr\'s API'],
]

const EXAMPLES = [
  'List my typstr projects and summarise what the thesis project contains.',
  'Compile the report and fix the errors it reports.',
  'Read chapter 2 and add review comments on unclear sentences, assigned to me.',
  'Go through the open review comments in the paper, make the requested changes and resolve them.',
  'Create a new project from the IEEE template called "Workshop paper" and draft an outline.',
]

function formatDate(timestamp: number | null): string {
  return timestamp ? new Date(timestamp).toLocaleDateString() : '—'
}

function CopyBlock({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={styles.copyBlock}>
      {label ? <span className={styles.copyLabel}>{label}</span> : null}
      <pre className={styles.code}>{value}</pre>
      <button type="button" className={styles.copyBtn} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

export default function AgentsPanel() {
  const endpoint = useMemo(() => `${window.location.origin}/api/mcp`, [])
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('My LLM agent')
  const [scope, setScope] = useState<'read' | 'write'>('write')
  const [expiry, setExpiry] = useState<string>('90')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [client, setClient] = useState<ClientId>('claude-code')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get<ApiToken[]>('/api/account/tokens')
      setTokens(data)
      setError(null)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not load your access tokens.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setBusy(true)
    try {
      const { data } = await apiClient.post<{ token: string; summary: ApiToken }>('/api/account/tokens', {
        name: name.trim(),
        scope,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      })
      setNewToken(data.token)
      await load()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not create the token.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: ApiToken) => {
    if (!window.confirm(`Revoke "${token.name}"? Agents using it will lose access immediately.`)) return
    try {
      await apiClient.delete(`/api/account/tokens/${encodeURIComponent(token.id)}`)
      await load()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not revoke the token.')
    }
  }

  const token = newToken ?? 'YOUR_TYPSTR_TOKEN'
  const snippets: Record<ClientId, Array<{ label: string; value: string }>> = {
    'claude-code': [
      { label: 'Run in a terminal', value: `claude mcp add --transport http typstr ${endpoint} \\\n  --header "Authorization: Bearer ${token}"` },
    ],
    'claude-desktop': [
      {
        label: 'Settings → Developer → Edit config (claude_desktop_config.json); requires Node.js',
        value: JSON.stringify({
          mcpServers: {
            typstr: {
              command: 'npx',
              args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${TYPSTR_AUTH}'],
              env: { TYPSTR_AUTH: `Bearer ${token}` },
            },
          },
        }, null, 2),
      },
    ],
    cursor: [
      {
        label: '~/.cursor/mcp.json (or .cursor/mcp.json in a project)',
        value: JSON.stringify({ mcpServers: { typstr: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
      },
    ],
    vscode: [
      {
        label: '.vscode/mcp.json — VS Code asks for the token once and stores it securely',
        value: JSON.stringify({
          inputs: [{ type: 'promptString', id: 'typstr-token', description: 'typstr access token', password: true }],
          servers: { typstr: { type: 'http', url: endpoint, headers: { Authorization: 'Bearer ${input:typstr-token}' } } },
        }, null, 2),
      },
    ],
    other: [
      { label: 'Server URL (Streamable HTTP transport)', value: endpoint },
      { label: 'HTTP header', value: `Authorization: Bearer ${token}` },
      { label: 'Clients that only start local (stdio) servers can use the mcp-remote bridge', value: `npx -y mcp-remote ${endpoint} --header "Authorization: Bearer ${token}"` },
    ],
  }

  return (
    <div className={styles.panel}>
      <section className={styles.intro}>
        <h3>Use typstr from an LLM agent</h3>
        <p>
          typstr has a <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">Model Context Protocol</a> (MCP)
          server. Connect Claude, Cursor, VS Code or any MCP client to it and ask the agent to work on your documents: read and edit
          files, compile and fix errors, export, handle review comments and create projects. The agent acts as you, with exactly
          your project permissions.
        </p>
        <ol className={styles.steps}>
          <li><strong>Create an access token</strong> below. Use a <em>read-only</em> token if the agent should only read.</li>
          <li><strong>Add the typstr server</strong> to your client with the snippet for it.</li>
          <li><strong>Ask the agent</strong>, e.g. "List my typstr projects".</li>
        </ol>
      </section>

      <section className={styles.card}>
        <h4>1. Access tokens</h4>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.createRow}>
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          <label className={styles.field}>
            <span>Access</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as 'read' | 'write')}>
              <option value="write">Read and write</option>
              <option value="read">Read only</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Expires</span>
            <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
              <option value="30">in 30 days</option>
              <option value="90">in 90 days</option>
              <option value="365">in a year</option>
              <option value="never">never</option>
            </select>
          </label>
          <button type="button" className={styles.primaryBtn} disabled={busy || !name.trim()} onClick={() => void create()}>Create token</button>
        </div>

        {newToken ? (
          <div className={styles.newToken}>
            <strong>Copy your token now — it will not be shown again.</strong>
            <CopyBlock value={newToken} />
            <p className={styles.hint}>The setup snippets below already contain it.</p>
          </div>
        ) : null}

        {tokens.length > 0 ? (
          <table className={styles.tokenTable}>
            <thead>
              <tr><th>Name</th><th>Access</th><th>Token</th><th>Created</th><th>Last used</th><th>Expires</th><th /></tr>
            </thead>
            <tbody>
              {tokens.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.name}</td>
                  <td><span className={entry.scope === 'read' ? styles.badgeRead : styles.badgeWrite}>{entry.scope === 'read' ? 'read only' : 'read & write'}</span></td>
                  <td><code>{entry.hint}…</code></td>
                  <td>{formatDate(entry.createdAt)}</td>
                  <td>{formatDate(entry.lastUsedAt)}</td>
                  <td>{entry.expiresAt ? formatDate(entry.expiresAt) : 'never'}</td>
                  <td><button type="button" className={styles.dangerBtn} onClick={() => void revoke(entry)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className={styles.hint}>You have no access tokens yet.</p>}
      </section>

      <section className={styles.card}>
        <h4>2. Connect your client</h4>
        <div className={styles.tabs} role="tablist">
          {CLIENTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={client === entry.id}
              className={client === entry.id ? styles.tabActive : styles.tab}
              onClick={() => setClient(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {snippets[client].map((snippet) => <CopyBlock key={snippet.label} label={snippet.label} value={snippet.value} />)}
        {!newToken ? <p className={styles.hint}>Replace YOUR_TYPSTR_TOKEN with a token you created above.</p> : null}
      </section>

      <section className={styles.card}>
        <h4>3. What the agent can do</h4>
        <table className={styles.toolTable}>
          <tbody>
            {TOOLS.map(([names, description]) => (
              <tr key={names}><td><code>{names}</code></td><td>{description}</td></tr>
            ))}
          </tbody>
        </table>
        <p className={styles.hint}>Try asking:</p>
        <ul className={styles.examples}>
          {EXAMPLES.map((example) => <li key={example}>“{example}”</li>)}
        </ul>
      </section>

      <section className={styles.card}>
        <h4>Security</h4>
        <ul className={styles.notes}>
          <li>A token is as powerful as your account in every project you can open. Keep it secret, like a password; never commit it to a repository.</li>
          <li>Prefer <strong>read-only</strong> tokens and short expiry dates. A read-only token cannot change anything, and its agent does not see the editing tools.</li>
          <li>Documents and comments can contain text written by others. An agent might be misled by instructions hidden in them; review what it changes. typstr keeps a revision history of every file.</li>
          <li>Tokens cannot create other tokens, sign in or use admin functions. Revoke a token here at any time; it stops working immediately.</li>
          <li>Changes made by an agent appear in the project activity as made by you “through the API”.</li>
        </ul>
      </section>
    </div>
  )
}
