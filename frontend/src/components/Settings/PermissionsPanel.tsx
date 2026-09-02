import { useState, useEffect, useCallback } from 'react'
import { apiClient, buildApiUrl, buildGoogleUpgradeUrl, buildOrcidConnectUrl } from '../../api/client'
import { getAiApiKeyStatus, saveAiApiKey, deleteAiApiKey } from '../../api/gemini'
import { useAuth } from '../../hooks/useAuth'

interface CheckResult {
  label: string
  description: string
  expectBlocked: boolean
  blocked: boolean | null
  httpStatus: number | null
  googleErrorCode: string | null
  googleMessage: string | null
  note: string
}

interface PermissionsData {
  connected: boolean
  scopes: string[]
  driveRootFolderId: string | null
  projects: Array<{ id: string; title: string; driveFolderId: string }>
  liveFiles: Array<{ id: string; name: string; mimeType: string; webViewLink: string | null }> | null
}

const SCOPE_INFO: Record<string, { label: string; reason: string; revokeEffect: string }> = {
  'https://www.googleapis.com/auth/drive.file': {
    label: 'Google Drive (app files only)',
    reason: 'Stores your projects and documents in your own Google Drive. We can only see files that this app created — never your personal files.',
    revokeEffect: 'Your projects in Drive will remain intact. You will no longer be able to sync new documents until you reconnect.',
  },
  'https://www.googleapis.com/auth/generative-language.peruserquota': {
    label: 'Gemini AI (your quota)',
    reason: 'Enables AI writing assistance powered by Gemini. Usage counts against your personal Google AI quota, not a shared pool.',
    revokeEffect: 'AI writing features will be disabled until you reconnect.',
  },
  'openid': { label: 'OpenID (sign-in identity)', reason: 'Required for Google sign-in.', revokeEffect: '' },
  'profile': { label: 'Google profile (name & photo)', reason: 'Shows your name and avatar in the app.', revokeEffect: '' },
  'email': { label: 'Email address', reason: 'Used to identify your account.', revokeEffect: '' },
  'https://www.googleapis.com/auth/userinfo.email': { label: 'Email address', reason: 'Used to identify your account.', revokeEffect: '' },
  'https://www.googleapis.com/auth/userinfo.profile': { label: 'Google profile (name & photo)', reason: 'Shows your name and avatar in the app.', revokeEffect: '' },
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

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

function ScopeRow({ scope }: { scope: string }) {
  const info = SCOPE_INFO[scope]
  if (!info) return null
  const isBasic = scope === 'openid' || scope === 'profile' || scope === 'email' ||
    scope === 'https://www.googleapis.com/auth/userinfo.email' ||
    scope === 'https://www.googleapis.com/auth/userinfo.profile'
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--panel-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: isBasic ? 'var(--muted-text)' : 'var(--success)', flexShrink: 0
        }} />
        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-bright)' }}>{info.label}</span>
      </div>
      <p style={{ margin: '0 0 0 16px', fontSize: '13px', color: 'var(--text-soft)', lineHeight: 1.5 }}>{info.reason}</p>
      {!isBasic && info.revokeEffect && (
        <p style={{ margin: '4px 0 0 16px', fontSize: '12px', color: 'var(--muted-text)', lineHeight: 1.4 }}>
          If revoked: {info.revokeEffect}
        </p>
      )}
    </div>
  )
}

