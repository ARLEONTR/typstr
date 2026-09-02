import type { NextFunction, Request, Response } from 'express'

export function createConcurrencyLimitMiddleware(input: {
  id: string
  max: number
  retryAfterSeconds?: number
}) {
  let active = 0
  const max = Math.max(1, input.max)
  const retryAfterSeconds = input.retryAfterSeconds ?? 3

  return (_req: Request, res: Response, next: NextFunction) => {
    if (active >= max) {
      res.setHeader('Retry-After', retryAfterSeconds)
      res.status(503).json({
        error: `${input.id} is busy. Please retry shortly.`,
        code: 'SERVER_BUSY',
      })
      return
    }

    active += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      active = Math.max(0, active - 1)
    }

    res.once('finish', release)
    res.once('close', release)
    next()
  }
}
