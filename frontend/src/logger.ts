export const LOG_LEVELS = ['debug', 'verbose', 'info', 'warning', 'error', 'fatal'] as const

export type LogLevel = typeof LOG_LEVELS[number]

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  verbose: 20,
  info: 30,
  warning: 40,
  error: 50,
  fatal: 60,
}

function normalizeLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'debug':
    case 'verbose':
    case 'info':
    case 'warning':
    case 'warn':
    case 'error':
    case 'errors':
    case 'fatal':
      return normalized === 'warn' ? 'warning' : normalized === 'errors' ? 'error' : normalized
    default:
      return 'error'
  }
}

const activeLevel = normalizeLogLevel(import.meta.env.VITE_LOG_LEVEL)

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[activeLevel]
}

function write(level: LogLevel, ...args: unknown[]): void {
  if (!shouldLog(level)) {
    return
  }

  switch (level) {
    case 'debug':
    case 'verbose':
      console.debug(...args)
      break
    case 'info':
      console.info(...args)
      break
    case 'warning':
      console.warn(...args)
      break
    case 'error':
    case 'fatal':
      console.error(...args)
      break
  }
}

export const logger = {
  level: activeLevel,
  debug: (...args: unknown[]) => write('debug', ...args),
  verbose: (...args: unknown[]) => write('verbose', ...args),
  info: (...args: unknown[]) => write('info', ...args),
  warning: (...args: unknown[]) => write('warning', ...args),
  error: (...args: unknown[]) => write('error', ...args),
  fatal: (...args: unknown[]) => write('fatal', ...args),
}