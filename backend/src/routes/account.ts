import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import { getDbPool, findUserById, sanitizeUser } from '../db.js'
import { confirmEmailVerification, getBillingStatus, listVerifiedDomains, startEmailVerification } from '../services/billing.js'
import type { WorkspaceTheme } from '../types.js'

const VALID_ACADEMIC_ROLES = new Set(['student', 'phd_student', 'postdoc', 'researcher', 'faculty', 'staff', 'other'])
const VALID_THEME_FIELDS = new Set(['presetId', 'uiFontFamily', 'uiFontSize', 'editorFontFamily', 'editorFontSize'])
const ORCID_ID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

export const accountRouter = Router()

accountRouter.post('/verify-email/start', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const result = await startEmailVerification(user.id, email)
    res.status(201).json(result)
  } catch (error) {
    next(error)
  }
})

accountRouter.post('/verify-email/confirm', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    res.json(await confirmEmailVerification(user.id, email, code))
  } catch (error) {
    next(error)
  }
})

accountRouter.get('/domains', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const [domains, billing] = await Promise.all([
      listVerifiedDomains(user.id),
      getBillingStatus(user.id),
    ])
    res.json({ domains, billing })
  } catch (error) {
    next(error)
  }
})

accountRouter.patch('/academic-profile', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const pool = getDbPool()

    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 255) : null
    const rawRole = typeof req.body?.academicRole === 'string' ? req.body.academicRole.trim() : null
    const rawDept = typeof req.body?.department === 'string' ? req.body.department.trim().slice(0, 255) : null
    const rawInst = typeof req.body?.institutionName === 'string' ? req.body.institutionName.trim().slice(0, 255) : null

    if (rawRole !== null && !VALID_ACADEMIC_ROLES.has(rawRole)) {
      return res.status(400).json({ error: `academicRole must be one of: ${[...VALID_ACADEMIC_ROLES].join(', ')}` })
    }

    await pool.query(
      `UPDATE users
       SET name = $1,
           academic_role = $2,
           department = $3,
           institution_name = $4,
           updated_at = $5
       WHERE id = $6`,
      [rawName || user.name, rawRole || null, rawDept || null, rawInst || null, Date.now(), user.id],
    )

    const refreshed = await findUserById(user.id)
    res.json(refreshed ? sanitizeUser(refreshed) : { ok: true })
  } catch (error) {
    next(error)
  }
})

accountRouter.get('/academic-profile', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const pool = getDbPool()
    const { rows } = await pool.query<{ academic_role: string | null; department: string | null; institution_name: string | null }>(
      'SELECT academic_role, department, institution_name FROM users WHERE id = $1',
      [user.id],
    )
    const row = rows[0]
    res.json({
      name: user.name,
      academicRole: row?.academic_role ?? null,
      department: row?.department ?? null,
      institutionName: row?.institution_name ?? null,
    })
  } catch (error) {
    next(error)
  }
})

accountRouter.patch('/theme', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const theme = normalizeThemePayload(req.body?.theme)
    if (!theme) {
      return res.status(400).json({ error: 'theme must include presetId, uiFontFamily, uiFontSize, editorFontFamily, and editorFontSize.' })
    }

    await getDbPool().query(
      'UPDATE users SET selected_theme_settings = $1, updated_at = $2 WHERE id = $3',
      [JSON.stringify(theme), Date.now(), user.id],
    )
    user.selectedTheme = theme
    res.json({ theme })
  } catch (error) {
    next(error)
  }
})

accountRouter.get('/orcid-profile', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!user.orcidId || !ORCID_ID_PATTERN.test(user.orcidId)) {
      return res.status(400).json({ error: 'Connect ORCID before importing profile details.' })
    }

    const summary = await fetchOrcidPublicProfile(user.orcidId)
    res.json(summary)
  } catch (error) {
    next(error)
  }
})

type OrcidProfileSuggestion = {
  name: string | null
  institutionName: string | null
  department: string | null
  academicRole: string | null
  keywords: string[]
}

