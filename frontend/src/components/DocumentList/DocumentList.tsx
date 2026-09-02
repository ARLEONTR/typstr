import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { GlobalSearchModal } from './GlobalSearchModal'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { apiClient, buildGoogleUpgradeUrl } from '../../api/client'
import { useAuth } from '../../hooks/useAuth'
import { safeStorage } from '../../safeStorage'
import {
  UI_FONT_OPTIONS,
  EDITOR_FONT_OPTIONS,
  THEME_STORAGE_KEY,
  themeStorageKeyForUser,
  THEME_PRESETS,
  DEFAULT_THEME,
  normalizeWorkspaceTheme,
  type WorkspaceTheme
} from '../../theme'
import { FeedbackPanel } from '../Global/FeedbackPanel'
import { UserFeedbackPanel } from '../Global/UserFeedbackPanel'
import { PermissionsPanel } from '../Settings/PermissionsPanel'
import { ProfilePanel } from '../Settings/ProfilePanel'
import { SubscriptionPanel } from '../Settings/SubscriptionPanel'
import { TYPST_TUTORIAL_STEPS } from '../Editor/editorLearning'
import { TasksPanel } from '../Editor/TasksPanel'
import type {
  ProjectDashboardData,
  ProjectInvitation,
  ProjectRole,
  ProjectSummary,
  Team,
  TeamMember,
  ProjectTemplate,
  ProjectTemplateId,
  ProjectFormat,
  ProjectState,
  ProjectComment,
} from '../../types'
import styles from './DocumentList.module.css'
import {
  Home,
  Plus,
  Users,
  Trash2,
  Settings as SettingsLucide,
  MessageSquare,
  LogOut,
  Shield,
  Star,
  MapPin,
  Archive,
  Copy,
  Move,
  Share2,
  Upload,
  BookOpen,
  ClipboardList,
  Search as SearchLucide,
  Bell,
} from '../../icons'

const LazyMoveProjectModal = lazy(() => import('./DocumentList').then(m => ({ default: m.MoveProjectModal })))
const LazyDeleteProjectModal = lazy(() => import('./DocumentList').then(m => ({ default: m.DeleteProjectModal })))

type DashboardProject = ProjectSummary & {
  state: ProjectState
}

type DashboardSort = 'recent' | 'updated' | 'created' | 'title'
type DashboardStatus = 'active' | 'archived' | 'trashed' | 'all'
type ShortcutAction =
  | 'compile'
  | 'save'
  | 'search'
  | 'projectSearch'
  | 'toggleNavigation'
  | 'quickExport'
  | 'previousSection'
  | 'nextSection'
  | 'toggleFold'
  | 'togglePreview'
  | 'focusEditor'

type ShortcutBindings = Record<ShortcutAction, string>

const SHORTCUTS_STORAGE_PREFIX = 'typstr.shortcuts.'
const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  compile: 'Mod-Enter',
  save: 'Mod-s',
  search: 'Mod-f',
  projectSearch: 'Mod-Shift-f',
  toggleNavigation: 'Mod-/',
  quickExport: 'Mod-Shift-e',
  previousSection: 'Alt-ArrowUp',
  nextSection: 'Alt-ArrowDown',
  toggleFold: 'Mod-Alt-[',
  togglePreview: 'Mod-Shift-p',
  focusEditor: 'Escape',
}

const SHORTCUT_BINDING_LABELS: Array<{ action: ShortcutAction; label: string; description: string }> = [
  { action: 'compile', label: 'Render document', description: 'Run a document render for the current entry file.' },
  { action: 'save', label: 'Save to Drive', description: 'Persist the active file to Google Drive.' },
  { action: 'search', label: 'Current-file search', description: 'Open in-file search panel.' },
  { action: 'projectSearch', label: 'Project search', description: 'Open project-wide text search panel.' },
  { action: 'toggleNavigation', label: 'Navigation panel', description: 'Toggle document navigation helpers.' },
  { action: 'quickExport', label: 'Quick export', description: 'Run the default export target for the project.' },
  { action: 'previousSection', label: 'Previous section', description: 'Jump to previous heading section.' },
  { action: 'nextSection', label: 'Next section', description: 'Jump to next heading section.' },
  { action: 'toggleFold', label: 'Toggle fold', description: 'Fold or unfold current heading section.' },
  { action: 'togglePreview', label: 'Toggle preview', description: 'Show or hide the preview panel.' },
  { action: 'focusEditor', label: 'Focus / Zen mode', description: 'Collapse sidebar and preview to maximise the editor.' },
]

type SettingsTabId = 'general' | 'profile' | 'subscription' | 'shortcuts' | 'permissions'

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'profile', label: 'Profile' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'permissions', label: 'Permissions' },
]

const SORT_OPTIONS: Array<{ value: DashboardSort; label: string }> = [
  { value: 'recent', label: 'Recently opened' },
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created recently' },
  { value: 'title', label: 'Title A-Z' },
]

const LATEX_WALKTHROUGH_STEPS = [
  {
    title: 'Choose your engine',
    description: 'Set the LaTeX engine (pdfLaTeX, XeLaTeX, or LuaLaTeX) in compile settings before writing deeply engine-specific markup.',
  },
  {
    title: 'Manage bibliography pipeline',
    description: 'Use BibTeX/Biber intentionally and run the expected compile sequence so citations and references are resolved correctly.',
  },
  {
    title: 'Validate web preview limits',
    description: 'Treat HTML preview as a fast check; always verify final journal layout and float behavior with PDF output.',
  },
]

const LATEX_TEMPLATE_OPTIONS: ProjectTemplate[] = [
  {
    id: 'blank',
    title: 'Blank',
    description: 'Start with an empty LaTeX article.',
    category: 'General',
    kind: 'built-in',
    tags: [],
    styleProfileId: null,
    citationStyle: null,
    pageLimit: null,
    requiredSections: [],
    voteCount: 0,
    currentUserVote: 0,
    authorName: 'Typstr',
    publishedAt: null,
    previewSnippet: '',
  },
  {
    id: 'ieee',
    title: 'IEEE',
    description: 'IEEEtran conference paper starter.',
    category: 'Academic styles',
    kind: 'built-in',
    tags: ['ieee', 'conference'],
    styleProfileId: 'ieee',
    citationStyle: 'ieee',
    pageLimit: 10,
    requiredSections: ['Abstract', 'Introduction', 'Method', 'Results', 'Conclusion'],
    voteCount: 0,
    currentUserVote: 0,
    authorName: 'Typstr',
    publishedAt: null,
    previewSnippet: '',
  },
  {
    id: 'acm',
    title: 'ACM',
    description: 'acmart SIGCONF paper starter.',
    category: 'Academic styles',
    kind: 'built-in',
    tags: ['acm', 'sigconf'],
    styleProfileId: 'acm',
    citationStyle: 'acm',
    pageLimit: 10,
    requiredSections: ['Abstract', 'Introduction', 'Method', 'Results', 'Conclusion'],
    voteCount: 0,
    currentUserVote: 0,
    authorName: 'Typstr',
    publishedAt: null,
    previewSnippet: '',
  },
]

const NAV_ICON_SIZE = 18
const MINI_ICON_SIZE = 15

function formatDriveActionError(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: string; code?: string } } })?.response
  const code = response?.data?.code
  const message = response?.data?.error
  if (code === 'drive_storage_quota_exceeded') {
    return message ?? 'Google Drive storage is full. Free up space in Drive, then try again.'
  }
  if (typeof message === 'string' && /google drive|drive storage|quota|storage/i.test(message)) {
    return message
  }
  return fallback
}

function HomeIcon() { return <Home size={NAV_ICON_SIZE} aria-hidden /> }
function PlusIcon() { return <Plus size={NAV_ICON_SIZE} aria-hidden /> }
function UsersIcon() { return <Users size={NAV_ICON_SIZE} aria-hidden /> }
function TrashIcon() { return <Trash2 size={NAV_ICON_SIZE} aria-hidden /> }
function SettingsIcon() { return <SettingsLucide size={NAV_ICON_SIZE} aria-hidden /> }
function FeedbackIcon() { return <MessageSquare size={NAV_ICON_SIZE} aria-hidden /> }
function LogOutIcon() { return <LogOut size={NAV_ICON_SIZE} aria-hidden /> }
function ShieldIcon() { return <Shield size={NAV_ICON_SIZE} aria-hidden /> }
function ImportIcon() { return <Upload size={NAV_ICON_SIZE} aria-hidden /> }
function WalkthroughIcon() { return <BookOpen size={NAV_ICON_SIZE} aria-hidden /> }
function TasksIcon() { return <ClipboardList size={NAV_ICON_SIZE} aria-hidden /> }
function GlobalSearchIcon() { return <SearchLucide size={NAV_ICON_SIZE} aria-hidden /> }
function NotificationIcon() { return <Bell size={NAV_ICON_SIZE} aria-hidden /> }

function StarIcon({ filled }: { filled?: boolean }) {
  return <Star size={MINI_ICON_SIZE} fill={filled ? 'currentColor' : 'none'} aria-hidden />
}
function PinIcon({ filled }: { filled?: boolean }) {
  return <MapPin size={MINI_ICON_SIZE} fill={filled ? 'currentColor' : 'none'} aria-hidden />
}
function ArchiveIcon() { return <Archive size={MINI_ICON_SIZE} aria-hidden /> }
function CopyIcon() { return <Copy size={MINI_ICON_SIZE} aria-hidden /> }
function MoveIcon() { return <Move size={MINI_ICON_SIZE} aria-hidden /> }
function ShareIcon() { return <Share2 size={MINI_ICON_SIZE} aria-hidden /> }

