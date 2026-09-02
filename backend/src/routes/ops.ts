import { Router } from 'express'
import { env } from '../env.js'
import { getAdminDiagnostics, getHealthReport, listProjectActivity, runDatabaseBackup } from '../services/reliability.js'
import { getProjectRole } from '../db.js'
import { getAuthenticatedUser, isAdminRequestAuthorized, requireAuth } from '../auth.js'

export const opsRouter = Router()

opsRouter.get('/health', async (_req, res) => {
  const report = await getHealthReport()
  const statusCode = report.status === 'ok' ? 200 : report.status === 'degraded' ? 200 : 503
  res.status(statusCode).json(report)
})

opsRouter.get('/health/ready', async (_req, res) => {
  const report = await getHealthReport()
  res.status(report.status === 'error' ? 503 : 200).json(report)
})

opsRouter.get('/admin/diagnostics', async (req, res) => {
  if (!isAdminRequestAuthorized(req)) {
    return res.status(403).json({ error: 'Admin diagnostics are disabled or unauthorized' })
  }

  res.json(await getAdminDiagnostics())
})

opsRouter.post('/admin/backup', async (req, res) => {
  if (!isAdminRequestAuthorized(req)) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  if (!env.backupDir) {
    return res.status(503).json({ error: 'Backup not configured: set BACKUP_DIR to enable' })
  }

  try {
    const report = await runDatabaseBackup()
    res.json(report)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// ─── Audit export (owner only) ────────────────────────────────────────────────

opsRouter.get('/projects/:projectId/audit-export', requireAuth, async (req, res) => {
  const user = getAuthenticatedUser(req)
  const projectId = req.params.projectId as string
  const role = await getProjectRole(projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner' && role !== 'manager') return res.status(403).json({ error: 'Owner or manager access required' })

  const format = (typeof req.query.format === 'string' && req.query.format === 'csv') ? 'csv' : 'json'
  const limit = Math.min(Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '1000', 10) || 1000, 5000)

  const events = await listProjectActivity(projectId, limit)

  if (format === 'csv') {
    const headers = ['id', 'type', 'actor_user_id', 'actor_name', 'summary', 'created_at']
    const rows = events.map((e) => [
      e.id,
      e.type,
      e.actorUserId ?? '',
      e.actorName ?? '',
      `"${(e.summary ?? '').replace(/"/g, '""')}"`,
      new Date(e.createdAt).toISOString(),
    ].join(','))

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="audit-${projectId}.csv"`)
    return res.send([headers.join(','), ...rows].join('\n'))
  }

  res.json(events)
})
