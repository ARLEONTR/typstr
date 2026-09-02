import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { apiClient, buildOrcidConnectUrl } from '../../api/client'
import { useAuth } from '../../hooks/useAuth'
import type { AuthenticatedUser } from '../../types'

const ACADEMIC_ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  phd_student: 'PhD student',
  postdoc: 'Postdoctoral researcher',
  researcher: 'Researcher',
  faculty: 'Faculty',
  staff: 'Research staff',
  other: 'Other',
}

type OrcidSuggestion = {
  name: string | null
  institutionName: string | null
  department: string | null
  academicRole: string | null
  keywords: string[]
}

type VerifiedDomain = {
  email: string
  domain: string
  domainType: string
  verifiedAt: number
}

type DomainResponse = {
  domains: VerifiedDomain[]
}

function userInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase()
}

function getOrcidErrorMessage(): string | null {
  const code = new URLSearchParams(window.location.search).get('orcidError')
  if (!code) return null
  if (code === 'orcid-already-linked') return 'That ORCID iD is already linked to another account.'
  if (code === 'orcid-not-configured') return 'ORCID is not configured on this server.'
  if (code === 'orcid-login-required') return 'Sign in again before connecting ORCID.'
  if (code === 'account-disabled') return 'This account is disabled.'
  if (code === 'invalid-orcid-callback') return 'ORCID returned an invalid sign-in response. Please try again.'
  if (code === 'invalid-orcid-token') return 'ORCID did not return a verified iD. Please try again.'
  if (code === 'orcid-token-exchange-failed') return 'Could not verify your ORCID authorization. Please try again.'
  return 'ORCID connection failed.'
}

