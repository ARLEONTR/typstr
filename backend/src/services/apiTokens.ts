// Personal access tokens, for API clients such as the MCP endpoint.
//
// A token acts as its user (with the same project permissions); a "read"
// token is limited to reading. Only a SHA-256 hash of each token is stored;
// the token itself is shown once, when it is created.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { findUserById, getDbPool, sanitizeUser } from '../db.js'
import type { AuthenticatedUser } from '../types.js'

export const API_TOKEN_PREFIX = 'typstr_pat_'
export type ApiTokenScope = 'read' | 'write'

export interface ApiTokenSummary {
  id: string
  name: string
  scope: ApiTokenScope
  /** First characters of the token, to recognise it in the list. */
  hint: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
}

interface ApiTokenRow {
  id: string
  user_id: string
  name: string
  scope: ApiTokenScope
  token_hash: string
  hint: string
  created_at: string | number
  last_used_at: string | number | null
  expires_at: string | number | null
  revoked_at: string | number | null
}

const MAX_TOKENS_PER_USER = 20
// Writing last_used_at on every request would make every API call a write.
const LAST_USED_RESOLUTION_MS = 60_000

let schemaReady: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  schemaReady ??= getDbPool().query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
      token_hash TEXT NOT NULL UNIQUE,
      hint TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT,
      expires_at BIGINT,
      revoked_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
  `).then(() => undefined).catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value)
}

function rowToSummary(row: ApiTokenRow): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    hint: row.hint,
    createdAt: Number(row.created_at),
    lastUsedAt: toNumber(row.last_used_at),
    expiresAt: toNumber(row.expires_at),
  }
}

export async function createApiToken(input: {
  userId: string
  name: string
  scope: ApiTokenScope
  expiresAt: number | null
}): Promise<{ token: string; summary: ApiTokenSummary }> {
  await ensureSchema()
  const pool = getDbPool()
  const active = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $2)',
    [input.userId, Date.now()],
  )
  if (Number(active.rows[0]?.count ?? 0) >= MAX_TOKENS_PER_USER) {
    throw Object.assign(new Error(`You can have at most ${MAX_TOKENS_PER_USER} active tokens. Revoke one first.`), { status: 400 })
  }

  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const now = Date.now()
  const result = await pool.query<ApiTokenRow>(`
    INSERT INTO api_tokens (id, user_id, name, scope, token_hash, hint, created_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [randomUUID(), input.userId, input.name, input.scope, hashToken(token), token.slice(0, API_TOKEN_PREFIX.length + 4), now, input.expiresAt])
  return { token, summary: rowToSummary(result.rows[0]!) }
}

export async function listApiTokens(userId: string): Promise<ApiTokenSummary[]> {
  await ensureSchema()
  const result = await getDbPool().query<ApiTokenRow>(
    'SELECT * FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
    [userId],
  )
  return result.rows.map(rowToSummary)
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  await ensureSchema()
  const result = await getDbPool().query(
    'UPDATE api_tokens SET revoked_at = $1 WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL',
    [Date.now(), tokenId, userId],
  )
  return (result.rowCount ?? 0) > 0
}

/** The user and scope behind a token, or null if it is unknown, revoked, expired or its user is disabled. */
export async function authenticateApiToken(token: string): Promise<{ user: AuthenticatedUser; tokenId: string; scope: ApiTokenScope } | null> {
  if (!token.startsWith(API_TOKEN_PREFIX) || token.length > 200) {
    return null
  }
  await ensureSchema()
  const pool = getDbPool()
  const result = await pool.query<ApiTokenRow>('SELECT * FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)])
  const row = result.rows[0]
  const now = Date.now()
  if (!row || (row.expires_at !== null && Number(row.expires_at) <= now)) {
    return null
  }
  const user = await findUserById(row.user_id)
  if (!user || user.disabledAt) {
    return null
  }
  if (row.last_used_at === null || now - Number(row.last_used_at) > LAST_USED_RESOLUTION_MS) {
    void pool.query('UPDATE api_tokens SET last_used_at = $1 WHERE id = $2', [now, row.id]).catch(() => undefined)
  }
  return { user: sanitizeUser(user), tokenId: row.id, scope: row.scope }
}