export default function DocumentList() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightedInvitationId = searchParams.get('invitation')
  const highlightedInvitationProof = searchParams.get('invitationProof')
  const { user, logout } = useAuth()
  const [activeView, setActiveView] = useState<'projects' | 'trash' | 'teams' | 'new-project' | 'walkthrough' | 'feedback' | 'settings' | 'tasks'>('projects')
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general')
  const [feedbackTab, setFeedbackTab] = useState<'feedback' | 'my-feedback'>('feedback')
  const [myTasks, setMyTasks] = useState<ProjectComment[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)

  const openProfileSettings = useCallback(() => {
    setActiveView('settings')
    setSettingsTab('profile')
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('settings', 'profile')
      return next
    })
  }, [setSearchParams])

  useEffect(() => {
    if (activeView !== 'tasks') return
    let cancelled = false
    setIsLoadingTasks(true)
    apiClient.get<ProjectComment[]>('/api/projects/my-tasks').then(({ data }) => {
      if (!cancelled) setMyTasks(data)
    }).catch(() => {}).finally(() => { if (!cancelled) setIsLoadingTasks(false) })
    return () => { cancelled = true }
  }, [activeView])

  useEffect(() => {
    const requestedSettingsTab = searchParams.get('settings')
    if (requestedSettingsTab === 'profile') {
      setActiveView('settings')
      setSettingsTab('profile')
    } else if (requestedSettingsTab === 'permissions' || searchParams.has('orcidError')) {
      setActiveView('settings')
      setSettingsTab('permissions')
    }
  }, [searchParams])

  const [theme, setTheme] = useState<WorkspaceTheme>(DEFAULT_THEME)
  const [themeHydrated, setThemeHydrated] = useState(false)
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUT_BINDINGS)
  const shortcutStorageKey = useMemo(() => `${SHORTCUTS_STORAGE_PREFIX}${user?.id ?? 'anonymous'}`, [user?.id])
  const themeStorageKey = useMemo(() => themeStorageKeyForUser(user?.id), [user?.id])

  useEffect(() => {
    try {
      const userScopedRaw = safeStorage.getItem(themeStorageKey)
      const globalRaw = safeStorage.getItem(THEME_STORAGE_KEY)
      setTheme(normalizeWorkspaceTheme(
        userScopedRaw ? JSON.parse(userScopedRaw) : user?.selectedTheme ?? (globalRaw ? JSON.parse(globalRaw) : DEFAULT_THEME),
      ))
    } catch (e) {
      console.error('Failed to parse theme', e)
      setTheme(normalizeWorkspaceTheme(user?.selectedTheme ?? DEFAULT_THEME))
      safeStorage.removeItem(themeStorageKey)
    }
    setThemeHydrated(true)
  }, [themeStorageKey, user?.selectedTheme])

  const updateTheme = (patch: Partial<WorkspaceTheme>) => {
    const next = normalizeWorkspaceTheme({ ...theme, ...patch })
    setTheme(next)
    safeStorage.setItem(themeStorageKey, JSON.stringify(next))
    safeStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('typstr-theme-updated'))
    if ((window as any).applyTypstrTheme) {
      (window as any).applyTypstrTheme()
    }
  }

  useEffect(() => {
    if (!themeHydrated) return
    const timeoutId = window.setTimeout(() => {
      void apiClient.patch('/api/account/theme', { theme }).catch((error) => {
        console.error('Failed to save theme preference', error)
      })
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [theme, themeHydrated])

  useEffect(() => {
    try {
      const raw = safeStorage.getItem(shortcutStorageKey)
      if (!raw) {
        setShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
        return
      }

      const parsed = JSON.parse(raw) as Partial<ShortcutBindings>
      setShortcutBindings({
        ...DEFAULT_SHORTCUT_BINDINGS,
        ...Object.fromEntries(
          Object.entries(parsed).filter(([_, value]) => typeof value === 'string'),
        ) as Partial<ShortcutBindings>,
      })
    } catch {
      setShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    }
  }, [shortcutStorageKey])

  useEffect(() => {
    safeStorage.setItem(shortcutStorageKey, JSON.stringify(shortcutBindings))
  }, [shortcutBindings, shortcutStorageKey])

  const handleSelectTheme = (presetId: string) => {
    updateTheme({ presetId })
  }

  const [dashboard, setDashboard] = useState<ProjectDashboardData | null>(null)
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([])
  const [linkedInvitation, setLinkedInvitation] = useState<ProjectInvitation | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'personal'>('personal')
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<TeamMember[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const [roleFilter, setRoleFilter] = useState<'all' | ProjectRole>('all')
  const [starFilter, setStarFilter] = useState<'all' | 'starred'>('all')
  const [ownerFilter, setOwnerFilter] = useState<'all' | string>('all')
  const [teamFilter, setTeamFilter] = useState<'all' | 'personal' | string>('all')
  const [statusFilter, setStatusFilter] = useState<DashboardStatus>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<DashboardSort>('recent')
  const [walkthroughTrack, setWalkthroughTrack] = useState<'typst' | 'latex'>('typst')

  const [driveWorkspaceName, setDriveWorkspaceName] = useState('Typstr')
  const [isConfiguringDriveWorkspace, setIsConfiguringDriveWorkspace] = useState(false)
  const [driveWorkspaceError, setDriveWorkspaceError] = useState<string | null>(null)

  const [newTeamName, setNewTeamName] = useState('')
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [teamInviteEmail, setTeamInviteEmail] = useState('')
  const [invitingToTeam, setInvitingToTeam] = useState(false)
  const [deletingTeam, setDeletingTeam] = useState(false)

  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<ProjectTemplateId>('blank')
  const [selectedProjectFormat, setSelectedProjectFormat] = useState<ProjectFormat>('typst')
  const [selectedWorkspaceTeamId, setSelectedWorkspaceTeamId] = useState<string | 'personal'>('personal')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [pendingProjectActionId, setPendingProjectActionId] = useState<string | null>(null)
  const [publishingTemplateProjectId, setPublishingTemplateProjectId] = useState<string | null>(null)

  const [projectPendingDelete, setProjectPendingDelete] = useState<ProjectSummary | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [showInvitationCenter, setShowInvitationCenter] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setShowGlobalSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const [moveProject, setMoveProject] = useState<DashboardProject | null>(null)
  const [moveTargetTeamId, setMoveTargetTeamId] = useState<string | 'personal'>('personal')
  const [movingProjectId, setMovingProjectId] = useState<string | null>(null)

  const [emptyingTrash, setEmptyingTrash] = useState(false)
  const [respondingInvitationId, setRespondingInvitationId] = useState<string | null>(null)

  const loadDashboard = useCallback(async (cursor?: string) => {
    try {
      if (!cursor) setLoading(true)
      else setLoadingMore(true)
      setDashboardError(null)

      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)

      const [dashRes, invRes, teamsRes] = await Promise.all([
        apiClient.get<ProjectDashboardData>(`/api/projects/dashboard?${params.toString()}`),
        apiClient.get<ProjectInvitation[]>('/api/invitations'),
        apiClient.get<Team[]>('/api/teams'),
      ])

      const dashData = dashRes.data
      if (cursor) {
        setDashboard(prev => {
          if (!prev) return dashData
          return {
            ...dashData,
            activeProjects: [...prev.activeProjects, ...dashData.activeProjects],
            trashedProjects: [...prev.trashedProjects, ...dashData.trashedProjects],
            archivedProjects: [...prev.archivedProjects, ...dashData.archivedProjects],
          }
        })
      } else {
        setDashboard(dashData)
      }

      setInvitations(invRes.data)
      setTeams(teamsRes.data)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
      setDashboardError('Failed to load your projects. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void loadDashboard().then(() => {
      if (!active) return
    })
    return () => { active = false }
  }, [loadDashboard])

  useEffect(() => {
    if (!highlightedInvitationId || (invitations.length === 0 && !linkedInvitation)) return
    const el = document.getElementById(`invitation-${highlightedInvitationId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => {
      setSearchParams(prev => {
        prev.delete('invitation')
        prev.delete('invitationProof')
        return prev
      }, { replace: true })
    }, 3000)
    return () => clearTimeout(timer)
  }, [highlightedInvitationId, invitations, linkedInvitation, setSearchParams])

  useEffect(() => {
    if (!highlightedInvitationId || !user) {
      setLinkedInvitation(null)
      return
    }

    if (invitations.some((invitation) => invitation.id === highlightedInvitationId)) {
      setLinkedInvitation(null)
      return
    }

    let cancelled = false
    apiClient.get<ProjectInvitation>(`/api/invitations/${highlightedInvitationId}`, {
      params: highlightedInvitationProof ? { proof: highlightedInvitationProof } : undefined,
    })
      .then(({ data }) => {
        if (!cancelled) {
          setLinkedInvitation(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedInvitation(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [highlightedInvitationId, highlightedInvitationProof, invitations, user])

  useEffect(() => {
    if (selectedTeamId === 'personal') {
      setSelectedTeamMembers([])
      return
    }
    const loadTeamMembers = async () => {
      try {
        setTeamLoading(true)
        setTeamError(null)
        const response = await apiClient.get<TeamMember[]>(`/api/teams/${selectedTeamId}/members`)
        setSelectedTeamMembers(response.data)
      } catch (err) {
        setTeamError('Failed to load team members')
      } finally {
        setTeamLoading(false)
      }
    }
    void loadTeamMembers()
  }, [selectedTeamId])

  async function handleSync() {
    try {
      setSyncing(true)
      await apiClient.post('/api/projects/sync')
      await loadDashboard()
    } catch (error) {
      alert('Failed to sync with Google Drive')
    } finally {
      setSyncing(false)
    }
  }

  async function handleConfigureDriveWorkspace() {
    try {
      setIsConfiguringDriveWorkspace(true)
      setDriveWorkspaceError(null)
      await apiClient.post('/api/auth/drive-workspace', { name: driveWorkspaceName.trim() })
      window.location.reload()
    } catch (error: any) {
      const code = error?.response?.data?.code
      const status = Number(error?.response?.status ?? 0)
      if (
        code === 'google_reauth_required'
        || code === 'drive_scope_required'
        || code === 'drive_workspace_required'
        || status === 401
        || status === 403
      ) {
        const next = window.location.pathname + window.location.search + window.location.hash
        window.location.href = buildGoogleUpgradeUrl('drive', next)
        return
      }
      if (code !== 'google_reauth_required' && code !== 'drive_scope_required') {
        setDriveWorkspaceError(formatDriveActionError(error, 'Failed to configure Google Drive workspace.'))
      }
    } finally {
      setIsConfiguringDriveWorkspace(false)
    }
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return
    try {
      setCreatingTeam(true)
      const res = await apiClient.post<Team>('/api/teams', { name: newTeamName.trim() })
      const team = res.data
      setTeams([...teams, team])
      setNewTeamName('')
      setSelectedTeamId(team.id)
    } catch (err) {
      alert('Failed to create team')
    } finally {
      setCreatingTeam(false)
    }
  }

  async function handleAddTeamMember() {
    if (!teamInviteEmail.trim() || selectedTeamId === 'personal') return
    try {
      setInvitingToTeam(true)
      const res = await apiClient.post<TeamMember>(`/api/teams/${selectedTeamId}/members`, { email: teamInviteEmail.trim(), role: 'editor' })
      const member = res.data
      setSelectedTeamMembers([...selectedTeamMembers, member])
      setTeamInviteEmail('')
    } catch (err) {
      alert('Failed to add team member')
    } finally {
      setInvitingToTeam(false)
    }
  }

  async function handleRemoveTeamMember(userId: string) {
    if (selectedTeamId === 'personal') return
    try {
      await apiClient.delete(`/api/teams/${selectedTeamId}/members/${userId}`)
      setSelectedTeamMembers(selectedTeamMembers.filter((m) => m.userId !== userId))
    } catch (err) {
      alert('Failed to remove team member')
    }
  }

  async function handleChangeTeamMemberRole(userId: string, role: string) {
    if (selectedTeamId === 'personal') return
    try {
      const res = await apiClient.patch<TeamMember[]>(`/api/teams/${selectedTeamId}/members/${userId}`, { role })
      setSelectedTeamMembers(res.data)
    } catch (err) {
      alert('Failed to change role')
    }
  }

  async function handleDeleteTeam() {
    if (selectedTeamId === 'personal' || !window.confirm('Are you sure you want to delete this team?')) return
    try {
      setDeletingTeam(true)
      await apiClient.delete(`/api/teams/${selectedTeamId}`)
      setTeams(teams.filter((t) => t.id !== selectedTeamId))
      setSelectedTeamId('personal')
    } catch (err) {
      alert('Failed to delete team')
    } finally {
      setDeletingTeam(false)
    }
  }

  async function handleCreate() {
    if (!newProjectTitle.trim()) return
    try {
      setCreating(true)
      setCreateError(null)
      const res = await apiClient.post<ProjectSummary>('/api/projects', {
        title: newProjectTitle.trim(),
        templateId: selectedTemplateId,
        projectFormat: selectedProjectFormat,
        teamId: selectedWorkspaceTeamId === 'personal' ? null : selectedWorkspaceTeamId,
      })
      const project = res.data
      navigate(`/projects/${project.id}`)
    } catch (error) {
      setCreateError(formatDriveActionError(error, 'Failed to create project. Please try again.'))
    } finally {
      setCreating(false)
    }
  }

  async function handleImportZip(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    try {
      setLoading(true)
      const formData = new FormData()
      formData.append('file', file)
      const res = await apiClient.post<ProjectSummary>('/api/projects/import-zip', formData)
      const project = res.data
      navigate(`/projects/${project.id}`)
    } catch (error) {
      alert('Failed to import ZIP file.')
    } finally {
      setLoading(false)
    }
  }

  async function handleProjectAction(projectId: string, action: 'archive' | 'trash' | 'restore') {
    try {
      setPendingProjectActionId(projectId)
      await apiClient.post(`/api/projects/${projectId}/${action}`)
      await loadDashboard()
    } catch (error) {
      alert(`Failed to ${action} project.`)
    } finally {
      setPendingProjectActionId(null)
    }
  }

  async function handleProjectStateUpdate(projectId: string, patch: { isStarred?: boolean; isPinned?: boolean }) {
    try {
      setPendingProjectActionId(projectId)
      await apiClient.patch(`/api/projects/${projectId}/state`, patch)
      await loadDashboard()
    } catch (error) {
      alert('Failed to update project state.')
    } finally {
      setPendingProjectActionId(null)
    }
  }

  async function handleProjectClone(projectId: string, action: 'copy' | 'fork') {
    try {
      setPendingProjectActionId(projectId)
      const res = await apiClient.post<ProjectSummary>(`/api/projects/${projectId}/${action}`)
      const project = res.data
      navigate(`/projects/${project.id}`)
    } catch (error) {
      alert(`Failed to ${action} project.`)
    } finally {
      setPendingProjectActionId(null)
    }
  }

  async function handlePublishTemplate(project: DashboardProject, event: ReactMouseEvent) {
    event.stopPropagation()
    try {
      setPublishingTemplateProjectId(project.id)
      await apiClient.post(`/api/projects/${project.id}/publish-template`)
      alert('Project successfully published as a community template!')
    } catch (error) {
      alert('Failed to publish project as a template.')
    } finally {
      setPublishingTemplateProjectId(null)
    }
  }

  function handleDeleteClick(project: ProjectSummary, event: ReactMouseEvent) {
    event.stopPropagation()
    setProjectPendingDelete(project)
  }

  async function handleDeleteConfirmed(deleteFromDrive: boolean) {
    if (!projectPendingDelete) return
    try {
      setDeletingId(projectPendingDelete.id)
      await apiClient.delete(`/api/projects/${projectPendingDelete.id}?deleteFromDrive=${deleteFromDrive}`)
      setProjectPendingDelete(null)
      await loadDashboard()
    } catch (error) {
      alert('Failed to delete project.')
    } finally {
      setDeletingId(null)
    }
  }

  function handleMoveClick(project: DashboardProject) {
    setMoveProject(project)
    setMoveTargetTeamId(project.teamId ?? 'personal')
  }

  async function handleMoveConfirm() {
    if (!moveProject) return
    try {
      setMovingProjectId(moveProject.id)
      await apiClient.patch(`/api/projects/${moveProject.id}/workspace`, { teamId: moveTargetTeamId === 'personal' ? null : moveTargetTeamId })
      setMoveProject(null)
      await loadDashboard()
    } catch (error) {
      alert('Failed to move project.')
    } finally {
      setMovingProjectId(null)
    }
  }

  async function handleEmptyTrash() {
    if (!window.confirm('Permanently delete all projects in your trash? This cannot be undone.')) return
    try {
      setEmptyingTrash(true)
      await apiClient.post('/api/projects/trash/empty')
      await loadDashboard()
    } catch (error) {
      alert('Failed to empty trash.')
    } finally {
      setEmptyingTrash(false)
    }
  }

  async function handleInvitationResponse(invitationId: string, action: 'accept' | 'reject') {
    try {
      setRespondingInvitationId(invitationId)
      await apiClient.post(`/api/invitations/${invitationId}/respond`, {
        action,
        proof: linkedInvitation?.id === invitationId ? highlightedInvitationProof : undefined,
      })
      if (linkedInvitation?.id === invitationId) {
        setLinkedInvitation(null)
      }
      await loadDashboard()
    } catch (error) {
      alert(`Failed to ${action} invitation.`)
    } finally {
      setRespondingInvitationId(null)
    }
  }

  const allProjects = useMemo(() => {
    if (!dashboard) return []
    const mapped: DashboardProject[] = dashboard.activeProjects.map((p) => ({
      ...p,
      ownerName: p.ownerName || 'Unknown',
      teamName: p.teamName || null,
      state: p.state || { isStarred: false, isPinned: false, archivedAt: null, trashedAt: null, lastOpenedAt: null }
    }))
    return mapped.sort((a, b) => compareProjects(a, b, sortBy))
  }, [dashboard, sortBy])

  const trashedProjects = useMemo(() => {
    if (!dashboard) return []
    const mapped: DashboardProject[] = dashboard.trashedProjects.map((p) => ({
      ...p,
      ownerName: p.ownerName || 'Unknown',
      teamName: p.teamName || null,
      state: p.state || { isStarred: false, isPinned: false, archivedAt: null, trashedAt: null, lastOpenedAt: null }
    }))
    return mapped.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [dashboard])

  const pinnedProjects = useMemo(() => allProjects.filter((p) => p.state.isPinned), [allProjects])
  const unpinnedProjects = useMemo(() => allProjects.filter((p) => !p.state.isPinned), [allProjects])

  const filteredProjects = useMemo(() => {
    return unpinnedProjects.filter((p) =>
      matchesProjectFilters(p, { roleFilter, starFilter, ownerFilter, teamFilter, searchQuery }) &&
      matchesStatusFilter(p, statusFilter),
    )
  }, [unpinnedProjects, roleFilter, starFilter, ownerFilter, teamFilter, searchQuery, statusFilter])

  const ownerOptions = useMemo(() => {
    const names = new Set<string>()
    allProjects.forEach((p) => names.add(p.ownerName))
    return Array.from(names).sort()
  }, [allProjects])

  const hasActiveFilters = roleFilter !== 'all' || starFilter !== 'all' || ownerFilter !== 'all' || teamFilter !== 'all' || statusFilter !== 'active' || searchQuery !== ''

  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending')
  const visiblePendingInvitations = linkedInvitation && !pendingInvitations.some((invitation) => invitation.id === linkedInvitation.id)
    ? [linkedInvitation, ...pendingInvitations]
    : pendingInvitations

  useEffect(() => {
    if (visiblePendingInvitations.length === 0) {
      setShowInvitationCenter(false)
    }
  }, [visiblePendingInvitations.length])

  const renderInvitationCard = (invitation: ProjectInvitation, compact = false) => {
    const needsAccountLink = linkedInvitation?.id === invitation.id && invitation.email.toLowerCase() !== (user?.email ?? '').toLowerCase()

    return (
      <li
        key={invitation.id}
        id={`invitation-${invitation.id}`}
        className={[
          styles.invitationCard,
          compact ? styles.invitationCardCompact : '',
          highlightedInvitationId === invitation.id ? styles.invitationCardHighlight : '',
        ].filter(Boolean).join(' ')}
      >
        <div className={styles.cardBody}>
          <span className={styles.cardTitle}>{invitation.projectTitle}</span>
          <div className={styles.metaRow}>
            <span className={styles.roleBadge}>{roleLabel(invitation.role)}</span>
            <span className={styles.cardDate}>Invited by {invitation.invitedByName}</span>
          </div>
          {needsAccountLink ? (
            <p className={styles.cardDate} style={{ marginTop: 8 }}>
              This invitation was sent to {invitation.email}. Accepting it will attach this project to your signed-in Google account, {user?.email}.
            </p>
          ) : null}
        </div>
        <div className={styles.invitationActions}>
          <button
            className={styles.acceptBtn}
            onClick={() => void handleInvitationResponse(invitation.id, 'accept')}
            disabled={respondingInvitationId === invitation.id}
          >
            Accept
          </button>
          <button
            className={styles.rejectBtn}
            onClick={() => void handleInvitationResponse(invitation.id, 'reject')}
            disabled={respondingInvitationId === invitation.id}
          >
            Reject
          </button>
        </div>
      </li>
    )
  }

  const driveWorkspaceConfigured = Boolean(user?.driveRootFolderId)

  return (
    <div className={styles.dashboard}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <img src={`/logo.svg?v=${Date.now()}`} alt="Typstr" />
        </div>
        <nav className={styles.sidebarNav}>
          <button
            className={[styles.sidebarBtn, activeView === 'projects' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveView('projects')}
            title="Projects"
            aria-label="Projects"
          >
            <HomeIcon />
          </button>
          <button
            className={[styles.sidebarBtn, activeView === 'new-project' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => { setSelectedProjectFormat('typst'); setActiveView('new-project') }}
            disabled={!driveWorkspaceConfigured}
            title="Create Project"
            aria-label="Create project"
          >
            <PlusIcon />
          </button>
          <button
            className={styles.sidebarBtn}
            onClick={() => document.getElementById('project-zip-import')?.click()}
            disabled={!driveWorkspaceConfigured || syncing}
            title="Import ZIP"
            aria-label="Import ZIP"
          >
            <ImportIcon />
          </button>
          <button
            className={[styles.sidebarBtn, activeView === 'teams' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => { setActiveView('teams'); if (teams.length > 0 && selectedTeamId === 'personal') setSelectedTeamId(teams[0].id) }}
            title="Workspaces"
            aria-label="Workspaces"
          >
            <UsersIcon />
          </button>
          <button
            className={[styles.sidebarBtn, activeView === 'tasks' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveView('tasks')}
            title="My Tasks"
            aria-label="My tasks"
          >
            <TasksIcon />
          </button>
          <button
            className={styles.sidebarBtn}
            onClick={() => setShowGlobalSearch(true)}
            title="Search all projects (Ctrl+Shift+F)"
            aria-label="Search all projects"
          >
            <GlobalSearchIcon />
          </button>
          <button
            className={[styles.sidebarBtn, activeView === 'walkthrough' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveView('walkthrough')}
            title="Walkthrough"
            aria-label="Walkthrough"
          >
            <WalkthroughIcon />
          </button>
          <button
            className={[styles.sidebarBtn, activeView === 'trash' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveView('trash')}
            title="Trash"
            aria-label="Trash"
          >
            <TrashIcon />
          </button>
        </nav>
        <div className={styles.sidebarFooter}>
          {user?.avatarUrl && (
            <button className={styles.sidebarBtn} title={`${user.name} · Profile`} onClick={openProfileSettings} aria-label="Open profile settings">
              <img src={user.avatarUrl} alt={user.name} className={styles.headerAvatar} style={{ margin: 0 }} referrerPolicy="no-referrer" />
            </button>
          )}
          {user?.isAdmin && (
            <button
              className={styles.sidebarBtn}
              onClick={() => navigate('/admin')}
              title="Admin"
              aria-label="Admin"
            >
              <ShieldIcon />
            </button>
          )}
          <button
            className={[styles.sidebarBtn, activeView === 'settings' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveView('settings')}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            className={[styles.sidebarBtn, activeView === 'feedback' ? styles.sidebarBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => { setFeedbackTab('feedback'); setActiveView('feedback') }}
            title="Feedback"
            aria-label="Feedback"
          >
            <FeedbackIcon />
          </button>
          <button
            className={styles.sidebarBtn}
            onClick={() => void logout()}
            title="Logout"
            aria-label="Logout"
          >
            <LogOutIcon />
          </button>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <div className={styles.userRow}>
              {user?.avatarUrl && (
                <button
                  type="button"
                  onClick={openProfileSettings}
                  aria-label="Open profile settings"
                  title="Open profile settings"
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', lineHeight: 0 }}
                >
                  <img src={user.avatarUrl} alt={user.name} className={styles.headerAvatar} referrerPolicy="no-referrer" />
                </button>
              )}
              <p className={styles.kicker}>{user?.name ?? user?.email}</p>
            </div>
            <h1>
              {activeView === 'projects' && 'Document Workspace'}
              {activeView === 'teams' && 'Team Workspaces'}
              {activeView === 'walkthrough' && 'Walkthrough'}
              {activeView === 'feedback' && 'Feedback'}
              {activeView === 'trash' && 'Trash'}
              {activeView === 'new-project' && 'New Project'}
              {activeView === 'settings' && ' '}
              {activeView === 'tasks' && 'My Tasks'}
            </h1>
            <p className={styles.headerSubtitle}>
              {activeView === 'projects' && 'A calmer home for collaborative writing, reviewing, and publishing.'}
              {activeView === 'teams' && 'Manage your teams and collaborative workspaces.'}
              {activeView === 'walkthrough' && 'Step-by-step onboarding tracks for Typst and LaTeX in a dedicated workspace.'}
              {activeView === 'feedback' && 'Send feedback, review prior submissions, and continue feedback threads.'}
              {activeView === 'trash' && 'Restore or permanently delete your removed projects.'}
              {activeView === 'new-project' && 'Create a document workspace and choose a starter template.'}
              {activeView === 'settings' && 'Customize your interface, typography, and AI writing assistance.'}
              {activeView === 'tasks' && 'Comments and threads assigned to you across all projects.'}
            </p>
          </div>

          <div className={styles.headerActions} style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' }}>
            <div className={styles.notificationWrap}>
              <button
                className={[styles.secondaryBtn, styles.notificationBtn, showInvitationCenter ? styles.notificationBtnActive : ''].filter(Boolean).join(' ')}
                onClick={() => setShowInvitationCenter((current) => !current)}
                title={visiblePendingInvitations.length > 0 ? `${visiblePendingInvitations.length} pending invitation${visiblePendingInvitations.length === 1 ? '' : 's'}` : 'Invitations'}
                aria-label={visiblePendingInvitations.length > 0 ? `${visiblePendingInvitations.length} pending invitation${visiblePendingInvitations.length === 1 ? '' : 's'}` : 'Invitations'}
                type="button"
              >
                <NotificationIcon />
                {visiblePendingInvitations.length > 0 ? <span className={styles.notificationBadge}>{visiblePendingInvitations.length}</span> : null}
              </button>
              {showInvitationCenter ? (
                <div className={styles.notificationPanel}>
                  <div className={styles.notificationPanelHeader}>
                    <strong>Invitations</strong>
                    <span>{visiblePendingInvitations.length}</span>
                  </div>
                  {visiblePendingInvitations.length > 0 ? (
                    <ul className={styles.notificationInvitationList}>
                      {visiblePendingInvitations.map((invitation) => renderInvitationCard(invitation, true))}
                    </ul>
                  ) : (
                    <p className={styles.emptyInline}>No pending invitations.</p>
                  )}
                </div>
              ) : null}
            </div>
            {activeView === 'projects' && (
              <>
                <div className={styles.headerStat}>
                  <strong>{dashboard?.activeProjects.length ?? 0}</strong>
                  <span>active</span>
                </div>
                {driveWorkspaceConfigured ? (
                  <button className={styles.secondaryBtn} onClick={() => void handleSync()} disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                ) : (
                  <button className={styles.newBtn} onClick={() => void handleConfigureDriveWorkspace()} disabled={isConfiguringDriveWorkspace}>
                    {isConfiguringDriveWorkspace ? 'Setting up…' : 'Setup Drive Workspace'}
                  </button>
                )}
              </>
            )}
            {activeView === 'trash' && (
              <button
                className={styles.sidebarBtn}
                onClick={() => void handleEmptyTrash()}
                disabled={emptyingTrash || trashedProjects.filter(p => p.role === 'owner').length === 0}
                title="Empty trash"
                aria-label="Empty trash"
                style={{ color: 'var(--danger)' }}
              >
                <Trash2 size={NAV_ICON_SIZE} aria-hidden />
              </button>
            )}
            {activeView === 'teams' && (
              <button className={styles.newBtn} onClick={() => {
                const name = window.prompt('Workspace (Team) name')
                if (name?.trim()) {
                  setNewTeamName(name.trim())
                  void handleCreateTeam()
                }
              }}>
                Create Team
              </button>
            )}
            {activeView === 'new-project' && (
              <button className={styles.newBtn} onClick={() => void handleCreate()} disabled={creating || !newProjectTitle.trim()}>
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            )}
          </div>
        </header>

        <main className={styles.main}>
          {createError ? <p className={styles.error}>{createError}</p> : null}

          {!driveWorkspaceConfigured ? (
            <div className={styles.settingsContainer}>
              <div className={styles.settingsSection}>
                <h3>Choose your Typstr folder</h3>
                <p>Typstr will create and use one dedicated Google Drive folder for your workspace. Until you choose it, the app will not sync or browse project folders.</p>
                
                <div className={styles.settingsGrid}>
                  <div className={styles.settingsLabel}>Workspace Setup</div>
                  <div className={styles.settingsControl}>
                    <div className={styles.inlineForm} style={{ marginTop: 0 }}>
                      <input
                        className={styles.panelInput}
                        value={driveWorkspaceName}
                        onChange={(event) => setDriveWorkspaceName(event.target.value)}
                        placeholder="Folder name (e.g. My Typstr)"
                        maxLength={32}
                      />
                      <button className={styles.newBtn} onClick={() => void handleConfigureDriveWorkspace()} disabled={isConfiguringDriveWorkspace || !driveWorkspaceName.trim()}>
                        {isConfiguringDriveWorkspace ? 'Setting up…' : 'Setup Workspace'}
                      </button>
                    </div>
                    {driveWorkspaceError ? <p className={styles.error} style={{ marginTop: 12 }}>{driveWorkspaceError}</p> : null}
                  </div>
                </div>
              </div>

              <div className={styles.settingsSection}>
                <h3>Technical Details</h3>
                <div className={styles.onboardingSteps}>
                  <article className={styles.guideCard}>
                    <strong>Scope</strong>
                    <span>Authentication uses the Google Drive `drive.file` scope, not full-drive access.</span>
                  </article>
                  <article className={styles.guideCard}>
                    <strong>Boundary</strong>
                    <span>After setup, Typstr is coded to operate inside the configured workspace folder instead of scanning the rest of Drive.</span>
                  </article>
                  <article className={styles.guideCard}>
                    <strong>Next step</strong>
                    <span>Choose a folder name below to create your Typstr workspace and unlock sync plus project creation.</span>
                  </article>
                </div>
              </div>
            </div>
          ) : loading && !dashboard ? (
            <div className={styles.list}>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className={styles.skeletonCard}>
                  <div className={styles.skeletonLine} style={{ width: '60%' }} />
                  <div className={styles.skeletonLine} style={{ width: '35%' }} />
                </div>
              ))}
            </div>
          ) : dashboardError && !dashboard ? (
            <section className={styles.emptyStateCard}>
              <h2>Dashboard unavailable</h2>
              <p className={styles.heroText}>
                We could not load your projects right now.
              </p>
              <div className={styles.heroActions}>
                <button className={styles.newBtn} onClick={() => void loadDashboard()}>
                  Retry
                </button>
                <button className={styles.secondaryBtn} onClick={() => void logout()}>
                  <LogOutIcon />
                  <span>Sign out</span>
                </button>
              </div>
            </section>
          ) : (
            <>
              {activeView === 'projects' && (
                <>
                  {visiblePendingInvitations.length > 0 && (
                    <section className={styles.invitationSection}>
                      <div className={styles.sectionHeader}>
                        <h2>Pending Invitations</h2>
                        <span>{visiblePendingInvitations.length}</span>
                      </div>
                      <ul className={styles.invitationList}>
                        {visiblePendingInvitations.map((invitation) => renderInvitationCard(invitation))}
                      </ul>
                    </section>
                  )}

                  {allProjects.length === 0 ? (
                    <div className={styles.settingsContainer}>
                      <div className={styles.settingsSection}>
                        <h3>Your workspace is ready</h3>
                        <p>Create a project, import a ZIP, or start a team workspace to see recent, pinned, and shared work show up here.</p>

                        <div className={styles.settingsGrid}>
                          <div className={styles.settingsLabel}>Get Started</div>
                          <div className={styles.heroActions} style={{ marginTop: 0 }}>
                            <button className={styles.newBtn} onClick={() => { setSelectedProjectFormat('typst'); setActiveView('new-project') }} disabled={!driveWorkspaceConfigured}>Create project</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (

                    <>
                      {pinnedProjects.length > 0 && (
                        <ProjectSection
                          title="Pinned"
                          description="Quick access to projects you decided should always stay close."
                          projects={pinnedProjects}
                          emptyMessage="Pin a project to keep it in this shortlist."
                          pendingProjectActionId={pendingProjectActionId}
                          onOpen={(projectId) => navigate(`/projects/${projectId}`)}
                          onToggleStar={(project) => void handleProjectStateUpdate(project.id, { isStarred: !project.state.isStarred })}
                          onTogglePin={(project) => void handleProjectStateUpdate(project.id, { isPinned: !project.state.isPinned })}
                          onArchive={(projectId) => void handleProjectAction(projectId, 'archive')}
                          onRestore={(projectId) => void handleProjectAction(projectId, 'restore')}
                          onCopy={(project) => void handleProjectClone(project.id, 'copy')}
                          onPublishTemplate={handlePublishTemplate}
                          publishingTemplateProjectId={publishingTemplateProjectId}
                          onDelete={handleDeleteClick}
                          onMove={handleMoveClick}
                          teams={teams}
                        />
                      )}

                      <section className={styles.filterBar}>
                        <div className={styles.filterBarLabel}>
                          <span className={styles.filterBarTitle}>Filter Projects</span>
                          <span className={styles.filterBarCount}>{filteredProjects.length} shown</span>
                        </div>
                        <div className={styles.searchWrap}>
                          <label className={styles.filterField}>
                            <span>Search</span>
                            <input
                              className={styles.filterInput}
                              value={searchQuery}
                              onChange={(event) => setSearchQuery(event.target.value)}
                              placeholder="Search by title, owner, or workspace"
                            />
                          </label>
                        </div>
                        <div className={styles.filterGroup}>
                          <label className={styles.filterField}>
                            <span>Sort</span>
                            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as DashboardSort)}>
                              {SORT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.filterField}>
                            <span>Role</span>
                            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | ProjectRole)}>
                              <option value="all">All roles</option>
                              <option value="owner">Owner</option>
                              <option value="manager">Manager</option>
                              <option value="editor">Writer</option>
                              <option value="viewer">Reviewer</option>
                            </select>
                          </label>
                          <label className={styles.filterField}>
                            <span>Status</span>
                            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DashboardStatus)}>
                              <option value="active">Active</option>
                              <option value="all">All statuses</option>
                              <option value="archived">Archived</option>
                              <option value="trashed">Trash</option>
                            </select>
                          </label>
                          <label className={styles.filterField}>
                            <span>Owner</span>
                            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                              <option value="all">All owners</option>
                              {ownerOptions.map((ownerName) => (
                                <option key={ownerName} value={ownerName}>{ownerName}</option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.filterField}>
                            <span>Workspace</span>
                            <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                              <option value="all">All workspaces</option>
                              <option value="personal">Personal only</option>
                              {teams.map((team) => (
                                <option key={team.id} value={team.id}>{team.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className={styles.filterChips}>
                          <button
                            className={[styles.filterChip, starFilter === 'starred' ? styles.filterChipActive : ''].filter(Boolean).join(' ')}
                            onClick={() => setStarFilter((current) => current === 'starred' ? 'all' : 'starred')}
                            type="button"
                          >
                            Starred
                          </button>
                          {hasActiveFilters ? (
                            <button
                              className={styles.clearFiltersBtn}
                              onClick={() => {
                                setRoleFilter('all')
                                setStarFilter('all')
                                setOwnerFilter('all')
                                setTeamFilter('all')
                                setStatusFilter('active')
                                setSearchQuery('')
                                setSortBy('recent')
                              }}
                              type="button"
                            >
                              Clear filters
                            </button>
                          ) : null}
                        </div>
                      </section>

                      <ProjectSection
                        title="Projects"
                        description="Showing all projects that match the filters above."
                        projects={filteredProjects}
                        emptyMessage="No projects match the current filters."
                        pendingProjectActionId={pendingProjectActionId}
                        onOpen={(projectId) => navigate(`/projects/${projectId}`)}
                        onToggleStar={(project) => void handleProjectStateUpdate(project.id, { isStarred: !project.state.isStarred })}
                        onTogglePin={(project) => void handleProjectStateUpdate(project.id, { isPinned: !project.state.isPinned })}
                        onArchive={(projectId) => void handleProjectAction(projectId, 'archive')}
                        onRestore={(projectId) => void handleProjectAction(projectId, 'restore')}
                        onCopy={(project) => void handleProjectClone(project.id, 'copy')}

                        onPublishTemplate={handlePublishTemplate}
                        publishingTemplateProjectId={publishingTemplateProjectId}
                        onDelete={handleDeleteClick}
                        onMove={handleMoveClick}
                        teams={teams}
                      />

                      {dashboard?.nextCursor && (
                        <div style={{ textAlign: 'center', marginTop: 18 }}>
                          <button className={styles.secondaryBtn} disabled={loadingMore} onClick={() => void loadDashboard(dashboard.nextCursor ?? undefined)}>
                            {loadingMore ? 'Loading…' : 'Load more projects'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {activeView === 'trash' && dashboard && (
                <ProjectSection
                  title="Trash"
                  description="Restore projects, duplicate them before recovery, or permanently remove all trashed projects you own."
                  projects={trashedProjects}
                  emptyMessage="Your trash is empty."
                  pendingProjectActionId={pendingProjectActionId}
                  onOpen={(projectId) => navigate(`/projects/${projectId}`)}
                  onToggleStar={(project) => void handleProjectStateUpdate(project.id, { isStarred: !project.state.isStarred })}
                  onTogglePin={(project) => void handleProjectStateUpdate(project.id, { isPinned: !project.state.isPinned })}
                  onArchive={(projectId) => void handleProjectAction(projectId, 'archive')}
                  onRestore={(projectId) => void handleProjectAction(projectId, 'restore')}
                  onCopy={(project) => void handleProjectClone(project.id, 'copy')}
                  onPublishTemplate={handlePublishTemplate}
                  publishingTemplateProjectId={publishingTemplateProjectId}
                  onDelete={handleDeleteClick}
                  onMove={handleMoveClick}
                  teams={teams}
                />
              )}

              {activeView === 'teams' && (
                <div className={styles.settingsContainer}>
                  <div className={styles.settingsSection}>
                    <h3>Workspace Management</h3>
                    <p>Create a team workspace, add members, and launch shared projects into the right home from the start.</p>
                    <div className={styles.teamStatsGrid}>
                      <article className={styles.teamStatCard}>
                        <strong>{teams.length}</strong>
                        <span>Team workspaces</span>
                      </article>
                      <article className={styles.teamStatCard}>
                        <strong>{selectedTeamId === 'personal' ? 'Personal' : (teams.find((team) => team.id === selectedTeamId)?.name ?? 'Team')}</strong>
                        <span>Active workspace</span>
                      </article>
                      <article className={styles.teamStatCard}>
                        <strong>{selectedTeamId === 'personal' ? 0 : selectedTeamMembers.length}</strong>
                        <span>Members in active team</span>
                      </article>
                    </div>
                    
                    <div className={styles.settingsGrid}>
                      <div className={styles.settingsLabel}>New Team</div>
                      <div className={styles.inlineForm} style={{ marginTop: 0 }}>
                        <input
                          className={styles.panelInput}
                          value={newTeamName}
                          onChange={(event) => setNewTeamName(event.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newTeamName.trim() && !creatingTeam) void handleCreateTeam() }}
                          placeholder="Team name"
                          maxLength={255}
                        />
                        <button className={styles.secondaryBtn} onClick={() => void handleCreateTeam()} disabled={creatingTeam || !newTeamName.trim()}>
                          {creatingTeam ? 'Creating…' : 'Create team'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={styles.settingsSection}>
                    <div className={styles.settingsGrid}>
                      <div className={styles.settingsLabel}>Active Workspace</div>
                      <div>
                        {teams.length === 0 ? (
                          <p className={styles.emptyInline} style={{ marginTop: 0 }}>No teams yet. Create one above.</p>
                        ) : (
                          <div className={styles.workspacePicker} style={{ marginTop: 0 }}>
                            {teams.map((team) => (
                              <button
                                key={team.id}
                                className={[styles.workspaceChip, selectedTeamId === team.id ? styles.workspaceChipActive : ''].filter(Boolean).join(' ')}
                                onClick={() => setSelectedTeamId(team.id)}
                                type="button"
                              >
                                {team.name}
                              </button>
                            ))}
                          </div>
                        )}

                        {selectedTeamId !== 'personal' && (
                          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
                            <div className={styles.settingsGrid}>
                              <div className={styles.settingsLabel}>Invite Member</div>
                              <div className={styles.inlineForm} style={{ marginTop: 0 }}>
                                <input
                                  className={styles.panelInput}
                                  value={teamInviteEmail}
                                  onChange={(event) => setTeamInviteEmail(event.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && teamInviteEmail.trim() && !invitingToTeam) void handleAddTeamMember() }}
                                  placeholder="Member email"
                                />
                                <button className={styles.secondaryBtn} onClick={() => void handleAddTeamMember()} disabled={invitingToTeam || !teamInviteEmail.trim()}>
                                  {invitingToTeam ? 'Inviting…' : 'Add member'}
                                </button>
                              </div>
                            </div>

                            {teamError ? <p className={styles.error}>{teamError}</p> : null}

                            <div>
                              <h4 style={{ marginBottom: 16, color: 'var(--text-strong)', fontSize: 14 }}>Members</h4>
                              {teamLoading ? (
                                <p className={styles.emptyInline}>Loading…</p>
                              ) : selectedTeamMembers.length === 0 ? (
                                <p className={styles.emptyInline}>No members yet.</p>
                              ) : (
                                <ul className={styles.teamMemberList}>
                                  {selectedTeamMembers.map((member) => {
                                    const isOwner = member.role === 'owner'
                                    const currentUserIsOwner = selectedTeamMembers.find((m) => m.userId === user?.id)?.role === 'owner'
                                    return (
                                      <li key={member.userId} className={styles.teamMemberItem}>
                                        <div className={styles.cardBody}>
                                          <span className={styles.cardTitle}>{member.name}</span>
                                          <span className={styles.cardDate}>{member.email}</span>
                                        </div>
                                        {isOwner ? (
                                          <span className={styles.roleBadge}>owner</span>
                                        ) : currentUserIsOwner ? (
                                          <>
                                            <select
                                              className={styles.modalInput}
                                              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                                              value={member.role}
                                              onChange={(e) => void handleChangeTeamMemberRole(member.userId, e.target.value)}
                                            >
                                              <option value="member">member</option>
                                              <option value="editor">editor</option>
                                              <option value="manager">manager</option>
                                            </select>
                                            <button className={styles.deleteBtn} onClick={() => void handleRemoveTeamMember(member.userId)}>
                                              Remove
                                            </button>
                                          </>
                                        ) : (
                                          <span className={styles.roleBadge}>{member.role}</span>
                                        )}
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                            </div>

                            {selectedTeamMembers.find((m) => m.userId === user?.id)?.role === 'owner' && (
                              <button
                                className={styles.deleteBtn}
                                onClick={() => void handleDeleteTeam()}
                                disabled={deletingTeam}
                                style={{ alignSelf: 'flex-start' }}
                              >
                                {deletingTeam ? 'Deleting…' : 'Delete team'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeView === 'walkthrough' && (
                <div className={styles.settingsContainer}>
                  <section className={styles.settingsSection}>
                    <div className={styles.sectionHeader}>
                      <div>
                        <h2>Professional Walkthrough</h2>
                        <p className={styles.sectionDescription}>Structured onboarding for both Typst and LaTeX projects from a dedicated page.</p>
                      </div>
                    </div>
                    <div className={styles.workspacePicker} style={{ marginTop: 0, marginBottom: 20 }}>
                      <button
                        className={[styles.workspaceChip, walkthroughTrack === 'typst' ? styles.workspaceChipActive : ''].filter(Boolean).join(' ')}
                        onClick={() => setWalkthroughTrack('typst')}
                        type="button"
                      >
                        Typst
                      </button>
                      <button
                        className={[styles.workspaceChip, walkthroughTrack === 'latex' ? styles.workspaceChipActive : ''].filter(Boolean).join(' ')}
                        onClick={() => setWalkthroughTrack('latex')}
                        type="button"
                      >
                        LaTeX
                      </button>
                    </div>
                    <div className={styles.onboardingSteps}>
                      {(walkthroughTrack === 'typst' ? TYPST_TUTORIAL_STEPS : LATEX_WALKTHROUGH_STEPS).map((step, index) => (
                        <article key={`${walkthroughTrack}-${index}`} className={styles.guideCard}>
                          <strong>{index + 1}. {step.title}</strong>
                          <span>{'description' in step ? step.description : step.explanation}</span>
                        </article>
                      ))}
                    </div>
                    <div className={styles.heroActions} style={{ marginTop: 20 }}>
                      <button className={styles.newBtn} onClick={() => { setSelectedProjectFormat(walkthroughTrack); setActiveView('new-project') }}>
                        Start {walkthroughTrack === 'typst' ? 'Typst' : 'LaTeX'} project
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {activeView === 'new-project' && dashboard && (
                <div className={styles.settingsContainer} style={{ maxWidth: '1000px' }}>
                  <div className={styles.settingsSection}>
                    <div className={styles.settingsGrid}>
                      <div>
                        <h3>Project Identity</h3>
                        <p>Define the title and location for your new document.</p>
                      </div>
                      <div className={styles.createModalForm}>
                        <label className={styles.modalField}>
                          <span>Project title</span>
                          <input className={styles.modalInput} value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newProjectTitle.trim() && !creating) void handleCreate() }} autoFocus maxLength={255} placeholder="My Research Project" />
                        </label>

                        <label className={styles.modalField}>
                          <span>Workspace</span>
                          <select className={styles.modalInput} value={selectedWorkspaceTeamId} onChange={(event) => setSelectedWorkspaceTeamId(event.target.value)}>
                            <option value="personal">Personal workspace</option>
                            {teams.map((team) => (
                              <option key={team.id} value={team.id}>{team.name}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className={styles.settingsSection}>
                    <div className={styles.settingsGrid}>
                      <div>
                        <h3>Document Format</h3>
                        <p>Select the underlying technology for your project.</p>
                      </div>
                      <div className={styles.settingsControl}>
                        <select className={styles.modalInput} value={selectedProjectFormat} onChange={(event) => {
                          const val = event.target.value as ProjectFormat
                          setSelectedProjectFormat(val)
                        }}>
                          <option value="typst">Typst</option>
                          <option value="latex">LaTeX</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className={styles.settingsSection}>
                    <h3>Starter Template</h3>
                    <p>Browse built-in and community templates to jumpstart your work.</p>
                    
                    <div className={styles.modalTemplateGallery} style={{ maxHeight: 'none', overflowY: 'visible', marginTop: 24 }}>
                      {(selectedProjectFormat === 'typst'
                        ? dashboard.templates
                        : selectedProjectFormat === 'latex'
                          ? LATEX_TEMPLATE_OPTIONS
                          : LATEX_TEMPLATE_OPTIONS.slice(0, 1)
                      ).map((template) => (
                        <button
                          key={template.id}
                          className={[styles.templateCard, selectedTemplateId === template.id ? styles.templateCardActive : ''].filter(Boolean).join(' ')}
                          onClick={() => setSelectedTemplateId(template.id as ProjectTemplateId)}
                          type="button"
                        >
                          <strong>{template.title}</strong>
                          <p>{template.description}</p>
                          <span className={styles.templateDesc}>{template.category} · {template.kind === 'community' ? 'Community' : 'Built-in'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeView === 'settings' && (
                <div className={styles.settingsContainer}>
                  <div className={styles.settingsTabRow}>
                    {SETTINGS_TABS.map(tab => (
                      <button
                        key={tab.id}
                        className={[styles.settingsTab, settingsTab === tab.id ? styles.settingsTabActive : ''].filter(Boolean).join(' ')}
                        onClick={() => setSettingsTab(tab.id)}
                        type="button"
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className={styles.settingsContent}>
                    {settingsTab === 'general' && (
                      <>
                        <div className={styles.settingsSection}>
                          <div className={styles.settingsGrid}>
                            <div>
                              <h3>Color Theme</h3>
                              <p>Select a visual style for your workspace.</p>
                            </div>
                            <div className={styles.themeGrid}>
                              {THEME_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  className={[styles.templateCard, theme.presetId === preset.id ? styles.templateCardActive : ''].filter(Boolean).join(' ')}
                                  onClick={() => handleSelectTheme(preset.id)}
                                  style={{ padding: '12px' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: preset.vars['--page-bg'], border: `2px solid ${preset.vars['--accent']}` }} />
                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{preset.label}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className={styles.settingsSection}>
                          <div className={styles.settingsGrid}>
                            <div>
                              <h3>Interface Typography</h3>
                              <p>Choose the font family and size for the application UI.</p>
                            </div>
                            <div className={styles.settingsControl}>
                              <div className={styles.themeGrid}>
                                {UI_FONT_OPTIONS.map((opt) => (
                                  <button
                                    key={opt.value}
                                    className={[styles.templateCard, theme.uiFontFamily === opt.value ? styles.templateCardActive : ''].filter(Boolean).join(' ')}
                                    onClick={() => updateTheme({ uiFontFamily: opt.value })}
                                    style={{ textAlign: 'left' }}
                                    type="button"
                                  >
                                    <strong>{opt.label}</strong>
                                    <p style={{ margin: '8px 0 0', fontFamily: opt.value, fontSize: `${theme.uiFontSize}pt`, lineHeight: 1.4 }}>
                                      The quick brown fox jumps over the lazy dog
                                    </p>
                                  </button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '14px 0 10px' }}>
                                <span className={styles.settingsLabel} style={{ paddingTop: 0 }}>UI Font Size</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)' }}>{theme.uiFontSize}pt</span>
                              </div>
                              <input
                                type="range" min="9" max="24" step="1"
                                value={theme.uiFontSize}
                                onChange={(e) => updateTheme({ uiFontSize: Number(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className={styles.settingsSection}>
                          <div className={styles.settingsGrid}>
                            <div>
                              <h3>Editor Typography</h3>
                              <p>Configure the font and size for your writing environment.</p>
                            </div>
                            <div className={styles.settingsControl}>
                              <div className={styles.settingsLabel} style={{ marginBottom: 12 }}>Font Family</div>
                              <div className={styles.themeGrid}>
                                {EDITOR_FONT_OPTIONS.map((opt) => (
                                  <button
                                    key={opt.value}
                                    className={[styles.templateCard, theme.editorFontFamily === opt.value ? styles.templateCardActive : ''].filter(Boolean).join(' ')}
                                    onClick={() => updateTheme({ editorFontFamily: opt.value })}
                                    style={{ textAlign: 'left' }}
                                    type="button"
                                  >
                                    <strong>{opt.label}</strong>
                                    <p style={{ margin: '8px 0 0', fontFamily: opt.value, fontSize: `${theme.editorFontSize}pt`, lineHeight: 1.4 }}>
                                      The quick brown fox jumps over the lazy dog
                                    </p>
                                  </button>
                                ))}
                              </div>
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                <span className={styles.settingsLabel} style={{ paddingTop: 0 }}>Font Size</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)' }}>{theme.editorFontSize}pt</span>
                              </div>
                              <input 
                                type="range" min="9" max="24" step="1"
                                value={theme.editorFontSize} 
                                onChange={(e) => updateTheme({ editorFontSize: Number(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {settingsTab === 'shortcuts' && (
                      <div className={styles.settingsSection}>
                        <div className={styles.settingsGrid}>
                          <div>
                            <h3>Keyboard Shortcuts</h3>
                            <p>These bindings are saved per user and applied across projects.</p>
                          </div>
                          <div className={styles.settingsControl}>
                            <div className={styles.shortcutList}>
                              {SHORTCUT_BINDING_LABELS.map((entry) => (
                                <label key={entry.action} className={styles.shortcutRow}>
                                  <div className={styles.shortcutMeta}>
                                    <strong>{entry.label}</strong>
                                    <span>{entry.description}</span>
                                  </div>
                                  <input
                                    className={styles.shortcutInput}
                                    value={shortcutBindings[entry.action]}
                                    onChange={(event) => setShortcutBindings((current) => ({
                                      ...current,
                                      [entry.action]: event.target.value,
                                    }))}
                                    placeholder={DEFAULT_SHORTCUT_BINDINGS[entry.action]}
                                  />
                                </label>
                              ))}
                            </div>
                            <div className={styles.heroActions} style={{ marginTop: 20 }}>
                              <button className={styles.secondaryBtn} onClick={() => setShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)}>Reset defaults</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsTab === 'profile' && (
                      <div className={styles.settingsSection}>
                        <div className={styles.settingsGrid}>
                          <div>
                            <h3>Profile</h3>
                            <p>Manage author metadata, affiliation, ORCID import, and institution verification.</p>
                          </div>
                          <div className={styles.settingsControl} style={{ maxWidth: 720 }}>
                            <ProfilePanel />
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsTab === 'subscription' && (
                      <div className={styles.settingsSection}>
                        <div className={styles.settingsGrid}>
                          <div>
                            <h3>Subscription</h3>
                            <p>Review your current plan, usage, verified domains, and effective limits.</p>
                          </div>
                          <div className={styles.settingsControl} style={{ maxWidth: 620 }}>
                            <SubscriptionPanel />
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsTab === 'permissions' && (
                      <div className={styles.settingsSection}>
                        <PermissionsPanel />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeView === 'tasks' && (
                <TasksView
                  tasks={myTasks}
                  isLoading={isLoadingTasks}
                  currentUserId={user?.id ?? ''}
                  onNavigate={(projectId: string, commentId: string) => navigate(`/projects/${projectId}?commentId=${commentId}`)}
                  onTasksChange={(updater) => setMyTasks((prev) => updater(prev))}
                />
              )}

              {activeView === 'feedback' && (
                <div className={styles.settingsContainer}>
                  <div className={styles.settingsTabRow}>
                    {[
                      { id: 'feedback', label: 'Send Feedback' },
                      { id: 'my-feedback', label: 'My Feedbacks' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        className={[styles.settingsTab, feedbackTab === tab.id ? styles.settingsTabActive : ''].filter(Boolean).join(' ')}
                        onClick={() => setFeedbackTab(tab.id as 'feedback' | 'my-feedback')}
                        type="button"
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.settingsContent}>
                    {feedbackTab === 'feedback' ? (
                      <div className={styles.settingsSection}>
                        <FeedbackPanel embedded />
                      </div>
                    ) : null}
                    {feedbackTab === 'my-feedback' ? (
                      <div className={styles.settingsSection}>
                        <UserFeedbackPanel embedded />
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <input
        id="project-zip-import"
        type="file"
        style={{ display: 'none' }}
        accept=".zip,application/zip"
        onChange={(event) => {
          void handleImportZip(event.target.files)
          event.currentTarget.value = ''
        }}
      />

      {projectPendingDelete && (
        <Suspense fallback={null}>
          <LazyDeleteProjectModal
            project={projectPendingDelete}
            isDeleting={deletingId === projectPendingDelete.id}
            onCancel={() => setProjectPendingDelete(null)}
            onConfirm={(deleteFromDrive) => void handleDeleteConfirmed(deleteFromDrive)}
          />
        </Suspense>
      )}

      {showGlobalSearch && (
        <GlobalSearchModal onClose={() => setShowGlobalSearch(false)} />
      )}

      {moveProject && (
        <Suspense fallback={null}>
          <LazyMoveProjectModal
            project={moveProject}
            teams={teams}
            targetTeamId={moveTargetTeamId}
            isMoving={movingProjectId === moveProject.id}
            onSelectTeam={setMoveTargetTeamId}
            onCancel={() => setMoveProject(null)}
            onConfirm={() => void handleMoveConfirm()}
          />
        </Suspense>
      )}
    </div>
  )
}

function ProjectSection({
  title,
  description,
  projects,
  emptyMessage,
  pendingProjectActionId,
  onOpen,
  onToggleStar,
  onTogglePin,
  onArchive,
  onRestore,
  onCopy,
  onPublishTemplate,
  publishingTemplateProjectId,
  onDelete,
  onMove,
  teams,
}: {
  title: string
  description: string
  projects: DashboardProject[]
  emptyMessage: string
  pendingProjectActionId: string | null
  onOpen: (projectId: string) => void
  onToggleStar: (project: DashboardProject) => void
  onTogglePin: (project: DashboardProject) => void
  onArchive: (projectId: string) => void
  onRestore: (projectId: string) => void
  onCopy: (project: DashboardProject) => void
  onPublishTemplate: (project: DashboardProject, event: ReactMouseEvent) => void
  publishingTemplateProjectId: string | null
  onDelete: (project: ProjectSummary, event: ReactMouseEvent) => void
  onMove: (project: DashboardProject) => void
  teams: Team[]
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: projects.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 6,
  })

  return (
    <section className={styles.invitationSection}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{title}</h2>
          <p className={styles.sectionDescription}>{description}</p>
        </div>
        <div className={styles.sectionHeaderActions}>
          <span>{projects.length}</span>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className={styles.emptyInline}>{emptyMessage}</p>
      ) : (
        <div ref={parentRef} className={styles.virtualListContainer}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const project = projects[virtualItem.index]
              return (
                <div
                  key={project.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${virtualItem.start}px)` }}
                >
                  <div className={styles.card} onClick={() => !project.state.trashedAt && onOpen(project.id)}>
                    <div className={styles.cardBody}>
                      <div className={styles.cardTitleRow}>
                        <span className={styles.cardTitle}>{project.title}</span>
                        <span className={styles.roleBadge}>{roleLabel(project.role)}</span>
                      </div>
                      <div className={styles.metaRow}>
                        {project.state.isPinned ? <span className={styles.cardDate}>Pinned</span> : null}
                        {project.state.isStarred ? <span className={styles.cardDate}>Starred</span> : null}
                        <span className={styles.cardDate}>Owner: {project.ownerName}</span>
                        <span className={styles.cardDate}>Workspace: {project.teamName ?? 'Personal'}</span>
                        <span className={styles.cardDate}>{project.fileCount} file{project.fileCount === 1 ? '' : 's'}</span>
                        <span className={styles.cardDate}>Updated {formatTimestamp(project.updatedAt)}</span>
                      </div>
                    </div>
                    {!project.state.trashedAt ? (
                      <div className={styles.cardActions}>
                        <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onToggleStar(project) }} disabled={pendingProjectActionId === project.id} title={project.state.isStarred ? 'Unstar' : 'Star'}>
                          <StarIcon filled={project.state.isStarred} />
                        </button>
                        <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onTogglePin(project) }} disabled={pendingProjectActionId === project.id} title={project.state.isPinned ? 'Unpin' : 'Pin'}>
                          <PinIcon filled={project.state.isPinned} />
                        </button>
                        {!project.state.archivedAt ? (
                          <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onArchive(project.id) }} disabled={pendingProjectActionId === project.id} title="Archive">
                            <ArchiveIcon />
                          </button>
                        ) : (
                          <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onRestore(project.id) }} disabled={pendingProjectActionId === project.id} title="Restore">
                            <HomeIcon />
                          </button>
                        )}
                        <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onCopy(project) }} disabled={pendingProjectActionId === project.id} title="Copy">
                          <CopyIcon />
                        </button>
                        {project.role === 'owner' && teams.length > 0 ? (
                          <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onMove(project) }} disabled={pendingProjectActionId === project.id} title="Move">
                            <MoveIcon />
                          </button>
                        ) : null}
                        <button className={styles.secondaryBtn} onClick={(event) => onPublishTemplate(project, event)} disabled={pendingProjectActionId === project.id || publishingTemplateProjectId === project.id || project.state.trashedAt !== null} title="Publish Template">
                          {publishingTemplateProjectId === project.id ? '…' : <ShareIcon />}
                        </button>
                        <button className={styles.deleteBtn} onClick={(event) => onDelete(project, event)} disabled={pendingProjectActionId === project.id || project.role !== 'owner'} title="Delete">
                          <TrashIcon />
                        </button>
                      </div>
                    ) : (
                      <div className={styles.trashCardMeta}>
                        <span className={styles.cardDate}>In Trash</span>
                        <div className={styles.cardActions}>
                          <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onRestore(project.id) }} disabled={pendingProjectActionId === project.id} title="Restore">
                            <HomeIcon />
                          </button>
                          <button className={styles.secondaryBtn} onClick={(event) => { event.stopPropagation(); onCopy(project) }} disabled={pendingProjectActionId === project.id} title="Copy">
                            <CopyIcon />
                          </button>
                          <button className={styles.deleteBtn} onClick={(event) => onDelete(project, event)} disabled={pendingProjectActionId === project.id || project.role !== 'owner'} title="Delete">
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

