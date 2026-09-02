import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { Redis } from 'ioredis'
import { getDbPool } from '../db.js'
import { env } from '../env.js'
import type { BillingStatus, ExportFormat, PlanLimits, SubscriptionPlan, SubscriptionStatus } from '../types.js'
import { sendEmailVerificationCode } from './email.js'
import { isAdminEmail } from '../adminAccess.js'

const pool = getDbPool()
const redis = new Redis(env.sessionRedisUrl, { maxRetriesPerRequest: null })
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000
const MAX_VERIFICATION_ATTEMPTS = 5

type SubscriptionRow = {
  id: string
  user_id: string | null
  team_id: string | null
  plan: SubscriptionPlan
  status: SubscriptionStatus
  period_start: number | null
  period_end: number | null
  renewal_mode: string
  payment_provider: string | null
  provider_customer_id: string | null
  provider_reference: string | null
  created_at: number
  updated_at: number
}

export const ADMIN_UNLIMITED_LIMITS: PlanLimits = {
  activeProjects: null,
  collaboratorsPerProject: null,
  fileStoragePerProjectMb: null,
  totalStorageMb: null,
  compileTimeoutSeconds: null,
  autoCompileDebounceMs: 0,
  compilesPerDay: null,
  revisionHistoryDays: null,
  exportFormats: ['pdf', 'docx', 'html', 'latex'],
  bibliographySearchesPerDay: null,
  customFonts: true,
  typstPackagePins: null,
  sharingPresets: true,
  sharingPresetsCount: null,
  teamWorkspaces: true,
  teamWorkspaceCount: null,
  teamMembers: null,
  trackChanges: true,
  writingGoals: true,
  publicProjectPublishing: true,
  managerRole: true,
  auditLogExportDays: null,
  adminConsole: true,
  prioritySupport: true,
  aiChatHistoryDays: null,
  aiRequestsPerDay: null,
}

export const STUDENT_FREEMIUM_LIMITS: PlanLimits = {
  activeProjects: 2,
  collaboratorsPerProject: 2,
  fileStoragePerProjectMb: 50,
  totalStorageMb: 200,
  compileTimeoutSeconds: 20,
  autoCompileDebounceMs: 2000,
  compilesPerDay: 100,
  revisionHistoryDays: 7,
  exportFormats: ['pdf'],
  bibliographySearchesPerDay: 20,
  customFonts: false,
  typstPackagePins: 0,
  sharingPresets: false,
  sharingPresetsCount: 0,
  teamWorkspaces: false,
  teamWorkspaceCount: 0,
  teamMembers: 0,
  trackChanges: false,
  writingGoals: false,
  publicProjectPublishing: false,
  managerRole: false,
  auditLogExportDays: 0,
  adminConsole: false,
  prioritySupport: false,
  aiChatHistoryDays: 0,
  aiRequestsPerDay: 20,
}

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: STUDENT_FREEMIUM_LIMITS,
  student_freemium: STUDENT_FREEMIUM_LIMITS,
  personal: {
    activeProjects: null,
    collaboratorsPerProject: 6,
    fileStoragePerProjectMb: 500,
    totalStorageMb: 5 * 1024,
    compileTimeoutSeconds: 60,
    autoCompileDebounceMs: 500,
    compilesPerDay: null,
    revisionHistoryDays: 90,
    exportFormats: ['pdf', 'docx', 'html', 'latex'],
    bibliographySearchesPerDay: null,
    customFonts: true,
    typstPackagePins: null,
    sharingPresets: true,
    sharingPresetsCount: 5,
    teamWorkspaces: false,
    teamWorkspaceCount: 0,
    teamMembers: 0,
    trackChanges: true,
    writingGoals: true,
    publicProjectPublishing: true,
    managerRole: false,
    auditLogExportDays: 0,
    adminConsole: false,
    prioritySupport: true,
    aiChatHistoryDays: 30,
    aiRequestsPerDay: null,
  },
  team: teamLikeLimits({ compileTimeoutSeconds: 120, totalStorageMb: 20 * 1024, revisionHistoryDays: 90, teamWorkspaceCount: 1, teamMembers: 20, managerRole: true, auditLogExportDays: 90, adminConsole: false, aiChatHistoryDays: 90, aiRequestsPerDay: null }),
  business: teamLikeLimits({ compileTimeoutSeconds: 180, totalStorageMb: 100 * 1024, revisionHistoryDays: 365, teamWorkspaceCount: 5, teamMembers: 100, managerRole: true, auditLogExportDays: 365, adminConsole: true, aiChatHistoryDays: 365, aiRequestsPerDay: null }),
  institution: teamLikeLimits({ compileTimeoutSeconds: 240, totalStorageMb: 100 * 1024, revisionHistoryDays: null, teamWorkspaceCount: null, teamMembers: null, managerRole: true, auditLogExportDays: null, adminConsole: true, aiChatHistoryDays: null, aiRequestsPerDay: null }),
  research_enterprise: teamLikeLimits({ compileTimeoutSeconds: 300, totalStorageMb: 500 * 1024, revisionHistoryDays: null, teamWorkspaceCount: null, teamMembers: null, managerRole: true, auditLogExportDays: null, adminConsole: true, aiChatHistoryDays: null, aiRequestsPerDay: null }),
}

