import { randomBytes } from 'node:crypto'
import { Router, type Request } from 'express'
import type { CookieOptions } from 'express-session'
import passport from 'passport'
import { OAuth2Client } from 'google-auth-library'
import { establishLocalDevSession, loginWithSessionRegenerate, requireAuth, SESSION_COOKIE_NAME } from '../auth.js'
import { disableUserByGoogleId, findUserById, linkUserOrcid, sanitizeUser, unlinkUserOrcid, upsertLdapUser } from '../db.js'
import { env, isGoogleAuthConfigured, isLdapConfigured, isLocalAuthBypassEnabled, isOrcidAuthConfigured } from '../env.js'
import { logger } from '../logger.js'
import { initializeUserDriveRootFolder } from '../services/drive.js'
import { authenticateLdap } from '../services/ldap.js'
import { validateString } from '../validation.js'

export const authRouter = Router()

const oauth2Client = new OAuth2Client(env.googleClientId)
const ORCID_AUTHENTICATE_SCOPE = '/authenticate'
const ORCID_ID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

type OrcidTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  name?: string
  orcid?: string
  error?: string
  error_description?: string
}

/**
 * Google RISC (Risk Incident Shared Check) receiver.
 * Handles Cross-Account Protection events from Google.
 * https://developers.google.com/identity/protocols/risc
 */
authRouter.post('/google/risc', async (req, res) => {
  // Google sends the SET (Security Event Token) as a JWT in the body
  // The content-type is usually application/secevent+jwt
  // If the body is a string, we parse it. If it's already parsed by a body-parser, we handle that too.
  const token = typeof req.body === 'string' ? req.body : (req.body ? req.body.toString() : null)

  if (!token || token === '[object Object]') {
    return res.status(400).end()
  }

  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: env.googleClientId,
    })

    const payload = ticket.getPayload()
    if (!payload || payload.iss !== 'https://accounts.google.com') {
      logger.warning('RISC: Invalid issuer', payload?.iss)
      return res.status(400).end()
    }

    // Google RISC events are in the 'events' claim
    // https://schemas.openid.net/secevent/risc/event-type/account-compromised
    const events = (payload as any).events
    if (!events) {
      return res.status(204).end()
    }

    const googleId = payload.sub
    if (!googleId) {
      return res.status(400).end()
    }

    // Check for critical security events
    const isCompromised = !!(
      events['https://schemas.openid.net/secevent/risc/event-type/account-compromised'] ||
      events['https://schemas.openid.net/secevent/risc/event-type/account-deleted'] ||
      events['https://schemas.openid.net/secevent/risc/event-type/account-disabled'] ||
      events['https://schemas.openid.net/secevent/risc/event-type/sessions-revoked']
    )

    if (isCompromised) {
      logger.warning(`RISC: Disabling user ${googleId} due to security event`)
      await disableUserByGoogleId(googleId)
    }

    res.status(204).end()
  } catch (error) {
    logger.error('RISC: Token verification failed', error)
    res.status(400).end()
  }
})

authRouter.get('/providers', (_req, res) => {
  res.json({
    google: isGoogleAuthConfigured(),
    orcid: isOrcidAuthConfigured(),
    ldap: isLdapConfigured(),
    localDev: isLocalAuthBypassEnabled(),
  })
})

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    return res.json(null)
  }

  res.json(req.user)
})

authRouter.post('/ldap/login', async (req, res, next) => {
  if (!isLdapConfigured()) {
    return res.status(503).json({ error: 'LDAP authentication is not enabled or configured on this server.' })
  }

  const usernameResult = validateString(req.body.username, { required: true, maxLength: 254, label: 'Username' })
  const passwordResult = validateString(req.body.password, { required: true, maxLength: 1000, label: 'Password' })

  if (!usernameResult.valid) {
    return res.status(400).json({ error: usernameResult.error })
  }
  if (!passwordResult.valid) {
    return res.status(400).json({ error: passwordResult.error })
  }

  try {
    const ldapResult = await authenticateLdap(usernameResult.value, passwordResult.value)
    if (!ldapResult) {
      return res.status(401).json({ error: 'Invalid username or password.' })
    }

    const user = await upsertLdapUser({
      ldapId: ldapResult.ldapId,
      email: ldapResult.email,
      name: ldapResult.name,
      avatarUrl: ldapResult.avatarUrl,
    })

    if (user.disabledAt) {
      return res.status(403).json({ error: 'Account disabled' })
    }

    await loginWithSessionRegenerate(req, user)

    if (!user.driveRootFolderId) {
      try {
        await initializeUserDriveRootFolder(user.id, env.googleDriveRootName)
      } catch (workspaceError) {
        logger.error('Failed to initialize workspace for LDAP user:', workspaceError)
      }
    }

    res.json(user)
  } catch (error) {
    logger.error('LDAP login error:', error)
    next(error)
  }
})


