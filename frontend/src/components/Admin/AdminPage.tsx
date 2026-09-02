import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../api/client'
import { useAuth } from '../../hooks/useAuth'
import type {
  AdminAccessRecord,
  AdminActivityRecord,
  AdminContainerLogsResponse,
  AdminContainerLogService,
  AdminContainerLogServicesResponse,
  AdminDiagnostics,
  AdminOverview,
  AdminProjectRecord,
  AdminSubscriptionRecord,
  AdminTeamRecord,
  AdminUserRecord,
  BackgroundJobRecord,
  DomainPlanRule,
  ErrorEvent,
  PlanLimits,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../types'
import styles from './AdminPage.module.css'
import docStyles from '../DocumentList/DocumentList.module.css'

type AdminTab = 'overview' | 'users' | 'subscriptions' | 'projects' | 'teams' | 'access' | 'jobs' | 'errors' | 'activity' | 'maintenance' | 'feedback' | 'domain-rules'

type ConfirmAction =
  | { kind: 'delete-project'; id: string; label: string }
  | { kind: 'disable-user'; id: string; label: string; enable: boolean }
  | { kind: 'revoke-user-credentials'; id: string; label: string }
  | { kind: 'retry-job'; id: string }
  | { kind: 'cancel-job'; id: string }
  | { kind: 'cancel-all-jobs' }
  | { kind: 'clear-errors' }
  | { kind: 'clear-activity'; before: number; label: string }
  | { kind: 'revoke-project-member'; projectId: string; userId: string; label: string }
  | { kind: 'revoke-project-invitation'; invitationId: string; label: string }
  | { kind: 'revoke-share-link'; linkId: string; projectId: string; label: string }
  | { kind: 'deny-access-request'; requestId: string; projectId: string; label: string }
  | { kind: 'revoke-team-member'; teamId: string; userId: string; label: string }

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'projects', label: 'Projects' },
  { id: 'teams', label: 'Teams' },
  { id: 'access', label: 'Access' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'errors', label: 'Errors' },
  { id: 'activity', label: 'Activity' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'domain-rules', label: 'Domain Rules' },
  { id: 'maintenance', label: 'Maintenance' },
]

import {
  Home,
  Plus,
  Users as UsersLucide,
  Trash2,
  Settings as SettingsLucide,
  LogOut,
  Shield,
} from '../../icons'

const NAV_ICON_SIZE = 18
const SUBSCRIPTION_PLANS: SubscriptionPlan[] = ['free', 'student_freemium', 'personal', 'team', 'business', 'institution', 'research_enterprise']
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'cancelled', 'expired']

function HomeIcon() { return <Home size={NAV_ICON_SIZE} aria-hidden /> }
function PlusIcon() { return <Plus size={NAV_ICON_SIZE} aria-hidden /> }
function UsersIcon() { return <UsersLucide size={NAV_ICON_SIZE} aria-hidden /> }
function TrashIcon() { return <Trash2 size={NAV_ICON_SIZE} aria-hidden /> }
function SettingsIcon() { return <SettingsLucide size={NAV_ICON_SIZE} aria-hidden /> }
function LogOutIcon() { return <LogOut size={NAV_ICON_SIZE} aria-hidden /> }
function ShieldIcon() { return <Shield size={NAV_ICON_SIZE} aria-hidden /> }

function formatPlanLabel(plan: string) {
  if (plan === 'personal') return 'researcher'
  return plan.replace(/_/g, ' ')
}

type FeedbackReply = {
  id: string
  message: string
  created_at: number
  author_name: string
  author_email: string
  is_admin_reply: boolean
}

