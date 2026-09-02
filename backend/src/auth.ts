import type { Express, NextFunction, Request, Response } from 'express'
import { RedisStore } from 'connect-redis'
import session, { type CookieOptions } from 'express-session'
import passport from 'passport'
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20'
import { createClient } from 'redis'
import { isAdminUser } from './adminAccess.js'
import { findUserById, sanitizeUser, upsertLocalDevUser, upsertUserFromGoogleProfile } from './db.js'
import { env, isGoogleAuthConfigured } from './env.js'
import { logger } from './logger.js'

export const SESSION_COOKIE_NAME = 'typstr-session'
type SessionRedisClient = ReturnType<typeof createClient>

let sessionRedisClientPromise: Promise<SessionRedisClient> | null = null

export async function initializeAuth(app: Express): Promise<void> {
  const sessionRedisClient = await getSessionRedisClient()

  // Trust all proxy hops in production to ensure X-Forwarded-Proto is respected for secure cookies
  app.set('trust proxy', env.isProduction ? true : env.trustProxyHops)

  app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: env.isProduction ? true : undefined,
    store: new RedisStore({
      client: sessionRedisClient,
      prefix: env.sessionRedisPrefix,
    }),
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: env.sessionCookieSameSite as CookieOptions['sameSite'],
      secure: env.cookieSecure,
      domain: env.sessionCookieDomain,
      maxAge: 1000 * 60 * 30,
    },
  }))

  app.use(passport.initialize())
  app.use(passport.session())

  passport.serializeUser((user, done) => {
    done(null, user.id)
  })

  passport.deserializeUser((id: string, done) => {
    void findUserById(id)
      .then((user) => {
        done(null, user ? sanitizeUser(user) : false)
      })
      .catch((error) => {
        done(error as Error)
      })
  })

  if (!isGoogleAuthConfigured()) return

  // Custom state store that flushes the session to Redis before signalling
  // completion. The built-in stores write state to req.session then immediately
  // call the callback, which causes passport to redirect before the session
  // middleware has asynchronously persisted the data. Under load (or with a
  // remote Redis), Google calls back before the nonce is in Redis, producing
  // "Unable to verify authorization request state." We fix this by saving
  // explicitly after the write and before the callback.
  const sessionKey = 'oauth2:accounts.google.com'

  const sessionStateStore = {
    // store() is called by passport-oauth2 when PKCE is OFF
    store(req: Request, _state: unknown, _meta: unknown, callback: (err: Error | null, handle?: string) => void): void {
      if (!req.session) return callback(new Error('Session support required'))
      const handle = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
      if (!(req.session as any)[sessionKey]) (req.session as any)[sessionKey] = {}
      ;(req.session as any)[sessionKey].state = handle
      req.session.save((err) => callback(err ?? null, handle))
    },
    verify(req: Request, providedState: string, callback: (err: Error | null, ok?: boolean, info?: unknown) => void): void {
      if (!req.session) return callback(new Error('Session support required'))
      const stored = (req.session as any)[sessionKey]?.state
      if (!stored) return callback(null, false, { message: 'Unable to verify authorization request state.' })
      delete (req.session as any)[sessionKey].state
      if (Object.keys((req.session as any)[sessionKey]).length === 0) delete (req.session as any)[sessionKey]
      if (stored !== providedState) return callback(null, false, { message: 'Invalid authorization request state.' })
      callback(null, true)
    },
  }

  const pkceStateStore = {
    // store() is called by passport-oauth2 when PKCE is ON (4-arg form)
    store(req: Request, verifier: string, _state: unknown, _meta: unknown, callback: (err: Error | null, handle?: string) => void): void {
      if (!req.session) return callback(new Error('Session support required'))
      const handle = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
      if (!(req.session as any)[sessionKey]) (req.session as any)[sessionKey] = {}
      ;(req.session as any)[sessionKey].state = { handle, code_verifier: verifier }
      logger.debug('[OAuth PKCE store] session id:', req.session.id, 'handle:', handle)
      req.session.save((err) => { logger.debug('[OAuth PKCE store] session saved, err:', err); callback(err ?? null, handle) })
    },
    verify(req: Request, providedState: string, callback: (err: Error | null, codeVerifier?: string | boolean, state?: unknown) => void): void {
      if (!req.session) return callback(new Error('Session support required'))
      logger.debug('[OAuth PKCE verify] session id:', req.session.id, 'session keys:', Object.keys(req.session), 'sessionKey present:', !!(req.session as any)[sessionKey])
      const stored = (req.session as any)[sessionKey]?.state
      if (!stored) return callback(null, false, { message: 'Unable to verify authorization request state.' } as unknown as boolean)
      delete (req.session as any)[sessionKey].state
      if (Object.keys((req.session as any)[sessionKey]).length === 0) delete (req.session as any)[sessionKey]
      if (stored.handle !== providedState) return callback(null, false, { message: 'Invalid authorization request state.' } as unknown as boolean)
      callback(null, stored.code_verifier, stored.state)
    },
  }

  passport.use(new GoogleStrategy(
    {
      clientID: env.googleClientId,
      clientSecret: env.googleClientSecret,
      callbackURL: env.googleCallbackUrl,
      pkce: env.isProduction,
      state: true,
      store: env.isProduction ? pkceStateStore : sessionStateStore,
    } as any,
    async (_accessToken: string, refreshToken: string, profile: Profile, done) => {
      try {
        const email = profile.emails?.[0]?.value
        if (!email) {
          return done(new Error('Google account did not provide an email address.'))
        }

        const user = await upsertUserFromGoogleProfile({
          googleId: profile.id,
          email,
          name: profile.displayName || email,
          avatarUrl: profile.photos?.[0]?.value ?? null,
          refreshToken: refreshToken || null,
        })

        done(null, user)
      } catch (error) {
        done(error as Error)
      }
    },
  ))
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (req.user.disabledAt) {
    res.status(403).json({ error: 'Account disabled' })
    return
  }

  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!isAdminUser(req.user)) {
    res.status(403).json({ error: 'Admin access required' })
    return
  }

  next()
}

