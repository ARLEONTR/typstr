import type { AuthenticatedUser } from './types.js'

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}

export {}