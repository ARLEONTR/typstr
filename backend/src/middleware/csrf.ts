import type { NextFunction, Request, Response } from 'express'
import { env } from '../env.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Origin-based CSRF protection middleware.
 *
 * For state-mutating requests (POST/PUT/PATCH/DELETE) we validate that the
 * Origin (or Referer as a fallback) matches the expected frontend origin.
 * GET/HEAD/OPTIONS are always allowed so SSR/prefetch flows are unaffected.
 *
 * This is a defence-in-depth measure that complements `SameSite=Lax` cookies.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }

  // Skip CSRF for machine-to-machine callbacks/webhooks.
  if (
    req.path === '/auth/google/risc' ||
    req.path === '/api/auth/google/risc' ||
    req.path === '/billing/callback' ||
    req.path === '/api/billing/callback'
  ) {
    next()
    return
  }

  // Allow same-origin requests (Origin header matches backend)
  const origin = req.get('origin')
  if (origin) {
    const allowed = [env.frontendOrigin, env.backendOrigin]
    if (allowed.includes(origin)) {
      next()
      return
    }

    console.log('CSRF Blocked: Invalid Origin', { origin, allowed });
    res.status(403).json({ error: 'CSRF check failed: invalid Origin', code: 'CSRF_BLOCKED' })
    return
  }

  // Fallback: check Referer header for same-origin
  const referer = req.get('referer')
  if (referer) {
    const allowed = [env.frontendOrigin, env.backendOrigin]
    try {
      const refererOrigin = new URL(referer).origin
      if (allowed.includes(refererOrigin)) {
        next()
        return
      }
    } catch {}

    res.status(403).json({ error: 'CSRF check failed: invalid Referer', code: 'CSRF_BLOCKED' })
    return
  }

  // No Origin and no Referer — allow in development, block in production
  if (env.isProduction) {
    res.status(403).json({ error: 'CSRF check failed: missing Origin', code: 'CSRF_BLOCKED' })
    return
  }

  next()
}