function teamLikeLimits(input: {
  compileTimeoutSeconds: number
  totalStorageMb: number | null
  revisionHistoryDays: number | null
  teamWorkspaceCount: number | null
  teamMembers: number | null
  managerRole: boolean
  auditLogExportDays: number | null
  adminConsole: boolean
  aiChatHistoryDays: number | null
  aiRequestsPerDay: number | null
}): PlanLimits {
  return {
    activeProjects: null,
    collaboratorsPerProject: null,
    fileStoragePerProjectMb: null,
    totalStorageMb: input.totalStorageMb,
    compileTimeoutSeconds: input.compileTimeoutSeconds,
    autoCompileDebounceMs: 500,
    compilesPerDay: null,
    revisionHistoryDays: input.revisionHistoryDays,
    exportFormats: ['pdf', 'docx', 'html', 'latex'],
    bibliographySearchesPerDay: null,
    customFonts: true,
    typstPackagePins: null,
    sharingPresets: true,
    sharingPresetsCount: null,
    teamWorkspaces: true,
    teamWorkspaceCount: input.teamWorkspaceCount,
    teamMembers: input.teamMembers,
    trackChanges: true,
    writingGoals: true,
    publicProjectPublishing: true,
    managerRole: input.managerRole,
    auditLogExportDays: input.auditLogExportDays,
    adminConsole: input.adminConsole,
    prioritySupport: true,
    aiChatHistoryDays: input.aiChatHistoryDays,
    aiRequestsPerDay: input.aiRequestsPerDay,
  }
}

export class PlanLimitError extends Error {
  status = 402
  code = 'plan_limit_exceeded'
  constructor(message: string, public limitKey: string, public statusPayload?: BillingStatus) {
    super(message)
  }
}

export function getStaticPlanLimits(plan: SubscriptionPlan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}

export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const { rows: userRows } = await pool.query<{ email: string }>(
    'SELECT email FROM users WHERE id = $1',
    [userId],
  )
  const userEmail = userRows[0]?.email ?? null

  const [verifiedDomains, activeProjects, totalStorageBytes, compilesToday, bibliographySearchesToday] = await Promise.all([
    listVerifiedDomains(userId),
    countActiveOwnedProjects(userId),
    getTotalStorageBytes(userId),
    getCounterValue(buildDailyCounterKey('compile', userId)),
    getCounterValue(buildDailyCounterKey('bibliography', userId)),
  ])

  // Admins get unlimited everything — no plan enforcement
  if (isAdminEmail(userEmail)) {
    return {
      plan: 'research_enterprise',
      status: 'active',
      limits: ADMIN_UNLIMITED_LIMITS,
      usage: { activeProjects, totalStorageBytes, compilesToday, bibliographySearchesToday },
      verifiedDomains,
      requiresVerification: false,
      eligiblePlans: ['student_freemium', 'personal', 'team', 'business', 'institution', 'research_enterprise'],
    }
  }

  const subscription = await getEffectiveSubscription(userId)
  const hasEduDomain = verifiedDomains.some((entry) => isAcademicEduDomain(entry.domain))
  const hasVerifiedDomain = verifiedDomains.length > 0

  let plan: SubscriptionPlan
  let baseLimits: PlanLimits
  let limitsOverride: Partial<PlanLimits> | null = null

  if (subscription) {
    plan = subscription.plan
    baseLimits = getStaticPlanLimits(plan)
  } else {
    const domainList = verifiedDomains.map((d) => d.domain)
    const domainRule = await getDomainPlanRule(domainList)
    if (domainRule) {
      plan = domainRule.plan
      baseLimits = getStaticPlanLimits(plan)
      limitsOverride = domainRule.limitsOverride
    } else {
      plan = hasEduDomain ? 'student_freemium' : 'free'
      baseLimits = getStaticPlanLimits(plan)
    }
  }

  const effectiveLimits: PlanLimits = limitsOverride
    ? { ...baseLimits, ...limitsOverride }
    : baseLimits

  const status = subscription?.status ?? 'active'

  return {
    plan,
    status,
    limits: effectiveLimits,
    usage: { activeProjects, totalStorageBytes, compilesToday, bibliographySearchesToday },
    verifiedDomains,
    requiresVerification: !hasVerifiedDomain && plan === 'free',
    eligiblePlans: hasEduDomain ? ['student_freemium', 'personal'] : ['free', 'personal'],
  }
}

