import { Router } from 'express'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAdminEmail } from '../adminAccess.js'
import { clearUserStoredCredentials, deleteProject, getDbPool, getUserRefreshToken, removeTeamMember, revokeProjectInvitation, revokeProjectMember, revokeShareLink, updateProjectMemberRole } from '../db.js'
import { requireAdmin, revokeSessionsForUser } from '../auth.js'
import { cancelAllQueuedJobs, cancelJob, getAdminDiagnostics, listRecentErrors, listRecentJobs, retryJob, runDatabaseBackup } from '../services/reliability.js'
import type {
  AdminActivityRecord,
  AdminOverview,
  AdminAccessRecord,
  AdminProjectRecord,
  AdminSubscriptionRecord,
  AdminTeamRecord,
  AdminUserRecord,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../types.js'
import { env } from '../env.js'
import { ensureUserSubscription } from '../services/billing.js'

const pool = getDbPool()
const adminRouter = Router()
const execFileAsync = promisify(execFile)

adminRouter.use(requireAdmin)

adminRouter.get('/overview', async (_req, res) => {
  const [diagnostics, counts, recentActivity] = await Promise.all([
    getAdminDiagnostics(),
    loadSystemCounts(),
    loadRecentActivity(12),
  ])

  const payload: AdminOverview = {
    checkedAt: Date.now(),
    counts,
    diagnostics,
    recentActivity,
  }

  res.json(payload)
})

adminRouter.get('/users', async (req, res) => {
  const limit = clampLimit(req.query.limit, 250, 1000)
  res.json(await loadUsers(limit))
})

adminRouter.get('/subscriptions', async (req, res) => {
  const limit = clampLimit(req.query.limit, 250, 1000)
  res.json(await loadSubscriptions(limit))
})

adminRouter.get('/projects', async (req, res) => {
  const limit = clampLimit(req.query.limit, 250, 1000)
  res.json(await loadProjects(limit))
})

adminRouter.get('/teams', async (req, res) => {
  const limit = clampLimit(req.query.limit, 250, 1000)
  res.json(await loadTeams(limit))
})

adminRouter.get('/access', async (req, res) => {
  const limit = clampLimit(req.query.limit, 500, 2000)
  res.json(await loadAccessRecords(limit))
})

adminRouter.patch('/access/project-members', async (req, res, next) => {
  try {
    const { projectId, userId, role } = req.body as { projectId?: string; userId?: string; role?: string }
    if (!projectId || !userId || (role !== 'manager' && role !== 'editor' && role !== 'viewer')) {
      return res.status(400).json({ error: 'projectId, userId, and a valid role are required' })
    }

    await updateProjectMemberRole(projectId, userId, role)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/access/project-members', async (req, res, next) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : ''
    const userId = typeof req.query.userId === 'string' ? req.query.userId : ''
    if (!projectId || !userId) {
      return res.status(400).json({ error: 'projectId and userId are required' })
    }

    await revokeProjectMember(projectId, userId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/access/project-invitations/:invitationId', async (req, res, next) => {
  try {
    await revokeProjectInvitation(req.params.invitationId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/access/share-links/:linkId', async (req, res, next) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : ''
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' })
    }
    await revokeShareLink(req.params.linkId, projectId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/access/access-requests/:requestId/deny', async (req, res, next) => {
  try {
    const projectId = typeof req.body.projectId === 'string' ? req.body.projectId : ''
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' })
    }
    const adminId = (req.user as { id: string }).id
    await pool.query(
      'UPDATE project_access_requests SET status = $1, decided_by_user_id = $2, decided_at = $3, updated_at = $3 WHERE id = $4 AND project_id = $5',
      ['denied', adminId, Date.now(), req.params.requestId, projectId],
    )
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/access/team-members', async (req, res, next) => {
  try {
    const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : ''
    const userId = typeof req.query.userId === 'string' ? req.query.userId : ''
    if (!teamId || !userId) {
      return res.status(400).json({ error: 'teamId and userId are required' })
    }

    await removeTeamMember(teamId, userId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/jobs', async (req, res) => {
  const limit = clampLimit(req.query.limit, 100, 500)
  res.json(await listRecentJobs(limit))
})

adminRouter.delete('/jobs', async (_req, res, next) => {
  try {
    const count = await cancelAllQueuedJobs()
    res.json({ ok: true, cancelledCount: count })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/jobs/:jobId', async (req, res, next) => {
  try {
    const cancelled = await cancelJob(req.params.jobId)
    if (!cancelled) {
      return res.status(404).json({ error: 'Job not found or not in a cancellable state' })
    }
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/errors', async (req, res) => {
  const limit = clampLimit(req.query.limit, 100, 500)
  res.json(await listRecentErrors(limit))
})

adminRouter.get('/activity', async (req, res) => {
  const limit = clampLimit(req.query.limit, 50, 250)
  res.json(await loadRecentActivity(limit))
})

adminRouter.get('/container-logs/services', async (_req, res) => {
  const services = listSupportedContainerServices()
  res.json({
    dockerAccessible: await isDockerLogsAccessible(),
    services,
  })
})

adminRouter.get('/container-logs', async (req, res) => {
  const service = typeof req.query.service === 'string' ? req.query.service : ''
  const tail = clampLimit(req.query.tail, 200, 2000)
  const supportedServices = listSupportedContainerServices()

  if (!service || !supportedServices.some((entry) => entry.service === service)) {
    return res.status(400).json({ error: 'A valid service is required.' })
  }

  try {
    const logs = await readContainerLogs(service, tail)
    res.json({
      service,
      tail,
      logs,
      checkedAt: Date.now(),
    })
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Docker logs are unavailable.' })
  }
})

adminRouter.get('/feedback', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT f.id, f.message, f.created_at, f.status, f.admin_response, u.name as user_name, u.email as user_email FROM feedback f JOIN users u ON f.user_id = u.id ORDER BY f.created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/feedback/:id', async (req, res, next) => {
  try {
    const { status, adminResponse } = req.body;
    await pool.query(
      'UPDATE feedback SET status = $1, admin_response = $2 WHERE id = $3',
      [status, adminResponse, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/feedback/:id/replies', async (req, res, next) => {
  try {
    const { message } = req.body as { message?: string };
    const trimmed = (message ?? '').trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const adminId = (req.user as { id: string }).id;
    const { rows } = await pool.query(
      'SELECT id, parent_feedback_id FROM feedback WHERE id = $1',
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Feedback item not found.' });
    }
    // Collapse to root so threading stays 1-level deep, matching the user flow.
    const rootId = rows[0].parent_feedback_id ?? rows[0].id;

    const { randomUUID } = await import('node:crypto');
    await pool.query(
      'INSERT INTO feedback (id, user_id, message, parent_feedback_id, created_at) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), adminId, trimmed, rootId, Date.now()],
    );

    res.status(201).end();
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/feedback/:id/replies', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.message, f.created_at, u.email AS author_email, u.name AS author_name
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       WHERE f.parent_feedback_id = $1
       ORDER BY f.created_at ASC`,
      [req.params.id],
    );
    const enriched = rows.map((row) => ({
      id: row.id,
      message: row.message,
      created_at: row.created_at,
      author_name: row.author_name,
      author_email: row.author_email,
      is_admin_reply: isAdminEmail(row.author_email),
    }));
    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

adminRouter.delete('/projects/:projectId', async (req, res, next) => {
  try {
    await deleteProject(req.params.projectId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.patch('/users/:userId/disable', async (req, res, next) => {
  try {
    const enable = req.body.enable === true
    await pool.query(
      `UPDATE users SET disabled_at = $1 WHERE id = $2`,
      [enable ? null : Date.now(), req.params.userId],
    )
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/users/:userId/revoke-credentials', async (req, res, next) => {
  try {
    const userId = req.params.userId
    const refreshToken = await getUserRefreshToken(userId)
    const [sessionsRevoked] = await Promise.all([
      revokeSessionsForUser(userId),
      clearUserStoredCredentials(userId),
      revokeGoogleTokenBestEffort(refreshToken),
    ])

    res.json({ ok: true, sessionsRevoked })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/users/:userId/subscription', async (req, res, next) => {
  try {
    const plan = req.body?.plan as SubscriptionPlan | undefined
    const status = (req.body?.status ?? 'active') as SubscriptionStatus
    if (!isSubscriptionPlan(plan) || !isSubscriptionStatus(status)) {
      return res.status(400).json({ error: 'Valid plan and status are required' })
    }

    const subscriptionId = await ensureUserSubscription(req.params.userId, plan, status, {
      periodStart: Date.now(),
      periodEnd: normalizeNullableTimestamp(req.body?.periodEnd),
      renewalMode: typeof req.body?.renewalMode === 'string' ? req.body.renewalMode : 'admin_manual',
      paymentProvider: 'admin',
      providerReference: typeof req.body?.providerReference === 'string' ? req.body.providerReference : null,
    })
    res.status(201).json({ ok: true, subscriptionId })
  } catch (error) {
    next(error)
  }
})

adminRouter.patch('/subscriptions/:subscriptionId', async (req, res, next) => {
  try {
    const plan = req.body?.plan as SubscriptionPlan | undefined
    const status = req.body?.status as SubscriptionStatus | undefined
    if (plan !== undefined && !isSubscriptionPlan(plan)) {
      return res.status(400).json({ error: 'Invalid subscription plan' })
    }
    if (status !== undefined && !isSubscriptionStatus(status)) {
      return res.status(400).json({ error: 'Invalid subscription status' })
    }

    await pool.query(
      `UPDATE subscriptions
       SET plan = COALESCE($1, plan),
           status = COALESCE($2, status),
           period_end = CASE WHEN $3 THEN $4 ELSE period_end END,
           renewal_mode = COALESCE($5, renewal_mode),
           provider_reference = COALESCE($6, provider_reference),
           updated_at = $7
       WHERE id = $8`,
      [
        plan ?? null,
        status ?? null,
        Object.prototype.hasOwnProperty.call(req.body ?? {}, 'periodEnd'),
        Object.prototype.hasOwnProperty.call(req.body ?? {}, 'periodEnd') ? normalizeNullableTimestamp(req.body.periodEnd) : null,
        typeof req.body?.renewalMode === 'string' ? req.body.renewalMode : null,
        typeof req.body?.providerReference === 'string' ? req.body.providerReference : null,
        Date.now(),
        req.params.subscriptionId,
      ],
    )
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/subscriptions/:subscriptionId/cancel', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE subscriptions
       SET status = 'cancelled', period_end = COALESCE(period_end, $1), updated_at = $1
       WHERE id = $2`,
      [Date.now(), req.params.subscriptionId],
    )
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/jobs/:jobId/retry', async (req, res, next) => {
  try {
    const retried = await retryJob(req.params.jobId)
    if (!retried) return res.status(404).json({ error: 'Job not found or not in failed state' })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/jobs/:jobId/cancel', async (req, res, next) => {
  try {
    const cancelled = await cancelJob(req.params.jobId)
    if (!cancelled) return res.status(404).json({ error: 'Job not found or already finished' })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/jobs/cancel-all-queued', async (_req, res, next) => {
  try {
    const count = await cancelAllQueuedJobs()
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/errors', async (_req, res, next) => {
  try {
    await pool.query(`DELETE FROM error_events`)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/activity', async (req, res, next) => {
  try {
    const before = typeof req.query.before === 'string' ? Number(req.query.before) : Date.now() - 30 * 24 * 60 * 60_000
    await pool.query(`DELETE FROM project_activity_events WHERE created_at < $1`, [before])
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/backup', async (_req, res) => {
  if (!env.backupDir) {
    return res.status(503).json({ error: 'Backup not configured: set BACKUP_DIR to enable' })
  }

  try {
    res.json(await runDatabaseBackup())
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// ─── Domain plan rules ────────────────────────────────────────────────────────
// These allow granting specific limits to entire email domains (e.g. metu.edu.tr
// gets unlimited storage, or a company domain gets Team plan for free).

adminRouter.get('/domain-rules', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, domain, plan, status, limits_override, valid_from, valid_until, created_at, updated_at
       FROM domain_plan_rules
       ORDER BY domain ASC`,
    )
    res.json(rows.map((r: any) => ({
      id: r.id,
      domain: r.domain,
      plan: r.plan,
      status: r.status,
      limitsOverride: r.limits_override ? JSON.parse(r.limits_override) : null,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })))
  } catch (error) {
    next(error)
  }
})

adminRouter.put('/domain-rules/:domain', async (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase().trim()
    if (!domain || domain.length > 253) {
      return res.status(400).json({ error: 'A valid domain is required' })
    }
    const { plan, status = 'active', limitsOverride = null, validFrom = null, validUntil = null } = req.body as {
      plan?: string
      status?: string
      limitsOverride?: Record<string, unknown> | null
      validFrom?: number | null
      validUntil?: number | null
    }
    if (!plan) return res.status(400).json({ error: 'plan is required' })

    const { randomUUID } = await import('node:crypto')
    const now = Date.now()
    await pool.query(
      `INSERT INTO domain_plan_rules (id, domain, plan, status, limits_override, valid_from, valid_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (domain) DO UPDATE
         SET plan = EXCLUDED.plan,
             status = EXCLUDED.status,
             limits_override = EXCLUDED.limits_override,
             valid_from = EXCLUDED.valid_from,
             valid_until = EXCLUDED.valid_until,
             updated_at = EXCLUDED.updated_at`,
      [randomUUID(), domain, plan, status, limitsOverride ? JSON.stringify(limitsOverride) : null, validFrom ?? null, validUntil ?? null, now],
    )
    res.status(200).json({ ok: true, domain })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/domain-rules/:domain', async (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase().trim()
    await pool.query('DELETE FROM domain_plan_rules WHERE domain = $1', [domain])
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

export { adminRouter }

type SupportedContainerService = {
  service: string
  label: string
}

function listSupportedContainerServices(): SupportedContainerService[] {
  const base: SupportedContainerService[] = [
    { service: 'backend', label: 'Backend' },
    { service: 'frontend', label: 'Frontend' },
    { service: 'nginx', label: 'Nginx' },
    { service: 'postgres', label: 'Postgres' },
    { service: 'redis', label: 'Redis' },
  ]

  if (env.isProduction) {
    base.push({ service: 'caddy', label: 'Caddy' })
  }

  return base
}

function getComposeProjectName(): string {
  const explicit = process.env.COMPOSE_PROJECT_NAME?.trim()
  if (explicit) {
    return explicit
  }

  return 'typstr'
}

function getContainerName(service: string): string {
  return `${getComposeProjectName()}-${service}-1`
}

async function isDockerLogsAccessible(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

async function readContainerLogs(service: string, tail: number): Promise<string> {
  const containerName = getContainerName(service)

  try {
    const { stdout, stderr } = await execFileAsync('docker', ['logs', '--tail', String(tail), containerName], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    const output = [stdout, stderr].filter(Boolean).join('')
    return output || `No logs available for ${containerName}.`
  } catch (error: any) {
    const detail = typeof error?.stderr === 'string' && error.stderr.trim()
      ? error.stderr.trim()
      : typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Docker logs are unavailable.'
    throw new Error(detail)
  }
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'string') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(max, parsed))
}

async function loadSystemCounts() {
  const result = await pool.query<{
    users: string
    subscriptions: string
    active_subscriptions: string
    projects: string
    teams: string
    files: string
    published_projects: string
    active_share_links: string
    pending_invitations: string
    pending_access_requests: string
    errors_last24h: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM users) AS users,
      (SELECT COUNT(*)::text FROM subscriptions) AS subscriptions,
      (SELECT COUNT(*)::text FROM subscriptions WHERE status IN ('active', 'trialing')) AS active_subscriptions,
      (SELECT COUNT(*)::text FROM projects) AS projects,
      (SELECT COUNT(*)::text FROM teams) AS teams,
      (SELECT COUNT(*)::text FROM project_files) AS files,
      (SELECT COUNT(*)::text FROM projects WHERE published_at IS NOT NULL) AS published_projects,
      (SELECT COUNT(*)::text FROM project_share_links WHERE is_active = TRUE) AS active_share_links,
      (SELECT COUNT(*)::text FROM project_invitations WHERE status = 'pending') AS pending_invitations,
      (SELECT COUNT(*)::text FROM project_access_requests WHERE status = 'pending') AS pending_access_requests,
      (SELECT COUNT(*)::text FROM error_events WHERE created_at >= $1) AS errors_last24h
  `, [Date.now() - 24 * 60 * 60_000])

  const row = result.rows[0]
  return {
    users: Number(row?.users ?? 0),
    subscriptions: Number(row?.subscriptions ?? 0),
    activeSubscriptions: Number(row?.active_subscriptions ?? 0),
    projects: Number(row?.projects ?? 0),
    teams: Number(row?.teams ?? 0),
    files: Number(row?.files ?? 0),
    publishedProjects: Number(row?.published_projects ?? 0),
    activeShareLinks: Number(row?.active_share_links ?? 0),
    pendingInvitations: Number(row?.pending_invitations ?? 0),
    pendingAccessRequests: Number(row?.pending_access_requests ?? 0),
    errorsLast24h: Number(row?.errors_last24h ?? 0),
  }
}

async function loadUsers(limit: number): Promise<AdminUserRecord[]> {
  const result = await pool.query<{
    id: string
    email: string
    name: string
    avatar_url: string | null
    drive_root_folder_id: string | null
    disabled_at: number | null
    subscription_plan: SubscriptionPlan | null
    subscription_status: SubscriptionStatus | null
    created_at: number
    updated_at: number
    project_count: string
    team_count: string
  }>(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.avatar_url,
      u.drive_root_folder_id,
      u.disabled_at,
      latest_subscription.plan AS subscription_plan,
      latest_subscription.status AS subscription_status,
      u.created_at,
      u.updated_at,
      COALESCE(project_counts.project_count, 0)::text AS project_count,
      COALESCE(team_counts.team_count, 0)::text AS team_count
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*)::int AS project_count
      FROM project_members
      GROUP BY user_id
    ) AS project_counts ON project_counts.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*)::int AS team_count
      FROM team_members
      GROUP BY user_id
    ) AS team_counts ON team_counts.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT plan, status
      FROM subscriptions s
      WHERE s.user_id = u.id
      ORDER BY s.updated_at DESC
      LIMIT 1
    ) AS latest_subscription ON TRUE
    ORDER BY u.updated_at DESC, u.created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    driveRootFolderId: row.drive_root_folder_id,
    isAdmin: isAdminEmail(row.email),
    disabledAt: row.disabled_at,
    subscriptionPlan: row.subscription_plan,
    subscriptionStatus: row.subscription_status,
    projectCount: Number(row.project_count),
    teamCount: Number(row.team_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function loadSubscriptions(limit: number): Promise<AdminSubscriptionRecord[]> {
  const result = await pool.query<{
    id: string
    user_id: string | null
    user_name: string | null
    user_email: string | null
    team_id: string | null
    team_name: string | null
    plan: SubscriptionPlan
    status: SubscriptionStatus
    period_start: number | null
    period_end: number | null
    renewal_mode: string
    payment_provider: string | null
    provider_customer_id: string | null
    provider_reference: string | null
    transaction_count: string
    paid_transaction_count: string
    created_at: number
    updated_at: number
  }>(`
    SELECT
      s.id,
      s.user_id,
      u.name AS user_name,
      u.email AS user_email,
      s.team_id,
      t.name AS team_name,
      s.plan,
      s.status,
      s.period_start,
      s.period_end,
      s.renewal_mode,
      s.payment_provider,
      s.provider_customer_id,
      s.provider_reference,
      COUNT(pt.id)::text AS transaction_count,
      COUNT(pt.id) FILTER (WHERE pt.status = 'paid')::text AS paid_transaction_count,
      s.created_at,
      s.updated_at
    FROM subscriptions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN teams t ON t.id = s.team_id
    LEFT JOIN payment_transactions pt ON pt.subscription_id = s.id
    GROUP BY s.id, u.name, u.email, t.name
    ORDER BY s.updated_at DESC, s.created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    teamId: row.team_id,
    teamName: row.team_name,
    plan: row.plan,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    renewalMode: row.renewal_mode,
    paymentProvider: row.payment_provider,
    providerCustomerId: row.provider_customer_id,
    providerReference: row.provider_reference,
    transactionCount: Number(row.transaction_count),
    paidTransactionCount: Number(row.paid_transaction_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && ['free', 'student_freemium', 'personal', 'team', 'business', 'institution', 'research_enterprise'].includes(value)
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && ['active', 'trialing', 'past_due', 'cancelled', 'expired'].includes(value)
}

function normalizeNullableTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const timestamp = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
}

async function revokeGoogleTokenBestEffort(refreshToken: string | null): Promise<void> {
  if (!refreshToken) {
    return
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: refreshToken }),
    })

    if (!response.ok) {
      console.warn('Admin credential revoke: Google token revocation returned non-OK status', response.status)
    }
  } catch (error) {
    console.warn('Admin credential revoke: failed to revoke Google token', error)
  }
}

async function loadAccessRecords(limit: number): Promise<AdminAccessRecord[]> {
  const result = await pool.query<{
    id: string
    kind: AdminAccessRecord['kind']
    label: string
    project_id: string | null
    project_title: string | null
    team_id: string | null
    team_name: string | null
    subject_user_id: string | null
    subject_name: string | null
    subject_email: string | null
    role: string | null
    status: string | null
    invited_by_name: string | null
    created_at: number
    updated_at: number
  }>(`
    SELECT * FROM (
      SELECT
        ('project-member:' || pm.project_id || ':' || pm.user_id) AS id,
        'project-member'::text AS kind,
        'Project member'::text AS label,
        pm.project_id,
        p.title AS project_title,
        NULL::text AS team_id,
        NULL::text AS team_name,
        pm.user_id AS subject_user_id,
        u.name AS subject_name,
        u.email AS subject_email,
        pm.role,
        'active'::text AS status,
        NULL::text AS invited_by_name,
        pm.created_at,
        pm.created_at AS updated_at
      FROM project_members pm
      JOIN projects p ON p.id = pm.project_id
      JOIN users u ON u.id = pm.user_id
      WHERE pm.role != 'owner'

      UNION ALL

      SELECT
        ('project-invitation:' || pi.id) AS id,
        'project-invitation'::text AS kind,
        'Project invitation'::text AS label,
        pi.project_id,
        p.title AS project_title,
        NULL::text AS team_id,
        NULL::text AS team_name,
        NULL::text AS subject_user_id,
        NULL::text AS subject_name,
        pi.email AS subject_email,
        pi.role,
        pi.status,
        inviter.name AS invited_by_name,
        pi.created_at,
        pi.updated_at
      FROM project_invitations pi
      JOIN projects p ON p.id = pi.project_id
      JOIN users inviter ON inviter.id = pi.invited_by_user_id

      UNION ALL

      SELECT
        ('share-link:' || sl.id) AS id,
        'share-link'::text AS kind,
        COALESCE(sl.label, 'Share link') AS label,
        sl.project_id,
        p.title AS project_title,
        NULL::text AS team_id,
        NULL::text AS team_name,
        NULL::text AS subject_user_id,
        creator.name AS subject_name,
        creator.email AS subject_email,
        sl.role,
        CASE WHEN sl.is_active THEN 'active' ELSE 'inactive' END::text AS status,
        NULL::text AS invited_by_name,
        sl.created_at,
        sl.updated_at
      FROM project_share_links sl
      JOIN projects p ON p.id = sl.project_id
      JOIN users creator ON creator.id = sl.created_by_user_id

      UNION ALL

      SELECT
        ('access-request:' || ar.id) AS id,
        'access-request'::text AS kind,
        'Access request'::text AS label,
        ar.project_id,
        p.title AS project_title,
        NULL::text AS team_id,
        NULL::text AS team_name,
        ar.requester_user_id AS subject_user_id,
        ar.requester_name AS subject_name,
        ar.requester_email AS subject_email,
        ar.requested_role AS role,
        ar.status,
        NULL::text AS invited_by_name,
        ar.created_at,
        ar.updated_at
      FROM project_access_requests ar
      JOIN projects p ON p.id = ar.project_id

      UNION ALL

      SELECT
        ('team-member:' || tm.team_id || ':' || tm.user_id) AS id,
        'team-member'::text AS kind,
        'Team member'::text AS label,
        NULL::text AS project_id,
        NULL::text AS project_title,
        tm.team_id,
        t.name AS team_name,
        tm.user_id AS subject_user_id,
        u.name AS subject_name,
        u.email AS subject_email,
        tm.role,
        'active'::text AS status,
        NULL::text AS invited_by_name,
        tm.created_at,
        tm.created_at AS updated_at
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      JOIN users u ON u.id = tm.user_id
      WHERE tm.role != 'owner'
    ) access_rows
    ORDER BY updated_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    projectId: row.project_id,
    projectTitle: row.project_title,
    teamId: row.team_id,
    teamName: row.team_name,
    subjectUserId: row.subject_user_id,
    subjectName: row.subject_name,
    subjectEmail: row.subject_email,
    role: row.role,
    status: row.status,
    invitedByName: row.invited_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function loadProjects(limit: number): Promise<AdminProjectRecord[]> {
  const result = await pool.query<{
    id: string
    title: string
    owner_user_id: string
    owner_name: string
    owner_email: string
    team_id: string | null
    team_name: string | null
    main_file_id: string | null
    file_count: string
    member_count: string
    published_at: number | null
    created_at: number
    updated_at: number
  }>(`
    SELECT
      p.id,
      p.title,
      p.owner_user_id,
      owner.name AS owner_name,
      owner.email AS owner_email,
      p.team_id,
      t.name AS team_name,
      p.main_file_id,
      COUNT(DISTINCT pf.id)::text AS file_count,
      COUNT(DISTINCT pm.user_id)::text AS member_count,
      p.published_at,
      p.created_at,
      p.updated_at
    FROM projects p
    INNER JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN project_files pf ON pf.project_id = p.id
    LEFT JOIN project_members pm ON pm.project_id = p.id
    GROUP BY p.id, owner.name, owner.email, t.name
    ORDER BY p.updated_at DESC, p.created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    teamId: row.team_id,
    teamName: row.team_name,
    mainFileId: row.main_file_id,
    fileCount: Number(row.file_count),
    memberCount: Number(row.member_count),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function loadTeams(limit: number): Promise<AdminTeamRecord[]> {
  const result = await pool.query<{
    id: string
    name: string
    owner_user_id: string
    owner_name: string
    owner_email: string
    member_count: string
    project_count: string
    created_at: number
    updated_at: number
  }>(`
    SELECT
      t.id,
      t.name,
      t.owner_user_id,
      owner.name AS owner_name,
      owner.email AS owner_email,
      COUNT(DISTINCT tm.user_id)::text AS member_count,
      COUNT(DISTINCT p.id)::text AS project_count,
      t.created_at,
      t.updated_at
    FROM teams t
    INNER JOIN users owner ON owner.id = t.owner_user_id
    LEFT JOIN team_members tm ON tm.team_id = t.id
    LEFT JOIN projects p ON p.team_id = t.id
    GROUP BY t.id, owner.name, owner.email
    ORDER BY t.updated_at DESC, t.created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    memberCount: Number(row.member_count),
    projectCount: Number(row.project_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function loadRecentActivity(limit: number): Promise<AdminActivityRecord[]> {
  const result = await pool.query<{
    id: string
    project_id: string
    project_title: string
    actor_name: string | null
    type: string
    summary: string
    created_at: number
  }>(`
    SELECT
      activity.id,
      activity.project_id,
      projects.title AS project_title,
      activity.actor_name,
      activity.type,
      activity.summary,
      activity.created_at
    FROM project_activity_events AS activity
    INNER JOIN projects ON projects.id = activity.project_id
    ORDER BY activity.created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    actorName: row.actor_name,
    type: row.type,
    summary: row.summary,
    createdAt: row.created_at,
  }))
}
