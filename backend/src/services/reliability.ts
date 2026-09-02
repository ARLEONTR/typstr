import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID, createHash } from 'node:crypto'
import pLimit from 'p-limit'
import * as Y from 'yjs'
import {
  canAccessProject,
  findUserById,
  getDbPool,
  getProjectById,
  getProjectEcosystemSettings,
  getProjectFileById,
  getProjectFileForUser,
  getProjectFileStorage,
  getProjectInvitationById,
  touchProjectFile,
  updateProjectFileCollaborationState,
} from '../db.js'
import { sendInvitationEmail } from './email.js'
import type {
  AdminDiagnostics,
  BackgroundJobRecord,
  BackgroundJobStatus,
  BackgroundJobType,
  CompileDiagnostic,
  ErrorEvent,
  ExportFormat,
  HealthCheckItem,
  HealthCheckReport,
  ProjectActivityEvent,
  ProjectRevision,
  ProjectRevisionReason,
} from '../types.js'
import { env, isGoogleAuthConfigured, isLocalFileStorageEnabled } from '../env.js'
import { getCollaborationMetrics } from '../collaboration.js'
import { ensureDriveItemPermission, deleteDriveItemPermissionByEmail, readTextFileFromDrive, upsertBinaryFileInDrive, writeTextFileToDrive } from './drive.js'
import {
  compileLatexProjectToPdf,
  compileTypstProjectToPdf,
  compileTypstProjectToSvg,
  parseCompileDiagnostics,
  type LatexSyncTexEntry,
} from './compiler.js'
import { createSyncTexSession } from './syncTexSession.js'
import { compileTypstProjectPdf, convertWithPandoc } from './exporter.js'
import { ecosystemIssuesToCompileDiagnostics, validateProjectWorkspace } from './ecosystem.js'
import { loadProjectWorkspace } from './projectWorkspace.js'
import { pingSessionRedis } from '../auth.js'
import { jobQueue, jobQueueEvents, createWorker } from './queueManager.js'
import { assertCanStoreFileBytes, consumeCompileQuota } from './billing.js'

const execFileAsync = promisify(execFile)
const pool = getDbPool()

const activeCompileSessions = new Map<string, AbortController>()
let worker: ReturnType<typeof createWorker> | null = null
const COMPILE_WORKER_CONCURRENCY = Math.max(1, parseInt(process.env.COMPILE_WORKER_CONCURRENCY ?? process.env.MAX_CONCURRENT_COMPILES ?? '2', 10))
const compileWorkerPool = pLimit(COMPILE_WORKER_CONCURRENCY)
let queuedCompileExecutions = 0
let runningCompileExecutions = 0

type SaveFilePayload = {
  userId: string
  projectId: string
  fileId: string
  source: string
  label?: string
}

type PdfSnapshotPayload = {
  userId: string
  projectId: string
  fileId: string
  source: string
}

type CompilePayload = {
  userId: string
  source: string
  projectId?: string
  fileId?: string
  activeFileId?: string
  activeSource?: string
  documentFormat?: 'typst' | 'latex'
  latexEngine?: 'pdflatex' | 'xelatex' | 'lualatex'
  format: 'svg' | 'pdf'
  previewSessionId?: string
  svgPageIndex?: number
  svgWindowSize?: number
  compileTimeoutMs?: number
}

type CompileJobResult =
  | { format: 'svg'; pages: string[]; pageCount: number; pageOffset: number; diagnostics: CompileDiagnostic[]; notice?: string }
  | { format: 'pdf'; pdfBase64: string; diagnostics: CompileDiagnostic[]; notice?: string; log?: string; syncTex?: LatexSyncTexEntry[]; syncTexToken?: string; syncTexEntryPath?: string }

type CompileWaiter = {
  resolve: (result: CompileJobResult) => void
  reject: (error: unknown) => void
}

type CoalescedCompileState = {
  active: boolean
  timer: ReturnType<typeof setTimeout> | null
  latestPayload: CompilePayload | null
  waiters: CompileWaiter[]
}

const PARTIAL_SVG_PAGE_THRESHOLD = parseInt(process.env.COMPILE_SVG_PARTIAL_THRESHOLD_PAGES ?? '8', 10)
const DEFAULT_SVG_WINDOW_SIZE = parseInt(process.env.COMPILE_SVG_WINDOW_SIZE ?? '4', 10)
const COMPILE_COALESCE_WINDOW_MS = Math.max(0, parseInt(process.env.COMPILE_COALESCE_WINDOW_MS ?? '120', 10))
const coalescedCompileStates = new Map<string, CoalescedCompileState>()

type ExportPayload = {
  userId: string
  source: string
  format: ExportFormat
  documentFormat?: 'typst' | 'latex'
  projectId?: string
  fileId?: string
  saveToDrive?: boolean
}

type InviteSyncPayload = {
  projectId: string
  actorUserId: string | null
  summary: string
  metadata?: Record<string, unknown>
}

type DrivePermissionSyncPayload = {
  projectId: string
  ownerUserId: string
  fileId: string
  email: string
  role: 'editor' | 'viewer' | null
  action: 'grant' | 'revoke'
  actorUserId: string | null
}

function clampSvgWindowSize(windowSize?: number): number {
  if (!windowSize || !Number.isFinite(windowSize)) {
    return DEFAULT_SVG_WINDOW_SIZE
  }

  return Math.max(1, Math.min(12, Math.trunc(windowSize)))
}

function buildSvgWindow(pages: string[], requestedPageIndex?: number, requestedWindowSize?: number): { pages: string[]; pageCount: number; pageOffset: number } {
  const pageCount = pages.length
  if (pageCount === 0) {
    return { pages: [], pageCount: 0, pageOffset: 0 }
  }

  const windowSize = clampSvgWindowSize(requestedWindowSize)
  if (pageCount <= Math.max(windowSize, PARTIAL_SVG_PAGE_THRESHOLD)) {
    return { pages, pageCount, pageOffset: 0 }
  }

  const safeRequestedPage = Math.max(0, Math.min(pageCount - 1, requestedPageIndex ?? 0))
  const halfWindow = Math.floor(windowSize / 2)
  const pageOffset = Math.max(0, Math.min(pageCount - windowSize, safeRequestedPage - halfWindow))
  return {
    pages: pages.slice(pageOffset, pageOffset + windowSize),
    pageCount,
    pageOffset,
  }
}