export async function startEmailVerification(userId: string, rawEmail: string): Promise<{ email: string; domain: string; expiresAt: number; devCode?: string }> {
  const email = normalizeEmail(rawEmail)
  const domain = domainFromEmail(email)
  if (!domain) {
    throw new Error('A valid school, university, or company email is required')
  }

  const recent = await pool.query(
    'SELECT COUNT(*)::int AS count FROM email_verification_codes WHERE user_id = $1 AND email = $2 AND created_at > $3',
    [userId, email, Date.now() - 60_000],
  )
  if (Number(recent.rows[0]?.count ?? 0) >= 3) {
    const error = new Error('Too many verification emails requested. Please wait a minute and try again.') as Error & { status?: number }
    error.status = 429
    throw error
  }

  const code = String(randomInt(100000, 999999))
  const expiresAt = Date.now() + VERIFICATION_CODE_TTL_MS
  await pool.query(
    `INSERT INTO email_verification_codes (id, user_id, email, code_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), userId, email, hashVerificationCode(userId, email, code), expiresAt, Date.now()],
  )
  await sendEmailVerificationCode({ toEmail: email, code, expiresInMinutes: Math.round(VERIFICATION_CODE_TTL_MS / 60_000) })

  return {
    email,
    domain,
    expiresAt,
    devCode: env.isProduction ? undefined : code,
  }
}

export async function confirmEmailVerification(userId: string, rawEmail: string, rawCode: string): Promise<BillingStatus> {
  const email = normalizeEmail(rawEmail)
  const code = String(rawCode ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Verification code must be 6 digits')
  }

  const { rows } = await pool.query<{
    id: string
    code_hash: string
    attempts: number
    expires_at: number
    consumed_at: number | null
  }>(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
     FROM email_verification_codes
     WHERE user_id = $1 AND email = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, email],
  )
  const record = rows[0]
  if (!record || record.consumed_at) throw new Error('Verification code not found or already used')
  if (record.expires_at < Date.now()) throw new Error('Verification code has expired')
  if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) throw new Error('Too many verification attempts')

  const expected = Buffer.from(record.code_hash)
  const actual = Buffer.from(hashVerificationCode(userId, email, code))
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual)
  if (!matches) {
    await pool.query('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id])
    throw new Error('Verification code is incorrect')
  }

  const domain = domainFromEmail(email)!
  const now = Date.now()
  await pool.query(
    `INSERT INTO verified_emails (user_id, email, domain, domain_type, verified_at, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'verified', $5, $5)
     ON CONFLICT (user_id, email) DO UPDATE
     SET domain = EXCLUDED.domain,
         domain_type = EXCLUDED.domain_type,
         verified_at = EXCLUDED.verified_at,
         status = 'verified',
         updated_at = EXCLUDED.updated_at`,
    [userId, email, domain, isAcademicEduDomain(domain) ? 'academic' : 'organization', now],
  )
  await pool.query('UPDATE email_verification_codes SET consumed_at = $1 WHERE id = $2', [now, record.id])

  if (isAcademicEduDomain(domain)) {
    await ensureUserSubscription(userId, 'student_freemium', 'active', {
      renewalMode: 'domain_verification',
      paymentProvider: 'domain',
      providerReference: domain,
    })
  }

  return getBillingStatus(userId)
}

export async function listVerifiedDomains(userId: string): Promise<BillingStatus['verifiedDomains']> {
  const { rows } = await pool.query<{
    email: string
    domain: string
    domain_type: string
    verified_at: number
  }>(
    `SELECT email, domain, domain_type, verified_at
     FROM verified_emails
     WHERE user_id = $1 AND status = 'verified'
     ORDER BY verified_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    email: row.email,
    domain: row.domain,
    domainType: row.domain_type,
    verifiedAt: Number(row.verified_at),
  }))
}