function FeedbackRow({ feedback, onSave }: { feedback: any; onSave: (id: string, status: string, response: string) => Promise<void> }) {
  const [status, setStatus] = useState(feedback.status || 'pending');
  const [adminResponse, setAdminResponse] = useState(feedback.admin_response || '');
  const [saving, setSaving] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [replies, setReplies] = useState<FeedbackReply[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'in-progress': return styles.badgeWarn;
      case 'addressed': return styles.badgeOk;
      default: return styles.badgeNeutral;
    }
  };

  const loadReplies = async () => {
    try {
      const res = await apiClient.get<FeedbackReply[]>(`/api/admin/feedback/${feedback.id}/replies`);
      setReplies(res.data);
      setRepliesLoaded(true);
    } catch (err) {
      console.error('Failed to load replies', err);
    }
  };

  const toggleThread = async () => {
    const next = !threadOpen;
    setThreadOpen(next);
    if (next && !repliesLoaded) {
      await loadReplies();
    }
  };

  const sendReply = async () => {
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    setReplying(true);
    try {
      await apiClient.post(`/api/admin/feedback/${feedback.id}/replies`, { message: trimmed });
      setReplyDraft('');
      await loadReplies();
    } catch (err) {
      console.error('Failed to send reply', err);
      alert('Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  return (
    <>
      <tr>
        <td>{feedback.user_name}<br /><span className={styles.dimText}>{feedback.user_email}</span></td>
        <td>{feedback.message}</td>
        <td>
          <span className={getStatusBadge(status)}>{status}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginLeft: '8px' }}>
            <option value="pending">Pending</option>
            <option value="in-progress">In-Progress</option>
            <option value="addressed">Addressed</option>
          </select>
        </td>
        <td>
          <textarea
            value={adminResponse}
            onChange={(e) => setAdminResponse(e.target.value)}
            placeholder="Pinned resolution summary..."
            title="This text is pinned on the user's view as the official resolution. For discussion, use the thread below."
            style={{ width: '100%', minHeight: '60px', padding: '4px', background: 'var(--editor-bg)', color: 'var(--text-bright)', border: '1px solid var(--panel-border)' }}
          />
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button
            className={styles.primaryBtnSmall}
            onClick={async () => {
              setSaving(true);
              await onSave(feedback.id, status, adminResponse);
              setSaving(false);
            }}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className={styles.primaryBtnSmall}
            onClick={() => void toggleThread()}
            style={{ marginLeft: 6 }}
            title={threadOpen ? 'Hide discussion thread' : 'Open discussion thread'}
          >
            {threadOpen ? 'Hide thread' : 'Thread'}
          </button>
        </td>
      </tr>
      {threadOpen ? (
        <tr>
          <td colSpan={5} style={{ background: 'var(--editor-bg)', padding: '14px 18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {replies.length === 0 ? (
                <div className={styles.dimText}>No discussion messages yet.</div>
              ) : (
                replies.map((reply) => (
                  <div
                    key={reply.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: reply.is_admin_reply ? 'var(--active-bg)' : 'var(--card-bg)',
                      borderLeft: `3px solid ${reply.is_admin_reply ? 'var(--accent)' : 'var(--panel-border)'}`,
                    }}
                  >
                    <div style={{ fontSize: 11, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {reply.is_admin_reply ? (
                        <span
                          style={{ padding: '1px 6px', borderRadius: 3, background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}
                        >
                          TEAM
                        </span>
                      ) : null}
                      <strong>{reply.author_name}</strong>
                      <span className={styles.dimText}>· {new Date(Number(reply.created_at)).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 13 }}>{reply.message}</div>
                  </div>
                ))
              )}
              <div>
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Reply to this thread as the team..."
                  rows={2}
                  style={{ width: '100%', padding: 8, background: 'var(--editor-bg)', color: 'var(--text-bright)', border: '1px solid var(--panel-border)', borderRadius: 6 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    className={styles.primaryBtnSmall}
                    onClick={() => void sendReply()}
                    disabled={replying || !replyDraft.trim()}
                  >
                    {replying ? 'Sending...' : 'Post reply'}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SubscriptionAdminRow({
  subscription,
  onChanged,
  onMessage,
}: {
  subscription: AdminSubscriptionRecord
  onChanged: () => void
  onMessage: (message: string | null) => void
}) {
  const [plan, setPlan] = useState<SubscriptionPlan>(subscription.plan)
  const [status, setStatus] = useState<SubscriptionStatus>(subscription.status)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPlan(subscription.plan)
    setStatus(subscription.status)
  }, [subscription.plan, subscription.status])

  const save = async () => {
    setSaving(true)
    try {
      await apiClient.patch(`/api/admin/subscriptions/${subscription.id}`, {
        plan,
        status,
        renewalMode: subscription.renewalMode || 'admin_manual',
      })
      onMessage('Subscription updated.')
      onChanged()
    } catch (error: any) {
      onMessage(error?.response?.data?.error ?? 'Failed to update subscription.')
    } finally {
      setSaving(false)
    }
  }

  const cancel = async () => {
    setSaving(true)
    try {
      await apiClient.post(`/api/admin/subscriptions/${subscription.id}/cancel`)
      onMessage('Subscription cancelled.')
      onChanged()
    } catch (error: any) {
      onMessage(error?.response?.data?.error ?? 'Failed to cancel subscription.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td>
        {subscription.userName ?? subscription.teamName ?? 'Unknown'}
        <br />
        <span className={styles.dimText}>{subscription.userEmail ?? subscription.teamName ?? subscription.id}</span>
      </td>
      <td>
        <select className={styles.inlineSelect} value={plan} onChange={(event) => setPlan(event.target.value as SubscriptionPlan)} disabled={saving}>
          {SUBSCRIPTION_PLANS.map((entry) => <option key={entry} value={entry}>{formatPlanLabel(entry)}</option>)}
        </select>
      </td>
      <td>
        <select className={styles.inlineSelect} value={status} onChange={(event) => setStatus(event.target.value as SubscriptionStatus)} disabled={saving}>
          {SUBSCRIPTION_STATUSES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
      </td>
      <td>
        {subscription.periodStart ? formatDateTime(subscription.periodStart) : 'No start'}
        <br />
        <span className={styles.dimText}>{subscription.periodEnd ? `Ends ${formatDateTime(subscription.periodEnd)}` : 'No period end'}</span>
      </td>
      <td>
        {subscription.paymentProvider ?? 'manual'}
        <br />
        <span className={styles.dimText}>{subscription.providerReference ?? subscription.renewalMode}</span>
      </td>
      <td>{subscription.paidTransactionCount}/{subscription.transactionCount} paid</td>
      <td>{formatDateTime(subscription.updatedAt)}</td>
      <td className={styles.actionCell}>
        <button className={styles.actionBtn} onClick={() => void save()} disabled={saving || (plan === subscription.plan && status === subscription.status)}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className={styles.dangerBtnSmall} onClick={() => void cancel()} disabled={saving || subscription.status === 'cancelled'} style={{ marginLeft: 8 }}>
          Cancel
        </button>
      </td>
    </tr>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const openProfileSettings = () => navigate('/?settings=profile')
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')

  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [diagnostics, setDiagnostics] = useState<AdminDiagnostics | null>(null)
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionRecord[]>([])
  const [projects, setProjects] = useState<AdminProjectRecord[]>([])
  const [teams, setTeams] = useState<AdminTeamRecord[]>([])
  const [accessRecords, setAccessRecords] = useState<AdminAccessRecord[]>([])
  const [jobs, setJobs] = useState<BackgroundJobRecord[]>([])
  const [errors, setErrors] = useState<ErrorEvent[]>([])
  const [activity, setActivity] = useState<AdminActivityRecord[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [backupState, setBackupState] = useState<'idle' | 'running'>('idle')
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [containerServices, setContainerServices] = useState<AdminContainerLogService[]>([])
  const [dockerAccessible, setDockerAccessible] = useState(false)
  const [selectedContainerService, setSelectedContainerService] = useState('backend')
  const [containerLogTail, setContainerLogTail] = useState('200')
  const [containerLogs, setContainerLogs] = useState('')
  const [containerLogsCheckedAt, setContainerLogsCheckedAt] = useState<number | null>(null)
  const [containerLogsState, setContainerLogsState] = useState<'idle' | 'loading'>('idle')
  const [containerLogsError, setContainerLogsError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadAdminData(true, active)
    return () => { active = false }
  }, [])

  async function handleUpdateFeedback(id: string, status: string, adminResponse: string) {
    try {
      await apiClient.patch(`/api/admin/feedback/${id}`, { status, adminResponse })
      setFeedback((prev) => prev.map((f) => f.id === id ? { ...f, status, admin_response: adminResponse } : f))
    } catch (err) {
      alert('Failed to update feedback')
    }
  }

  async function loadAdminData(initial = false, active = true) {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const results = await Promise.allSettled([
        apiClient.get<AdminOverview>('/api/admin/overview'),
        apiClient.get<AdminUserRecord[]>('/api/admin/users'),
        apiClient.get<AdminSubscriptionRecord[]>('/api/admin/subscriptions'),
        apiClient.get<AdminProjectRecord[]>('/api/admin/projects'),
        apiClient.get<AdminTeamRecord[]>('/api/admin/teams'),
        apiClient.get<AdminAccessRecord[]>('/api/admin/access'),
        apiClient.get<BackgroundJobRecord[]>('/api/admin/jobs'),
        apiClient.get<ErrorEvent[]>('/api/admin/errors'),
        apiClient.get<AdminActivityRecord[]>('/api/admin/activity'),
        apiClient.get<any[]>('/api/admin/feedback'),
        apiClient.get<AdminContainerLogServicesResponse>('/api/admin/container-logs/services'),
      ])

      if (!active) return

      const getRes = <T,>(idx: number): T | null => {
        const res = results[idx]
        return res.status === 'fulfilled' ? (res.value.data as T) : null
      }

      const ov = getRes<AdminOverview>(0)
      if (ov) {
        setOverview(ov)
        setDiagnostics(ov.diagnostics)
      }
      
      const u = getRes<AdminUserRecord[]>(1); if (u) setUsers(u)
      const s = getRes<AdminSubscriptionRecord[]>(2); if (s) setSubscriptions(s)
      const p = getRes<AdminProjectRecord[]>(3); if (p) setProjects(p)
      const t = getRes<AdminTeamRecord[]>(4); if (t) setTeams(t)
      const access = getRes<AdminAccessRecord[]>(5); if (access) setAccessRecords(access)
      const j = getRes<BackgroundJobRecord[]>(6); if (j) setJobs(j)
      const e = getRes<ErrorEvent[]>(7); if (e) setErrors(e)
      const a = getRes<AdminActivityRecord[]>(8); if (a) setActivity(a)
      const f = getRes<any[]>(9); if (f) setFeedback(f)
      const containerLogServices = getRes<AdminContainerLogServicesResponse>(10)
      if (containerLogServices) {
        setDockerAccessible(containerLogServices.dockerAccessible)
        setContainerServices(containerLogServices.services)
        setSelectedContainerService((current) => current || containerLogServices.services[0]?.service || 'backend')
      }

    } catch (err) {
      if (!active) return
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? 'Failed to load admin data.') : 'Failed to load admin data.')
    } finally {
      if (active) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  async function handleBackup() {
    setBackupState('running')
    setBackupMessage(null)
    try {
      const res = await apiClient.post<{ filePath: string }>('/api/admin/backup')
      setBackupMessage(`Backup created: ${res.data.filePath}`)
    } catch (err) {
      setBackupMessage(axios.isAxiosError(err) ? (err.response?.data?.error ?? 'Backup failed.') : 'Backup failed.')
    } finally {
      setBackupState('idle')
    }
  }

  async function handleLoadContainerLogs() {
    setContainerLogsState('loading')
    setContainerLogsError(null)
    try {
      const parsedTail = Number.parseInt(containerLogTail, 10)
      const tail = Number.isFinite(parsedTail) ? Math.max(1, Math.min(2000, parsedTail)) : 200
      const res = await apiClient.get<AdminContainerLogsResponse>('/api/admin/container-logs', {
        params: { service: selectedContainerService, tail },
      })
      setContainerLogs(res.data.logs)
      setContainerLogsCheckedAt(res.data.checkedAt)
      setContainerLogTail(String(res.data.tail))
    } catch (err) {
      setContainerLogsError(axios.isAxiosError(err) ? (err.response?.data?.error ?? 'Failed to load container logs.') : 'Failed to load container logs.')
    } finally {
      setContainerLogsState('idle')
    }
  }

  async function executeConfirm() {
    if (!confirmAction || actionPending) return
    setActionPending(true)
    setActionMessage(null)
    try {
      if (confirmAction.kind === 'delete-project') {
        await apiClient.delete(`/api/admin/projects/${confirmAction.id}`)
        setProjects((prev) => prev.filter((p) => p.id !== confirmAction.id))
        setActionMessage(`Project deleted.`)
      } else if (confirmAction.kind === 'disable-user') {
        await apiClient.patch(`/api/admin/users/${confirmAction.id}/disable`, { enable: confirmAction.enable })
        setUsers((prev) => prev.map((u) => u.id === confirmAction.id ? { ...u, disabledAt: confirmAction.enable ? null : Date.now() } : u))
        setActionMessage(confirmAction.enable ? `User re-enabled.` : `User disabled.`)
      } else if (confirmAction.kind === 'revoke-user-credentials') {
        const res = await apiClient.post<{ sessionsRevoked: number }>(`/api/admin/users/${confirmAction.id}/revoke-credentials`)
        setUsers((prev) => prev.map((u) => u.id === confirmAction.id ? { ...u, driveRootFolderId: null, updatedAt: Date.now() } : u))
        setActionMessage(`Stored credentials revoked. ${res.data.sessionsRevoked} active session${res.data.sessionsRevoked === 1 ? '' : 's'} cleared.`)
      } else if (confirmAction.kind === 'retry-job') {
        await apiClient.post(`/api/admin/jobs/${confirmAction.id}/retry`)
        void loadAdminData()
        setActionMessage(`Job queued for retry.`)
      } else if (confirmAction.kind === 'cancel-job') {
        await apiClient.post(`/api/admin/jobs/${confirmAction.id}/cancel`)
        void loadAdminData()
        setActionMessage(`Job cancelled.`)
      } else if (confirmAction.kind === 'cancel-all-jobs') {
        const res = await apiClient.post<{ count: number }>('/api/admin/jobs/cancel-all-queued')
        void loadAdminData()
        setActionMessage(`${res.data.count} queued jobs cancelled.`)
      } else if (confirmAction.kind === 'clear-errors') {
        await apiClient.delete('/api/admin/errors')
        setErrors([])
        setActionMessage(`All error events cleared.`)
      } else if (confirmAction.kind === 'clear-activity') {
        await apiClient.delete(`/api/admin/activity?before=${confirmAction.before}`)
        void loadAdminData()
        setActionMessage(`Activity events cleared.`)
      } else if (confirmAction.kind === 'revoke-project-member') {
        await apiClient.delete(`/api/admin/access/project-members?projectId=${encodeURIComponent(confirmAction.projectId)}&userId=${encodeURIComponent(confirmAction.userId)}`)
        setAccessRecords((prev) => prev.filter((record) => record.id !== `project-member:${confirmAction.projectId}:${confirmAction.userId}`))
        setActionMessage('Project member revoked.')
      } else if (confirmAction.kind === 'revoke-project-invitation') {
        await apiClient.delete(`/api/admin/access/project-invitations/${confirmAction.invitationId}`)
        setAccessRecords((prev) => prev.map((record) => record.id === `project-invitation:${confirmAction.invitationId}` ? { ...record, status: 'revoked', updatedAt: Date.now() } : record))
        setActionMessage('Invitation revoked.')
      } else if (confirmAction.kind === 'revoke-share-link') {
        await apiClient.delete(`/api/admin/access/share-links/${confirmAction.linkId}?projectId=${encodeURIComponent(confirmAction.projectId)}`)
        setAccessRecords((prev) => prev.map((record) => record.id === `share-link:${confirmAction.linkId}` ? { ...record, status: 'inactive', updatedAt: Date.now() } : record))
        setActionMessage('Share link revoked.')
      } else if (confirmAction.kind === 'deny-access-request') {
        await apiClient.post(`/api/admin/access/access-requests/${confirmAction.requestId}/deny`, { projectId: confirmAction.projectId })
        setAccessRecords((prev) => prev.map((record) => record.id === `access-request:${confirmAction.requestId}` ? { ...record, status: 'denied', updatedAt: Date.now() } : record))
        setActionMessage('Access request denied.')
      } else if (confirmAction.kind === 'revoke-team-member') {
        await apiClient.delete(`/api/admin/access/team-members?teamId=${encodeURIComponent(confirmAction.teamId)}&userId=${encodeURIComponent(confirmAction.userId)}`)
        setAccessRecords((prev) => prev.filter((record) => record.id !== `team-member:${confirmAction.teamId}:${confirmAction.userId}`))
        setActionMessage('Team member revoked.')
      }
      setConfirmAction(null)
    } catch (err) {
      setActionMessage(axios.isAxiosError(err) ? (err.response?.data?.error ?? 'Action failed.') : 'Action failed.')
    } finally {
      setActionPending(false)
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? users.filter((u) => [u.name, u.email, u.id, u.subscriptionPlan ?? '', u.subscriptionStatus ?? ''].some((v) => v.toLowerCase().includes(q))) : users
  }, [query, users])

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? projects.filter((p) => [p.title, p.ownerName, p.ownerEmail, p.teamName ?? '', p.id].some((v) => v.toLowerCase().includes(q))) : projects
  }, [projects, query])

  const filteredSubscriptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? subscriptions.filter((s) => [
      s.id,
      s.userName ?? '',
      s.userEmail ?? '',
      s.teamName ?? '',
      s.plan,
      s.status,
      s.paymentProvider ?? '',
      s.providerReference ?? '',
    ].some((v) => v.toLowerCase().includes(q))) : subscriptions
  }, [query, subscriptions])

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? teams.filter((t) => [t.name, t.ownerName, t.ownerEmail, t.id].some((v) => v.toLowerCase().includes(q))) : teams
  }, [query, teams])

  const filteredAccessRecords = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? accessRecords.filter((record) => [record.label, record.kind, record.projectTitle ?? '', record.teamName ?? '', record.subjectName ?? '', record.subjectEmail ?? '', record.role ?? '', record.status ?? '', record.invitedByName ?? ''].some((v) => v.toLowerCase().includes(q))) : accessRecords
  }, [accessRecords, query])

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? jobs.filter((j) => [j.id, j.type, j.status, j.errorMessage ?? ''].some((v) => v.toLowerCase().includes(q))) : jobs
  }, [jobs, query])

  const filteredErrors = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? errors.filter((e) => [e.scope, e.message, e.code ?? ''].some((v) => v.toLowerCase().includes(q))) : errors
  }, [errors, query])

  const filteredActivity = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? activity.filter((a) => [a.projectTitle, a.summary, a.type, a.actorName ?? ''].some((v) => v.toLowerCase().includes(q))) : activity
  }, [activity, query])

  const filteredFeedback = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? feedback.filter((f) => [f.message, f.user_name, f.user_email].some((v) => v.toLowerCase().includes(q))) : feedback
  }, [feedback, query])

  return (
    <div className={docStyles.dashboard}>
      <aside className={docStyles.sidebar}>
        <div className={docStyles.sidebarLogo}>
          <img src="/logo.svg" alt="Typstr" />
        </div>
        <nav className={docStyles.sidebarNav}>
          <button
            className={docStyles.sidebarBtn}
            onClick={() => navigate('/')}
            title="Projects"
          >
            <HomeIcon />
          </button>
          <button
            className={docStyles.sidebarBtn}
            onClick={() => navigate('/')}
            title="Create Project"
          >
            <PlusIcon />
          </button>
          <button
            className={docStyles.sidebarBtn}
            onClick={() => navigate('/')}
            title="Workspaces"
          >
            <UsersIcon />
          </button>
          <button
            className={docStyles.sidebarBtn}
            onClick={() => navigate('/')}
            title="Trash"
          >
            <TrashIcon />
          </button>
        </nav>
        <div className={docStyles.sidebarFooter}>
          {user?.avatarUrl && (
            <button className={docStyles.sidebarBtn} title={`${user.name} · Profile`} onClick={openProfileSettings} aria-label="Open profile settings">
              <img src={user.avatarUrl} alt={user.name} className={docStyles.headerAvatar} style={{ margin: 0 }} referrerPolicy="no-referrer" />
            </button>
          )}
          <button
            className={[docStyles.sidebarBtn, docStyles.sidebarBtnActive].join(' ')}
            onClick={() => navigate('/admin')}
            title="Admin"
          >
            <ShieldIcon />
          </button>
          <button
            className={docStyles.sidebarBtn}
            onClick={() => navigate('/')}
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            className={docStyles.sidebarBtn}
            onClick={() => void logout()}
            title="Logout"
          >
            <LogOutIcon />
          </button>
        </div>
      </aside>

      <div className={docStyles.content}>
        <header className={docStyles.header}>
          <div>
            <div className={docStyles.userRow}>
              {user?.avatarUrl && (
                <button
                  type="button"
                  onClick={openProfileSettings}
                  aria-label="Open profile settings"
                  title="Open profile settings"
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', lineHeight: 0 }}
                >
                  <img src={user.avatarUrl} alt={user.name} className={docStyles.headerAvatar} referrerPolicy="no-referrer" />
                </button>
              )}
              <p className={docStyles.kicker}>{user?.name ?? user?.email}</p>
            </div>
            <h1>Admin Control Room</h1>
            <p className={docStyles.headerSubtitle}>Audit the workspace, watch the job system, and run maintenance.</p>
          </div>
          <div className={docStyles.headerActions}>
            <button className={docStyles.secondaryBtn} onClick={() => void loadAdminData()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <main className={docStyles.main}>
          {error ? <div className={styles.errorCard}>{error}</div> : null}

          {confirmAction ? (
            <div className={styles.confirmBanner}>
              <div className={styles.confirmText}>
                {confirmAction.kind === 'delete-project' && <>Delete project <strong>{confirmAction.label}</strong>? This is permanent.</>}
                {confirmAction.kind === 'disable-user' && (confirmAction.enable ? <>Re-enable <strong>{confirmAction.label}</strong>?</> : <>Disable <strong>{confirmAction.label}</strong>? They won't be able to sign in.</>)}
                {confirmAction.kind === 'revoke-user-credentials' && <>Revoke all stored credentials for <strong>{confirmAction.label}</strong>? This disconnects Google access, clears saved API keys, and signs out active sessions.</>}
                {confirmAction.kind === 'retry-job' && <>Retry this failed job?</>}
                {confirmAction.kind === 'cancel-job' && <>Stop and cancel this job?</>}
                {confirmAction.kind === 'cancel-all-jobs' && <>Cancel all currently queued jobs?</>}
                {confirmAction.kind === 'clear-errors' && <>Clear all error events? This cannot be undone.</>}
                {confirmAction.kind === 'clear-activity' && <>Clear activity events older than <strong>{confirmAction.label}</strong>?</>}
                {confirmAction.kind === 'revoke-project-member' && <>Revoke project access for <strong>{confirmAction.label}</strong>?</>}
                {confirmAction.kind === 'revoke-project-invitation' && <>Revoke invitation for <strong>{confirmAction.label}</strong>?</>}
                {confirmAction.kind === 'revoke-share-link' && <>Disable share link <strong>{confirmAction.label}</strong>?</>}
                {confirmAction.kind === 'deny-access-request' && <>Deny access request from <strong>{confirmAction.label}</strong>?</>}
                {confirmAction.kind === 'revoke-team-member' && <>Remove team access for <strong>{confirmAction.label}</strong>?</>}
              </div>
              <div className={styles.confirmActions}>
                {actionMessage ? <span className={styles.actionMessage}>{actionMessage}</span> : null}
                <button className={styles.dangerBtn} onClick={() => void executeConfirm()} disabled={actionPending}>
                  {actionPending ? 'Working…' : 'Confirm'}
                </button>
                <button className={styles.secondaryBtn} onClick={() => { setConfirmAction(null); setActionMessage(null) }} disabled={actionPending}>
                  Cancel
                </button>
              </div>
            </div>
          ) : actionMessage ? (
            <div className={styles.successBanner}>
              {actionMessage}
              <button className={styles.dismissBtn} onClick={() => setActionMessage(null)}>×</button>
            </div>
          ) : null}

          {loading ? (
            <div className={styles.loadingCard}>Loading admin data…</div>
          ) : (
            <>
              <section className={styles.toolbar}>
                <div className={styles.tabRow}>
                  {TABS.map((tab) => (
                    <button key={tab.id} className={tab.id === activeTab ? styles.tabActive : styles.tab} onClick={() => setActiveTab(tab.id)} type="button">
                      {tab.label}
                    </button>
                  ))}
                </div>
                <input className={styles.searchInput} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter visible data" />
              </section>

              {activeTab === 'overview' ? (
                <>
                <section className={styles.metricsGrid}>
                  <MetricCard label="Users" value={overview?.counts.users ?? 0} detail="Authenticated accounts" />
                  <MetricCard label="Subscriptions" value={overview?.counts.activeSubscriptions ?? 0} detail={`${overview?.counts.subscriptions ?? 0} total billing records`} />
                  <MetricCard label="Projects" value={overview?.counts.projects ?? 0} detail="Across personal and team workspaces" />
                  <MetricCard label="Teams" value={overview?.counts.teams ?? 0} detail="Shared workspaces" />
                  <MetricCard label="Files" value={overview?.counts.files ?? 0} detail="Tracked in the project tree" />
                  <MetricCard label="Published" value={overview?.counts.publishedProjects ?? 0} detail="Projects with a published snapshot" />
                  <MetricCard label="Share Links" value={overview?.counts.activeShareLinks ?? 0} detail="Currently active" />
                  <MetricCard
                    label="Pending Invites"
                    value={overview?.counts.pendingInvitations ?? 0}
                    detail="Awaiting response"
                    severity={(overview?.counts.pendingInvitations ?? 0) > 0 ? 'warn' : 'neutral'}
                  />
                  <MetricCard
                    label="Errors 24h"
                    value={overview?.counts.errorsLast24h ?? 0}
                    detail="Recorded platform failures"
                    severity={(overview?.counts.errorsLast24h ?? 0) > 0 ? 'error' : 'neutral'}
                  />
                </section>

                <section className={styles.panelGrid}>
                  <Panel title="Service Health" subtitle={diagnostics ? `Checked ${formatDateTime(diagnostics.checkedAt)}` : undefined}>
                    <ul className={styles.healthList}>
                      {diagnostics?.health.checks.map((check) => (
                        <li key={check.name} className={styles.healthItem}>
                          <span className={badgeClass(check.status, styles)}>{check.status}</span>
                          <div><strong>{check.name}</strong><p>{check.detail}</p></div>
                        </li>
                      ))}
                    </ul>
                  </Panel>

                  <Panel title="Job Queue">
                    <div className={styles.queueGrid}>
                      <MetricCard compact label="Queued" value={diagnostics?.queue.queued ?? 0} />
                      <MetricCard compact label="Running" value={diagnostics?.queue.running ?? 0} />
                      <MetricCard
                        compact
                        label="Failed"
                        value={diagnostics?.queue.failed ?? 0}
                        severity={(diagnostics?.queue.failed ?? 0) > 0 ? 'error' : 'neutral'}
                      />
                      <MetricCard compact label="Done 24h" value={diagnostics?.queue.completedLast24h ?? 0} />
                    </div>
                  </Panel>

                  <Panel title="Recent Errors">
                    <ul className={styles.feedList}>
                      {errors.slice(0, 6).map((e) => (
                        <li key={e.id} className={styles.feedItem}>
                          <strong>{e.scope}</strong>
                          <p>{e.message}</p>
                          <span>{formatDateTime(e.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>

                  <Panel title="Recent Activity">
                    <ul className={styles.feedList}>
                      {activity.slice(0, 6).map((a) => (
                        <li key={a.id} className={styles.feedItem}>
                          <strong>{a.projectTitle}</strong>
                          <p>{a.summary}</p>
                          <span>{a.actorName ?? 'System'} · {formatDateTime(a.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </section>
                </>
              ) : null}

              {activeTab === 'users' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr>
                        <th>Name</th><th>Email</th><th>Role</th><th>Subscription</th><th>Projects</th><th>Teams</th><th>Status</th><th>Updated</th><th>Actions</th>
                      </tr></thead>
                      <tbody>
                        {filteredUsers.length === 0 ? (
                          <tr><td colSpan={9} className={styles.emptyCell}>No results.</td></tr>
                        ) : filteredUsers.map((u) => (
                          <tr key={u.id} className={u.disabledAt ? styles.disabledRow : undefined}>
                            <td>{u.name}</td>
                            <td>{u.email}</td>
                            <td>{u.isAdmin ? <span className={styles.badgeWarn}>Admin</span> : 'User'}</td>
                            <td>
                              {u.subscriptionPlan ? <span className={styles.badgeNeutral}>{formatPlanLabel(u.subscriptionPlan)}</span> : 'None'}
                              {u.subscriptionStatus ? <><br /><span className={styles.dimText}>{u.subscriptionStatus}</span></> : null}
                            </td>
                            <td>{u.projectCount}</td>
                            <td>{u.teamCount}</td>
                            <td>{u.disabledAt
                              ? <span className={styles.badgeError}>Disabled</span>
                              : <span className={styles.badgeOk}>Active</span>}
                            </td>
                            <td>{formatDateTime(u.updatedAt)}</td>
                            <td>
                              <button
                                className={styles.actionBtn}
                                onClick={async () => {
                                  try {
                                    await apiClient.post(`/api/admin/users/${u.id}/subscription`, { plan: 'student_freemium', status: 'active', renewalMode: 'admin_manual' })
                                    setActionMessage('Student freemium granted.')
                                    void loadAdminData()
                                  } catch (error: any) {
                                    setActionMessage(error?.response?.data?.error ?? 'Could not grant student freemium.')
                                  }
                                }}
                              >
                                Grant student
                              </button>
                              <button
                                className={styles.actionBtn}
                                onClick={() => setConfirmAction({ kind: 'revoke-user-credentials', id: u.id, label: u.email })}
                                style={{ marginLeft: 8 }}
                              >
                                Revoke creds
                              </button>
                              <button
                                className={u.disabledAt ? styles.actionBtn : styles.dangerBtnSmall}
                                onClick={() => setConfirmAction({ kind: 'disable-user', id: u.id, label: u.email, enable: !!u.disabledAt })}
                                style={{ marginLeft: 8 }}
                              >
                                {u.disabledAt ? 'Enable' : 'Disable'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'subscriptions' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tablePanelHeader}>
                    <span className={styles.tablePanelCount}>{filteredSubscriptions.length} subscription{filteredSubscriptions.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr>
                        <th>Account</th><th>Plan</th><th>Status</th><th>Period</th><th>Provider</th><th>Transactions</th><th>Updated</th><th>Actions</th>
                      </tr></thead>
                      <tbody>
                        {filteredSubscriptions.length === 0 ? (
                          <tr><td colSpan={8} className={styles.emptyCell}>No subscriptions.</td></tr>
                        ) : filteredSubscriptions.map((subscription) => (
                          <SubscriptionAdminRow
                            key={subscription.id}
                            subscription={subscription}
                            onChanged={() => void loadAdminData()}
                            onMessage={setActionMessage}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'projects' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr>
                        <th>Title</th><th>Owner</th><th>Workspace</th><th>Files</th><th>Members</th><th>Published</th><th>Updated</th><th>Actions</th>
                      </tr></thead>
                      <tbody>
                        {filteredProjects.length === 0 ? (
                          <tr><td colSpan={8} className={styles.emptyCell}>No results.</td></tr>
                        ) : filteredProjects.map((p) => (
                          <tr key={p.id}>
                            <td>{p.title}</td>
                            <td>{p.ownerName}<br /><span className={styles.dimText}>{p.ownerEmail}</span></td>
                            <td>{p.teamName ?? 'Personal'}</td>
                            <td>{p.fileCount}</td>
                            <td>{p.memberCount}</td>
                            <td>{p.publishedAt ? formatDateTime(p.publishedAt) : '—'}</td>
                            <td>{formatDateTime(p.updatedAt)}</td>
                            <td>
                              <button
                                className={styles.dangerBtnSmall}
                                onClick={() => setConfirmAction({ kind: 'delete-project', id: p.id, label: p.title })}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'teams' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr>
                        <th>Name</th><th>Owner</th><th>Members</th><th>Projects</th><th>Created</th><th>Updated</th>
                      </tr></thead>
                      <tbody>
                        {filteredTeams.length === 0 ? (
                          <tr><td colSpan={6} className={styles.emptyCell}>No results.</td></tr>
                        ) : filteredTeams.map((t) => (
                          <tr key={t.id}>
                            <td>{t.name}</td>
                            <td>{t.ownerName}<br /><span className={styles.dimText}>{t.ownerEmail}</span></td>
                            <td>{t.memberCount}</td>
                            <td>{t.projectCount}</td>
                            <td>{formatDateTime(t.createdAt)}</td>
                            <td>{formatDateTime(t.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'access' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tablePanelHeader}>
                    <span className={styles.tablePanelCount}>{filteredAccessRecords.length} access record{filteredAccessRecords.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr>
                        <th>Kind</th><th>Resource</th><th>Subject</th><th>Role / Status</th><th>Updated</th><th>Actions</th>
                      </tr></thead>
                      <tbody>
                        {filteredAccessRecords.length === 0 ? (
                          <tr><td colSpan={6} className={styles.emptyCell}>No results.</td></tr>
                        ) : filteredAccessRecords.map((record) => (
                          <tr key={record.id}>
                            <td>{record.label}</td>
                            <td>
                              {record.projectTitle ?? record.teamName ?? '—'}
                              {record.invitedByName ? <><br /><span className={styles.dimText}>Invited by {record.invitedByName}</span></> : null}
                            </td>
                            <td>
                              {record.subjectName ?? record.subjectEmail ?? '—'}
                              {record.subjectName && record.subjectEmail ? <><br /><span className={styles.dimText}>{record.subjectEmail}</span></> : null}
                            </td>
                            <td>
                              {record.kind === 'project-member' && record.projectId && record.subjectUserId ? (
                                <div className={styles.inlineActions}>
                                  <select
                                    className={styles.inlineSelect}
                                    value={record.role ?? 'viewer'}
                                    onChange={async (event) => {
                                      const nextRole = event.target.value as 'manager' | 'editor' | 'viewer'
                                      await apiClient.patch('/api/admin/access/project-members', { projectId: record.projectId, userId: record.subjectUserId, role: nextRole })
                                      setAccessRecords((prev) => prev.map((entry) => entry.id === record.id ? { ...entry, role: nextRole, updatedAt: Date.now() } : entry))
                                      setActionMessage('Project member role updated.')
                                    }}
                                  >
                                    <option value="manager">Manager</option>
                                    <option value="editor">Editor</option>
                                    <option value="viewer">Viewer</option>
                                  </select>
                                  <span className={styles.dimText}>{record.status ?? 'active'}</span>
                                </div>
                              ) : (
                                <>{record.role ?? '—'}{record.status ? <><br /><span className={styles.dimText}>{record.status}</span></> : null}</>
                              )}
                            </td>
                            <td>{formatDateTime(record.updatedAt)}</td>
                            <td className={styles.actionCell}>
                              {record.kind === 'project-member' && record.projectId && record.subjectUserId ? (
                                <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'revoke-project-member', projectId: record.projectId!, userId: record.subjectUserId!, label: record.subjectEmail ?? record.subjectName ?? record.id })}>Revoke</button>
                              ) : null}
                              {record.kind === 'project-invitation' && record.status === 'pending' ? (
                                <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'revoke-project-invitation', invitationId: record.id.replace('project-invitation:', ''), label: record.subjectEmail ?? record.id })}>Revoke</button>
                              ) : null}
                              {record.kind === 'share-link' && record.projectId && record.status === 'active' ? (
                                <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'revoke-share-link', linkId: record.id.replace('share-link:', ''), projectId: record.projectId!, label: record.label })}>Disable</button>
                              ) : null}
                              {record.kind === 'access-request' && record.projectId && record.status === 'pending' ? (
                                <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'deny-access-request', requestId: record.id.replace('access-request:', ''), projectId: record.projectId!, label: record.subjectEmail ?? record.subjectName ?? record.id })}>Deny</button>
                              ) : null}
                              {record.kind === 'team-member' && record.teamId && record.subjectUserId ? (
                                <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'revoke-team-member', teamId: record.teamId!, userId: record.subjectUserId!, label: record.subjectEmail ?? record.subjectName ?? record.id })}>Remove</button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'jobs' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr>
                        <th>Type</th><th>Status</th><th>Attempts</th><th>Created</th><th>Updated</th><th>Error</th><th>Actions</th>
                      </tr></thead>
                      <tbody>
                        {filteredJobs.length === 0 ? (
                          <tr><td colSpan={7} className={styles.emptyCell}>No results.</td></tr>
                        ) : filteredJobs.map((j) => (
                          <tr key={j.id}>
                            <td><span className={styles.mono}>{j.type}</span></td>
                            <td><span className={j.status === 'failed' ? styles.badgeError : j.status === 'completed' ? styles.badgeOk : styles.badgeWarn}>{j.status}</span></td>
                            <td>{j.attempts}/{j.maxAttempts}</td>
                            <td>{formatDateTime(j.createdAt)}</td>
                            <td>{formatDateTime(j.updatedAt)}</td>
                            <td className={styles.errorCell}>{j.errorMessage ?? '—'}</td>
                            <td className={styles.actionCell}>
                              {j.status === 'failed' ? (
                                <button className={styles.actionBtn} onClick={() => setConfirmAction({ kind: 'retry-job', id: j.id })}>
                                  Retry
                                </button>
                              ) : (j.status === 'queued' || j.status === 'running') ? (
                                <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'cancel-job', id: j.id })}>
                                  Stop
                                </button>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'errors' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tablePanelHeader}>
                    <span className={styles.tablePanelCount}>{filteredErrors.length} error{filteredErrors.length !== 1 ? 's' : ''}</span>
                    {errors.length > 0 ? (
                      <button className={styles.dangerBtnSmall} onClick={() => setConfirmAction({ kind: 'clear-errors' })}>
                        Clear all
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th>Scope</th><th>Message</th><th>Code</th><th>Created</th></tr></thead>
                      <tbody>
                        {filteredErrors.length === 0 ? (
                          <tr><td colSpan={4} className={styles.emptyCell}>No error events.</td></tr>
                        ) : filteredErrors.map((e) => (
                          <tr key={e.id}>
                            <td><span className={styles.mono}>{e.scope}</span></td>
                            <td>{e.message}</td>
                            <td>{e.code ?? '—'}</td>
                            <td>{formatDateTime(e.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'activity' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tablePanelHeader}>
                    <span className={styles.tablePanelCount}>{filteredActivity.length} events</span>
                    {activity.length > 0 ? (
                      <button
                        className={styles.dangerBtnSmall}
                        onClick={() => {
                          const before = Date.now() - 30 * 24 * 60 * 60_000
                          setConfirmAction({ kind: 'clear-activity', before, label: '30 days ago' })
                        }}
                      >
                        Clear older than 30 days
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th>Project</th><th>Actor</th><th>Type</th><th>Summary</th><th>Created</th></tr></thead>
                      <tbody>
                        {filteredActivity.length === 0 ? (
                          <tr><td colSpan={5} className={styles.emptyCell}>No activity.</td></tr>
                        ) : filteredActivity.map((a) => (
                          <tr key={a.id}>
                            <td>{a.projectTitle}</td>
                            <td>{a.actorName ?? 'System'}</td>
                            <td><span className={styles.mono}>{a.type}</span></td>
                            <td>{a.summary}</td>
                            <td>{formatDateTime(a.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'feedback' ? (
                <section className={styles.tablePanel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th>User</th><th>Message</th><th>Status</th><th>Response</th><th>Actions</th></tr></thead>
                      <tbody>
                        {filteredFeedback.length === 0 ? (
                          <tr><td colSpan={5} className={styles.emptyCell}>No feedback yet.</td></tr>
                        ) : filteredFeedback.map((f) => (
                          <FeedbackRow key={f.id} feedback={f} onSave={handleUpdateFeedback} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {activeTab === 'domain-rules' ? (
                <DomainRulesPanel onMessage={setActionMessage} />
              ) : null}

              {activeTab === 'maintenance' ? (
                <section className={styles.panelGrid}>
                  <Panel title="Database Backup">
                    <p className={styles.panelText}>Create an immediate backup using the configured <code>BACKUP_DIR</code>.</p>
                    <div className={styles.inlineActions}>
                      <button className={styles.primaryBtn} onClick={() => void handleBackup()} disabled={backupState === 'running'}>
                        {backupState === 'running' ? 'Running backup…' : 'Run backup now'}
                      </button>
                      {backupMessage ? <span className={styles.statusText}>{backupMessage}</span> : null}
                    </div>
                  </Panel>

                  <Panel title="Queue Management">
                    <p className={styles.panelText}>Emergency controls for the job system and error logs.</p>
                    <div className={styles.inlineActions}>
                      <button className={styles.dangerBtn} onClick={() => setConfirmAction({ kind: 'cancel-all-jobs' })} disabled={diagnostics?.queue.queued === 0}>
                        Cancel all queued jobs ({diagnostics?.queue.queued ?? 0})
                      </button>
                      <button className={styles.dangerBtn} onClick={() => setConfirmAction({ kind: 'clear-errors' })} disabled={errors.length === 0}>
                        Clear error events ({errors.length})
                      </button>
                      <button
                        className={styles.dangerBtn}
                        onClick={() => {
                          const before = Date.now() - 30 * 24 * 60 * 60_000
                          setConfirmAction({ kind: 'clear-activity', before, label: '30 days ago' })
                        }}
                        disabled={activity.length === 0}
                      >
                        Clear activity &gt;30 days
                      </button>
                    </div>
                  </Panel>

                  <Panel title="Access Rules">
                    <ul className={styles.ruleList}>
                      <li>Production access is restricted to emails configured in <code>ADMIN_EMAILS</code>.</li>
                      <li>Development: any authenticated user has admin access.</li>
                      <li>API-key diagnostics remain available via <code>x-admin-api-key</code>.</li>
                      <li>Disabled users are blocked at the <code>requireAuth</code> middleware layer.</li>
                    </ul>
                  </Panel>

                  <Panel title="Container Logs" subtitle={containerLogsCheckedAt ? `Fetched ${formatDateTime(containerLogsCheckedAt)}` : undefined}>
                    <p className={styles.panelText}>Inspect recent Docker logs for a selected service container.</p>
                    <div className={styles.inlineActions}>
                      <select className={styles.inlineSelect} value={selectedContainerService} onChange={(event) => setSelectedContainerService(event.target.value)} disabled={containerServices.length === 0}>
                        {containerServices.map((entry) => (
                          <option key={entry.service} value={entry.service}>{entry.label}</option>
                        ))}
                      </select>
                      <input
                        className={styles.inlineInput}
                        value={containerLogTail}
                        onChange={(event) => setContainerLogTail(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Tail"
                      />
                      <button className={styles.primaryBtn} onClick={() => void handleLoadContainerLogs()} disabled={containerLogsState === 'loading' || containerServices.length === 0}>
                        {containerLogsState === 'loading' ? 'Loading logs…' : 'Load logs'}
                      </button>
                    </div>
                    {!dockerAccessible ? <p className={styles.logWarning}>Docker access is not currently available to the admin API container.</p> : null}
                    {containerLogsError ? <p className={styles.logError}>{containerLogsError}</p> : null}
                    <pre className={styles.logViewer}>{containerLogs || 'No logs loaded yet.'}</pre>
                  </Panel>
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

// ─── Domain Rules Panel ───────────────────────────────────────────────────────

type NumericOverrideKey = 'activeProjects' | 'collaboratorsPerProject' | 'totalStorageMb' | 'compilesPerDay' | 'compileTimeoutSeconds' | 'revisionHistoryDays'
type BoolOverrideKey = 'trackChanges' | 'customFonts' | 'publicProjectPublishing'

type RuleFormState = {
  domain: string
  plan: SubscriptionPlan
  status: 'active' | 'inactive'
  validFrom: string
  validUntil: string
  // '' = not overriding, 'null' = unlimited, number string = specific value
  activeProjects: string
  collaboratorsPerProject: string
  totalStorageMb: string
  compilesPerDay: string
  compileTimeoutSeconds: string
  revisionHistoryDays: string
  // '' = not overriding, 'true'/'false' = override with boolean
  trackChanges: '' | 'true' | 'false'
  customFonts: '' | 'true' | 'false'
  publicProjectPublishing: '' | 'true' | 'false'
  // '' = not overriding, 'all' = all formats, 'pdf_only' = pdf only
  exportFormats: '' | 'all' | 'pdf_only'
}

function emptyRuleForm(): RuleFormState {
  return { domain: '', plan: 'student_freemium', status: 'active', validFrom: '', validUntil: '', activeProjects: '', collaboratorsPerProject: '', totalStorageMb: '', compilesPerDay: '', compileTimeoutSeconds: '', revisionHistoryDays: '', trackChanges: '', customFonts: '', publicProjectPublishing: '', exportFormats: '' }
}

function ruleToForm(rule: DomainPlanRule): RuleFormState {
  const o = rule.limitsOverride ?? {}
  const numStr = (key: NumericOverrideKey): string => {
    if (!(key in o)) return ''
    return (o[key] as number | null) === null ? 'null' : String(o[key])
  }
  const boolStr = (key: BoolOverrideKey): '' | 'true' | 'false' => {
    if (!(key in o)) return ''
    return o[key] ? 'true' : 'false'
  }
  return {
    domain: rule.domain,
    plan: rule.plan,
    status: rule.status,
    validFrom: rule.validFrom ? new Date(rule.validFrom).toISOString().slice(0, 10) : '',
    validUntil: rule.validUntil ? new Date(rule.validUntil).toISOString().slice(0, 10) : '',
    activeProjects: numStr('activeProjects'),
    collaboratorsPerProject: numStr('collaboratorsPerProject'),
    totalStorageMb: numStr('totalStorageMb'),
    compilesPerDay: numStr('compilesPerDay'),
    compileTimeoutSeconds: numStr('compileTimeoutSeconds'),
    revisionHistoryDays: numStr('revisionHistoryDays'),
    trackChanges: boolStr('trackChanges'),
    customFonts: boolStr('customFonts'),
    publicProjectPublishing: boolStr('publicProjectPublishing'),
    exportFormats: 'exportFormats' in o ? (o.exportFormats && o.exportFormats.length > 1 ? 'all' : 'pdf_only') : '',
  }
}

function formToLimitsOverride(form: RuleFormState): Partial<PlanLimits> | null {
  const o: Partial<PlanLimits> = {}
  const numeric: NumericOverrideKey[] = ['activeProjects', 'collaboratorsPerProject', 'totalStorageMb', 'compilesPerDay', 'compileTimeoutSeconds', 'revisionHistoryDays']
  for (const key of numeric) {
    const val = form[key]
    if (val === '') continue
    if (val === 'null') { (o as any)[key] = null; continue }
    const n = parseInt(val, 10)
    if (!isNaN(n)) (o as any)[key] = n
  }
  if (form.trackChanges !== '') o.trackChanges = form.trackChanges === 'true'
  if (form.customFonts !== '') o.customFonts = form.customFonts === 'true'
  if (form.publicProjectPublishing !== '') o.publicProjectPublishing = form.publicProjectPublishing === 'true'
  if (form.exportFormats === 'all') o.exportFormats = ['pdf', 'docx', 'html', 'latex']
  else if (form.exportFormats === 'pdf_only') o.exportFormats = ['pdf']
  return Object.keys(o).length > 0 ? o : null
}

function NumericOverrideRow({ label, value, onChange }: { label: string; field: string; value: string; onChange: (v: string) => void }) {
  const isUnlimited = value === 'null'
  const isActive = value !== ''
  return (
    <tr>
      <td style={{ padding: '5px 8px', color: 'var(--text-soft)', fontSize: 13, width: 190 }}>{label}</td>
      <td style={{ padding: '5px 8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-soft)' }}>
          <input type="checkbox" checked={isActive} onChange={(e) => onChange(e.target.checked ? 'null' : '')} />
          Override
        </label>
      </td>
      <td style={{ padding: '5px 8px' }}>
        {isActive && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-soft)' }}>
              <input type="checkbox" checked={isUnlimited} onChange={(e) => onChange(e.target.checked ? 'null' : '')} />
              ∞ Unlimited
            </label>
            {!isUnlimited && (
              <input
                type="number"
                min={0}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{ width: 90, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--panel-border)', background: 'var(--editor-bg)', color: 'var(--text-bright)', fontSize: 13 }}
              />
            )}
          </div>
        )}
        {!isActive && <span style={{ fontSize: 12, color: 'var(--muted-text)' }}>using plan default</span>}
      </td>
    </tr>
  )
}

function BoolOverrideRow({ label, value, onChange }: { label: string; value: '' | 'true' | 'false'; onChange: (v: '' | 'true' | 'false') => void }) {
  return (
    <tr>
      <td style={{ padding: '5px 8px', color: 'var(--text-soft)', fontSize: 13, width: 190 }}>{label}</td>
      <td colSpan={2} style={{ padding: '5px 8px' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['', 'true', 'false'] as const).map((opt) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: value === opt ? 'var(--text-bright)' : 'var(--text-soft)', cursor: 'pointer' }}>
              <input type="radio" name={label} checked={value === opt} onChange={() => onChange(opt)} />
              {opt === '' ? 'Plan default' : opt === 'true' ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
      </td>
    </tr>
  )
}

function DomainRulesPanel({ onMessage }: { onMessage: (msg: string) => void }) {
  const [rules, setRules] = useState<DomainPlanRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<RuleFormState>(emptyRuleForm())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => { void loadRules() }, [])

  async function loadRules() {
    setLoading(true)
    try {
      const res = await apiClient.get<DomainPlanRule[]>('/api/admin/domain-rules')
      setRules(res.data)
    } catch {
      onMessage('Failed to load domain rules.')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(rule: DomainPlanRule) {
    setEditing(rule.domain)
    setForm(ruleToForm(rule))
  }

  function startNew() {
    setEditing('__new__')
    setForm(emptyRuleForm())
  }

  async function saveRule() {
    if (!form.domain.trim()) { onMessage('Domain is required.'); return }
    setSaving(true)
    try {
      await apiClient.put(`/api/admin/domain-rules/${encodeURIComponent(form.domain.trim().toLowerCase())}`, {
        plan: form.plan,
        status: form.status,
        limitsOverride: formToLimitsOverride(form),
        validFrom: form.validFrom ? new Date(form.validFrom).getTime() : null,
        validUntil: form.validUntil ? new Date(form.validUntil).getTime() : null,
      })
      onMessage(`Domain rule for ${form.domain} saved.`)
      setEditing(null)
      await loadRules()
    } catch (err: any) {
      onMessage(err?.response?.data?.error ?? 'Failed to save domain rule.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(domain: string) {
    setDeleting(domain)
    try {
      await apiClient.delete(`/api/admin/domain-rules/${encodeURIComponent(domain)}`)
      setRules((prev) => prev.filter((r) => r.domain !== domain))
      if (editing === domain) setEditing(null)
      onMessage(`Domain rule for ${domain} deleted.`)
    } catch (err: any) {
      onMessage(err?.response?.data?.error ?? 'Failed to delete domain rule.')
    } finally {
      setDeleting(null)
    }
  }

  function setField<K extends keyof RuleFormState>(key: K, val: RuleFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  const isEditorOpen = editing !== null
  return (
    <section className={styles.tablePanel}>
      <div className={styles.tablePanelHeader}>
        <span className={styles.tablePanelCount}>{rules.length} domain rule{rules.length !== 1 ? 's' : ''}</span>
        <button className={styles.primaryBtn} onClick={startNew} disabled={isEditorOpen}>
          + Add rule
        </button>
      </div>

      {loading ? (
        <div className={styles.loadingCard}>Loading domain rules…</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Base Plan</th>
                <th>Status</th>
                <th>Limit overrides</th>
                <th>Valid until</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 && !isEditorOpen && (
                <tr><td colSpan={7} className={styles.emptyCell}>No domain rules configured. Add one to grant custom limits to a specific email domain.</td></tr>
              )}
              {rules.map((rule) => (
                <>
                  <tr key={rule.domain} style={editing === rule.domain ? { background: 'var(--active-bg)' } : undefined}>
                    <td><span className={styles.mono}>{rule.domain}</span></td>
                    <td><span className={styles.badgeNeutral}>{formatPlanLabel(rule.plan)}</span></td>
                    <td>
                      <span className={rule.status === 'active' ? styles.badgeOk : styles.badgeNeutral}>
                        {rule.status}
                      </span>
                    </td>
                    <td>
                      {rule.limitsOverride
                        ? <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>{Object.keys(rule.limitsOverride).length} override{Object.keys(rule.limitsOverride).length !== 1 ? 's' : ''}</span>
                        : <span style={{ fontSize: 12, color: 'var(--muted-text)' }}>None (plan defaults)</span>}
                    </td>
                    <td>{rule.validUntil ? formatDateTime(rule.validUntil) : '—'}</td>
                    <td>{formatDateTime(rule.updatedAt)}</td>
                    <td className={styles.actionCell}>
                      <button className={styles.actionBtn} onClick={() => editing === rule.domain ? setEditing(null) : startEdit(rule)}>
                        {editing === rule.domain ? 'Close' : 'Edit'}
                      </button>
                      <button
                        className={styles.dangerBtnSmall}
                        onClick={() => void deleteRule(rule.domain)}
                        disabled={deleting === rule.domain}
                        style={{ marginLeft: 6 }}
                      >
                        {deleting === rule.domain ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                  {editing === rule.domain && (
                    <tr key={`${rule.domain}-editor`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <RuleEditor form={form} setField={setField} saving={saving} onSave={() => void saveRule()} onCancel={() => setEditing(null)} isNew={false} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {editing === '__new__' && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <RuleEditor form={form} setField={setField} saving={saving} onSave={() => void saveRule()} onCancel={() => setEditing(null)} isNew={true} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RuleEditor({
  form,
  setField,
  saving,
  onSave,
  onCancel,
  isNew,
}: {
  form: RuleFormState
  setField: <K extends keyof RuleFormState>(key: K, val: RuleFormState[K]) => void
  saving: boolean
  onSave: () => void
  onCancel: () => void
  isNew: boolean
}) {
  return (
    <div style={{ padding: '20px 24px', background: 'var(--editor-bg)', borderTop: '1px solid var(--panel-border)', borderBottom: '1px solid var(--panel-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px 24px', marginBottom: 20 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 700 }}>Domain</span>
          <input
            value={form.domain}
            onChange={(e) => setField('domain', e.target.value)}
            placeholder="e.g. metu.edu.tr"
            disabled={saving || !isNew}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border)', background: isNew ? 'var(--editor-bg)' : 'var(--sidebar-bg)', color: 'var(--text-bright)', fontSize: 13 }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 700 }}>Base Plan</span>
          <select
            className={styles.inlineSelect}
            value={form.plan}
            onChange={(e) => setField('plan', e.target.value as SubscriptionPlan)}
            disabled={saving}
          >
            {SUBSCRIPTION_PLANS.map((p) => <option key={p} value={p}>{formatPlanLabel(p)}</option>)}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 700 }}>Status</span>
          <select className={styles.inlineSelect} value={form.status} onChange={(e) => setField('status', e.target.value as 'active' | 'inactive')} disabled={saving}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 700 }}>Valid from (optional)</span>
          <input type="date" value={form.validFrom} onChange={(e) => setField('validFrom', e.target.value)} disabled={saving}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--editor-bg)', color: 'var(--text-bright)', fontSize: 13 }} />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 700 }}>Valid until (optional)</span>
          <input type="date" value={form.validUntil} onChange={(e) => setField('validUntil', e.target.value)} disabled={saving}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--editor-bg)', color: 'var(--text-bright)', fontSize: 13 }} />
        </label>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>Limit overrides</h3>
          <span style={{ fontSize: 12, color: 'var(--muted-text)' }}>Leave unchecked to use the plan's default for that limit.</span>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              setField('activeProjects', 'null'); setField('collaboratorsPerProject', 'null')
              setField('totalStorageMb', 'null'); setField('compilesPerDay', 'null')
              setField('compileTimeoutSeconds', 'null'); setField('revisionHistoryDays', 'null')
              setField('trackChanges', 'true'); setField('customFonts', 'true')
              setField('publicProjectPublishing', 'true'); setField('exportFormats', 'all')
            }}
            disabled={saving}
            style={{ marginLeft: 'auto', fontSize: 12 }}
          >
            Preset: no limits
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              setField('activeProjects', ''); setField('collaboratorsPerProject', '')
              setField('totalStorageMb', ''); setField('compilesPerDay', '')
              setField('compileTimeoutSeconds', ''); setField('revisionHistoryDays', '')
              setField('trackChanges', ''); setField('customFonts', '')
              setField('publicProjectPublishing', ''); setField('exportFormats', '')
            }}
            disabled={saving}
            style={{ fontSize: 12 }}
          >
            Clear all overrides
          </button>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 680 }}>
          <tbody>
            <NumericOverrideRow label="Active projects" field="activeProjects" value={form.activeProjects} onChange={(v) => setField('activeProjects', v)} />
            <NumericOverrideRow label="Collaborators / project" field="collaboratorsPerProject" value={form.collaboratorsPerProject} onChange={(v) => setField('collaboratorsPerProject', v)} />
            <NumericOverrideRow label="Total storage (MB)" field="totalStorageMb" value={form.totalStorageMb} onChange={(v) => setField('totalStorageMb', v)} />
            <NumericOverrideRow label="Compiles per day" field="compilesPerDay" value={form.compilesPerDay} onChange={(v) => setField('compilesPerDay', v)} />
            <NumericOverrideRow label="Compile timeout (s)" field="compileTimeoutSeconds" value={form.compileTimeoutSeconds} onChange={(v) => setField('compileTimeoutSeconds', v)} />
            <NumericOverrideRow label="Revision history (days)" field="revisionHistoryDays" value={form.revisionHistoryDays} onChange={(v) => setField('revisionHistoryDays', v)} />
            <BoolOverrideRow label="Track changes" value={form.trackChanges} onChange={(v) => setField('trackChanges', v)} />
            <BoolOverrideRow label="Custom fonts" value={form.customFonts} onChange={(v) => setField('customFonts', v)} />
            <BoolOverrideRow label="Public publishing" value={form.publicProjectPublishing} onChange={(v) => setField('publicProjectPublishing', v)} />
            <tr>
              <td style={{ padding: '5px 8px', color: 'var(--text-soft)', fontSize: 13, width: 190 }}>Export formats</td>
              <td colSpan={2} style={{ padding: '5px 8px' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  {(['', 'all', 'pdf_only'] as const).map((opt) => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: form.exportFormats === opt ? 'var(--text-bright)' : 'var(--text-soft)', cursor: 'pointer' }}>
                      <input type="radio" name="exportFormats" checked={form.exportFormats === opt} onChange={() => setField('exportFormats', opt)} />
                      {opt === '' ? 'Plan default' : opt === 'all' ? 'All (PDF, DOCX, HTML, LaTeX)' : 'PDF only'}
                    </label>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className={styles.primaryBtn} onClick={onSave} disabled={saving || !form.domain.trim()}>
          {saving ? 'Saving…' : isNew ? 'Create rule' : 'Save changes'}
        </button>
        <button className={styles.secondaryBtn} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

type MetricSeverity = 'neutral' | 'warn' | 'error'

function MetricCard({ label, value, detail, compact = false, severity = 'neutral' }: {
  label: string
  value: number | string
  detail?: string
  compact?: boolean
  severity?: MetricSeverity
}) {
  const base = compact ? styles.metricCardCompact : styles.metricCard
  const tone = severity === 'error' ? styles.metricCardError
    : severity === 'warn' ? styles.metricCardWarn
    : ''
  return (
    <article className={[base, tone].filter(Boolean).join(' ')}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
      </div>
      {children}
    </section>
  )
}

function badgeClass(status: 'ok' | 'degraded' | 'error', css: Record<string, string>) {
  if (status === 'ok') return css.badgeOk
  if (status === 'degraded') return css.badgeWarn
  return css.badgeError
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}