authRouter.get('/google/start', (req, res, next) => {
  if (!isGoogleAuthConfigured() && isLocalAuthBypassEnabled()) {
    return res.redirect(`${env.backendOrigin}/api/auth/local-dev-login?next=${encodeURIComponent(sanitizeNextPath(typeof req.query.next === 'string' ? req.query.next : null))}`)
  }

  if (!isGoogleAuthConfigured()) {
    return res.status(503).json({ error: 'Google OAuth is not configured' });
  }

  const targetPath: string = sanitizeNextPath(typeof req.query.next === 'string' ? req.query.next : null);

  logger.debug('[OAuth start] req.secure:', req.secure, 'x-forwarded-proto:', req.headers['x-forwarded-proto'], 'session id before:', req.session.id);

  // Store targetPath in session to redirect after successful callback
  // We don't put it in the OAuth 'state' param because we want Passport to
  // manage a secure random state for us automatically.
  (req.session as any).returnTo = targetPath;

  passport.authenticate('google', {
    scope: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
    accessType: 'offline',
    includeGrantedScopes: true,
    prompt: 'select_account',
  } as any)(req, res, next);
})

authRouter.get('/google/upgrade', requireAuth, (req, res, next) => {
  if (!isGoogleAuthConfigured()) {
    return res.status(503).json({ error: 'Google OAuth is not configured' })
  }

  const scopeParam = typeof req.query.scope === 'string' ? req.query.scope : ''
  const nextPath = sanitizeNextPath(typeof req.query.next === 'string' ? req.query.next : null)

  const scopeMap: Record<string, string[]> = {
    drive: ['https://www.googleapis.com/auth/drive.file'],
    gemini: ['https://www.googleapis.com/auth/generative-language.peruserquota'],
  }
  const additionalScopes = scopeMap[scopeParam]
  if (!additionalScopes) {
    return res.status(400).json({ error: 'Invalid scope parameter. Use "drive" or "gemini".' })
  }

  ;(req.session as any).upgradeReturnTo = nextPath
  ;(req.session as any).isUpgradeFlow = true

  passport.authenticate('google', {
    scope: ['openid', 'profile', 'email', ...additionalScopes],
    accessType: 'offline',
    prompt: 'consent',
    includeGrantedScopes: true,
  } as any)(req, res, next)
})

authRouter.get('/google/callback', (req, res, next) => {
  if (!isGoogleAuthConfigured()) {
    return res.redirect(`${env.frontendOrigin}/?authError=google-not-configured`)
  }

  const isUpgradeFlow = !!(req.session as any).isUpgradeFlow

  passport.authenticate('google', async (err: unknown, user: Express.User | false, info: any) => {
    if (err || !user) {
      logger.error('Google OAuth callback failed:', { err, info })
      return res.redirect(`${env.frontendOrigin}/?authError=google-auth-failed`)
    }

    try {
      if (isUpgradeFlow && req.user) {
        // Scope upgrade for already-authenticated user: persist new refresh token only,
        // do not regenerate session (user is already logged in).
        delete (req.session as any).isUpgradeFlow
        const nextPath = sanitizeNextPath((req.session as any).upgradeReturnTo || null)
        delete (req.session as any).upgradeReturnTo
        await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()))
        res.redirect(`${env.frontendOrigin}${nextPath}`)
      } else {
        await loginWithSessionRegenerate(req, user)
        if (!user.driveRootFolderId) {
          try {
            await initializeUserDriveRootFolder(user.id, env.googleDriveRootName)
          } catch (workspaceError) {
            logger.error('Failed to initialize Drive workspace for first-time user:', workspaceError)
          }
        }
        const nextPath = sanitizeNextPath((req.session as any).returnTo || null)
        res.redirect(`${env.frontendOrigin}${nextPath}`)
      }
    } catch (loginErr) {
      next(loginErr)
    }
  })(req, res, next)
})

authRouter.get('/orcid/start', (req, res, next) => {
  const nextPath = sanitizeNextPath(typeof req.query.next === 'string' ? req.query.next : null)
  const redirectTarget = `${env.frontendOrigin}${nextPath}`
  if (!req.user) {
    return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'orcid-login-required'))
  }

  if (req.user.disabledAt) {
    return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'account-disabled'))
  }

  if (!isOrcidAuthConfigured()) {
    return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'orcid-not-configured'))
  }

  const state = randomBytes(24).toString('hex')
  ;(req.session as any).orcidOAuth = { state, nextPath }

  req.session.save((error) => {
    if (error) {
      next(error)
      return
    }

    const authorizeUrl = new URL(env.orcidAuthorizeUrl)
    authorizeUrl.searchParams.set('client_id', env.orcidClientId)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', ORCID_AUTHENTICATE_SCOPE)
    authorizeUrl.searchParams.set('redirect_uri', env.orcidCallbackUrl)
    authorizeUrl.searchParams.set('state', state)
    res.redirect(authorizeUrl.toString())
  })
})

