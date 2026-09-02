import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import { runSyncTexEdit, runSyncTexView } from '../services/syncTexSession.js'

export const syncTexRouter = Router()

// POST /api/synctex/edit
// Inverse search: PDF page+coords → source file/line/column.
syncTexRouter.post('/edit', async (req, res) => {
  const { token, page, x, y } = req.body ?? {}
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'token is required' })
  }
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: 'page must be a positive integer' })
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'x and y must be numeric' })
  }

  const user = getAuthenticatedUser(req)
  try {
    const result = await runSyncTexEdit(token, user.id, { page, x, y })
    if (!result) {
      return res.status(404).json({ error: 'No SyncTeX session for token' })
    }
    return res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
})

// POST /api/synctex/view
// Forward search: source file+line(+column) → PDF page boxes.
syncTexRouter.post('/view', async (req, res) => {
  const { token, filePath, line, column } = req.body ?? {}
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'token is required' })
  }
  if (typeof filePath !== 'string' || !filePath) {
    return res.status(400).json({ error: 'filePath is required' })
  }
  if (!Number.isFinite(line) || line < 1) {
    return res.status(400).json({ error: 'line must be a positive integer' })
  }
  if (column !== undefined && column !== null && (!Number.isFinite(column) || column < 1)) {
    return res.status(400).json({ error: 'column must be a positive integer when provided' })
  }

  const user = getAuthenticatedUser(req)
  try {
    const result = await runSyncTexView(token, user.id, { filePath, line, column: column ?? null })
    if (!result) {
      console.warn('[SyncTeX] view returned no result', { token: token.slice(0, 8), filePath, line, column })
      return res.status(404).json({ error: 'No SyncTeX result' })
    }
    return res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
})
