import type { AuthenticatedUser } from './types.js'
import { env } from './env.js'

const productionAdminEmails = new Set(env.adminEmails)

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  if (!env.isProduction) return true
  return productionAdminEmails.has(email.trim().toLowerCase())
}

export function isAdminUser(user: Pick<AuthenticatedUser, 'email'> | null | undefined): boolean {
  return isAdminEmail(user?.email)
}