export async function initializeReliabilityTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      label TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('manual-save', 'collaboration-checkpoint', 'restore', 'pre-restore')),
      source TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_activity_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS error_events (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      code TEXT,
      details TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_revisions_file_id_created_at ON project_revisions(file_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_activity_events_project_id_created_at ON project_activity_events(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_error_events_created_at ON error_events(created_at DESC);
  `)
}

export function startBackgroundJobWorker(): void {
  if (worker) {
    return
  }

  worker = createWorker(async (job) => {
    return await executeJob(job.name as BackgroundJobType, job.data)
  }, 10)
}

export async function enqueueBackgroundJob(
  type: BackgroundJobType, 
  payload: unknown, 
  options: { maxAttempts?: number; runAfter?: number; deduplicateKey?: string } = {}
): Promise<string> {
  const job = await jobQueue.add(type, payload, {
    jobId: options.deduplicateKey,
    attempts: options.maxAttempts ?? 3,
    delay: options.runAfter ? Math.max(0, options.runAfter - Date.now()) : undefined,
    backoff: { type: 'exponential', delay: 1000 },
  })
  return job.id!
}

export async function countQueuedCompileJobsForUser(userId: string): Promise<number> {
  const [queued, active, waiting] = await Promise.all([
    jobQueue.getJobs(['waiting']),
    jobQueue.getJobs(['active']),
    jobQueue.getJobs(['delayed'])
  ])
  
  const all = [...queued, ...active, ...waiting]
  return all.filter(job => job.name === 'compile-project' && job.data.userId === userId).length
}

export async function runBackgroundJobAndWait<TResult>(
  type: BackgroundJobType, 
  payload: unknown, 
  options: { maxAttempts?: number; timeoutMs?: number; deduplicateKey?: string } = {}
): Promise<TResult> {
  const job = await jobQueue.add(type, payload, {
    jobId: options.deduplicateKey,
    attempts: options.maxAttempts ?? 3,
  })
  await jobQueueEvents.waitUntilReady()
  return await job.waitUntilFinished(jobQueueEvents, options.timeoutMs ?? 60_000)
}

export function runCoalescedCompileJobAndWait(
  payload: CompilePayload,
  options: { timeoutMs?: number } = {},
): Promise<CompileJobResult> {
  const key = compileCoalescingKey(payload)
  let state = coalescedCompileStates.get(key)
  if (!state) {
    state = {
      active: false,
      timer: null,
      latestPayload: null,
      waiters: [],
    }
    coalescedCompileStates.set(key, state)
  }

  state.latestPayload = payload

  const promise = new Promise<CompileJobResult>((resolve, reject) => {
    state!.waiters.push({ resolve, reject })
  })

  if (!state.active && !state.timer) {
    state.timer = setTimeout(() => {
      state!.timer = null
      void flushCoalescedCompile(key, options)
    }, COMPILE_COALESCE_WINDOW_MS)
  }

  return promise
}

function compileCoalescingKey(payload: CompilePayload): string {
  return [
    payload.userId,
    payload.projectId ?? 'standalone',
    payload.fileId ?? 'main',
    payload.documentFormat ?? 'typst',
    payload.latexEngine ?? 'default',
    payload.format,
    payload.previewSessionId ?? 'preview',
  ].join(':')
}

function beginCompileSession(payload: CompilePayload): { signal: AbortSignal | undefined; finish: () => void } {
  const sessionKey = getCompileSessionKey(payload)
  if (!sessionKey) {
    return { signal: undefined, finish: () => undefined }
  }

  activeCompileSessions.get(sessionKey)?.abort()
  const controller = new AbortController()
  activeCompileSessions.set(sessionKey, controller)

  return {
    signal: controller.signal,
    finish: () => {
      if (activeCompileSessions.get(sessionKey) === controller) {
        activeCompileSessions.delete(sessionKey)
      }
    },
  }
}

function getCompileSessionKey(payload: CompilePayload): string | null {
  if (payload.previewSessionId) {
    return `${payload.userId}:${payload.previewSessionId}`
  }

  if (!payload.projectId || !payload.fileId) {
    return null
  }

  return [
    payload.userId,
    payload.projectId,
    payload.fileId,
    payload.documentFormat ?? 'typst',
    payload.format,
  ].join(':')
}

function diagnosticsFromCompileLog(log: string, entryPath: string): CompileDiagnostic[] {
  return parseCompileDiagnostics(latestCompileLogSection(log), entryPath)
}

function latestCompileLogSection(log: string): string {
  const sections = log
    .split(/\n\n(?=\$ )/)
    .map((section) => section.trim())
    .filter(Boolean)

  return sections.at(-1) ?? log
}

async function flushCoalescedCompile(
  key: string,
  options: { timeoutMs?: number },
): Promise<void> {
  const state = coalescedCompileStates.get(key)
  if (!state || state.active || !state.latestPayload || state.waiters.length === 0) {
    return
  }

  const payload = state.latestPayload
  const waiters = state.waiters
  state.latestPayload = null
  state.waiters = []
  state.active = true

  try {
    await consumeCompileQuota(payload.userId)
    const result = await runBackgroundJobAndWait<CompileJobResult>('compile-project', payload, {
      timeoutMs: options.timeoutMs,
    })
    for (const waiter of waiters) {
      waiter.resolve(result)
    }
  } catch (error) {
    for (const waiter of waiters) {
      waiter.reject(error)
    }
  } finally {
    state.active = false
    if (state.waiters.length > 0) {
      state.timer = setTimeout(() => {
        state.timer = null
        void flushCoalescedCompile(key, options)
      }, COMPILE_COALESCE_WINDOW_MS)
    } else {
      coalescedCompileStates.delete(key)
    }
  }
}

export function getCompileWorkerMetrics() {
  return {
    concurrency: COMPILE_WORKER_CONCURRENCY,
    queued: queuedCompileExecutions,
    running: runningCompileExecutions,
    cancellableSessions: activeCompileSessions.size,
    coalescingKeys: coalescedCompileStates.size,
  }
}

export async function createProjectRevisionSnapshot(input: {
  projectId: string
  fileId: string
  filePath: string
  source: string
  reason: ProjectRevisionReason
  actorUserId: string | null
  label: string
}): Promise<ProjectRevision> {
  const id = randomUUID()
  const now = Date.now()
  const actor = input.actorUserId ? await findUserById(input.actorUserId) : null
  await pool.query(`
    INSERT INTO project_revisions (id, project_id, file_id, file_path, label, reason, source, actor_user_id, actor_name, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [id, input.projectId, input.fileId, input.filePath, input.label, input.reason, input.source, input.actorUserId, actor?.name ?? null, now])

  return {
    id,
    projectId: input.projectId,
    fileId: input.fileId,
    filePath: input.filePath,
    label: input.label,
    reason: input.reason,
    source: input.source,
    actorUserId: input.actorUserId,
    actorName: actor?.name ?? null,
    createdAt: now,
  }
}

export async function maybeCreateCollaborationCheckpoint(input: {
  projectId: string
  fileId: string
  filePath: string
  source: string
}): Promise<void> {
  const recent = await pool.query<{ created_at: number }>(`
    SELECT created_at
    FROM project_revisions
    WHERE file_id = $1 AND reason = 'collaboration-checkpoint'
    ORDER BY created_at DESC
    LIMIT 1
  `, [input.fileId])

  const lastCreatedAt = recent.rows[0]?.created_at ?? 0
  if (Date.now() - lastCreatedAt < 5 * 60_000) {
    return
  }

  await createProjectRevisionSnapshot({
    ...input,
    reason: 'collaboration-checkpoint',
    actorUserId: null,
    label: `Checkpoint ${new Date().toLocaleString()}`,
  })
}

export async function listProjectFileRevisions(fileId: string, limit = 30): Promise<ProjectRevision[]> {
  const result = await pool.query<{
    id: string
    project_id: string
    file_id: string
    file_path: string
    label: string
    reason: ProjectRevisionReason
    source: string
    actor_user_id: string | null
    actor_name: string | null
    created_at: number
  }>(`
    SELECT id, project_id, file_id, file_path, label, reason, source, actor_user_id, actor_name, created_at
    FROM project_revisions
    WHERE file_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [fileId, limit])

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    fileId: row.file_id,
    filePath: row.file_path,
    label: row.label,
    reason: row.reason,
    source: row.source,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }))
}

export async function updateProjectRevisionLabel(revisionId: string, fileId: string, label: string | null): Promise<void> {
  await pool.query(
    `UPDATE project_revisions SET label = $1 WHERE id = $2 AND file_id = $3`,
    [label, revisionId, fileId],
  )
}

export async function restoreProjectRevision(input: { projectId: string; fileId: string; revisionId: string; actorUserId: string }): Promise<ProjectRevision> {
  const revisionQuery = await pool.query<{
    id: string
    project_id: string
    file_id: string
    file_path: string
    label: string
    reason: ProjectRevisionReason
    source: string
    created_at: number
  }>('SELECT * FROM project_revisions WHERE id = $1 LIMIT 1', [input.revisionId])
  const revision = revisionQuery.rows[0]
  if (!revision || revision.project_id !== input.projectId || revision.file_id !== input.fileId) {
    throw new Error('Revision not found')
  }

  const storage = await getProjectFileStorage(input.fileId)
  if (!storage || storage.file.projectId !== input.projectId) {
    throw new Error('File not found')
  }

  const currentSource = await readTextFileFromDrive(storage.ownerUserId, storage.file.driveFileId)
  await createProjectRevisionSnapshot({
    projectId: input.projectId,
    fileId: input.fileId,
    filePath: storage.file.path,
    source: currentSource,
    reason: 'pre-restore',
    actorUserId: input.actorUserId,
    label: `Pre-restore backup ${new Date().toLocaleString()}`,
  })

  await writeTextFileToDrive(storage.ownerUserId, storage.file.driveFileId, revision.source)
  const document = new Y.Doc()
  document.getText('content').insert(0, revision.source)
  await updateProjectFileCollaborationState(input.fileId, Y.encodeStateAsUpdate(document))
  await touchProjectFile(input.fileId)

  const restoredRevision = await createProjectRevisionSnapshot({
    projectId: input.projectId,
    fileId: input.fileId,
    filePath: storage.file.path,
    source: revision.source,
    reason: 'restore',
    actorUserId: input.actorUserId,
    label: `Restored from ${revision.label}`,
  })

  await logProjectActivity({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    type: 'revision.restore',
    summary: `Restored ${storage.file.path} from revision “${revision.label}”.`,
    metadata: { revisionId: revision.id, fileId: input.fileId },
  })

  return restoredRevision
}

export async function logProjectActivity(input: {
  projectId: string
  actorUserId: string | null
  type: string
  summary: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const actor = input.actorUserId ? await findUserById(input.actorUserId) : null
  await pool.query(`
    INSERT INTO project_activity_events (id, project_id, actor_user_id, actor_name, type, summary, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [randomUUID(), input.projectId, input.actorUserId, actor?.name ?? null, input.type, input.summary, input.metadata ? JSON.stringify(input.metadata) : null, Date.now()])
}

export async function listProjectActivity(projectId: string, limit = 50): Promise<ProjectActivityEvent[]> {
  const result = await pool.query<{
    id: string
    project_id: string
    actor_user_id: string | null
    actor_name: string | null
    type: string
    summary: string
    metadata: string | null
    created_at: number
  }>(`
    SELECT *
    FROM project_activity_events
    WHERE project_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [projectId, limit])

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    type: row.type,
    summary: row.summary,
    metadata: row.metadata,
    createdAt: row.created_at,
  }))
}

export async function recordErrorEvent(input: { scope: string; message: string; code?: string | null; details?: string | null }): Promise<void> {
  await pool.query(`
    INSERT INTO error_events (id, scope, message, code, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [randomUUID(), input.scope, input.message, input.code ?? null, input.details ?? null, Date.now()])
}

export async function listRecentErrors(limit = 25): Promise<ErrorEvent[]> {
  const result = await pool.query<{ id: string; scope: string; message: string; code: string | null; details: string | null; created_at: number }>(`
    SELECT * FROM error_events
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    message: row.message,
    code: row.code,
    details: row.details,
    createdAt: row.created_at,
  }))
}

let healthReportCache: { report: HealthCheckReport; expiresAt: number } | null = null
const HEALTH_CACHE_TTL_MS = 30_000

export async function getHealthReport(): Promise<HealthCheckReport> {
  if (healthReportCache && Date.now() < healthReportCache.expiresAt) {
    return healthReportCache.report
  }
  const checkedAt = Date.now()
  const checks = await Promise.all([
    runHealthCheck('database', async () => {
      await pool.query('SELECT 1')
      return 'Postgres reachable'
    }),
    runHealthCheck('redis', async () => {
      await pingSessionRedis()
      return 'Redis session store reachable'
    }),
    runHealthCheck('compiler', async () => {
      const { stdout } = await execFileAsync('typst', ['--version'])
      return stdout.trim() || 'typst available'
    }),
    runHealthCheck('exporter', async () => {
      const { stdout } = await execFileAsync('pandoc', ['--version'])
      return stdout.split('\n')[0]?.trim() || 'pandoc available'
    }),
    runHealthCheck('drive', async () => {
      if (isLocalFileStorageEnabled()) {
        return 'Local filesystem storage mode enabled'
      }

      if (!isGoogleAuthConfigured()) {
        throw new Error('Google OAuth / Drive integration is not configured')
      }

      return 'Google Drive integration configured'
    }),
    runHealthCheck('collaboration', async () => {
      const metrics = getCollaborationMetrics()
      return metrics.isReady
        ? `WebSocket server ready with ${metrics.connectionCount} active connections, ${metrics.documentCount} active rooms, and ${metrics.scalingStrategy}`
        : 'Collaboration server not initialized'
    }),
    runHealthCheck('compile-queue', async () => {
      const metrics = getCompileWorkerMetrics()
      return `Worker pool concurrency ${metrics.concurrency}, running ${metrics.running}, queued ${metrics.queued}, cancellable sessions ${metrics.cancellableSessions}`
    }),
  ])

  const status: 'error' | 'degraded' | 'ok' = checks.some((check) => check.status === 'error')
    ? 'error'
    : checks.some((check) => check.status === 'degraded')
      ? 'degraded'
      : 'ok'

  const report = {
    status,
    service: env.serverRole,
    checkedAt,
    checks,
  }
  healthReportCache = { report, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS }
  return report
}

export async function getAdminDiagnostics(): Promise<AdminDiagnostics> {
  const [health, recentErrors, recentJobs] = await Promise.all([
    getHealthReport(),
    listRecentErrors(10),
    listRecentJobs(20),
  ])

  const counts = await jobQueue.getJobCounts(
    'waiting',
    'active',
    'failed',
    'completed',
    'delayed',
    'paused',
    'prioritized',
    'waiting-children',
  )

  const completedJobs = await jobQueue.getJobs(['completed'], 0, 500, true)
  const cutoff = Date.now() - 24 * 60 * 60_000
  const completedLast24h = completedJobs.filter((job) => (job.finishedOn ?? 0) >= cutoff).length

  return {
    checkedAt: Date.now(),
    queue: {
      queued: (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0) + (counts['waiting-children'] ?? 0) + (counts.paused ?? 0),
      running: counts.active ?? 0,
      failed: counts.failed ?? 0,
      completedLast24h,
    },
    recentErrors,
    recentJobs,
    health,
  }
}

export async function listRecentJobs(limit = 20): Promise<BackgroundJobRecord[]> {
  const max = Math.max(1, Math.min(limit, 500))
  const jobs = await jobQueue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed', 'prioritized', 'waiting-children'], 0, max - 1, true)
  const deduped = new Map<string, (typeof jobs)[number]>()
  for (const job of jobs) {
    deduped.set(String(job.id), job)
  }

  return Array.from(deduped.values())
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, max)
    .map((job) => {
      const state = (job as { finishedOn?: number | null; failedReason?: string | null; processedOn?: number | null; delay?: number }).finishedOn
        ? ((job as { failedReason?: string | null }).failedReason ? 'failed' : 'completed')
        : (job as { processedOn?: number | null }).processedOn
          ? 'running'
          : 'queued'

      const attemptsMade = (job.attemptsMade ?? 0)
      const maxAttempts = Number(job.opts.attempts ?? 1)
      const runAfter = Number(job.timestamp ?? Date.now()) + Number((job as { delay?: number }).delay ?? 0)

      return {
        id: String(job.id),
        type: job.name as BackgroundJobType,
        status: state as BackgroundJobStatus,
        attempts: attemptsMade,
        maxAttempts,
        payload: safeJson(job.data),
        result: job.returnvalue === undefined ? null : safeJson(job.returnvalue),
        errorMessage: (job as { failedReason?: string | null }).failedReason ?? null,
        runAfter,
        lockedAt: (job as { processedOn?: number | null }).processedOn ?? null,
        completedAt: (job as { finishedOn?: number | null }).finishedOn ?? null,
        createdAt: Number(job.timestamp ?? Date.now()),
        updatedAt: Number((job as { finishedOn?: number | null }).finishedOn ?? (job as { processedOn?: number | null }).processedOn ?? job.timestamp ?? Date.now()),
      }
    })
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const job = await jobQueue.getJob(jobId)
  if (!job) return false
  await job.remove()
  return true
}

export async function retryJob(jobId: string): Promise<boolean> {
  const job = await jobQueue.getJob(jobId)
  if (!job) return false
  const state = await job.getState()
  if (state !== 'failed') return false
  await job.retry()
  return true
}

export async function cancelAllQueuedJobs(): Promise<number> {
  const queuedJobs = await jobQueue.getJobs(['waiting', 'delayed', 'prioritized', 'waiting-children', 'paused'], 0, 10_000, true)
  let cancelledCount = 0
  for (const job of queuedJobs) {
    await job.remove()
    cancelledCount += 1
  }
  return cancelledCount
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function executeJob(type: BackgroundJobType, payload: any): Promise<unknown> {
  switch (type) {
    case 'save-file':
      return await executeSaveFileJob(payload as SaveFilePayload)
    case 'generate-pdf-snapshot':
      return await executePdfSnapshotJob(payload as PdfSnapshotPayload)
    case 'compile-project':
      queuedCompileExecutions += 1
      return await compileWorkerPool(async () => {
        queuedCompileExecutions = Math.max(0, queuedCompileExecutions - 1)
        runningCompileExecutions += 1
        try {
          return await executeCompileJob(payload as CompilePayload)
        } finally {
          runningCompileExecutions = Math.max(0, runningCompileExecutions - 1)
        }
      })
    case 'export-document':
      return await executeExportJob(payload as ExportPayload)
    case 'invite-sync':
      return await executeInviteSyncJob(payload as InviteSyncPayload)
    case 'drive-permission-sync':
      return await executeDrivePermissionSyncJob(payload as DrivePermissionSyncPayload)
  }
}

async function executeSaveFileJob(payload: SaveFilePayload): Promise<{ saved: true }> {
  const file = await getProjectFileForUser(payload.fileId, payload.userId)
  if (!file || file.projectId !== payload.projectId) {
    throw new Error('File not found')
  }

  const hash = createHash('sha256').update(payload.source).digest('hex')
  const { rows } = await pool.query<{ last_content_hash: string | null }>(
    'SELECT last_content_hash FROM project_files WHERE id = $1',
    [file.id]
  )

  const snapshotLabel = payload.label?.trim()
  if (rows[0]?.last_content_hash === hash && !snapshotLabel) {
    return { saved: true }
  }

  if (rows[0]?.last_content_hash !== hash) {
    await assertCanStoreFileBytes(payload.userId, file.projectId, file.id, Buffer.byteLength(payload.source, 'utf8'))
    await writeTextFileToDrive(file.ownerUserId, file.driveFileId, payload.source)
    const collaborationDocument = new Y.Doc()
    collaborationDocument.getText('content').insert(0, payload.source)
    await updateProjectFileCollaborationState(file.id, Y.encodeStateAsUpdate(collaborationDocument))
    await touchProjectFile(file.id)

    await pool.query(
      'UPDATE project_files SET last_content_hash = $1, size_bytes = $2 WHERE id = $3',
      [hash, Buffer.byteLength(payload.source, 'utf8'), file.id]
    )
  }

  await createProjectRevisionSnapshot({
    projectId: file.projectId,
    fileId: file.id,
    filePath: file.path,
    source: payload.source,
    reason: 'manual-save',
    actorUserId: payload.userId,
    label: snapshotLabel || `Manual save ${new Date().toLocaleString()}`,
  })
  await logProjectActivity({
    projectId: file.projectId,
    actorUserId: payload.userId,
    type: 'file.save',
    summary: `Saved ${file.path} to Drive.`,
    metadata: { fileId: file.id },
  })

  return { saved: true }
}

async function executePdfSnapshotJob(payload: PdfSnapshotPayload): Promise<{ pdfFileName: string | null }> {
  const file = await getProjectFileForUser(payload.fileId, payload.userId)
  if (!file || file.projectId !== payload.projectId) {
    throw new Error('File not found')
  }

  const project = await getProjectById(file.projectId)
  if (!project) {
    return { pdfFileName: null }
  }

  const entryFile = project.mainFileId
    ? await getProjectFileForUser(project.mainFileId, payload.userId)
    : file

  const workspace = await loadProjectWorkspace({
    projectId: file.projectId,
    ownerUserId: file.ownerUserId,
    entryFileId: entryFile?.id ?? file.id,
    entryPath: entryFile?.path ?? file.path,
    sourceOverride: entryFile?.id === file.id
      ? {
          fileId: file.id,
          content: payload.source,
        }
      : undefined,
    additionalOverrides: entryFile?.id === file.id
      ? undefined
      : [{ fileId: file.id, content: payload.source }],
  })

  const pdfResult = await compileTypstProjectPdf(workspace)
  const pdfFileName = `${(entryFile?.name ?? file.name).replace(/\.[^.]+$/, '')}.pdf`
  await upsertBinaryFileInDrive({
    userId: file.ownerUserId,
    parentId: project.driveFolderId,
    name: pdfFileName,
    mimeType: pdfResult.mimeType,
    content: pdfResult.buffer,
  })

  return { pdfFileName }
}

async function executeCompileJob(payload: CompilePayload): Promise<CompileJobResult> {
  const compileSession = beginCompileSession(payload)
  try {
    return await executeCompileJobWithSignal(payload, compileSession.signal)
  } finally {
    compileSession.finish()
  }
}

async function executeCompileJobWithSignal(payload: CompilePayload, compileSignal: AbortSignal | undefined): Promise<CompileJobResult> {
  if (payload.documentFormat === 'latex') {
    if (payload.format !== 'pdf') {
      throw new Error('LaTeX compile endpoint currently supports PDF output only.')
    }

    if (!payload.projectId || !payload.fileId) {
      const entryPath = 'main.tex'
      const { pdf, engine, log, syncTex, syncTexRaw } = await compileLatexProjectToPdf({
        entryPath,
        files: [{ path: entryPath, content: payload.source }],
        engine: payload.latexEngine,
      }, { signal: compileSignal, timeoutMs: payload.compileTimeoutMs })
      const syncTexToken = syncTexRaw
        ? createSyncTexSession({ userId: payload.userId, entryPath, pdfBuffer: pdf, syncTexBuffer: syncTexRaw })
        : undefined
      return {
        format: 'pdf',
        pdfBase64: pdf.toString('base64'),
        diagnostics: diagnosticsFromCompileLog(log, entryPath),
        notice: `Compiled on server with ${engine}.`,
        log,
        syncTex,
        syncTexToken,
        syncTexEntryPath: syncTexToken ? entryPath : undefined,
      }
    }

    const activeFile = await getProjectFileForUser(payload.fileId, payload.userId)
    if (!activeFile || activeFile.projectId !== payload.projectId) {
      throw new Error('File not found')
    }

    const project = await getProjectById(payload.projectId)
    const configuredEntryFile = project?.mainFileId
      ? await getProjectFileForUser(project.mainFileId, payload.userId)
      : null
    const entryFile = configuredEntryFile && configuredEntryFile.projectId === payload.projectId
      ? configuredEntryFile
      : activeFile
    const overrideMap = new Map<string, string>()

    if (payload.fileId === entryFile.id) {
      overrideMap.set(entryFile.id, payload.source)
    } else {
      overrideMap.set(activeFile.id, payload.source)
    }

    if (payload.activeFileId && payload.activeSource !== undefined) {
      const subFile = await getProjectFileForUser(payload.activeFileId, payload.userId)
      if (subFile && subFile.projectId === payload.projectId) {
        overrideMap.set(subFile.id, payload.activeSource)
      }
    }

    const workspace = await loadProjectWorkspace({
      projectId: activeFile.projectId,
      ownerUserId: activeFile.ownerUserId,
      entryFileId: entryFile.id,
      entryPath: entryFile.path,
      sourceOverride: overrideMap.has(entryFile.id)
        ? { fileId: entryFile.id, content: overrideMap.get(entryFile.id)! }
        : undefined,
      additionalOverrides: [...overrideMap.entries()]
        .filter(([fileId]) => fileId !== entryFile.id)
        .map(([fileId, content]) => ({ fileId, content })),
    })

    const { pdf, engine, log, syncTex, syncTexRaw } = await compileLatexProjectToPdf({
      entryPath: workspace.entryPath,
      files: workspace.files,
      engine: payload.latexEngine,
    }, { signal: compileSignal, timeoutMs: payload.compileTimeoutMs })

    await logProjectActivity({
      projectId: activeFile.projectId,
      actorUserId: payload.userId,
      type: 'compile.run',
      summary: `Rendered ${entryFile.path} as PDF.`,
      metadata: { fileId: activeFile.id, entryFileId: entryFile.id, format: payload.format, documentFormat: 'latex', engine },
    })

    const syncTexToken = syncTexRaw
      ? createSyncTexSession({ userId: payload.userId, entryPath: workspace.entryPath, pdfBuffer: pdf, syncTexBuffer: syncTexRaw })
      : undefined

    return {
      format: 'pdf',
      pdfBase64: pdf.toString('base64'),
      diagnostics: diagnosticsFromCompileLog(log, workspace.entryPath),
      notice: `Compiled on server with ${engine}.`,
      log,
      syncTex,
      syncTexToken,
      syncTexEntryPath: syncTexToken ? workspace.entryPath : undefined,
    }
  }

  if (!payload.projectId || !payload.fileId) {
    if (payload.format === 'pdf') {
      const pdfBuffer = await compileTypstProjectToPdf({ entryPath: 'input.typ', files: [{ path: 'input.typ', content: payload.source }] }, { previewSessionId: payload.previewSessionId, signal: compileSignal, timeoutMs: payload.compileTimeoutMs })
      return { format: 'pdf', pdfBase64: pdfBuffer.toString('base64'), diagnostics: [] }
    }

    const result = await compileTypstProjectToSvg({ entryPath: 'input.typ', files: [{ path: 'input.typ', content: payload.source }] }, { signal: compileSignal, timeoutMs: payload.compileTimeoutMs })
    const windowedResult = buildSvgWindow(result.pages, payload.svgPageIndex, payload.svgWindowSize)
    return { format: 'svg', ...windowedResult, diagnostics: result.diagnostics }
  }

  const activeFile = await getProjectFileForUser(payload.fileId, payload.userId)
  if (!activeFile || activeFile.projectId !== payload.projectId) {
    throw new Error('File not found')
  }

  const project = await getProjectById(payload.projectId)
  const configuredEntryFile = project?.mainFileId
    ? await getProjectFileForUser(project.mainFileId, payload.userId)
    : null
  const entryFile = configuredEntryFile && configuredEntryFile.projectId === payload.projectId
    ? configuredEntryFile
    : activeFile
  const overrideMap = new Map<string, string>()

  if (payload.fileId === entryFile.id) {
    overrideMap.set(entryFile.id, payload.source)
  } else {
    overrideMap.set(activeFile.id, payload.source)
  }

  if (payload.activeFileId && payload.activeSource !== undefined) {
    const subFile = await getProjectFileForUser(payload.activeFileId, payload.userId)
    if (subFile && subFile.projectId === payload.projectId) {
      overrideMap.set(subFile.id, payload.activeSource)
    }
  }

  const workspace = await loadProjectWorkspace({
    projectId: activeFile.projectId,
    ownerUserId: activeFile.ownerUserId,
    entryFileId: entryFile.id,
    entryPath: entryFile.path,
    sourceOverride: overrideMap.has(entryFile.id)
      ? { fileId: entryFile.id, content: overrideMap.get(entryFile.id)! }
      : undefined,
    additionalOverrides: [...overrideMap.entries()]
      .filter(([fileId]) => fileId !== entryFile.id)
      .map(([fileId, content]) => ({ fileId, content })),
  })
  const settings = await getProjectEcosystemSettings(payload.projectId)
  const validationDiagnostics = ecosystemIssuesToCompileDiagnostics(validateProjectWorkspace({ files: workspace.files, settings }))
  const previewSessionId = payload.previewSessionId ?? `${payload.projectId}:${entryFile.id}`
  await logProjectActivity({
    projectId: activeFile.projectId,
    actorUserId: payload.userId,
    type: 'compile.run',
    summary: `Rendered ${entryFile.path} as ${payload.format.toUpperCase()}.`,
    metadata: { fileId: activeFile.id, entryFileId: entryFile.id, format: payload.format },
  })

  if (payload.format === 'pdf') {
    const pdfBuffer = await compileTypstProjectToPdf(workspace, { previewSessionId, projectId: payload.projectId, signal: compileSignal, timeoutMs: payload.compileTimeoutMs })
    return { format: 'pdf', pdfBase64: pdfBuffer.toString('base64'), diagnostics: validationDiagnostics }
  }

  const result = await compileTypstProjectToSvg(workspace, { previewSessionId, projectId: payload.projectId, signal: compileSignal, timeoutMs: payload.compileTimeoutMs })
  const windowedResult = buildSvgWindow(result.pages, payload.svgPageIndex, payload.svgWindowSize)
  return { format: 'svg', ...windowedResult, diagnostics: [...result.diagnostics, ...validationDiagnostics] }
}


async function executeExportJob(payload: ExportPayload): Promise<{ saved: true; name: string; driveFileId: string } | { mimeType: string; extension: string; base64: string }> {
  let exportResult: Awaited<ReturnType<typeof convertWithPandoc>>
  let activityProjectId: string | null = payload.projectId ?? null
  const documentFormat: 'typst' | 'latex' = payload.documentFormat ?? 'typst'

  if (payload.format === 'pdf') {
    if (documentFormat === 'latex') {
      if (payload.projectId && payload.fileId) {
        const activeFile = await getProjectFileForUser(payload.fileId, payload.userId)
        if (!activeFile || activeFile.projectId !== payload.projectId) {
          throw new Error('File not found')
        }

        const project = await getProjectById(payload.projectId)
        const configuredEntryFile = project?.mainFileId
          ? await getProjectFileForUser(project.mainFileId, payload.userId)
          : null
        const entryFile = configuredEntryFile && configuredEntryFile.projectId === payload.projectId
          ? configuredEntryFile
          : activeFile
        const overrideMap = new Map<string, string>()
        overrideMap.set(activeFile.id, payload.source)

        const workspace = await loadProjectWorkspace({
          projectId: activeFile.projectId,
          ownerUserId: activeFile.ownerUserId,
          entryFileId: entryFile.id,
          entryPath: entryFile.path,
          sourceOverride: overrideMap.has(entryFile.id)
            ? { fileId: entryFile.id, content: overrideMap.get(entryFile.id)! }
            : undefined,
          additionalOverrides: [...overrideMap.entries()]
            .filter(([fileId]) => fileId !== entryFile.id)
            .map(([fileId, content]) => ({ fileId, content })),
        })

        const { pdf } = await compileLatexProjectToPdf({
          entryPath: workspace.entryPath,
          files: workspace.files,
        })

        exportResult = {
          buffer: pdf,
          mimeType: 'application/pdf',
          extension: 'pdf',
        }
      } else {
        const { pdf } = await compileLatexProjectToPdf({
          entryPath: 'main.tex',
          files: [{ path: 'main.tex', content: payload.source }],
        })

        exportResult = {
          buffer: pdf,
          mimeType: 'application/pdf',
          extension: 'pdf',
        }
      }
    } else if (payload.projectId && payload.fileId) {
      const activeFile = await getProjectFileForUser(payload.fileId, payload.userId)
      if (!activeFile || activeFile.projectId !== payload.projectId) {
        throw new Error('File not found')
      }

      const entryFile = activeFile
      const workspace = await loadProjectWorkspace({
        projectId: activeFile.projectId,
        ownerUserId: activeFile.ownerUserId,
        entryFileId: entryFile.id,
        entryPath: entryFile.path,
        sourceOverride: { fileId: activeFile.id, content: payload.source },
      })
      exportResult = await compileTypstProjectPdf(workspace)
    } else {
      exportResult = await convertWithPandoc(payload.source, payload.format, documentFormat)
    }
  } else {
    exportResult = await convertWithPandoc(payload.source, payload.format, documentFormat)
  }

  if (payload.saveToDrive) {
    if (!payload.projectId || !payload.fileId) {
      throw new Error('projectId and fileId are required to save an export to Google Drive')
    }

    const file = await getProjectFileForUser(payload.fileId, payload.userId)
    if (!file || file.projectId !== payload.projectId) {
      throw new Error('File not found')
    }

    const project = await getProjectById(file.projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    const outputName = `${file.name.replace(/\.[^.]+$/, '')}.${exportResult.extension}`
    const driveFileId = await upsertBinaryFileInDrive({
      userId: file.ownerUserId,
      parentId: project.driveFolderId,
      name: outputName,
      mimeType: exportResult.mimeType,
      content: exportResult.buffer,
    })

    await logProjectActivity({
      projectId: project.id,
      actorUserId: payload.userId,
      type: 'export.save',
      summary: `Exported ${file.path} as ${payload.format.toUpperCase()} to Drive.`,
      metadata: { fileId: file.id, format: payload.format, driveFileId },
    })

    return { saved: true, name: outputName, driveFileId }
  }

  if (activityProjectId) {
    await logProjectActivity({
      projectId: activityProjectId,
      actorUserId: payload.userId,
      type: 'export.download',
      summary: `Generated a ${payload.format.toUpperCase()} export.`,
      metadata: { format: payload.format },
    })
  }

  return { mimeType: exportResult.mimeType, extension: exportResult.extension, base64: exportResult.buffer.toString('base64') }
}

async function executeInviteSyncJob(payload: InviteSyncPayload): Promise<{ synced: true }> {
  await logProjectActivity({
    projectId: payload.projectId,
    actorUserId: payload.actorUserId,
    type: 'share.invite',
    summary: payload.summary,
    metadata: payload.metadata,
  })

  const invitationId = payload.metadata?.invitationId as string | undefined
  if (invitationId) {
    try {
      const invitation = await getProjectInvitationById(invitationId)
      if (invitation && invitation.status === 'pending') {
        await sendInvitationEmail({
          toEmail: invitation.email,
          invitedByName: invitation.invitedByName,
          projectTitle: invitation.projectTitle,
          role: invitation.role,
          invitationId: invitation.id,
        })
      }
    } catch (err) {
      console.error('[invite-sync] email send failed (non-fatal):', err)
    }
  }

  return { synced: true }
}

async function executeDrivePermissionSyncJob(payload: DrivePermissionSyncPayload): Promise<{ synced: true }> {
  if (payload.action === 'grant' && payload.role) {
    await ensureDriveItemPermission({
      ownerUserId: payload.ownerUserId,
      fileId: payload.fileId,
      email: payload.email,
      role: payload.role,
    })
    await logProjectActivity({
      projectId: payload.projectId,
      actorUserId: payload.actorUserId,
      type: 'share.permission-granted',
      summary: `Granted ${payload.role} access to ${payload.email}.`,
      metadata: { email: payload.email, role: payload.role },
    })
  } else {
    await deleteDriveItemPermissionByEmail({
      ownerUserId: payload.ownerUserId,
      fileId: payload.fileId,
      email: payload.email,
    })
    await logProjectActivity({
      projectId: payload.projectId,
      actorUserId: payload.actorUserId,
      type: 'share.permission-revoked',
      summary: `Revoked access for ${payload.email}.`,
      metadata: { email: payload.email },
    })
  }

  return { synced: true }
}

async function runHealthCheck(name: string, callback: () => Promise<string>): Promise<HealthCheckItem> {
  const checkedAt = Date.now()
  try {
    const detail = await callback()
    return { name, status: 'ok', detail, checkedAt }
  } catch (error) {
    return {
      name,
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
    }
  }
}

// ─── Retention policies ───────────────────────────────────────────────────────

export interface RetentionReport {
  revisionsDeleted: number
  activityEventsDeleted: number
  completedJobsDeleted: number
  errorEventsDeleted: number
  trashedFilesDeleted: number
  ranAt: number
}

export async function runRetentionPolicies(): Promise<RetentionReport> {
  const ranAt = Date.now()

  const revisionsCutoff = ranAt - env.retentionRevisionsDays * 86_400_000
  const activityCutoff = ranAt - env.retentionActivityDays * 86_400_000
  const errorsCutoff = ranAt - env.retentionErrorsDays * 86_400_000
  const trashCutoff = ranAt - env.retentionTrashDays * 86_400_000

  const [revisions, activity, errors, trash] = await Promise.all([
    pool.query<{ count: string }>(`
      WITH keep AS (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY created_at DESC) AS rn
          FROM project_revisions
        ) ranked WHERE rn <= 5
      )
      DELETE FROM project_revisions
      WHERE created_at < $1 AND id NOT IN (SELECT id FROM keep)
      RETURNING id
    `, [revisionsCutoff]),
    pool.query<{ count: string }>(`
      DELETE FROM project_activity_events WHERE created_at < $1 RETURNING id
    `, [activityCutoff]),
    pool.query<{ count: string }>(`
      DELETE FROM error_events WHERE created_at < $1 RETURNING id
    `, [errorsCutoff]),
    pool.query<{ count: string }>(`
      DELETE FROM project_file_workflow
      WHERE trashed_at IS NOT NULL AND trashed_at < $1 RETURNING file_id
    `, [trashCutoff]),
  ])

  return {
    revisionsDeleted: revisions.rowCount ?? 0,
    activityEventsDeleted: activity.rowCount ?? 0,
    completedJobsDeleted: 0,
    errorEventsDeleted: errors.rowCount ?? 0,
    trashedFilesDeleted: trash.rowCount ?? 0,
    ranAt,
  }
}

/** Schedule a recurring retention job to run at startup and every 24h */
export function scheduleRetentionJob(): void {
  const RUN_INTERVAL_MS = 24 * 60 * 60_000 // 24h

  async function run() {
    try {
      const report = await runRetentionPolicies()
      console.info('[retention] completed', report)
    } catch (error) {
      console.error('[retention] failed', error)
    }
    setTimeout(() => void run(), RUN_INTERVAL_MS)
  }

  // Delay first run by 5 minutes after startup so the server is fully ready
  setTimeout(() => void run(), 5 * 60_000)
}

// ─── Database backup ──────────────────────────────────────────────────────────

export interface BackupReport {
  filePath: string
  fileSizeBytes: number
  durationMs: number
  ranAt: number
}

/**
 * Runs pg_dump against the configured DATABASE_URL and writes a custom-format
 * dump to BACKUP_DIR. Keeps the most recent BACKUP_KEEP_COUNT files and
 * deletes older ones.
 */
export async function runDatabaseBackup(): Promise<BackupReport> {
  const ranAt = Date.now()
  const backupDir = env.backupDir
  if (!backupDir) {
    throw new Error('BACKUP_DIR is not configured')
  }

  await mkdir(backupDir, { recursive: true })

  const timestamp = new Date(ranAt).toISOString().replace(/[:.]/g, '-')
  const fileName = `typstr-${timestamp}.dump`
  const filePath = join(backupDir, fileName)

  // pg_dump accepts a full connection URI via --dbname
  await execFileAsync('pg_dump', [
    `--dbname=${env.databaseUrl}`,
    '--format=custom',
    '--compress=9',
    `--file=${filePath}`,
  ])

  const { size: fileSizeBytes } = await stat(filePath)

  // Rotate: keep only the most recent N backups
  const files = await readdir(backupDir)
  const dumps = files
    .filter((f) => f.startsWith('typstr-') && f.endsWith('.dump'))
    .sort() // ISO timestamps sort lexicographically = chronologically
  const toDelete = dumps.slice(0, Math.max(0, dumps.length - env.backupKeepCount))
  await Promise.all(toDelete.map((f) => rm(join(backupDir, f))))

  return { filePath, fileSizeBytes, durationMs: Date.now() - ranAt, ranAt }
}

/** Schedule a daily database backup, starting 10 minutes after startup. */
export function scheduleDatabaseBackup(): void {
  if (!env.backupDir) {
    return // backup not configured; skip silently
  }

  const RUN_INTERVAL_MS = 24 * 60 * 60_000 // 24h

  async function run() {
    try {
      const report = await runDatabaseBackup()
      console.info('[backup] completed', {
        filePath: report.filePath,
        fileSizeBytes: report.fileSizeBytes,
        durationMs: report.durationMs,
      })
    } catch (error) {
      console.error('[backup] failed', error)
    }
    setTimeout(() => void run(), RUN_INTERVAL_MS)
  }

  // Run 10 minutes after startup (after the retention job's 5-minute delay)
  setTimeout(() => void run(), 10 * 60_000)
}
