import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ProjectAccessRequest,
  ProjectInvitation,
  ProjectMember,
  ProjectRole,
  ProjectShareLink,
  ProjectSummary,
  SharingPreset,
} from '../../types'
import styles from './SharingPanel.module.css'

interface Props {
  visible: boolean
  variant?: 'sidebar' | 'popover'
  inSidebar?: boolean
  project: ProjectSummary
  projectRole: ProjectRole
  members: ProjectMember[]
  invitations: ProjectInvitation[]
  onClose: () => void
  onInvite: (email: string, role: Exclude<ProjectRole, 'owner'>) => Promise<void>
  onChangeMemberRole: (userId: string, role: Exclude<ProjectRole, 'owner'>) => Promise<void>
  onRevokeMember: (userId: string) => Promise<void>
  onRevokeInvitation: (invitationId: string) => Promise<void>
  onPublish: () => Promise<void>
  onUnpublish: () => Promise<void>
  onTransferOwnership: (toUserId: string) => Promise<void>
}

type Tab = 'members' | 'links' | 'requests' | 'presets' | 'publish'

const ROLE_OPTIONS: Array<{ value: Exclude<ProjectRole, 'owner'>; label: string }> = [
  { value: 'manager', label: 'Manager' },
  { value: 'editor', label: 'Writer' },
  { value: 'viewer', label: 'Reviewer' },
]