async function fetchOrcidPublicProfile(orcidId: string): Promise<OrcidProfileSuggestion> {
  const [person, employments, educations] = await Promise.all([
    fetchOrcidJson(`https://pub.orcid.org/v3.0/${orcidId}/person`),
    fetchOrcidJson(`https://pub.orcid.org/v3.0/${orcidId}/employments`),
    fetchOrcidJson(`https://pub.orcid.org/v3.0/${orcidId}/educations`),
  ])

  const employment = firstAffiliationSummary(employments, 'employment-summary')
  const education = firstAffiliationSummary(educations, 'education-summary')
  const affiliation = employment ?? education
  const roleTitle = getString(affiliation, ['role-title'])
  const department = getString(affiliation, ['department-name'])

  return {
    name: readOrcidDisplayName(person),
    institutionName: getString(affiliation, ['organization', 'name']),
    department,
    academicRole: inferAcademicRole(roleTitle),
    keywords: readOrcidKeywords(person),
  }
}

async function fetchOrcidJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.orcid+json',
    },
  })
  if (!response.ok) {
    throw new Error(`ORCID profile request failed with HTTP ${response.status}`)
  }
  return await response.json()
}

function readOrcidDisplayName(person: unknown): string | null {
  const creditName = getString(person, ['name', 'credit-name', 'value'])
  if (creditName) return creditName
  const given = getString(person, ['name', 'given-names', 'value'])
  const family = getString(person, ['name', 'family-name', 'value'])
  return [given, family].filter(Boolean).join(' ').trim() || null
}

function readOrcidKeywords(person: unknown): string[] {
  const keywords = getValue(person, ['keywords', 'keyword'])
  if (!Array.isArray(keywords)) return []
  return keywords
    .map((entry) => getString(entry, ['content']))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8)
}

function firstAffiliationSummary(payload: unknown, summaryKey: string): unknown {
  const groups = getValue(payload, ['affiliation-group'])
  if (!Array.isArray(groups)) return null

  for (const group of groups) {
    const summaries = getValue(group, ['summaries'])
    if (!Array.isArray(summaries)) continue
    for (const summary of summaries) {
      const candidate = getValue(summary, [summaryKey])
      if (candidate) return candidate
    }
  }

  return null
}

function inferAcademicRole(roleTitle: string | null): string | null {
  const title = roleTitle?.toLowerCase() ?? ''
  if (!title) return null
  if (title.includes('phd') || title.includes('doctoral')) return 'phd_student'
  if (title.includes('postdoc')) return 'postdoc'
  if (title.includes('professor') || title.includes('faculty') || title.includes('lecturer')) return 'faculty'
  if (title.includes('student')) return 'student'
  if (title.includes('staff')) return 'staff'
  if (title.includes('research')) return 'researcher'
  return null
}

function getString(input: unknown, path: string[]): string | null {
  const value = getValue(input, path)
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 255) : null
}

function getValue(input: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, input)
}

function normalizeThemePayload(input: unknown): WorkspaceTheme | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.some(([key]) => !VALID_THEME_FIELDS.has(key))) {
    return null
  }

  const theme = input as Partial<WorkspaceTheme>
  const stringFields = [theme.presetId, theme.uiFontFamily, theme.editorFontFamily]
  if (stringFields.some((value) => typeof value !== 'string' || value.trim().length === 0 || value.length > 255)) {
    return null
  }
  if (typeof theme.uiFontSize !== 'number' || theme.uiFontSize < 9 || theme.uiFontSize > 24) {
    return null
  }
  if (typeof theme.editorFontSize !== 'number' || theme.editorFontSize < 9 || theme.editorFontSize > 24) {
    return null
  }

  const presetId = theme.presetId
  const uiFontFamily = theme.uiFontFamily
  const editorFontFamily = theme.editorFontFamily
  if (!presetId || !uiFontFamily || !editorFontFamily) {
    return null
  }

  return {
    presetId,
    uiFontFamily,
    uiFontSize: Math.round(theme.uiFontSize),
    editorFontFamily,
    editorFontSize: Math.round(theme.editorFontSize),
  }
}