export async function ensureUserSubscription(
  userId: string,
  plan: SubscriptionPlan,
  status: SubscriptionStatus,
  options: {
    periodStart?: number | null
    periodEnd?: number | null
    renewalMode?: string
    paymentProvider?: string | null
    providerCustomerId?: string | null
    providerReference?: string | null
  } = {},
): Promise<string> {
  const existing = await getDirectUserSubscription(userId)
  const now = Date.now()
  if (existing) {
    await pool.query(
      `UPDATE subscriptions
       SET plan = $1, status = $2, period_start = $3, period_end = $4, renewal_mode = $5,
           payment_provider = $6, provider_customer_id = $7, provider_reference = $8, updated_at = $9
       WHERE id = $10`,
      [
        plan,
        status,
        options.periodStart ?? existing.period_start,
        options.periodEnd ?? existing.period_end,
        options.renewalMode ?? existing.renewal_mode,
        options.paymentProvider ?? existing.payment_provider,
        options.providerCustomerId ?? existing.provider_customer_id,
        options.providerReference ?? existing.provider_reference,
        now,
        existing.id,
      ],
    )
    return existing.id
  }

  const id = randomUUID()
  await pool.query(
    `INSERT INTO subscriptions
       (id, user_id, team_id, plan, status, period_start, period_end, renewal_mode, payment_provider, provider_customer_id, provider_reference, created_at, updated_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      id,
      userId,
      plan,
      status,
      options.periodStart ?? now,
      options.periodEnd ?? null,
      options.renewalMode ?? 'manual',
      options.paymentProvider ?? null,
      options.providerCustomerId ?? null,
      options.providerReference ?? null,
      now,
    ],
  )
  return id
}

export async function createPaymentOrder(input: {
  userId: string
  plan: SubscriptionPlan
  amount: number
  currency: string
}): Promise<{ orderId: string; subscriptionId: string; provider: 'isbank_sanal_pos'; status: 'created'; redirectPayload: Record<string, unknown> }> {
  const subscriptionId = await ensureUserSubscription(input.userId, input.plan, 'past_due', {
    renewalMode: 'manual',
    paymentProvider: 'isbank_sanal_pos',
  })
  const orderId = `typstr-${Date.now()}-${randomUUID().slice(0, 8)}`
  const now = Date.now()
  await pool.query(
    `INSERT INTO payment_transactions
       (id, subscription_id, provider, order_id, amount, currency, status, raw_request, created_at, updated_at)
     VALUES ($1, $2, 'isbank_sanal_pos', $3, $4, $5, 'created', $6, $7, $7)`,
    [randomUUID(), subscriptionId, orderId, Math.max(0, Math.trunc(input.amount)), input.currency.toUpperCase(), JSON.stringify(input), now],
  )

  return {
    orderId,
    subscriptionId,
    provider: 'isbank_sanal_pos',
    status: 'created',
    redirectPayload: {
      mode: 'pending_bank_integration',
      orderId,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      callbackUrl: `${env.backendOrigin}/api/billing/callback`,
    },
  }
}

export async function recordPaymentCallback(payload: Record<string, unknown>): Promise<{ ok: true; orderId: string | null }> {
  const orderId = typeof payload.orderId === 'string'
    ? payload.orderId
    : typeof payload.oid === 'string'
      ? payload.oid
      : null
  const status = normalizePaymentStatus(payload)
  const now = Date.now()
  if (!orderId) {
    return { ok: true, orderId: null }
  }

  const { rows } = await pool.query<{ subscription_id: string | null }>(
    `UPDATE payment_transactions
     SET status = $1, raw_response = $2, paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, $3) ELSE paid_at END, updated_at = $3
     WHERE order_id = $4
     RETURNING subscription_id`,
    [status, JSON.stringify(payload), now, orderId],
  )
  const subscriptionId = rows[0]?.subscription_id
  if (subscriptionId && status === 'paid') {
    await pool.query(
      `UPDATE subscriptions
       SET status = 'active', period_start = COALESCE(period_start, $1), period_end = COALESCE(period_end, $2), updated_at = $1
       WHERE id = $3`,
      [now, now + 365 * 24 * 60 * 60 * 1000, subscriptionId],
    )
  }
  return { ok: true, orderId }
}

export async function assertCanCreateProject(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.activeProjects
  if (limit != null && status.usage.activeProjects >= limit) {
    throw new PlanLimitError(`Your plan allows ${limit} active projects.`, 'activeProjects', status)
  }
}

export async function assertCanUploadBytes(userId: string, projectId: string, bytes: number): Promise<void> {
  const status = await getBillingStatus(userId)
  const perProjectLimit = status.limits.fileStoragePerProjectMb
  if (perProjectLimit != null) {
    const projectBytes = await getProjectStorageBytes(projectId)
    if (projectBytes + bytes > perProjectLimit * 1024 * 1024) {
      throw new PlanLimitError(`Your plan allows ${perProjectLimit} MB per project.`, 'fileStoragePerProjectMb', status)
    }
  }
  const totalLimit = status.limits.totalStorageMb
  if (totalLimit != null && status.usage.totalStorageBytes + bytes > totalLimit * 1024 * 1024) {
    throw new PlanLimitError(`Your plan allows ${totalLimit} MB total storage.`, 'totalStorageMb', status)
  }
}

export async function assertCanStoreFileBytes(userId: string, projectId: string, fileId: string, nextBytes: number): Promise<void> {
  const { rows } = await pool.query<{ size_bytes: number }>('SELECT size_bytes FROM project_files WHERE id = $1 AND project_id = $2', [fileId, projectId])
  const currentBytes = Number(rows[0]?.size_bytes ?? 0)
  const delta = Math.max(0, nextBytes - currentBytes)
  if (delta > 0) {
    await assertCanUploadBytes(userId, projectId, delta)
  }
}

export async function assertCanInviteCollaborator(userId: string, projectId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.collaboratorsPerProject
  if (limit == null) return
  const { rows } = await pool.query<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM project_members WHERE project_id = $1) +
       (SELECT COUNT(*) FROM project_invitations WHERE project_id = $1 AND status = 'pending')
     )::int AS count`,
    [projectId],
  )
  if (Number(rows[0]?.count ?? 0) >= limit) {
    throw new PlanLimitError(`Your plan allows ${limit} total project members and pending invitations.`, 'collaboratorsPerProject', status)
  }
}