function roleLabel(role: ProjectRole): string {
  switch (role) {
    case 'owner': return 'Owner'
    case 'manager': return 'Manager'
    case 'editor': return 'Writer'
    case 'viewer': return 'Reviewer'
  }
}
export default function SharingPanel({
  visible,
  variant = 'sidebar',
  inSidebar = false,
  project,
  projectRole,
  members,
  invitations,
  onClose,
  onInvite,
  onChangeMemberRole,
  onRevokeMember,
  onRevokeInvitation,
  onPublish,
  onUnpublish,
  onTransferOwnership,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('members')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<ProjectRole, 'owner'>>('editor')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [links, setLinks] = useState<ProjectShareLink[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [linksError, setLinksError] = useState<string | null>(null)
  const [newLinkRole, setNewLinkRole] = useState<'viewer' | 'editor'>('viewer')
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkExpiresAt, setNewLinkExpiresAt] = useState('')
  const [newLinkMaxUses, setNewLinkMaxUses] = useState('')
  const [creatingLink, setCreatingLink] = useState(false)

  const [requests, setRequests] = useState<ProjectAccessRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [requestsError, setRequestsError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const [presets, setPresets] = useState<SharingPreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [presetName, setPresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const [applyingPresetId, setApplyingPresetId] = useState<string | null>(null)
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null)

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [transferEmail, setTransferEmail] = useState('')
  const [transferSubmitting, setTransferSubmitting] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)

  const canManage = projectRole === 'owner' || projectRole === 'manager'
  const canShare = canManage || projectRole === 'editor'
  const isOwner = projectRole === 'owner'

  const pendingInvitations = useMemo(() => invitations.filter((inv) => inv.status === 'pending'), [invitations])
  const invitationHistory = useMemo(() => invitations.filter((inv) => inv.status !== 'pending'), [invitations])
  const pendingRequests = useMemo(() => requests.filter((request) => request.status === 'pending'), [requests])

  const presetEntries = useMemo(() => {
    const entries = new Map<string, Exclude<ProjectRole, 'owner'>>()

    for (const member of members) {
      if (member.role !== 'owner') {
        entries.set(member.email.toLowerCase(), member.role)
      }
    }

    for (const invitation of pendingInvitations) {
      entries.set(invitation.email.toLowerCase(), invitation.role)
    }

    return Array.from(entries.entries()).map(([entryEmail, entryRole]) => ({
      email: entryEmail,
      role: entryRole,
    }))
  }, [members, pendingInvitations])

  const loadLinks = useCallback(async () => {
    if (!canShare) return
    setLinksLoading(true)
    setLinksError(null)
    try {
      const response = await fetch(`/api/share/${project.id}/links`, { credentials: 'include' })
      if (!response.ok) throw new Error(await response.text())
      setLinks(await response.json() as ProjectShareLink[])
    } catch (e) {
      setLinksError(e instanceof Error ? e.message : 'Failed to load links')
    } finally {
      setLinksLoading(false)
    }
  }, [project.id, canShare])

  const loadRequests = useCallback(async () => {
    if (!canShare) return
    setRequestsLoading(true)
    setRequestsError(null)
    try {
      const response = await fetch(`/api/share/${project.id}/access-requests`, { credentials: 'include' })
      if (!response.ok) throw new Error(await response.text())
      setRequests(await response.json() as ProjectAccessRequest[])
    } catch (e) {
      setRequestsError(e instanceof Error ? e.message : 'Failed to load requests')
    } finally {
      setRequestsLoading(false)
    }
  }, [project.id, canShare])

  const loadPresets = useCallback(async () => {
    if (!canManage) return
    setPresetsLoading(true)
    setPresetError(null)
    try {
      const response = await fetch('/api/share/presets', { credentials: 'include' })
      if (!response.ok) throw new Error(await response.text())
      setPresets(await response.json() as SharingPreset[])
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Failed to load sharing presets')
    } finally {
      setPresetsLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    if (!visible) return
    if (activeTab === 'links') void loadLinks()
    if (activeTab === 'requests') void loadRequests()
    if (activeTab === 'presets') void loadPresets()
  }, [visible, activeTab, loadLinks, loadPresets, loadRequests])

  useEffect(() => {
    if (!visible || activeTab !== 'requests') return
    const id = setInterval(() => { void loadRequests() }, 20_000)
    return () => clearInterval(id)
  }, [visible, activeTab, loadRequests])

  if (!visible) return null

  async function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onInvite(email.trim().toLowerCase(), role)
      setEmail('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateLink() {
    setCreatingLink(true)
    try {
      const response = await fetch(`/api/share/${project.id}/links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: newLinkRole,
          label: newLinkLabel || undefined,
          expiresAt: newLinkExpiresAt ? new Date(`${newLinkExpiresAt}T23:59:59`).getTime() : undefined,
          maxUses: newLinkMaxUses ? Number(newLinkMaxUses) : undefined,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      const link = await response.json() as ProjectShareLink
      setLinks((prev) => [link, ...prev])
      setNewLinkLabel('')
      setNewLinkExpiresAt('')
      setNewLinkMaxUses('')
    } catch (e) {
      setLinksError(e instanceof Error ? e.message : 'Failed to create link')
    } finally {
      setCreatingLink(false)
    }
  }

  async function handleRevokeLink(linkId: string) {
    try {
      await fetch(`/api/share/${project.id}/links/${linkId}`, { method: 'DELETE', credentials: 'include' })
      setLinks((prev) => prev.filter((link) => link.id !== linkId))
    } catch {
      // no-op
    }
  }

  function copyLink(token: string) {
    void navigator.clipboard.writeText(`${window.location.origin}/join/${token}`)
  }

  async function handleDecide(requestId: string, decision: 'approved' | 'denied') {
    setDecidingId(requestId)
    try {
      const response = await fetch(`/api/share/${project.id}/access-requests/${requestId}/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (!response.ok) throw new Error(await response.text())
      const updated = await response.json() as ProjectAccessRequest
      setRequests((prev) => prev.map((request) => request.id === requestId ? updated : request))
    } catch (e) {
      setRequestsError(e instanceof Error ? e.message : 'Failed to process request')
    } finally {
      setDecidingId(null)
    }
  }

  async function handlePublishToggle() {
    setPublishing(true)
    setPublishError(null)
    try {
      if (project.publishedAt) {
        await onUnpublish()
      } else {
        await onPublish()
      }
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Failed to update publish state')
    } finally {
      setPublishing(false)
    }
  }

  async function handleTransfer(event: React.FormEvent) {
    event.preventDefault()
    if (!transferEmail.trim()) return
    const target = members.find((member) => member.email.toLowerCase() === transferEmail.trim().toLowerCase())
    if (!target) {
      setTransferError('User must be a current project member.')
      return
    }

    setTransferSubmitting(true)
    setTransferError(null)
    try {
      await onTransferOwnership(target.userId)
      setTransferEmail('')
    } catch (err: unknown) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed.')
    } finally {
      setTransferSubmitting(false)
    }
  }

  async function handleSavePreset() {
    if (!presetName.trim()) {
      setPresetError('Preset name is required.')
      return
    }

    if (presetEntries.length === 0) {
      setPresetError('Add members or pending invitations before saving a sharing preset.')
      return
    }

    setSavingPreset(true)
    setPresetError(null)
    try {
      const response = await fetch('/api/share/presets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: presetName.trim(), entries: presetEntries }),
      })
      if (!response.ok) throw new Error(await response.text())
      const preset = await response.json() as SharingPreset
      setPresets((current) => [preset, ...current])
      setPresetName('')
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Failed to save sharing preset')
    } finally {
      setSavingPreset(false)
    }
  }

  async function handleApplyPreset(preset: SharingPreset) {
    setApplyingPresetId(preset.id)
    setPresetError(null)
    try {
      for (const entry of preset.entries) {
        if (entry.role === 'owner') {
          continue
        }
        await onInvite(entry.email, entry.role as Exclude<ProjectRole, 'owner'>)
      }
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Failed to apply sharing preset')
    } finally {
      setApplyingPresetId(null)
    }
  }

  async function handleDeletePreset(presetId: string) {
    setDeletingPresetId(presetId)
    setPresetError(null)
    try {
      const response = await fetch(`/api/share/presets/${presetId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw new Error(await response.text())
      setPresets((current) => current.filter((preset) => preset.id !== presetId))
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Failed to delete sharing preset')
    } finally {
      setDeletingPresetId(null)
    }
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'members', label: 'Members' },
    { key: 'links', label: 'Share Links' },
    { key: 'requests', label: 'Requests', badge: pendingRequests.length || undefined },
    { key: 'presets', label: 'Presets' },
    { key: 'publish', label: 'Publish' },
  ]

  return (
    <aside className={[styles.panel, variant === 'popover' ? styles.popoverPanel : ''].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Sharing</p>
         
        </div>
        {!inSidebar && <button className={styles.closeBtn} onClick={onClose}>Close</button>}
      </div>

      <div className={styles.accessSummary}>
        <span className={styles.statusBadge}>{project.teamName ? `Workspace: ${project.teamName}` : 'Personal workspace'}</span>
        <span className={styles.statusBadge}>{roleLabel(projectRole)}</span>
        {project.publishedAt ? <span className={styles.statusBadge}>Published</span> : null}
      </div>

      <div className={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={[styles.tabBtn, activeTab === tab.key ? styles.tabBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.badge ? <span className={styles.tabBadge}>{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === 'members' && (
        <>
          {canShare ? (
            <form className={styles.inviteForm} onSubmit={(event) => void handleInviteSubmit(event)}>
              <label className={styles.field}>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="collaborator@example.com"
                />
              </label>
              <label className={styles.field}>
                <span>Role</span>
                <select value={role} onChange={(event) => setRole(event.target.value as Exclude<ProjectRole, 'owner'>)}>
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button className={styles.inviteBtn} type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send Invitation'}
              </button>
              {error ? <p className={styles.error}>{error}</p> : null}
            </form>
          ) : null}

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h3>Members</h3></div>
            <ul className={styles.list}>
              {members.map((member) => (
                <li key={member.userId} className={styles.listItem}>
                  <div className={styles.meta}>
                    <strong>{member.name}</strong>
                    <span>{member.email}</span>
                  </div>
                  <div className={styles.actions}>
                    {canManage && member.role !== 'owner' ? (
                      <>
                        <select
                          className={styles.roleSelect}
                          value={member.role}
                          onChange={(event) => void onChangeMemberRole(member.userId, event.target.value as Exclude<ProjectRole, 'owner'>)}
                        >
                          {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <button className={styles.revokeBtn} onClick={() => void onRevokeMember(member.userId)}>
                          Revoke
                        </button>
                      </>
                    ) : (
                      <span className={styles.statusBadge}>{roleLabel(member.role)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h3>Pending Invitations</h3></div>
            {pendingInvitations.length === 0 ? (
              <p className={styles.empty}>No pending invitations.</p>
            ) : (
              <ul className={styles.list}>
                {pendingInvitations.map((invitation) => (
                  <li key={invitation.id} className={styles.listItem}>
                    <div className={styles.meta}>
                      <strong>{invitation.email}</strong>
                      <span>{roleLabel(invitation.role)} · invited by {invitation.invitedByName}</span>
                    </div>
                    <div className={styles.actions}>
                      <span className={styles.statusBadge}>Pending</span>
                      {canShare ? (
                        <button className={styles.revokeBtn} onClick={() => void onRevokeInvitation(invitation.id)}>
                          Revoke
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h3>Invitation History</h3></div>
            {invitationHistory.length === 0 ? (
              <p className={styles.empty}>Accepted, rejected, and revoked invitations will appear here.</p>
            ) : (
              <ul className={styles.list}>
                {invitationHistory.map((invitation) => (
                  <li key={invitation.id} className={styles.listItem}>
                    <div className={styles.meta}>
                      <strong>{invitation.email}</strong>
                      <span>{roleLabel(invitation.role)} · invited by {invitation.invitedByName}</span>
                      {invitation.respondedByEmail && invitation.respondedByEmail.toLowerCase() !== invitation.email.toLowerCase() ? (
                        <span>Accepted with Google account {invitation.respondedByEmail}</span>
                      ) : null}
                      <span>{new Date(invitation.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className={styles.actions}>
                      <span className={[styles.statusBadge, invitation.status === 'accepted' ? styles.approved : styles.denied].join(' ')}>
                        {invitation.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {activeTab === 'links' && (
        <div className={styles.tabContent}>
          {!canShare ? (
            <p className={styles.empty}>Only owners, managers, and editors can manage share links.</p>
          ) : (
            <>
              <div className={styles.createLinkForm}>
                <div className={styles.createLinkRow}>
                  <input
                    className={styles.linkLabelInput}
                    type="text"
                    placeholder="Label (optional)"
                    value={newLinkLabel}
                    onChange={(event) => setNewLinkLabel(event.target.value)}
                    maxLength={100}
                  />
                  <select
                    className={styles.linkRoleSelect}
                    value={newLinkRole}
                    onChange={(event) => setNewLinkRole(event.target.value as 'viewer' | 'editor')}
                  >
                    <option value="viewer">Reviewer</option>
                    <option value="editor">Writer</option>
                  </select>
                  <button className={styles.createLinkBtn} onClick={() => void handleCreateLink()} disabled={creatingLink}>
                    {creatingLink ? '…' : 'Create'}
                  </button>
                </div>
                <div className={styles.createLinkRow}>
                  <label className={styles.linkOptionField}>
                    <span>Expires</span>
                    <input
                      className={styles.linkDateInput}
                      type="date"
                      value={newLinkExpiresAt}
                      onChange={(event) => setNewLinkExpiresAt(event.target.value)}
                    />
                  </label>
                  <label className={styles.linkOptionField}>
                    <span>Max uses</span>
                    <input
                      className={styles.linkMaxUsesInput}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      placeholder="Unlimited"
                      value={newLinkMaxUses}
                      onChange={(event) => setNewLinkMaxUses(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              {linksError ? <p className={styles.error}>{linksError}</p> : null}

              {linksLoading ? (
                <p className={styles.empty}>Loading…</p>
              ) : links.length === 0 ? (
                <p className={styles.empty}>No share links yet. Create one above.</p>
              ) : (
                <ul className={styles.list}>
                  {links.map((link) => (
                    <li key={link.id} className={styles.listItem}>
                      <div className={styles.meta}>
                        <strong>{link.label ?? `${roleLabel(link.role)} link`}</strong>
                        <span>
                          {roleLabel(link.role)} · used {link.useCount} time{link.useCount !== 1 ? 's' : ''}
                          {link.maxUses ? ` / ${link.maxUses}` : ''}
                          {link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}` : ''}
                        </span>
                      </div>
                      <div className={styles.actions}>
                        <button className={styles.copyBtn} onClick={() => copyLink(link.token)}>Copy</button>
                        <button className={styles.revokeBtn} onClick={() => void handleRevokeLink(link.id)}>Revoke</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'requests' && (
        <div className={styles.tabContent}>
          {!canShare ? (
            <p className={styles.empty}>Only owners, managers, and editors can review access requests.</p>
          ) : requestsLoading ? (
            <p className={styles.empty}>Loading…</p>
          ) : requestsError ? (
            <p className={styles.error}>{requestsError}</p>
          ) : requests.length === 0 ? (
            <p className={styles.empty}>No access requests.</p>
          ) : (
            <ul className={styles.list}>
              {requests.map((request) => (
                <li key={request.id} className={[styles.listItem, styles.requestItem].join(' ')}>
                  <div className={styles.meta}>
                    <strong>{request.requesterName}</strong>
                    <span>{request.requesterEmail} · requested {roleLabel(request.requestedRole)} access</span>
                    {request.message ? <span className={styles.requestMessage}>{request.message}</span> : null}
                  </div>
                  <div className={styles.actions}>
                    {request.status === 'pending' ? (
                      <>
                        <button
                          className={styles.approveBtn}
                          onClick={() => void handleDecide(request.id, 'approved')}
                          disabled={decidingId === request.id}
                        >
                          Approve
                        </button>
                        <button
                          className={styles.revokeBtn}
                          onClick={() => void handleDecide(request.id, 'denied')}
                          disabled={decidingId === request.id}
                        >
                          Deny
                        </button>
                      </>
                    ) : (
                      <span className={[styles.statusBadge, request.status === 'approved' ? styles.approved : styles.denied].join(' ')}>
                        {request.status === 'approved' ? 'Approved' : 'Denied'}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'presets' && (
        <div className={styles.tabContent}>
          {!canManage ? (
            <p className={styles.empty}>Only owners and managers can manage sharing presets.</p>
          ) : (
            <>
              <section className={styles.section}>
                <div className={styles.sectionHeader}><h3>Save Current Team</h3></div>
                <p className={styles.helperText}>
                  Capture the current non-owner members and pending invitations so you can reuse them across projects.
                </p>
                <div className={styles.presetForm}>
                  <input
                    className={styles.transferInput}
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    placeholder="Preset name"
                    maxLength={255}
                  />
                  <button className={styles.inviteBtn} onClick={() => void handleSavePreset()} disabled={savingPreset}>
                    {savingPreset ? 'Saving…' : 'Save preset'}
                  </button>
                </div>
                <p className={styles.helperText}>{presetEntries.length} collaborator slot{presetEntries.length === 1 ? '' : 's'} ready to save.</p>
                {presetError ? <p className={styles.error}>{presetError}</p> : null}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}><h3>Reusable Presets</h3></div>
                {presetsLoading ? (
                  <p className={styles.empty}>Loading…</p>
                ) : presets.length === 0 ? (
                  <p className={styles.empty}>No sharing presets saved yet.</p>
                ) : (
                  <ul className={styles.list}>
                    {presets.map((preset) => (
                      <li key={preset.id} className={[styles.listItem, styles.requestItem].join(' ')}>
                        <div className={styles.meta}>
                          <strong>{preset.name}</strong>
                          <span>{preset.entries.length} collaborator slot{preset.entries.length === 1 ? '' : 's'}</span>
                          <span>{preset.entries.map((entry) => `${entry.email} (${entry.role})`).join(', ')}</span>
                        </div>
                        <div className={styles.actions}>
                          <button
                            className={styles.approveBtn}
                            onClick={() => void handleApplyPreset(preset)}
                            disabled={applyingPresetId === preset.id}
                          >
                            {applyingPresetId === preset.id ? 'Applying…' : 'Apply'}
                          </button>
                          <button
                            className={styles.revokeBtn}
                            onClick={() => void handleDeletePreset(preset.id)}
                            disabled={deletingPresetId === preset.id}
                          >
                            {deletingPresetId === preset.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {activeTab === 'publish' && (
        <div className={styles.tabContent}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}><h3>Public Access</h3></div>
            <p className={styles.publishDesc}>
              When published, anyone with the link can view a read-only version of this project.
            </p>
            {project.publishedAt ? (
              <div className={styles.publishedState}>
                <span className={styles.publishedBadge}>Published</span>
                <span className={styles.publishedDate}>since {new Date(project.publishedAt).toLocaleDateString()}</span>
                <button
                  className={styles.shareUrl}
                  onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/view/${project.id}`)}
                >
                  Copy public link
                </button>
              </div>
            ) : (
              <p className={styles.empty}>This project is private.</p>
            )}
            {isOwner ? (
              <>
                <button
                  className={project.publishedAt ? styles.revokeBtn : styles.inviteBtn}
                  onClick={() => void handlePublishToggle()}
                  disabled={publishing}
                >
                  {publishing ? '…' : project.publishedAt ? 'Unpublish' : 'Publish'}
                </button>
                {publishError ? <p className={styles.error}>{publishError}</p> : null}
              </>
            ) : null}
          </section>

          {isOwner ? (
            <section className={styles.section}>
              <div className={styles.sectionHeader}><h3>Transfer Ownership</h3></div>
              <p className={styles.publishDesc}>
                Transfer ownership to another project member. You will become an editor.
              </p>
              <form className={styles.transferForm} onSubmit={(event) => void handleTransfer(event)}>
                <input
                  className={styles.transferInput}
                  type="email"
                  placeholder="Member email"
                  value={transferEmail}
                  onChange={(event) => setTransferEmail(event.target.value)}
                />
                <button className={styles.revokeBtn} type="submit" disabled={transferSubmitting}>
                  {transferSubmitting ? '…' : 'Transfer'}
                </button>
              </form>
              {transferError ? <p className={styles.error}>{transferError}</p> : null}
            </section>
          ) : null}
        </div>
      )}
    </aside>
  )
}
