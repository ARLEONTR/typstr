import { useEffect, useState, type CSSProperties } from 'react'
import { apiClient } from '../../api/client'
import type { BillingStatus, PlanLimits } from '../../types'

function formatPlan(plan: string): string {
  if (plan === 'personal') return 'researcher'
  return plan.replace(/_/g, ' ')
}

function formatLimit(value: number | null, suffix = ''): string {
  return value == null ? 'Unlimited' : `${value}${suffix}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function limitRows(limits: PlanLimits) {
  return [
    ['Active projects', formatLimit(limits.activeProjects)],
    ['Collaborators per project', formatLimit(limits.collaboratorsPerProject)],
    ['File storage per project', formatLimit(limits.fileStoragePerProjectMb, ' MB')],
    ['Total storage', formatLimit(limits.totalStorageMb, ' MB')],
    ['Compile timeout', formatLimit(limits.compileTimeoutSeconds, ' s')],
    ['Auto-compile debounce', `${limits.autoCompileDebounceMs} ms`],
    ['Compiles per day', formatLimit(limits.compilesPerDay)],
    ['Revision history', formatLimit(limits.revisionHistoryDays, ' days')],
    ['Export formats', limits.exportFormats.map((entry) => entry.toUpperCase()).join(', ')],
    ['Bibliography searches', formatLimit(limits.bibliographySearchesPerDay, '/day')],
    ['Custom fonts', limits.customFonts ? 'Yes' : 'No'],
    ['Typst package pins', formatLimit(limits.typstPackagePins)],
    ['Sharing presets', limits.sharingPresets ? formatLimit(limits.sharingPresetsCount) : 'No'],
    ['Team workspaces', limits.teamWorkspaces ? formatLimit(limits.teamWorkspaceCount) : 'No'],
    ['Team members', formatLimit(limits.teamMembers)],
    ['Track changes', limits.trackChanges ? 'Yes' : 'No'],
    ['Writing goals', limits.writingGoals ? 'Yes' : 'No'],
    ['Public publishing', limits.publicProjectPublishing ? 'Yes' : 'No'],
    ['Manager role', limits.managerRole ? 'Yes' : 'No'],
    ['Audit log export', limits.auditLogExportDays == null ? 'Unlimited' : limits.auditLogExportDays > 0 ? `${limits.auditLogExportDays} days` : 'No'],
    ['Admin console', limits.adminConsole ? 'Yes' : 'No'],
    ['Priority support', limits.prioritySupport ? 'Yes' : 'No'],
  ]
}

export function SubscriptionPanel() {
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const loadBilling = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const response = await apiClient.get<BillingStatus>('/api/billing/status')
      setBilling(response.data)
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not load subscription details.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBilling()
  }, [])

  if (loading) {
    return <p style={{ color: 'var(--muted-text)' }}>Loading subscription details...</p>
  }

  if (!billing) {
    return (
      <div>
        <p style={{ color: 'var(--danger)' }}>{message ?? 'Subscription details are unavailable.'}</p>
        <button type="button" onClick={() => void loadBilling()} style={buttonStyle}>Retry</button>
      </div>
    )
  }

  const totalLimitBytes = billing.limits.totalStorageMb == null ? null : billing.limits.totalStorageMb * 1024 * 1024
  const storageText = totalLimitBytes == null
    ? `${formatBytes(billing.usage.totalStorageBytes)} used`
    : `${formatBytes(billing.usage.totalStorageBytes)} / ${formatBytes(totalLimitBytes)}`

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <p style={eyebrowStyle}>Current plan</p>
            <h3 style={{ margin: '4px 0', textTransform: 'capitalize' }}>{formatPlan(billing.plan)}</h3>
            <p style={mutedStyle}>Status: {billing.status}</p>
          </div>
          <button type="button" onClick={() => void loadBilling()} style={buttonStyle}>Refresh</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 16 }}>
          <UsageTile label="Projects" value={`${billing.usage.activeProjects}/${formatLimit(billing.limits.activeProjects)}`} />
          <UsageTile label="Storage" value={storageText} />
          <UsageTile label="Compiles today" value={`${billing.usage.compilesToday}/${formatLimit(billing.limits.compilesPerDay)}`} />
          <UsageTile label="Scholar searches" value={`${billing.usage.bibliographySearchesToday}/${formatLimit(billing.limits.bibliographySearchesPerDay)}`} />
        </div>
      </section>

      <section style={cardStyle}>
        <p style={eyebrowStyle}>Verified domains</p>
        {billing.verifiedDomains.length === 0 ? (
          <p style={mutedStyle}>No academic or organization domains are verified yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {billing.verifiedDomains.map((entry) => (
              <div key={entry.email} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span>{entry.email}</span>
                <span style={mutedStyle}>{entry.domainType} · {entry.domain}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <p style={eyebrowStyle}>Plan limits</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {limitRows(billing.limits).map(([label, value]) => (
            <div key={label} style={limitRowStyle}>
              <span style={mutedStyle}>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function UsageTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={limitRowStyle}>
      <span style={mutedStyle}>{label}</span>
      <strong>{value}</strong>
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

const limitRowStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 10,
  borderRadius: 8,
  background: 'var(--action-bg)',
  color: 'var(--text-strong)',
}

const mutedStyle: CSSProperties = {
  margin: 0,
  color: 'var(--muted-text)',
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