export async function assertCanCreateTeam(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.teamWorkspaces) {
    throw new PlanLimitError('Your plan does not include team workspaces.', 'teamWorkspaces', status)
  }
  const limit = status.limits.teamWorkspaceCount
  if (limit != null) {
    const { rows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM teams WHERE owner_user_id = $1`,
      [userId],
    )
    if (Number(rows[0]?.count ?? 0) >= limit) {
      throw new PlanLimitError(`Your plan allows ${limit} team workspace${limit === 1 ? '' : 's'}.`, 'teamWorkspaceCount', status)
    }
  }
}

export async function assertCanAddTeamMember(userId: string, teamId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.teamMembers
  if (limit == null) return
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM team_members WHERE team_id = $1`,
    [teamId],
  )
  if (Number(rows[0]?.count ?? 0) >= limit) {
    throw new PlanLimitError(`Your plan allows ${limit} team member${limit === 1 ? '' : 's'}.`, 'teamMembers', status)
  }
}

export async function assertCanCreateSharingPreset(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.sharingPresets) {
    throw new PlanLimitError('Your plan does not include saved sharing presets.', 'sharingPresets', status)
  }
  const limit = status.limits.sharingPresetsCount
  if (limit != null) {
    const { rows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM sharing_presets WHERE owner_user_id = $1`,
      [userId],
    )
    if (Number(rows[0]?.count ?? 0) >= limit) {
      throw new PlanLimitError(`Your plan allows ${limit} saved sharing preset${limit === 1 ? '' : 's'}.`, 'sharingPresetsCount', status)
    }
  }
}

export async function assertCanUseCustomFonts(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.customFonts) {
    throw new PlanLimitError('Your plan does not include custom fonts.', 'customFonts', status)
  }
}

export async function assertCanUseTrackChanges(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.trackChanges) {
    throw new PlanLimitError('Your plan does not include tracked changes.', 'trackChanges', status)
  }
}

export async function assertCanUseWritingGoals(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.writingGoals) {
    throw new PlanLimitError('Your plan does not include writing goals.', 'writingGoals', status)
  }
}

export async function assertCanUseTypstPackagePins(userId: string, nextPinCount: number): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.typstPackagePins
  if (limit != null && nextPinCount > limit) {
    throw new PlanLimitError(`Your plan allows ${limit} Typst package pin${limit === 1 ? '' : 's'}.`, 'typstPackagePins', status)
  }
}

export async function assertCanPublishProject(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.publicProjectPublishing) {
    throw new PlanLimitError('Your plan does not include public project publishing.', 'publicProjectPublishing', status)
  }
}

export async function assertCanUseManagerRole(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.managerRole) {
    throw new PlanLimitError('Your plan does not include manager roles.', 'managerRole', status)
  }
}

export async function assertCanExportFormat(userId: string, format: ExportFormat): Promise<void> {
  const status = await getBillingStatus(userId)
  if (!status.limits.exportFormats.includes(format)) {
    throw new PlanLimitError(`Your plan only allows these export formats: ${status.limits.exportFormats.join(', ')}.`, 'exportFormats', status)
  }
}

export async function assertCanUseCompileSettings(userId: string, compileDebounceMs: number, defaultExportFormat: ExportFormat): Promise<void> {
  const status = await getBillingStatus(userId)
  if (compileDebounceMs < status.limits.autoCompileDebounceMs) {
    throw new PlanLimitError(`Your plan allows auto-compile debounce of ${status.limits.autoCompileDebounceMs} ms or higher.`, 'autoCompileDebounceMs', status)
  }
  if (!status.limits.exportFormats.includes(defaultExportFormat)) {
    throw new PlanLimitError(`Your plan only allows these export formats: ${status.limits.exportFormats.join(', ')}.`, 'exportFormats', status)
  }
}

export async function assertCanAccessRevision(userId: string, revisionCreatedAt: number): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.revisionHistoryDays
  if (limit != null && revisionCreatedAt < Date.now() - limit * 86_400_000) {
    throw new PlanLimitError(`Your plan includes ${limit} days of revision history.`, 'revisionHistoryDays', status)
  }
}

export async function assertCanAccessRevisionById(userId: string, revisionId: string): Promise<void> {
  const { rows } = await pool.query<{ created_at: number }>(
    `SELECT created_at FROM project_revisions WHERE id = $1 LIMIT 1`,
    [revisionId],
  )
  const createdAt = rows[0]?.created_at
  if (createdAt != null) {
    await assertCanAccessRevision(userId, Number(createdAt))
  }
}

export async function filterRevisionsForPlan<T extends { createdAt: number }>(userId: string, revisions: T[]): Promise<T[]> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.revisionHistoryDays
  if (limit == null) return revisions
  const cutoff = Date.now() - limit * 86_400_000
  return revisions.filter((revision) => revision.createdAt >= cutoff)
}

export async function consumeCompileQuota(userId: string): Promise<BillingStatus> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.compilesPerDay
  if (limit == null) return status
  const count = await incrementDailyCounter(buildDailyCounterKey('compile', userId))
  if (count > limit) {
    throw new PlanLimitError(`Your plan allows ${limit} compiles per day.`, 'compilesPerDay', {
      ...status,
      usage: { ...status.usage, compilesToday: count },
    })
  }
  return { ...status, usage: { ...status.usage, compilesToday: count } }
}

export async function consumeBibliographySearchQuota(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.bibliographySearchesPerDay
  if (limit == null) return
  const count = await incrementDailyCounter(buildDailyCounterKey('bibliography', userId))
  if (count > limit) {
    throw new PlanLimitError(`Your plan allows ${limit} bibliography searches per day.`, 'bibliographySearchesPerDay', status)
  }
}

async function getEffectiveSubscription(userId: string): Promise<SubscriptionRow | null> {
  return getDirectUserSubscription(userId)
}

async function getDomainPlanRule(domains: string[]): Promise<{ plan: SubscriptionPlan; limitsOverride: Partial<PlanLimits> | null } | null> {
  if (domains.length === 0) return null
  const now = Date.now()
  const { rows } = await pool.query<{ plan: string; limits_override: string | null }>(
    `SELECT plan, limits_override
     FROM domain_plan_rules
     WHERE domain = ANY($1)
       AND status = 'active'
       AND (valid_from IS NULL OR valid_from <= $2)
       AND (valid_until IS NULL OR valid_until >= $2)
     ORDER BY valid_until DESC NULLS FIRST
     LIMIT 1`,
    [domains, now],
  )
  const row = rows[0]
  if (!row) return null
  return {
    plan: row.plan as SubscriptionPlan,
    limitsOverride: row.limits_override ? (JSON.parse(row.limits_override) as Partial<PlanLimits>) : null,
  }
}

async function getDirectUserSubscription(userId: string): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query<SubscriptionRow>(
    `SELECT * FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

async function countActiveOwnedProjects(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM projects p
     LEFT JOIN project_preferences pp ON pp.project_id = p.id
     WHERE p.owner_user_id = $1
       AND COALESCE(pp.trashed_at, 0) = 0
       AND COALESCE(pp.archived_at, 0) = 0`,
    [userId],
  )
  return Number(rows[0]?.count ?? 0)
}

async function getProjectStorageBytes(projectId: string): Promise<number> {
  const { rows } = await pool.query<{ bytes: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS bytes FROM project_files WHERE project_id = $1`,
    [projectId],
  )
  return Number(rows[0]?.bytes ?? 0)
}

async function getTotalStorageBytes(userId: string): Promise<number> {
  const { rows } = await pool.query<{ bytes: number }>(
    `SELECT COALESCE(SUM(pf.size_bytes), 0)::bigint AS bytes
     FROM project_files pf
     INNER JOIN projects p ON p.id = pf.project_id
     WHERE p.owner_user_id = $1`,
    [userId],
  )
  return Number(rows[0]?.bytes ?? 0)
}

function normalizeEmail(rawEmail: string): string {
  const email = String(rawEmail ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required')
  }
  return email
}

function domainFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase().replace(/\.$/, '')
  if (!domain || domain.length > 253 || domain.includes('..')) return null
  return domain
}

