// Failed sign-in tracking for password logins. The per-request rate limit
// only slows one client down; this stops guessing one account's password
// from many addresses, and one address from cycling through accounts.

const WINDOW_MS = 15 * 60_000
const MAX_FAILURES_PER_ACCOUNT = 10
const MAX_FAILURES_PER_ADDRESS = 20
const SWEEP_INTERVAL_MS = 60_000

const failures = new Map<string, { count: number; windowStart: number }>()

function keysFor(username: string, address: string | undefined): Array<{ key: string; max: number }> {
  return [
    { key: `account:${username.trim().toLowerCase()}`, max: MAX_FAILURES_PER_ACCOUNT },
    { key: `address:${address ?? 'unknown'}`, max: MAX_FAILURES_PER_ADDRESS },
  ]
}

/** Seconds until another attempt is allowed, or 0 when not throttled. */
export function loginRetryAfterSeconds(username: string, address: string | undefined, now = Date.now()): number {
  let wait = 0
  for (const { key, max } of keysFor(username, address)) {
    const entry = failures.get(key)
    if (entry && now - entry.windowStart < WINDOW_MS && entry.count >= max) {
      wait = Math.max(wait, Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000))
    }
  }
  return wait
}

export function recordLoginFailure(username: string, address: string | undefined, now = Date.now()): void {
  for (const { key } of keysFor(username, address)) {
    const entry = failures.get(key)
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      failures.set(key, { count: 1, windowStart: now })
    } else {
      entry.count += 1
    }
  }
}

export function clearLoginFailures(username: string): void {
  failures.delete(`account:${username.trim().toLowerCase()}`)
}

export function sweepLoginFailures(now = Date.now()): void {
  for (const [key, entry] of failures) {
    if (now - entry.windowStart >= WINDOW_MS) failures.delete(key)
  }
}

setInterval(() => sweepLoginFailures(), SWEEP_INTERVAL_MS).unref()
