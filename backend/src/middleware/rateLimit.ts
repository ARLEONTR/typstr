import type { Request, Response, NextFunction } from 'express'

const buckets = new Map<string, { count: number; windowStart: number }>()

export function createRateLimitMiddleware(input: {
  id: string
  windowMs: number
  max: number
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = typeof (req.user as { id?: unknown } | undefined)?.id === 'string'
      ? (req.user as { id: string }).id
      : null
    const subject = userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`
    const key = `${input.id}:${subject}:${req.method}`
    const now = Date.now()
    const current = buckets.get(key)

    if (!current || now - current.windowStart >= input.windowMs) {
      buckets.set(key, { count: 1, windowStart: now })
      next()
      return
    }

    if (current.count >= input.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((input.windowMs - (now - current.windowStart)) / 1000))
      res.setHeader('Retry-After', retryAfterSeconds)
      res.status(429).json({ error: 'Too many requests. Please retry shortly.' })
      return
    }

    current.count += 1
    next()
  }
}