authRouter.get('/orcid/callback', async (req, res, next) => {
  if (!isOrcidAuthConfigured()) {
    return res.redirect(withQueryParam(env.frontendOrigin, 'orcidError', 'orcid-not-configured'))
  }

  const stored = (req.session as any).orcidOAuth as { state?: string; nextPath?: string } | undefined
  delete (req.session as any).orcidOAuth
  const nextPath = sanitizeNextPath(stored?.nextPath ?? null)
  const redirectTarget = `${env.frontendOrigin}${nextPath}`
  if (!req.user) {
    return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'orcid-login-required'))
  }

  if (req.user.disabledAt) {
    return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'account-disabled'))
  }

  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const code = typeof req.query.code === 'string' ? req.query.code : ''

  if (!stored?.state || stored.state !== state || !code) {
    return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'invalid-orcid-callback'))
  }

  try {
    const tokenResponse = await exchangeOrcidAuthorizationCode(code)
    if (!tokenResponse.access_token || !tokenResponse.orcid || !ORCID_ID_PATTERN.test(tokenResponse.orcid)) {
      logger.error('ORCID token response did not contain an authenticated ORCID iD:', {
        error: tokenResponse.error,
        errorDescription: tokenResponse.error_description,
      })
      return res.redirect(withQueryParam(redirectTarget, 'orcidError', 'invalid-orcid-token'))
    }

    const user = await linkUserOrcid({
      userId: req.user!.id,
      orcidId: tokenResponse.orcid,
      orcidName: tokenResponse.name?.trim() || null,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? null,
    })
    await refreshCurrentLogin(req, user)

    res.redirect(redirectTarget)
  } catch (error) {
    logger.error('ORCID OAuth callback failed:', error)
    const code = (error as { code?: string } | null)?.code === '23505' ? 'orcid-already-linked' : 'orcid-token-exchange-failed'
    res.redirect(withQueryParam(redirectTarget, 'orcidError', code))
  }
})

authRouter.post('/orcid/unlink', requireAuth, async (req, res, next) => {
  try {
    const user = await unlinkUserOrcid(req.user!.id)
    await refreshCurrentLogin(req, user)
    res.json(user)
  } catch (error) {
    next(error)
  }
})

authRouter.get('/local-dev-login', async (req, res, next) => {
  if (!isLocalAuthBypassEnabled()) {
    return res.status(404).json({ error: 'Local development auth bypass is disabled' })
  }

  try {
    await establishLocalDevSession(req)
    const nextPath = sanitizeNextPath(typeof req.query.next === 'string' ? req.query.next : null)
    res.redirect(`${env.frontendOrigin}${nextPath}`)
  } catch (error) {
    next(error)
  }
})

authRouter.post('/local-dev-login', async (req, res, next) => {
  if (!isLocalAuthBypassEnabled()) {
    return res.status(404).json({ error: 'Local development auth bypass is disabled' })
  }

  try {
    const user = await establishLocalDevSession(req)
    res.json(user)
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', requireAuth, (req, res, next) => {
  req.logout((err) => {
    if (err) {
      next(err)
      return
    }

    req.session.destroy((destroyError) => {
      if (destroyError) {
        next(destroyError)
        return
      }

      res.clearCookie(SESSION_COOKIE_NAME, {
        domain: env.sessionCookieDomain,
        httpOnly: true,
        sameSite: env.sessionCookieSameSite as CookieOptions['sameSite'],
        secure: env.cookieSecure,
      })
      res.status(204).end()
    })
  })
})

authRouter.post('/drive-workspace', requireAuth, async (req, res, next) => {
  try {
    const folderNameResult = validateString(req.body.name, { required: true, maxLength: 32, label: 'Folder name' })
    if (!folderNameResult.valid) {
      return res.status(400).json({ error: folderNameResult.error })
    }

    const folderName = folderNameResult.value
    if (folderName.includes('/')) {
      return res.status(400).json({ error: 'Folder name cannot contain path separators.' })
    }

    await initializeUserDriveRootFolder(req.user!.id, folderName)
    const refreshed = await findUserById(req.user!.id)
    if (!refreshed) {
      return res.status(404).json({ error: 'User not found after workspace setup.' })
    }

    res.json(sanitizeUser(refreshed))
  } catch (error) {
    next(error)
  }
})

function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) {
    return '/'
  }

  return nextPath
}

async function refreshCurrentLogin(req: Request, user: Express.User): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.login(user, (error) => {
      if (error) {
        reject(error)
        return
      }

      req.session.save((saveError) => {
        if (saveError) {
          reject(saveError)
          return
        }

        resolve()
      })
    })
  })
}

async function exchangeOrcidAuthorizationCode(code: string): Promise<OrcidTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.orcidClientId,
    client_secret: env.orcidClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.orcidCallbackUrl,
  })

  const response = await fetch(env.orcidTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const payload = await response.json().catch(() => ({})) as OrcidTokenResponse
  if (!response.ok) {
    const message = payload.error_description || payload.error || `ORCID token exchange failed with HTTP ${response.status}`
    throw new Error(message)
  }

  return payload
}

function withQueryParam(target: string, key: string, value: string): string {
  const url = new URL(target)
  url.searchParams.set(key, value)
  return url.toString()
}
