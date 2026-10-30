import type { NextFunction, Request, Response } from 'express'
import { authenticateApiToken } from '../services/apiTokens.js'

// Requests a read-only token may make besides GET: the MCP endpoint (whose
// tools respect the scope themselves) and rendering a document.
const READ_SCOPE_POST_PATHS = new Set(['/api/mcp', '/api/compile'])

/**
 * `Authorization: Bearer typstr_pat_…` authenticates the request as the
 * token's user, instead of the session cookie. An invalid token is refused
 * outright rather than falling back to the cookie.
 */
export async function apiTokenAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.get('authorization')
  const match = header?.match(/^Bearer\s+(\S+)$/i)
  if (!match) {
    next()
    return
  }

  try {
    const result = await authenticateApiToken(match[1])
    if (!result) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
      res.status(401).json({ error: 'Invalid, expired or revoked access token' })
      return
    }
    if (result.scope === 'read' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !READ_SCOPE_POST_PATHS.has(req.originalUrl.split('?')[0])) {
      res.status(403).json({ error: 'This access token is read-only' })
      return
    }
    req.user = result.user
    req.apiToken = { id: result.tokenId, scope: result.scope, raw: match[1] }
    next()
  } catch (error) {
    next(error)
  }
}

/** For endpoints that must only be used from a signed-in browser session (e.g. creating tokens). */
export function requireSessionAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.apiToken) {
    res.status(403).json({ error: 'This action is not available with an access token; use the web interface' })
    return
  }
  next()
}