export function MoveProjectModal({
  project,
  teams,
  targetTeamId,
  isMoving,
  onSelectTeam,
  onCancel,
  onConfirm,
}: {
  project: DashboardProject
  teams: Team[]
  targetTeamId: string | 'personal'
  isMoving: boolean
  onSelectTeam: (teamId: string | 'personal') => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const currentTeamId = project.teamId ?? 'personal'
  const hasChanged = targetTeamId !== currentTeamId

  return (
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.modalEyebrow}>Move Project</p>
            <h2>Choose a workspace for <strong>{project.title}</strong></h2>
          </div>
          <button className={styles.modalCloseBtn} onClick={onCancel} aria-label="Close move project dialog">✕</button>
        </div>

        <p className={styles.modalText}>
          Currently in <strong>{project.teamName ?? 'Personal workspace'}</strong>. Select the destination workspace below.
        </p>

        <div className={styles.workspacePicker}>
          <button
            className={[styles.workspaceChip, targetTeamId === 'personal' ? styles.workspaceChipActive : ''].filter(Boolean).join(' ')}
            onClick={() => onSelectTeam('personal')}
            type="button"
          >
            Personal
          </button>
          {teams.map((team) => (
            <button
              key={team.id}
              className={[styles.workspaceChip, targetTeamId === team.id ? styles.workspaceChipActive : ''].filter(Boolean).join(' ')}
              onClick={() => onSelectTeam(team.id)}
              type="button"
            >
              {team.name}
            </button>
          ))}
        </div>

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onCancel} disabled={isMoving}>Cancel</button>
          <button className={styles.newBtn} onClick={onConfirm} disabled={!hasChanged || isMoving}>
            {isMoving ? 'Moving…' : 'Move project'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DeleteProjectModal({
  project,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  project: ProjectSummary
  isDeleting: boolean
  onCancel: () => void
  onConfirm: (deleteFromDrive: boolean) => void
}) {
  const [confirmationText, setConfirmationText] = useState('')
  const [deleteFromDrive, setDeleteFromDrive] = useState(false)

  useEffect(() => {
    setConfirmationText('')
    setDeleteFromDrive(false)
  }, [project.id])

  const isMatch = confirmationText === project.title

  return (
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.modalEyebrow}>Delete Project</p>
            <h2>Type the project name to confirm deletion</h2>
          </div>
          <button className={styles.modalCloseBtn} onClick={onCancel} aria-label="Close delete project dialog">✕</button>
        </div>

        <p className={styles.modalText}>
          This will permanently delete <strong>{project.title}</strong> from Typstr. This action cannot be undone.
        </p>

        <label className={styles.modalField}>
          <span>Enter the exact project name</span>
          <input
            className={styles.modalInput}
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && isMatch && !isDeleting) onConfirm(deleteFromDrive) }}
            placeholder={project.title}
            autoFocus
          />
        </label>

        <label className={styles.modalField} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={deleteFromDrive} onChange={(e) => setDeleteFromDrive(e.target.checked)} />
          <span>Also delete project files from Google Drive</span>
        </label>

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onCancel} disabled={isDeleting}>Cancel</button>
          <button className={styles.confirmDeleteBtn} onClick={() => onConfirm(deleteFromDrive)} disabled={!isMatch || isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  )
}

