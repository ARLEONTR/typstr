import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { initializeAuth, requireAuth } from './auth.js'
import { env } from './env.js'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'
import { invitationsRouter } from './routes/invitations.js'
import { notificationsRouter } from './routes/notifications.js'
import { projectsRouter } from './routes/projects.js'
import { compileRouter } from './routes/compile.js'
import { syncTexRouter } from './routes/synctex.js'
import { exportRouter } from './routes/export.js'
import { opsRouter } from './routes/ops.js'
import { shareRouter } from './routes/share.js'
import { teamsRouter } from './routes/teams.js'
import { aiRouter } from './routes/ai.js'
import { accountRouter } from './routes/account.js'
import { billingRouter } from './routes/billing.js'
import { reviewRouter } from './routes/review.js'
import userRouter from './routes/user.js'
import feedbackRouter from './routes/feedback.js'
import permissionsRouter from './routes/permissions.js'
import { createRateLimitMiddleware } from './middleware/rateLimit.js'
import { csrfProtection } from './middleware/csrf.js'
import { createConcurrencyLimitMiddleware } from './middleware/concurrencyLimit.js'

export async function createApp() {
  const app = express()
  const authRateLimit = createRateLimitMiddleware({ id: 'auth', windowMs: 60_000, max: env.rateLimitAuthMax })
  const inviteRateLimit = createRateLimitMiddleware({ id: 'invite', windowMs: 60_000, max: env.rateLimitInviteMax })
  const compileRateLimit = createRateLimitMiddleware({ id: 'compile', windowMs: 60_000, max: env.rateLimitCompileMax })
  const exportRateLimit = createRateLimitMiddleware({ id: 'export', windowMs: 60_000, max: env.rateLimitExportMax })
  const uploadRateLimit = createRateLimitMiddleware({ id: 'upload', windowMs: 60_000, max: env.rateLimitUploadMax })
  const compileConcurrencyLimit = createConcurrencyLimitMiddleware({ id: 'Compile service', max: env.compileHttpConcurrencyMax })
  const exportConcurrencyLimit = createConcurrencyLimitMiddleware({ id: 'Export service', max: env.exportHttpConcurrencyMax })

  app.use(helmet({
  contentSecurityPolicy: false,
}))
  app.use(cors({ origin: env.frontendOrigin, credentials: true }))
  app.use(morgan('dev'))
  app.use(express.json({ limit: `${env.requestBodyLimitMb}mb` }))
  app.use(express.urlencoded({ extended: true, limit: `${env.requestBodyLimitMb}mb` }))
  // Parser for Google RISC Security Event Tokens
  app.use(express.text({ type: 'application/secevent+jwt', limit: '1mb' }))
  await initializeAuth(app)

  // CSRF protection for all state-mutating routes
  app.use('/api', csrfProtection)

  app.use('/api', opsRouter)
  app.use('/api/auth', authRateLimit, authRouter)
  app.use('/api/review', reviewRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/invitations', requireAuth, inviteRateLimit, invitationsRouter)
  app.use('/api/notifications', requireAuth, notificationsRouter)
  app.use('/api/projects', requireAuth, (req, res, next) => {
    if (req.method === 'POST' && /\/uploads(?:\/|$)/.test(req.path)) {
      return uploadRateLimit(req, res, next)
    }

    if (req.method === 'POST' && /\/shares(?:\/|$)/.test(req.path)) {
      return inviteRateLimit(req, res, next)
    }

    next()
  }, projectsRouter)
  app.use('/api/compile', requireAuth, compileRateLimit, compileConcurrencyLimit, compileRouter)
  app.use('/api/synctex', requireAuth, syncTexRouter)
  app.use('/api/export', requireAuth, exportRateLimit, exportConcurrencyLimit, exportRouter)
  app.use('/api/share', requireAuth, shareRouter)
  app.use('/api/teams', requireAuth, teamsRouter)
  app.use('/api/account', requireAuth, accountRouter)
  app.use('/api/billing', (req, res, next) => {
    if (req.method === 'POST' && req.path === '/callback') return next()
    return requireAuth(req, res, next)
  }, billingRouter)
  app.use('/api/ai', requireAuth, aiRouter)
  app.use('/api/user', requireAuth, userRouter)
  app.use('/api/permissions', requireAuth, permissionsRouter)
  app.use('/api/feedback', requireAuth, feedbackRouter)

  app.use(async (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Global Error Handler]', err); const message = err instanceof Error ? err.message : 'Unexpected server error'
    const typedError = err as { status?: number; code?: string; limitKey?: string; statusPayload?: unknown }
    const status = typedError.status ?? (/auth|forbidden|denied/i.test(message) ? 401 : 500)
    try {
      const reliability = await import('./services/reliability.js')
      await reliability.recordErrorEvent({
        scope: 'express',
        message,
        code: typedError.code ?? null,
        details: err instanceof Error ? err.stack ?? null : JSON.stringify(err),
      })
    } catch {
      // ignore telemetry failures in the error path
    }
    res.status(status).json({
      error: message,
      code: typedError.code ?? null,
      limitKey: typedError.limitKey,
      billing: typedError.statusPayload,
    })
  })

  return app
}