export function getAuthenticatedUser(req: Request) {
  if (!req.user) {
    throw new Error('Missing authenticated user in request context')
  }

  return req.user
}

export function isAdminRequestAuthorized(req: Request): boolean {
  if (env.adminApiKey && req.header('x-admin-api-key') === env.adminApiKey) {
    return true
  }

  return isAdminUser(req.user)
}

export async function establishLocalDevSession(req: Request) {
  const user = await upsertLocalDevUser({
    email: env.localAuthBypassEmail,
    name: env.localAuthBypassName,
  })

  return await loginWithSessionRegenerate(req, user)
}

/** Regenerate session ID before logging in to prevent session fixation attacks */
export async function loginWithSessionRegenerate<T extends Express.User>(req: Request, user: T): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        reject(regenerateError)
        return
      }

      req.login(user, (loginError) => {
        if (loginError) {
          reject(loginError)
          return
        }

        resolve(user)
      })
    })
  })
}

async function getSessionRedisClient(): Promise<SessionRedisClient> {
  if (!sessionRedisClientPromise) {
    const client = createClient({
      url: env.sessionRedisUrl,
    })

    client.on('error', (error) => {
      logger.error('Redis session store error', error)
    })

    sessionRedisClientPromise = client.connect().then(() => client as SessionRedisClient)
  }

  return sessionRedisClientPromise
}

export async function pingSessionRedis(): Promise<void> {
  const client = await getSessionRedisClient()
  await client.ping()
}

export async function revokeSessionsForUser(userId: string): Promise<number> {
  const client = await getSessionRedisClient()
  let cursor = '0'
  let revokedCount = 0

  do {
    const result = await client.scan(cursor, {
      MATCH: `${env.sessionRedisPrefix}*`,
      COUNT: 200,
    })
    cursor = result.cursor

    for (const key of result.keys) {
      const rawSession = await client.get(key)
      if (!rawSession) {
        continue
      }

      try {
        const parsed = JSON.parse(rawSession) as { passport?: { user?: string } }
        if (parsed.passport?.user !== userId) {
          continue
        }

        await client.del(key)
        revokedCount += 1
      } catch {
        continue
      }
    }
  } while (cursor !== '0')

  return revokedCount
}