function compareProjects(left: DashboardProject, right: DashboardProject, sortBy: DashboardSort) {
  if (sortBy === 'title') {
    return left.title.localeCompare(right.title)
  }

  if (sortBy === 'created') {
    return right.createdAt - left.createdAt
  }

  if (sortBy === 'updated') {
    return right.updatedAt - left.updatedAt
  }

  const leftRecent = left.state.lastOpenedAt ?? left.updatedAt
  const rightRecent = right.state.lastOpenedAt ?? right.updatedAt
  return rightRecent - leftRecent
}

function matchesProjectFilters(
  project: DashboardProject,
  filters: {
    roleFilter: 'all' | ProjectRole
    starFilter: 'all' | 'starred'
    ownerFilter: 'all' | string
    teamFilter: 'all' | 'personal' | string
    searchQuery: string
  },
) {
  if (filters.roleFilter !== 'all' && project.role !== filters.roleFilter) {
    return false
  }

  if (filters.starFilter === 'starred' && !project.state.isStarred) {
    return false
  }

  if (filters.ownerFilter !== 'all' && project.ownerName !== filters.ownerFilter) {
    return false
  }

  if (filters.teamFilter === 'personal' && project.teamId) {
    return false
  }

  if (filters.teamFilter !== 'all' && filters.teamFilter !== 'personal' && project.teamId !== filters.teamFilter) {
    return false
  }

  const normalizedQuery = filters.searchQuery.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  return [
    project.title,
    project.ownerName,
    project.teamName ?? 'personal',
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

function matchesStatusFilter(project: DashboardProject, statusFilter: DashboardStatus) {
  if (statusFilter === 'all') {
    return true
  }

  if (statusFilter === 'trashed') {
    return Boolean(project.state.trashedAt)
  }

  if (statusFilter === 'archived') {
    return Boolean(project.state.archivedAt) && !project.state.trashedAt
  }

  return !project.state.archivedAt && !project.state.trashedAt
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

function roleLabel(role: ProjectRole): string {
  if (role === 'owner') return 'owner'
  if (role === 'manager') return 'manager'
  return role === 'editor' ? 'writer' : 'reviewer'
}

function TasksView({
  tasks,
  isLoading,
  currentUserId,
  onNavigate,
  onTasksChange,
}: {
  tasks: ProjectComment[]
  isLoading: boolean
  currentUserId: string
  onNavigate: (projectId: string, commentId: string) => void
  onTasksChange: (updater: (prev: ProjectComment[]) => ProjectComment[]) => void
}) {
  return (
    <div className={styles.settingsContainer} style={{ paddingTop: 8 }}>
      <TasksPanel
        comments={tasks}
        isLoading={isLoading}
        currentUserId={currentUserId}
        showProjectName
        onNavigate={onNavigate}
        onCommentsChange={onTasksChange}
      />
    </div>
  )
}