export function PermissionsPanel() {
  const { user, refresh } = useAuth()
  const [data, setData] = useState<PermissionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [boundaryChecking, setBoundaryChecking] = useState(false)
  const [boundaryChecks, setBoundaryChecks] = useState<CheckResult[] | null>(null)
  const [boundaryError, setBoundaryError] = useState<string | null>(null)
  const [aiKeyStatus, setAiKeyStatus] = useState<{ gemini: boolean; anthropic: boolean; openai: boolean }>({ gemini: false, anthropic: false, openai: false })
  const [geminiKey, setGeminiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [aiKeyMessage, setAiKeyMessage] = useState<string | null>(null)
  const [aiKeySaving, setAiKeySaving] = useState<'gemini' | 'anthropic' | 'openai' | null>(null)
  const [orcidMessage, setOrcidMessage] = useState<string | null>(() => getOrcidErrorMessage())
  const [orcidUnlinking, setOrcidUnlinking] = useState(false)

  const handleBoundaryCheck = useCallback(async () => {
    setBoundaryChecking(true)
    setBoundaryChecks(null)
    setBoundaryError(null)
    try {
      const res = await apiClient.get<{ checks: CheckResult[] }>(buildApiUrl('/permissions/boundary-checks'))
      setBoundaryChecks(res.data.checks)
    } catch {
      setBoundaryError('Could not reach the server to run the checks.')
    } finally {
      setBoundaryChecking(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get<PermissionsData>(buildApiUrl('/permissions'))
      setData(res.data)
    } catch {
      setError('Failed to load permissions data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    void getAiApiKeyStatus().then(setAiKeyStatus).catch(() => undefined)
  }, [])

  const handleSaveAiKey = useCallback(async (provider: 'gemini' | 'anthropic' | 'openai') => {
    const key = provider === 'anthropic' ? anthropicKey : provider === 'openai' ? openaiKey : geminiKey
    if (!key.trim()) return
    setAiKeyMessage(null)
    setAiKeySaving(provider)
    try {
      await saveAiApiKey(provider, key.trim())
      setAiKeyStatus(s => ({ ...s, [provider]: true }))
      if (provider === 'anthropic') setAnthropicKey('')
      else if (provider === 'openai') setOpenaiKey('')
      else setGeminiKey('')
      const label = provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Google AI'
      setAiKeyMessage(`${label} API key saved.`)
    } catch (err: any) {
      setAiKeyMessage(err?.response?.data?.error ?? 'Failed to save API key.')
    } finally {
      setAiKeySaving(null)
    }
  }, [anthropicKey, openaiKey, geminiKey])

  const handleRemoveAiKey = useCallback(async (provider: 'gemini' | 'anthropic' | 'openai') => {
    setAiKeyMessage(null)
    setAiKeySaving(provider)
    try {
      await deleteAiApiKey(provider)
      setAiKeyStatus(s => ({ ...s, [provider]: false }))
      const label = provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Google AI'
      setAiKeyMessage(`${label} API key removed.`)
    } catch (err: any) {
      setAiKeyMessage(err?.response?.data?.error ?? 'Failed to remove API key.')
    } finally {
      setAiKeySaving(null)
    }
  }, [])

  const handleRevoke = async () => {
    setRevoking(true)
    try {
      await apiClient.post(buildApiUrl('/permissions/revoke'))
      window.location.href = '/'
    } catch {
      setError('Failed to revoke permissions. Please try again.')
      setRevoking(false)
      setShowConfirm(false)
    }
  }

  const handleConnectDrive = () => {
    window.location.href = buildGoogleUpgradeUrl('drive', '/settings')
  }

  const handleConnectGemini = () => {
    window.location.href = buildGoogleUpgradeUrl('gemini', '/settings')
  }

  const handleConnectOrcid = () => {
    window.location.href = buildOrcidConnectUrl('/?settings=permissions')
  }

  const handleUnlinkOrcid = useCallback(async () => {
    setOrcidMessage(null)
    setOrcidUnlinking(true)
    try {
      await apiClient.post('/api/auth/orcid/unlink')
      await refresh()
      setOrcidMessage('ORCID iD disconnected.')
    } catch (err: any) {
      setOrcidMessage(err?.response?.data?.error ?? 'Failed to disconnect ORCID.')
    } finally {
      setOrcidUnlinking(false)
    }
  }, [refresh])

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted-text)' }}>Loading permissions…</div>
  }

  if (error && !data) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', marginBottom: '12px' }}>{error}</p>
        <button onClick={load} style={{ padding: '8px 16px', background: 'var(--action-bg)', color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }

  const hasDrive = data?.scopes?.includes('https://www.googleapis.com/auth/drive.file') ?? false
  const hasGemini = data?.scopes?.includes('https://www.googleapis.com/auth/generative-language.peruserquota') ?? false
  const visibleScopes = (data?.scopes ?? []).filter(s => SCOPE_INFO[s])
  const folders = (data?.liveFiles ?? []).filter(f => f.mimeType === FOLDER_MIME)
  const files = (data?.liveFiles ?? []).filter(f => f.mimeType !== FOLDER_MIME)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Connection status */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: 'var(--text-bright)', fontSize: '15px' }}>Google Account</h4>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
          background: 'var(--editor-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)'
        }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: data?.connected ? 'var(--success)' : 'var(--muted-text)', flexShrink: 0 }} />
          <span style={{ fontSize: '14px', color: data?.connected ? 'var(--text-bright)' : 'var(--text-soft)' }}>
            {data?.connected ? 'Connected — Google account linked' : 'Not connected — no Google tokens stored'}
          </span>
        </div>
      </section>

      <section>
        <h4 style={{ margin: '0 0 12px', color: 'var(--text-bright)', fontSize: '15px' }}>ORCID iD</h4>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '12px 16px',
          background: 'var(--editor-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: user?.orcidId ? '#A6CE39' : 'var(--muted-text)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '14px', color: user?.orcidId ? 'var(--text-bright)' : 'var(--text-soft)', fontWeight: 500 }}>
                {user?.orcidId ? `Connected — ${user.orcidId}` : 'Not connected'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--muted-text)', lineHeight: 1.4 }}>
                {user?.orcidId ? (user.orcidName ?? 'Authenticated ORCID iD stored on your account') : 'Link an authenticated researcher identifier for author metadata and future submission workflows.'}
              </p>
            </div>
          </div>
          {user?.orcidId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <a
                href={`https://orcid.org/${user.orcidId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '7px 12px', background: 'var(--action-bg)', color: 'var(--text-soft)', borderRadius: '6px', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}
              >
                View
              </a>
              <button
                onClick={() => void handleUnlinkOrcid()}
                disabled={orcidUnlinking}
                style={{ padding: '7px 12px', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: '6px', cursor: orcidUnlinking ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, opacity: orcidUnlinking ? 0.6 : 1 }}
              >
                {orcidUnlinking ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectOrcid}
              style={{ padding: '8px 14px', background: '#A6CE39', color: '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}
            >
              Connect ORCID iD
            </button>
          )}
        </div>
        {orcidMessage && (
          <p style={{ margin: '10px 0 0', fontSize: '13px', color: orcidMessage.includes('disconnected') ? 'var(--success)' : 'var(--danger)' }}>{orcidMessage}</p>
        )}
      </section>

      {/* Granted scopes */}
      {data?.connected && visibleScopes.length > 0 && (
        <section>
          <h4 style={{ margin: '0 0 4px', color: 'var(--text-bright)', fontSize: '15px' }}>Granted Permissions</h4>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted-text)' }}>
            These are the exact Google permissions you have granted this app.
          </p>
          <div style={{ background: 'var(--editor-bg)', borderRadius: '8px', padding: '0 16px', border: '1px solid var(--panel-border)' }}>
            {visibleScopes.map(s => <ScopeRow key={s} scope={s} />)}
          </div>
        </section>
      )}

      {/* Upgrade prompts */}
      {data?.connected && (!hasDrive || !hasGemini) && (
        <section>
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-bright)', fontSize: '15px' }}>Available Integrations</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {!hasDrive && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--editor-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-bright)', fontWeight: 500 }}>Google Drive</p>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--muted-text)' }}>Save projects to your Drive</p>
                </div>
                <button onClick={handleConnectDrive} style={{ padding: '8px 14px', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                  Connect
                </button>
              </div>
            )}
            {!hasGemini && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--editor-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-bright)', fontWeight: 500 }}>Gemini AI</p>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--muted-text)' }}>AI writing assistance</p>
                </div>
                <button onClick={handleConnectGemini} style={{ padding: '8px 14px', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                  Connect
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Drive files */}
      {hasDrive && data?.driveRootFolderId && (
        <section>
          <h4 style={{ margin: '0 0 4px', color: 'var(--text-bright)', fontSize: '15px' }}>Drive Workspace</h4>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted-text)' }}>
            Files and folders in your typstr Drive workspace. Revoking access will not delete these.
          </p>
          {data.liveFiles === null ? (
            <p style={{ fontSize: '13px', color: 'var(--danger)' }}>Could not load Drive contents.</p>
          ) : data.liveFiles.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--muted-text)' }}>No files in workspace yet.</p>
          ) : (
            <div style={{ background: 'var(--editor-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
              {folders.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderBottom: '1px solid var(--panel-border)' }}>
                  <span style={{ fontSize: '16px' }}>📁</span>
                  {f.webViewLink ? (
                    <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: 'var(--accent-soft)', textDecoration: 'none' }}>{f.name}</a>
                  ) : (
                    <span style={{ fontSize: '13px', color: 'var(--text-bright)' }}>{f.name}</span>
                  )}
                </div>
              ))}
              {files.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderBottom: '1px solid var(--panel-border)' }}>
                  <span style={{ fontSize: '16px' }}>📄</span>
                  {f.webViewLink ? (
                    <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: 'var(--accent-soft)', textDecoration: 'none' }}>{f.name}</a>
                  ) : (
                    <span style={{ fontSize: '13px', color: 'var(--text-bright)' }}>{f.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.projects.length > 0 && (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--muted-text)' }}>
              {data.projects.length} project{data.projects.length !== 1 ? 's' : ''} linked to Drive folders
            </p>
          )}

          <div style={{ marginTop: '16px', padding: '14px 16px', background: 'var(--editor-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 500, color: 'var(--text-bright)' }}>Verify access boundaries</p>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted-text)', lineHeight: 1.5 }}>
                  Runs 4 checks against the Google Drive API to show exactly what the <code style={{ background: 'var(--panel-border)', padding: '1px 5px', borderRadius: '3px', color: 'var(--accent)' }}>drive.file</code> scope allows and blocks.
                </p>
              </div>
              <button
                onClick={() => void handleBoundaryCheck()}
                disabled={boundaryChecking}
                style={{ flexShrink: 0, padding: '7px 14px', background: 'var(--panel-border)', color: 'var(--text-soft)', border: '1px solid var(--panel-border)', borderRadius: '6px', cursor: boundaryChecking ? 'not-allowed' : 'pointer', fontSize: '13px', opacity: boundaryChecking ? 0.6 : 1 }}
              >
                {boundaryChecking ? 'Checking…' : 'Run checks'}
              </button>
            </div>

            {boundaryError && (
              <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--danger)' }}>{boundaryError}</p>
            )}

            {boundaryChecks && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {boundaryChecks.map((check) => {
                  const passed = check.blocked === check.expectBlocked
                  const statusIcon = check.blocked === null ? '⚙️' : passed ? (check.expectBlocked ? '✅' : '🔵') : '⚠️'
                  const statusColor = check.blocked === null ? 'var(--text-soft)' : passed ? (check.expectBlocked ? 'var(--success)' : 'var(--accent)') : 'var(--danger)'
                  const bgColor = check.blocked === null ? 'var(--editor-bg)' : passed ? (check.expectBlocked ? 'var(--success-bg)' : 'var(--action-bg)') : 'var(--danger-bg)'
                  const borderColor = check.blocked === null ? 'var(--panel-border)' : passed ? (check.expectBlocked ? 'var(--success)' : 'var(--accent)') : 'var(--danger)'
                  return (
                    <div key={check.label} style={{ padding: '12px', borderRadius: '6px', background: bgColor, border: `1px solid ${borderColor}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '14px' }}>{statusIcon}</span>
                        <strong style={{ fontSize: '13px', color: statusColor }}>{check.label}</strong>
                        {check.httpStatus != null && (
                          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--muted-text)', fontFamily: 'var(--code-font)' }}>HTTP {check.httpStatus}</span>
                        )}
                      </div>
                      <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--muted-text)', lineHeight: 1.5 }}>{check.description}</p>
                      {(check.googleErrorCode || check.googleMessage) && (
                        <div style={{ fontFamily: 'var(--code-font)', fontSize: '11px', background: 'var(--editor-bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--panel-border)', marginBottom: '4px' }}>
                          {check.googleErrorCode && <span style={{ color: 'var(--danger)' }}>code: <span style={{ color: 'var(--text-bright)' }}>{check.googleErrorCode}</span>{'  '}</span>}
                          {check.googleMessage && <span style={{ color: 'var(--danger)' }}>message: <span style={{ color: 'var(--text-bright)' }}>{check.googleMessage}</span></span>}
                        </div>
                      )}
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted-text)', lineHeight: 1.5, fontStyle: 'italic' }}>{check.note}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Third-party AI keys */}
      <section>
        <h4 style={{ margin: '0 0 4px', color: 'var(--text-bright)', fontSize: '15px' }}>AI Provider Keys</h4>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted-text)' }}>
          Add your own API keys to use your personal quota for each AI provider.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {([
            { provider: 'gemini' as const, label: 'Gemini (Google AI)', placeholder: 'AIza...', consoleUrl: 'https://aistudio.google.com/app/apikey', key: geminiKey, setKey: setGeminiKey },
            { provider: 'anthropic' as const, label: 'Claude (Anthropic)', placeholder: 'sk-ant-...', consoleUrl: 'https://console.anthropic.com/settings/keys', key: anthropicKey, setKey: setAnthropicKey },
            { provider: 'openai' as const, label: 'ChatGPT (OpenAI)', placeholder: 'sk-...', consoleUrl: 'https://platform.openai.com/api-keys', key: openaiKey, setKey: setOpenaiKey },
          ]).map(({ provider, label, placeholder, consoleUrl, key, setKey }) => (
            <div key={provider} style={{ background: 'var(--editor-bg)', borderRadius: '8px', padding: '14px 16px', border: '1px solid var(--panel-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: aiKeyStatus[provider] ? 'var(--success)' : 'var(--muted-text)', flexShrink: 0 }} />
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-bright)' }}>{label}</span>
                </div>
                <a href={consoleUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--accent-soft)', textDecoration: 'none' }}>
                  Get API key →
                </a>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--muted-text)' }}>
                {aiKeyStatus[provider] ? 'A key is saved. Enter a new key to replace it.' : 'No key saved.'}
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder={placeholder}
                  style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', background: 'var(--panel-border)', border: '1px solid var(--panel-border)', color: 'var(--text-bright)', fontSize: '13px' }}
                />
                <button
                  onClick={() => void handleSaveAiKey(provider)}
                  disabled={!key.trim() || aiKeySaving === provider}
                  style={{ padding: '7px 14px', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: (!key.trim() || aiKeySaving === provider) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, opacity: (!key.trim() || aiKeySaving === provider) ? 0.5 : 1 }}
                >
                  Save
                </button>
                {aiKeyStatus[provider] && (
                  <button
                    onClick={() => void handleRemoveAiKey(provider)}
                    disabled={aiKeySaving === provider}
                    style={{ padding: '7px 14px', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: '6px', cursor: aiKeySaving === provider ? 'not-allowed' : 'pointer', fontSize: '13px', opacity: aiKeySaving === provider ? 0.5 : 1 }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {aiKeyMessage && (
          <p style={{ margin: '10px 0 0', fontSize: '13px', color: aiKeyMessage.includes('saved') || aiKeyMessage.includes('removed') ? 'var(--success)' : 'var(--danger)' }}>{aiKeyMessage}</p>
        )}
      </section>

      {/* Revoke */}
      {data?.connected && (
        <section style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '20px' }}>
          <h4 style={{ margin: '0 0 8px', color: 'var(--danger)', fontSize: '15px' }}>Disconnect Google Account</h4>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-soft)', lineHeight: 1.6 }}>
            This revokes all Google permissions and signs you out. Your Drive files and folders will <strong style={{ color: 'var(--text-bright)' }}>not</strong> be deleted — they remain in your Google Drive.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '10px' }}>{error}</p>}
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              style={{ padding: '10px 18px', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}
            >
              Disconnect & Revoke
            </button>
          ) : (
            <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: '8px', padding: '16px' }}>
              <p style={{ margin: '0 0 14px', fontSize: '14px', color: 'var(--danger)' }}>
                Are you sure? This will revoke all Google permissions and sign you out immediately.
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleRevoke}
                  disabled={revoking}
                  style={{ padding: '8px 16px', background: 'var(--danger)', color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: revoking ? 'not-allowed' : 'pointer', fontSize: '14px', opacity: revoking ? 0.6 : 1 }}
                >
                  {revoking ? 'Revoking…' : 'Yes, Disconnect'}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={revoking}
                  style={{ padding: '8px 16px', background: 'var(--action-bg)', color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
