import type { AuthenticatedUser } from './types.js'

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
    interface Request {
      /** Set when the request was authenticated with a personal access token. */
      apiToken?: { id: string; scope: 'read' | 'write'; raw: string }
    }
  }
}

export {}