function isAcademicEduDomain(domain: string): boolean {
  return domain.split('.').some((label) => label === 'edu')
}

function hashVerificationCode(userId: string, email: string, code: string): string {
  return createHash('sha256').update(`${userId}:${email}:${code}:${env.sessionSecret}`).digest('hex')
}

export async function consumeAiRequestQuota(userId: string): Promise<void> {
  const status = await getBillingStatus(userId)
  const limit = status.limits.aiRequestsPerDay
  if (limit == null) return
  const count = await incrementDailyCounter(buildDailyCounterKey('ai', userId))
  if (count > limit) {
    throw new PlanLimitError(`Your plan allows ${limit} AI requests per day. Upgrade to remove this limit.`, 'aiRequestsPerDay', status)
  }
}

export function getAiHistoryCutoff(limits: PlanLimits): number | null {
  const days = limits.aiChatHistoryDays
  if (days === null) return null
  if (days === 0) return -1
  return Date.now() - days * 24 * 60 * 60 * 1000
}

function buildDailyCounterKey(kind: 'compile' | 'bibliography' | 'ai', userId: string): string {
  return `typstr:${kind}:${userId}:${new Date().toISOString().slice(0, 10)}`
}

async function getCounterValue(key: string): Promise<number> {
  return Number(await redis.get(key) ?? 0)
}

async function incrementDailyCounter(key: string): Promise<number> {
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, 36 * 60 * 60)
  }
  return count
}

function normalizePaymentStatus(payload: Record<string, unknown>): 'created' | 'paid' | 'failed' | 'cancelled' {
  const raw = String(payload.status ?? payload.Response ?? payload.procReturnCode ?? '').toLowerCase()
  if (raw === 'approved' || raw === 'success' || raw === 'paid' || raw === '00') return 'paid'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  if (raw) return 'failed'
  return 'created'
}