export function ProfilePanel() {
  const { user, refresh } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [academicRole, setAcademicRole] = useState(user?.academicRole ?? '')
  const [department, setDepartment] = useState(user?.department ?? '')
  const [institutionName, setInstitutionName] = useState(user?.institutionName ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(() => getOrcidErrorMessage())
  const [orcidSuggestion, setOrcidSuggestion] = useState<OrcidSuggestion | null>(null)
  const [orcidLoading, setOrcidLoading] = useState(false)
  const [domains, setDomains] = useState<VerifiedDomain[]>([])
  const [institutionEmail, setInstitutionEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [verificationLoading, setVerificationLoading] = useState(false)

  useEffect(() => {
    setName(user?.name ?? '')
    setAcademicRole(user?.academicRole ?? '')
    setDepartment(user?.department ?? '')
    setInstitutionName(user?.institutionName ?? '')
  }, [user])

  const hasOrcid = Boolean(user?.orcidId)
  const verifiedInstitution = useMemo(() => domains.find((entry) => entry.domainType !== 'personal'), [domains])

  const loadDomains = useCallback(async () => {
    try {
      const response = await apiClient.get<DomainResponse>('/api/account/domains')
      setDomains(response.data.domains ?? [])
    } catch {
      setDomains([])
    }
  }, [])

  const importFromOrcid = useCallback(async (applyEmptyOnly = false) => {
    if (!hasOrcid) return
    setOrcidLoading(true)
    setMessage(null)
    try {
      const response = await apiClient.get<OrcidSuggestion>('/api/account/orcid-profile')
      const suggestion = response.data
      setOrcidSuggestion(suggestion)
      setName((current) => suggestion.name && (!applyEmptyOnly || !current.trim()) ? suggestion.name : current)
      setInstitutionName((current) => suggestion.institutionName && (!applyEmptyOnly || !current.trim()) ? suggestion.institutionName : current)
      setDepartment((current) => suggestion.department && (!applyEmptyOnly || !current.trim()) ? suggestion.department : current)
      setAcademicRole((current) => suggestion.academicRole && (!applyEmptyOnly || !current) ? suggestion.academicRole : current)
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not import public ORCID profile details.')
    } finally {
      setOrcidLoading(false)
    }
  }, [hasOrcid])

  useEffect(() => {
    void loadDomains()
  }, [loadDomains])

  useEffect(() => {
    if (!hasOrcid) return
    const hasProfileDetails = Boolean(user?.institutionName || user?.department || user?.academicRole)
    if (!hasProfileDetails) {
      void importFromOrcid(true)
    }
  }, [hasOrcid, importFromOrcid, user?.academicRole, user?.department, user?.institutionName])

  const saveProfile = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      await apiClient.patch<AuthenticatedUser>('/api/account/academic-profile', {
        name: name.trim() || null,
        academicRole: academicRole || null,
        department: department.trim() || null,
        institutionName: institutionName.trim() || null,
      })
      await refresh()
      setMessage('Profile saved.')
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }, [academicRole, department, institutionName, name, refresh])

  const startInstitutionVerification = useCallback(async () => {
    setVerificationLoading(true)
    setVerificationMessage(null)
    try {
      await apiClient.post('/api/account/verify-email/start', { email: institutionEmail.trim() })
      setVerificationMessage('Verification code sent.')
    } catch (error: any) {
      setVerificationMessage(error?.response?.data?.error ?? 'Could not send verification code.')
    } finally {
      setVerificationLoading(false)
    }
  }, [institutionEmail])

  const confirmInstitutionVerification = useCallback(async () => {
    setVerificationLoading(true)
    setVerificationMessage(null)
    try {
      await apiClient.post('/api/account/verify-email/confirm', {
        email: institutionEmail.trim(),
        code: verificationCode.trim(),
      })
      setVerificationMessage('Institution connected.')
      setVerificationCode('')
      await loadDomains()
    } catch (error: any) {
      setVerificationMessage(error?.response?.data?.error ?? 'Could not verify that code.')
    } finally {
      setVerificationLoading(false)
    }
  }, [institutionEmail, loadDomains, verificationCode])

  const connectOrcid = () => {
    window.location.href = buildOrcidConnectUrl('/?settings=profile')
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Research profile</p>
            <h3 style={headingStyle}>User information</h3>
          </div>
          {hasOrcid ? (
            <button type="button" onClick={() => void importFromOrcid(false)} disabled={orcidLoading} style={buttonStyle}>
              {orcidLoading ? 'Importing...' : 'Import from ORCID'}
            </button>
          ) : (
            <button type="button" onClick={connectOrcid} style={buttonStyle}>Connect ORCID</button>
          )}
        </div>

        <div style={accountHeaderStyle}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} style={avatarImageStyle} referrerPolicy="no-referrer" />
          ) : (
            <div aria-hidden style={avatarFallbackStyle}>{userInitials(user?.name)}</div>
          )}
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ color: 'var(--text-bright)', fontWeight: 700 }}>{user?.name ?? 'User'}</span>
            <span style={mutedStyle}>{user?.email ?? ''}</span>
          </div>
        </div>

        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Name</span>
            <input style={inputStyle} value={name} onChange={(event) => setName(event.target.value)} maxLength={255} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Role</span>
            <select style={inputStyle} value={academicRole ?? ''} onChange={(event) => setAcademicRole(event.target.value)}>
              <option value="">Select role</option>
              {Object.entries(ACADEMIC_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Department or field</span>
            <input style={inputStyle} value={department ?? ''} onChange={(event) => setDepartment(event.target.value)} maxLength={255} placeholder="Computer Science, Biochemistry" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Affiliation</span>
            <input style={inputStyle} value={institutionName ?? ''} onChange={(event) => setInstitutionName(event.target.value)} maxLength={255} placeholder="University or research organization" />
          </label>
        </div>

        {orcidSuggestion?.keywords.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
            {orcidSuggestion.keywords.map((keyword) => (
              <span key={keyword} style={pillStyle}>{keyword}</span>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void saveProfile()} disabled={saving} style={primaryButtonStyle}>
            {saving ? 'Saving...' : 'Save profile'}
          </button>
          {message ? <span style={{ ...mutedStyle, color: message.includes('saved') ? 'var(--success)' : 'var(--danger)' }}>{message}</span> : null}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Institution</p>
            <h3 style={headingStyle}>Connect with your institution</h3>
          </div>
          {verifiedInstitution ? <span style={pillStyle}>{verifiedInstitution.domain}</span> : null}
        </div>

        {domains.length ? (
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {domains.map((entry) => (
              <div key={entry.email} style={domainRowStyle}>
                <span>{entry.email}</span>
                <span style={mutedStyle}>{entry.domainType} · {entry.domain}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={mutedStyle}>Verify an institution email to connect your account to an academic or organization domain.</p>
        )}

        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Institution email</span>
            <input style={inputStyle} value={institutionEmail} onChange={(event) => setInstitutionEmail(event.target.value)} placeholder="name@university.edu" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Verification code</span>
            <input style={inputStyle} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="6-digit code" />
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void startInstitutionVerification()} disabled={!institutionEmail.trim() || verificationLoading} style={buttonStyle}>Send code</button>
          <button type="button" onClick={() => void confirmInstitutionVerification()} disabled={!institutionEmail.trim() || !verificationCode.trim() || verificationLoading} style={primaryButtonStyle}>Verify</button>
          {verificationMessage ? <span style={mutedStyle}>{verificationMessage}</span> : null}
        </div>
      </section>
    </div>
  )
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--panel-border)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--card-bg)',
  color: 'var(--text-soft)',
}

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginBottom: 14,
}

const accountHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 14,
  padding: 10,
  borderRadius: 8,
  background: 'var(--action-bg)',
}

const avatarImageStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  objectFit: 'cover',
  background: 'var(--editor-bg)',
}

const avatarFallbackStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontWeight: 700,
  fontSize: 13,
}

const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
}

const labelStyle: CSSProperties = {
  color: 'var(--muted-text)',
  fontSize: 12,
  fontWeight: 700,
}

const inputStyle: CSSProperties = {
  border: '1px solid var(--panel-border)',
  borderRadius: 8,
  padding: '9px 11px',
  background: 'var(--editor-bg)',
  color: 'var(--text-bright)',
  font: 'inherit',
}

const headingStyle: CSSProperties = {
  margin: '3px 0 0',
  color: 'var(--text-bright)',
}

const mutedStyle: CSSProperties = {
  margin: 0,
  color: 'var(--muted-text)',
  fontSize: 13,
}

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
}

const buttonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  background: 'var(--action-bg)',
  color: 'var(--accent)',
  fontWeight: 700,
  cursor: 'pointer',
}

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
}

const pillStyle: CSSProperties = {
  border: '1px solid var(--panel-border)',
  borderRadius: 999,
  padding: '4px 8px',
  background: 'var(--action-bg)',
  color: 'var(--text-soft)',
  fontSize: 12,
  fontWeight: 700,
}

const domainRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: 10,
  borderRadius: 8,
  background: 'var(--action-bg)',
}
