import { Router } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { requireAuth } from '../auth.js'
import { clearUserGoogleTokens, getUserRefreshToken, getDbPool } from '../db.js'
import { env } from '../env.js'
import { shouldUseLocalFileStorage } from '../services/drive.js'

const router = Router()

interface PermissionsResponse {
  connected: boolean
  scopes: string[]
  driveRootFolderId: string | null
  projects: Array<{ id: string; title: string; driveFolderId: string }>
  liveFiles: Array<{ id: string; name: string; mimeType: string; webViewLink: string | null }> | null
}

async function getLiveGrantedScopes(refreshToken: string): Promise<string[]> {
  try {
    const oauth2 = new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
    oauth2.setCredentials({ refresh_token: refreshToken })
    const tokenResponse = await oauth2.getAccessToken()
    const accessToken = tokenResponse.token
    if (!accessToken) return []

    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`)
    if (!res.ok) return []
    const data = await res.json() as { scope?: string }
    return data.scope ? data.scope.split(' ') : []
  } catch {
    return []
  }
}

async function getLiveDriveFiles(refreshToken: string, rootFolderId: string): Promise<Array<{ id: string; name: string; mimeType: string; webViewLink: string | null }> | null> {
  try {
    const { google } = await import('googleapis')
    const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
    oauth2.setCredentials({ refresh_token: refreshToken })
    const drive = google.drive({ version: 'v3', auth: oauth2 })
    const res = await drive.files.list({
      q: `'${rootFolderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink)',
      pageSize: 50,
    })
    return (res.data.files ?? []).map(f => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      webViewLink: f.webViewLink ?? null,
    }))
  } catch {
    return null
  }
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!
    const refreshToken = await getUserRefreshToken(user.id)
    const usesLocalStorage = await shouldUseLocalFileStorage(user.id)

    if (!refreshToken || usesLocalStorage) {
      const result: PermissionsResponse = {
        connected: false,
        scopes: [],
        driveRootFolderId: user.driveRootFolderId ?? null,
        projects: [],
        liveFiles: null,
      }
      return res.json(result)
    }

    const [scopes, projectRows] = await Promise.all([
      getLiveGrantedScopes(refreshToken),
      getDbPool().query<{ id: string; title: string; drive_folder_id: string }>(
        `SELECT p.id, p.title, p.drive_folder_id
         FROM projects p
         INNER JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = $1 AND p.drive_folder_id IS NOT NULL
         ORDER BY p.updated_at DESC`,
        [user.id]
      ),
    ])

    const driveProjects = projectRows.rows.map(p => ({
      id: p.id,
      title: p.title,
      driveFolderId: p.drive_folder_id,
    }))

    let liveFiles: PermissionsResponse['liveFiles'] = null
    if (user.driveRootFolderId) {
      liveFiles = await getLiveDriveFiles(refreshToken, user.driveRootFolderId)
    }

    const result: PermissionsResponse = {
      connected: true,
      scopes,
      driveRootFolderId: user.driveRootFolderId ?? null,
      projects: driveProjects,
      liveFiles,
    }

    res.json(result)
  } catch (error) {
    next(error)
  }
})

interface CheckResult {
  label: string
  description: string
  expectBlocked: boolean
  blocked: boolean | null  // null = error running the check itself
  httpStatus: number | null
  googleErrorCode: string | null
  googleMessage: string | null
  note: string
}

async function runDriveCheck(
  label: string,
  description: string,
  expectBlocked: boolean,
  note: string,
  attempt: () => Promise<unknown>,
): Promise<CheckResult> {
  try {
    await attempt()
    return {
      label,
      description,
      expectBlocked,
      blocked: false,
      httpStatus: 200,
      googleErrorCode: null,
      googleMessage: null,
      note,
    }
  } catch (err: any) {
    const status: number = err?.response?.status ?? err?.status ?? 0
    const reason: string = err?.response?.data?.error?.errors?.[0]?.reason ?? ''
    const googleMessage: string = err?.response?.data?.error?.message ?? err?.message ?? ''
    return {
      label,
      description,
      expectBlocked,
      blocked: status === 403 || status === 401,
      httpStatus: status || null,
      googleErrorCode: reason || null,
      googleMessage: googleMessage || null,
      note,
    }
  }
}

router.get('/boundary-checks', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!
    const refreshToken = await getUserRefreshToken(user.id)

    if (!refreshToken || !env.googleClientId || !env.googleClientSecret) {
      return res.status(400).json({ error: 'No Google account connected.' })
    }

    const { google } = await import('googleapis')
    const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
    oauth2.setCredentials({ refresh_token: refreshToken })
    const drive = google.drive({ version: 'v3', auth: oauth2 })

    // Check 1 — list root folder contents (metadata only, no file content)
    // drive.file does NOT block this — Google treats metadata listing as permitted.
    const check1 = await runDriveCheck(
      'List root folder (metadata)',
      "Call files.list with 'root' in parents. Returns file names and IDs — no content.",
      false,
      "drive.file does not block metadata listing of root. Google considers listing names/IDs a permitted operation. This is the known limitation of the scope.",
      () => drive.files.list({ q: `'root' in parents and trashed = false`, fields: 'files(id,name)', pageSize: 1, spaces: 'drive' }),
    )

    const check2 = await runDriveCheck(
      'Cross-drive search (corpora=user)',
      "Call files.list with corpora=user — searches all files across the entire Drive, not just app-created ones.",
      true,
      "drive.file blocks this. Searching across the full Drive corpus requires the broader 'drive' or 'drive.readonly' scope.",
      () => drive.files.list({ corpora: 'user', fields: 'files(id,name)', pageSize: 1 }),
    )

    const check3 = await runDriveCheck(
      'Read Drive account metadata (About)',
      "Call the Drive About endpoint to read account-level metadata such as storage quota and user info.",
      true,
      "drive.file blocks reading Drive account metadata. Only files created by typstr can be accessed.",
      () => drive.about.get({ fields: 'user,storageQuota' }),
    )

    const check4 = await runDriveCheck(
      'Access appDataFolder (hidden app storage)',
      "Attempt to list the hidden appDataFolder — a private space used by other apps to store their own data.",
      true,
      "drive.file cannot access appDataFolder contents belonging to other applications.",
      () => drive.files.list({ spaces: 'appDataFolder', fields: 'files(id,name)', pageSize: 1 }),
    )

    res.json({ checks: [check1, check2, check3, check4] })
  } catch (error) {
    next(error)
  }
})

router.post('/revoke', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!
    const refreshToken = await getUserRefreshToken(user.id)

    if (refreshToken && env.googleClientId && env.googleClientSecret) {
      try {
        const oauth2 = new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
        await oauth2.revokeToken(refreshToken)
      } catch {
        // Best-effort — proceed with local cleanup even if Google revocation fails
      }
    }

    await clearUserGoogleTokens(user.id)

    req.logout((err) => {
      if (err) return next(err)
      req.session.destroy((destroyErr) => {
        if (destroyErr) return next(destroyErr)
        res.status(204).end()
      })
    })
  } catch (error) {
    next(error)
  }
})

export default router
