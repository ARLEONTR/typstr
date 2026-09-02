import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle as ImperativePanelHandle } from 'react-resizable-panels'
import { apiClient, buildApiUrl } from '../../api/client'
import { useAuth } from '../../hooks/useAuth'
import { safeStorage } from '../../safeStorage'
import { useCollaboration } from '../../hooks/useCollaboration'
import { ENABLE_LATEX_SERVER_FALLBACK, ENABLE_LATEX_WASM_PDF, useCompile } from '../../hooks/useCompile'
import { useExport } from '../../hooks/useExport'
import type { ExportLogEntry } from '../../hooks/useExport'
import { useGemini } from '../../hooks/useGemini'
import { useSaveStatus } from '../../hooks/useSaveStatus'
import { useGeminiContext } from '../../context/GeminiContext'
import type { AiCollaborationEditedFile, AiCollaborationProjectFile, AiEditSuggestion, CommentSelectionAnchor, CompileDiagnostic, CompilePreviewFormat, EcosystemValidationIssue, ExportDestination, ExportFormat, LanguageDiagnosticsResponse, LanguageDiagnosticsSessionResponse, LanguageToolServerStatus, LatexSyncTexEntry, ProjectActivityEvent, ProjectChatMessage, ProjectComment, ProjectCommentPdfAnnotation, ProjectCompileSettings, ProjectDetail, ProjectEcosystemState, ProjectFile, ProjectFormat, ProjectInvitation, ProjectMember, ProjectMetadataFile, ProjectPackagePin, ProjectReviewSuggestion, ProjectRevision, ProjectRole, ProjectSummary, ProjectWritingGoals, ProjectWritingSnippet, ReusableAsset, SyncTexViewResponse, SyncTexViewBox, TypstPreviewSessionResponse } from '../../types'
import type { LatexEngine } from '../../latexWasm'
import type { LatexWebPreviewEngine } from '../../hooks/useCompile'
import CodeMirrorEditor from './CodeMirrorEditor'
import EditorToolbar from './EditorToolbar'
import HtmlPreview from './HtmlPreview'
import TypstPreviewFrame, { type TinymistJumpEvent, type TinymistContextMenuEvent } from './TypstPreviewFrame'
import CitationSearchPopup from './CitationSearchPopup'
import { TasksPanel } from './TasksPanel'
import PreviewErrorBoundary from './PreviewErrorBoundary'
import { convertLatexSnippetToTypst, explainCompileDiagnostic, type EditorSignatureHint } from './editorLearning'

const BibliographyPanel = lazy(() => import('./BibliographyPanel'))
const AcademicPanel = lazy(() => import('./AcademicPanel'))
const PdfPreview = lazy(() => import('./PdfPreview'))
const SvgPreview = lazy(() => import('./SvgPreview'))
const SharingPanel = lazy(() => import('./SharingPanel'))
const PlotPanel = lazy(() => import('./PlotPanel'))
import { GeminiPanel } from './GeminiPanel'
import FormatToolbar from './FormatToolbar'
import BibToolbar from './BibToolbar'
import {
  Folder as FolderIcon,
  Search as SearchIcon,
  ListTree,
  List as ListIcon,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Star,
  Wrench,
  BookOpen as BibIcon,
  BarChart2,
  History as HistoryIcon,
  MessageSquare as CommentsIcon,
  Share2 as ShareLucide,
  Copy as CopyIcon,
  GitFork,
  Users as UsersLucide,
  Leaf,
  Sparkles,
  Terminal,
  GraduationCap,
  File as FileIconLucide,
  FileText,
  FilePlus,
  FolderPlus,
  Plus,
  Upload as UploadIcon,
  Download as DownloadIcon,
  Check as CheckIcon,
  X as XIcon,
  LogOut as LogOutLucide,
  Shield,
  Settings as SettingsLucide,
  RefreshCw,
  Loader2,
  ClipboardList as PeerReviewIcon,
  SquareCheckBig as TasksIcon,
  Trash2 as TrashIcon,
  Save,
  Camera,
  FileOutput,
  Eye,
  ExternalLink,
  PackageCheck,
  Database,
} from '../../icons'
import {
  THEME_PRESETS,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  normalizeWorkspaceTheme,
  resolveThemeVars,
  themeStorageKeyForUser,
  type WorkspaceTheme
} from '../../theme'

import styles from './EditorPage.module.css'

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const SIDEBAR_EXPANDED_SIZE = "26%"
const SIDEBAR_MIN_SIZE = "0%"
const SIDEBAR_MAX_SIZE = "100%"
const DRAG_FILE_ID_MIME_TYPE = 'application/x-typstr-file-id'
const OPEN_TABS_STORAGE_PREFIX = 'typstr.open-tabs.'
const SHORTCUTS_STORAGE_PREFIX = 'typstr.shortcuts.'
const TRACK_CHANGES_STORAGE_PREFIX = 'typstr.track-changes-enabled.'
const SIDEBAR_TAB_ORDER_STORAGE_PREFIX = 'typstr.sidebar.tab-order.'
const LATEX_COMPILER_STORAGE_PREFIX = 'typstr.latex-compiler.'

function createTinymistClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall through to timestamp/random fallback.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

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
  | 'insertCite'

type ShortcutBindings = Record<ShortcutAction, string>

type ContextMenuState =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'folder'; x: number; y: number; file: ProjectFile }
  | { kind: 'tab'; x: number; y: number; file: ProjectFile }
  | { kind: 'file'; x: number; y: number; file: ProjectFile }

type TreeNode =
  | { type: 'folder'; name: string; path: string; file: ProjectFile | null; children: TreeNode[] }
  | { type: 'file'; name: string; file: ProjectFile }

type ProjectSearchResult = {
  fileId: string
  filePath: string
  lineNumber: number
  column: number
  lineText: string
}

type OutlineItem = {
  id: string
  depth: number
  title: string
  line: number
  kind: 'section' | 'figure' | 'table' | 'equation' | 'bibliography' | 'other'
  filePath?: string
}

type OutlineNode = OutlineItem & {
  path: string
  children: OutlineNode[]
}

type MinimapSegment = {
  index: number
  startLine: number
  endLine: number
  isActive: boolean
  featureKind: OutlineItem['kind'] | null
  featureLabel: string | null
}

type LatexCompilerPreference = LatexWebPreviewEngine | LatexEngine
type NomenclatureEntry = {
  id: string
  kind: 'symbol' | 'abbreviation'
  term: string
  definition: string
  source: 'scanned' | 'edited'
  count: number
  filePath: string
  line: number
  context: string
}
const LATEX_COMPILER_OPTIONS: Array<{ value: LatexCompilerPreference; label: string }> = [
  { value: 'pandoc-wasm', label: 'Pandoc WASM' },
  { value: 'make4ht', label: 'make4ht' },
  { value: 'pandoc', label: 'Pandoc (server)' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
]
const LATEX_WEB_PREVIEW_ENGINES: LatexWebPreviewEngine[] = ['pandoc-wasm', 'make4ht', 'pandoc']
const LATEX_PDF_COMPILERS: LatexEngine[] = ['xelatex', 'pdflatex', 'lualatex']
const ENABLED_LATEX_COMPILER_OPTIONS = LATEX_COMPILER_OPTIONS.filter((option) => {
  if (LATEX_WEB_PREVIEW_ENGINES.includes(option.value as LatexWebPreviewEngine)) {
    return option.value === 'pandoc-wasm' || ENABLE_LATEX_SERVER_FALLBACK
  }
  return ENABLE_LATEX_WASM_PDF || ENABLE_LATEX_SERVER_FALLBACK
})
const DEFAULT_LATEX_WEB_PREVIEW_ENGINE = (
  ENABLED_LATEX_COMPILER_OPTIONS.find((option) => LATEX_WEB_PREVIEW_ENGINES.includes(option.value as LatexWebPreviewEngine))?.value ?? 'pandoc-wasm'
) as LatexWebPreviewEngine
const DEFAULT_LATEX_COMPILER = (
  ENABLED_LATEX_COMPILER_OPTIONS.find((option) => option.value === 'pdflatex')?.value
  ?? DEFAULT_LATEX_WEB_PREVIEW_ENGINE
  ?? ENABLED_LATEX_COMPILER_OPTIONS[0]?.value
  ?? 'pdflatex'
)
const ENABLE_TINYMIST_PREVIEW = true
const ENABLE_AUTO_COMPILE = false

type SidebarTabKey = 'files' | 'export' | 'search' | 'outline' | 'tools' | 'bibliography' | 'nomenclature' | 'academic' | 'plots' | 'history' | 'peerReview' | 'comments' | 'sharing' | 'collaboration' | 'ecosystem' | 'log' | 'gemini' | 'settings' | 'tasks'
type FileViewMode = 'tree' | 'list' | 'gallery'

const PROJECT_FORMAT_OPTIONS: Array<{ value: ProjectFormat; label: string }> = [
  { value: 'typst', label: 'Typst (.typ)' },
  { value: 'latex', label: 'LaTeX (.tex)' },
  { value: 'gdoc', label: 'Google Docs (.gdoc)' },
]

type InlineCreateState = {
  kind: 'file' | 'folder'
  parentPath: string | null
  name: string
  error: string | null
  isSubmitting: boolean
}

type FolderVisibleCountState = Record<string, number>

type MutationNotice = {
  kind: 'error' | 'info'
  message: string
  actionLabel?: string
  onAction?: () => void
}

type CollaboratorPresence = {
  clientId: number
  userName: string
  color: string
  avatarUrl: string | null
  filePath: string | null
  line: number | null
  column: number | null
}

type EditorInsertRequest = {
  text: string
  selectInsertedText?: boolean
  appendOnly?: boolean
  replaceBefore?: number
  nonce: number
}

type SymbolPaletteGroup = {
  title: string
  items: Array<{ label: string; insert: string }>
}

type PeerReviewSubmissionRecord = {
  venue: string
  submissionDate: string
  manuscriptId: string
  editorContact: string
  roundLabel: string
}

type ParsedReviewerComment = {
  reviewer: string
  number: number
  text: string
}

type SupervisorReviewRequest = {
  id: string
  supervisor_email: string
  supervisor_name: string | null
  message: string | null
  file_path: string
  status: 'open' | 'closed'
  open_comments: number
  resolved_comments: number
  created_at: number
  updated_at: number
  expires_at: number
}

type ArxivLookupResult = {
  id: string
  title: string
  authors: string[]
  summary: string
  published: string | null
  updated: string | null
  categories: string[]
  doi: string | null
  journalRef: string | null
  pdfUrl: string | null
}

const DEFAULT_WRITING_GOALS: ProjectWritingGoals = {
  targetWords: null,
  dailyWords: null,
  deadline: null,
}

const PROJECT_METADATA_JSON_PATH = '.typstr/project-metadata.json'

const SYMBOL_PALETTE: SymbolPaletteGroup[] = [
  {
    title: 'Math',
    items: [
      { label: 'alpha', insert: 'alpha' },
      { label: 'beta', insert: 'beta' },
      { label: 'gamma', insert: 'gamma' },
      { label: 'sum', insert: 'sum_' },
      { label: 'integral', insert: 'integral_' },
      { label: 'rightarrow', insert: 'arrow.r' },
    ],
  },
  {
    title: 'Logic',
    items: [
      { label: 'forall', insert: 'forall' },
      { label: 'exists', insert: 'exists' },
      { label: 'implies', insert: '==>' },
      { label: 'equiv', insert: '<=>' },
    ],
  },
  {
    title: 'Structure',
    items: [
      { label: 'figure', insert: '#figure(\n  image("figures/plot.png"),\n  caption: [Caption],\n) <fig:label>\n' },
      { label: 'table', insert: '#table(\n  columns: 3,\n  [A], [B], [C],\n) <tbl:label>\n' },
      { label: 'equation', insert: '$ x &= y + z $ <eq:label>\n' },
    ],
  },
]

const LATEX_SYMBOL_PALETTE: SymbolPaletteGroup[] = [
  {
    title: 'Math',
    items: [
      { label: '\\alpha', insert: '\\alpha ' },
      { label: '\\beta', insert: '\\beta ' },
      { label: '\\gamma', insert: '\\gamma ' },
      { label: '\\sum', insert: '\\sum_{i=1}^{n} ' },
      { label: '\\int', insert: '\\int_{a}^{b} ' },
      { label: '\\rightarrow', insert: '\\rightarrow ' },
    ],
  },
  {
    title: 'Logic',
    items: [
      { label: '\\forall', insert: '\\forall ' },
      { label: '\\exists', insert: '\\exists ' },
      { label: '\\implies', insert: '\\implies ' },
      { label: '\\iff', insert: '\\iff ' },
    ],
  },
  {
    title: 'Structure',
    items: [
      { label: 'figure', insert: '\\begin{figure}[ht]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{figures/plot.png}\n\\caption{Caption}\n\\label{fig:label}\n\\end{figure}\n' },
      { label: 'table', insert: '\\begin{table}[ht]\n\\centering\n\\begin{tabular}{ccc}\nA & B & C \\\\\n\\end{tabular}\n\\caption{Caption}\n\\label{tbl:label}\n\\end{table}\n' },
      { label: 'equation', insert: '\\begin{equation}\n  x = y + z\n\\label{eq:label}\n\\end{equation}\n' },
    ],
  },
]

const EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'latex', label: 'LaTeX (.tex)' },
  { value: 'html', label: 'HTML (.html)' },
]

const EXPORT_DESTINATION_OPTIONS: Array<{ value: ExportDestination; label: string }> = [
  { value: 'download', label: 'Download in browser' },
  { value: 'drive', label: 'Save into project Drive folder' },
]

const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  compile: 'Mod-b',
  save: 'Mod-s',
  search: 'Mod-f',
  projectSearch: 'Mod-Shift-f',
  toggleNavigation: 'Mod-g',
  quickExport: 'Mod-Shift-e',
  insertCite: 'Mod-e',
  previousSection: 'Alt-ArrowUp',
  nextSection: 'Alt-ArrowDown',
  toggleFold: 'Mod-Alt-[',
  togglePreview: 'Mod-Shift-p',
  focusEditor: 'Escape',
}

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialCommentId = searchParams.get('commentId')
  const initialSearch = searchParams.get('search')
  const initialSearchFileId = searchParams.get('fileId')
  const initialSearchLine = searchParams.get('line') ? Number(searchParams.get('line')) : null
  const initialSearchCol = searchParams.get('col') ? Number(searchParams.get('col')) : null
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const refreshProject = useCallback(async () => {
    if (!projectId) {
      return
    }

    const response = await apiClient.get<ProjectDetail>(`/api/projects/${projectId}`)
    setProject(response.data)
    setSelectedFileId((current) => current ?? (response.data.mainFileId && response.data.files.some((f) => f.id === response.data.mainFileId) ? response.data.mainFileId : null) ?? firstOpenableProjectFile(response.data.files)?.id ?? null)
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      return
    }

    refreshProject().catch(() => setNotFound(true))
  }, [projectId, refreshProject])

  useEffect(() => {
    if (!project) {
      return
    }

    if (initialSearchFileId && project.files.some((file) => file.id === initialSearchFileId)) {
      setSelectedFileId(initialSearchFileId)
      return
    }

    if (!selectedFileId || !project.files.some((file) => file.id === selectedFileId)) {
      const defaultFileId = (project.mainFileId && project.files.some((f) => f.id === project.mainFileId))
        ? project.mainFileId
        : firstOpenableProjectFile(project.files)?.id ?? null
      setSelectedFileId(defaultFileId)
    }
  }, [project, selectedFileId, initialSearchFileId])

  if (notFound) {
    return (
      <div className={styles.notFound}>
        <p>Project not found.</p>
        <button onClick={() => navigate('/')}>← Back</button>
      </div>
    )
  }

  if (!project || !user) {
    return <div className={styles.loading}>Loading…</div>
  }

  const activeFile = project.files.find((file) => file.id === selectedFileId) ?? firstOpenableProjectFile(project.files)

  if (!activeFile) {
    return (
      <div className={styles.notFound}>
        <p>This project has no files.</p>
        <button onClick={() => navigate('/')}>← Back</button>
      </div>
    )
  }

  return (
    <ProjectWorkspace
      project={project}
      activeFile={activeFile}
      userId={user.id}
      onProjectChange={setProject}
      onSelectFile={setSelectedFileId}
      onRefreshProject={refreshProject}
      initialCommentId={initialCommentId}
      initialSearch={initialSearch}
      initialSearchLine={initialSearchLine}
      initialSearchCol={initialSearchCol}
    />
  )
}

function openTabsStorageKey(projectId: string): string {
  return `${OPEN_TABS_STORAGE_PREFIX}${projectId}`
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function normalizeOpenTabFileIds(fileIds: unknown[], validFileIds: Set<string>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const fileId of fileIds) {
    if (typeof fileId !== 'string' || !validFileIds.has(fileId) || seen.has(fileId)) {
      continue
    }

    seen.add(fileId)
    normalized.push(fileId)
  }

  return normalized
}

function ProjectWorkspace({
  project,
  activeFile,
  userId,
  onProjectChange,
  onSelectFile,
  onRefreshProject,
  initialCommentId,
  initialSearch,
  initialSearchLine,
  initialSearchCol,
}: {
  project: ProjectDetail
  activeFile: ProjectFile
  userId: string
  onProjectChange: Dispatch<SetStateAction<ProjectDetail | null>>
  onSelectFile: (fileId: string) => void
  onRefreshProject: () => Promise<void>
  initialCommentId?: string | null
  initialSearch?: string | null
  initialSearchLine?: number | null
  initialSearchCol?: number | null
}) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const themeStorageKey = useMemo(() => themeStorageKeyForUser(userId), [userId])
  const shortcutStorageKey = useMemo(() => `${SHORTCUTS_STORAGE_PREFIX}${userId}`, [userId])
  const trackChangesStorageKey = useMemo(() => `${TRACK_CHANGES_STORAGE_PREFIX}${userId}.${project.id}`, [project.id, userId])
  const sidebarTabOrderStorageKey = useMemo(() => `${SIDEBAR_TAB_ORDER_STORAGE_PREFIX}${userId}.${project.id}`, [project.id, userId])
  const canCollaborateInEditor = isEditableTextFile(activeFile)
  const { ytext, awareness, authenticationError, connectionStatus, synced } = useCollaboration(project.id, activeFile.id, user!, canCollaborateInEditor, project.collaborationTokens?.[activeFile.id])
  const {
    pages,
    pageCount,
    pageOffset,
    pdfUrl,
    webPreviewHtml,
    isCompiling,
    compileError,
    compileDiagnostics,
    effectivePreviewFormat,
    compileNotice,
    compileLog,
    latexSyncTex,
    latexSyncTexToken,
    latexSyncTexEntryPath,
    compileNow,
    resetCompile,
  } = useCompile({})
  const { isExporting, exportLogs, clearExportLogs, exportDocument, saveExportToDrive, downloadProjectZip } = useExport()
  const collaborativeSaveStatus = useSaveStatus(ytext)
  const gemini = useGemini()
  const [pdfPreviewPageCount, setPdfPreviewPageCount] = useState(0)
  const [latexPreviewSyncTarget, setLatexPreviewSyncTarget] = useState<{ page: number; y?: number; nonce: number } | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && isEditableTextFile(activeFile)) {
        return
      }
      void onRefreshProject()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [activeFile, onRefreshProject])

  const [isSavingToDrive, setIsSavingToDrive] = useState(false)
  const [showSharingPanel, setShowSharingPanel] = useState(false)
  const [showCompileSettingsPanel, setShowCompileSettingsPanel] = useState(false)
  const [showRevisionPanel, setShowRevisionPanel] = useState(false)
  const [showNavigationPanel, setShowNavigationPanel] = useState(false)
  const [previewMode, setPreviewMode] = useState<CompilePreviewFormat>('svg')
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>('tree')
  const [latexCompilerByFileId, setLatexCompilerByFileId] = useState<Record<string, LatexCompilerPreference>>({})
  const [focusedFolderPath, setFocusedFolderPath] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [isRootExpanded, setIsRootExpanded] = useState(true)

  // Auto-expand folders containing the active file
  useEffect(() => {
    if (!activeFile) return
    const parts = activeFile.path.split('/')
    if (parts.length <= 1) return
    const folders: Record<string, boolean> = {}
    for (let i = 1; i < parts.length; i++) {
      folders[parts.slice(0, i).join('/')] = true
    }
    setExpandedFolders((prev) => ({ ...prev, ...folders }))
  }, [activeFile?.id])
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null | '__root__'>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [theme, setTheme] = useState<WorkspaceTheme>(DEFAULT_THEME)
  const [revealLocation, setRevealLocation] = useState<{ line: number; column?: number; endLine?: number; endColumn?: number; nonce: number } | null>(null)
  const [searchPanelRequest, setSearchPanelRequest] = useState<{ action: 'open' | 'close'; nonce: number } | null>(null)
  const [editorInsertRequest, setEditorInsertRequest] = useState<EditorInsertRequest | null>(null)
  const [projectSearchQuery, setProjectSearchQuery] = useState(initialSearch ?? '')
  const [projectSearchIndex, setProjectSearchIndex] = useState<Record<string, string>>({})
  const projectSearchIndexRef = useRef(projectSearchIndex)
  projectSearchIndexRef.current = projectSearchIndex
  const [isLoadingProjectSearch, setIsLoadingProjectSearch] = useState(false)
  const [projectSearchError, setProjectSearchError] = useState<string | null>(null)
  const [openTabFileIds, setOpenTabFileIds] = useState<string[]>([activeFile.id])
  const [cursorLocation, setCursorLocation] = useState({ line: 1, column: 1 })
  const [goToLineValue, setGoToLineValue] = useState('1')
  const [goToColumnValue, setGoToColumnValue] = useState('1')
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUT_BINDINGS)
  const [commentsByFileId, setCommentsByFileId] = useState<Record<string, ProjectComment[]>>({})
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [projectTasks, setProjectTasks] = useState<ProjectComment[]>([])
  const [isLoadingProjectTasks, setIsLoadingProjectTasks] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentDraftAssigneeUserId, setCommentDraftAssigneeUserId] = useState<string | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [suggestionsByFileId, setSuggestionsByFileId] = useState<Record<string, ProjectReviewSuggestion[]>>({})
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [suggestionDraft, setSuggestionDraft] = useState('')
  const [commentSelection, setCommentSelection] = useState<CommentSelectionAnchor | null>(null)
  const [tinymistContextMenu, setTinymistContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(initialCommentId ?? null)
  const [activeNoteDialogCommentId, setActiveNoteDialogCommentId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 960)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window === 'undefined' ? true : window.innerWidth > 960)
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTabKey | null>(
    initialCommentId ? 'comments' : initialSearch ? 'search' : 'files',
  )
  const [sidebarTabOrder, setSidebarTabOrder] = useState<SidebarTabKey[]>([
    'files', 'export', 'search', 'outline', 'tools', 'bibliography', 'nomenclature', 'academic', 'plots', 'history', 'peerReview', 'comments', 'sharing', 'collaboration', 'ecosystem', 'gemini', 'log',
  ])
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false)
  const [selectedExportFormat, setSelectedExportFormat] = useState<ExportFormat>('pdf')
  const [selectedExportDestination, setSelectedExportDestination] = useState<ExportDestination>('download')
  const [conversionLogs, setConversionLogs] = useState<ExportLogEntry[]>([])
  const appendConversionLog = useCallback((level: ExportLogEntry['level'], message: string) => {
    setConversionLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level,
        message,
        timestamp: Date.now(),
      },
      ...current,
    ].slice(0, 40))
  }, [])
  const clearAllExportLogs = useCallback(() => {
    clearExportLogs()
    setConversionLogs([])
  }, [clearExportLogs])
  const allExportLogs = useMemo(() => [...conversionLogs, ...exportLogs].sort((left, right) => right.timestamp - left.timestamp), [conversionLogs, exportLogs])
  const [inlineCreateState, setInlineCreateState] = useState<InlineCreateState | null>(null)
  const [folderVisibleCounts, setFolderVisibleCounts] = useState<FolderVisibleCountState>({})
  const [sharePopoverPosition, setSharePopoverPosition] = useState<{ left: number; top: number } | null>(null)
  const [ecosystem, setEcosystem] = useState<ProjectEcosystemState | null>(null)
  const [isLoadingEcosystem, setIsLoadingEcosystem] = useState(false)
  const [ecosystemError, setEcosystemError] = useState<string | null>(null)
  const [mutationNotice, setMutationNotice] = useState<MutationNotice | null>(null)
  const [isOnline, setIsOnline] = useState(() => typeof window === 'undefined' ? true : window.navigator.onLine)
  const [selectedTreeFileIds, setSelectedTreeFileIds] = useState<string[]>([])
  const [chatMessages, setChatMessages] = useState<ProjectChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [isLoadingChat, setIsLoadingChat] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [activityEvents, setActivityEvents] = useState<ProjectActivityEvent[]>([])
  const [isLoadingActivity, setIsLoadingActivity] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [isConvertingProjectFormat, setIsConvertingProjectFormat] = useState(false)
  const [fileRevisions, setFileRevisions] = useState<ProjectRevision[]>([])
  const [isLoadingFileRevisions, setIsLoadingFileRevisions] = useState(false)
  const [fileRevisionsError, setFileRevisionsError] = useState<string | null>(null)
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState(false)
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null)
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([])
  const [themeHydrated, setThemeHydrated] = useState(false)

  useEffect(() => {
    setSelectedExportFormat(project.compileSettings.defaultExportFormat)
    setSelectedExportDestination(project.compileSettings.defaultExportDestination)
  }, [project.compileSettings.defaultExportDestination, project.compileSettings.defaultExportFormat, project.id])

  const syncThemeFromStorage = useCallback(() => {
    try {
      const userScopedRaw = safeStorage.getItem(themeStorageKey)
      const globalRaw = safeStorage.getItem(THEME_STORAGE_KEY)
      setTheme(normalizeWorkspaceTheme(
        userScopedRaw ? JSON.parse(userScopedRaw) : user?.selectedTheme ?? (globalRaw ? JSON.parse(globalRaw) : DEFAULT_THEME),
      ))
    } catch {
      safeStorage.removeItem(themeStorageKey)
      setTheme(normalizeWorkspaceTheme(user?.selectedTheme ?? DEFAULT_THEME))
    }
  }, [themeStorageKey, user?.selectedTheme])
  const [followTargetClientId, setFollowTargetClientId] = useState<number | null>(null)
  const [languageDiagnostics, setLanguageDiagnostics] = useState<CompileDiagnostic[]>([])
  const [languageServerStatuses, setLanguageServerStatuses] = useState<LanguageToolServerStatus[]>([])
  const [typstPreviewSession, setTypstPreviewSession] = useState<TypstPreviewSessionResponse | null>(null)
  const [tinymistSyncSource, setTinymistSyncSource] = useState<string>('')
  const [tinymistReconnectNonce, setTinymistReconnectNonce] = useState(0)
  const [previewPanelTab, setPreviewPanelTab] = useState<'preview' | 'log'>('preview')
  const [pendingAiEdits, setPendingAiEdits] = useState<AiEditSuggestion[]>([])

  const uploadInputRef = useRef<HTMLInputElement>(null)
  const fontUploadInputRef = useRef<HTMLInputElement>(null)
  const libraryUploadInputRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const sharePopoverRef = useRef<HTMLDivElement>(null)
  const editorPanelRef = useRef<ImperativePanelHandle | null>(null)
  const dragFileIdRef = useRef<string | null>(null)
  const pendingUploadFolderPathRef = useRef<string | null>(null)
  const pendingDeletedCommentIdsRef = useRef(new Set<string>())
  const tinymistClientIdRef = useRef(createTinymistClientId())
  const previewSessionIdRef = useRef(`preview:${project.id}:${project.mainFileId ?? activeFile.id}:${tinymistClientIdRef.current}`)
  const tinymistReconnectAttemptsRef = useRef(0)
  const lastFollowedLocationRef = useRef<string | null>(null)
  const trackChangesTimerRef = useRef<number | null>(null)
  const trackChangesBaseSourceRef = useRef<string | null>(null)
  const trackChangesLatestSourceRef = useRef<string | null>(null)
  const editorAutosaveTimerRef = useRef<number | null>(null)
  const editorAutosaveLatestRef = useRef<{ projectId: string; fileId: string; source: string } | null>(null)
  const editorAutosaveLastSavedRef = useRef<Record<string, string>>({})
  const sidebarPanelRef = useRef<ImperativePanelHandle | null>(null)
  const previewPanelRef = useRef<ImperativePanelHandle | null>(null)
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [formatRequest, setFormatRequest] = useState<{ prefix: string; suffix: string; placeholder: string; nonce: number } | null>(null)
  const [signatureHint, setSignatureHint] = useState<EditorSignatureHint | null>(null)
  const [latexConverterSource, setLatexConverterSource] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const didRevealInitialSearchRef = useRef(false)
  useEffect(() => {
    if (!initialSearch || !initialSearchLine || didRevealInitialSearchRef.current) return
    didRevealInitialSearchRef.current = true
    setRevealLocation({ line: initialSearchLine, column: initialSearchCol ?? 1, nonce: Date.now() })
    setCursorLocation({ line: initialSearchLine, column: initialSearchCol ?? 1 })
  }, [initialSearch, initialSearchLine, initialSearchCol])

  const canEdit = project.role !== 'viewer'
  const workspaceLabel = project.title || 'Workspace'
  const isReviewMode = project.role === 'viewer'
  const mainFile = useMemo(
    () => project.files.find((file) => file.id === project.mainFileId) ?? null,
    [project.files, project.mainFileId],
  )
  const activeIsRenderableTypstFile = isRenderableTypstFile(activeFile)
  const activeIsRenderableLatexFile = isRenderableLatexFile(activeFile)
  const activeIsBibFile = /\.bib$/i.test(activeFile.name)
  const latexMainFile = useMemo(
    () => (mainFile && isRenderableLatexFile(mainFile) ? mainFile : null),
    [mainFile],
  )
  const typstMainFile = useMemo(
    () => (mainFile && isRenderableTypstFile(mainFile) ? mainFile : null),
    [mainFile],
  )
  const canRenderLatex = activeIsRenderableLatexFile || Boolean(latexMainFile)
  const canRender = activeIsRenderableTypstFile || Boolean(typstMainFile) || canRenderLatex
  const canLoadCommentsForActiveFile = isEditableTextFile(activeFile) || isPdfFile(activeFile)
  const canCreateTextComments = isEditableTextFile(activeFile)
  const activeSourceFormat = inferProjectFormatFromFileName(activeFile.name)
  const compileTargetFile = useMemo(() => {
    if (latexMainFile) return latexMainFile
    if (typstMainFile) return typstMainFile
    return activeFile
  }, [activeFile, latexMainFile, typstMainFile])
  const activeLatexCompiler = canRenderLatex
    ? (ENABLED_LATEX_COMPILER_OPTIONS.some((option) => option.value === latexCompilerByFileId[compileTargetFile.id])
        ? latexCompilerByFileId[compileTargetFile.id]
        : DEFAULT_LATEX_COMPILER)
    : null
  const activeLatexWebPreviewEngine = canRenderLatex && activeLatexCompiler && LATEX_WEB_PREVIEW_ENGINES.includes(activeLatexCompiler as LatexWebPreviewEngine)
    ? activeLatexCompiler as LatexWebPreviewEngine
    : null
  const latexPreviewModeOptions = useMemo<CompilePreviewFormat[]>(() => {
    if (!canRenderLatex) {
      return ['svg', 'pdf']
    }

    const hasWebPreview = ENABLED_LATEX_COMPILER_OPTIONS.some((option) => LATEX_WEB_PREVIEW_ENGINES.includes(option.value as LatexWebPreviewEngine))
    const hasPdfPreview = ENABLED_LATEX_COMPILER_OPTIONS.some((option) => LATEX_PDF_COMPILERS.includes(option.value as LatexEngine))
    return [
      ...(hasWebPreview ? ['svg' as const] : []),
      ...(hasPdfPreview ? ['pdf' as const] : []),
    ]
  }, [canRenderLatex])
  const blockingTaskMessage = useMemo(() => {
    if (restoringRevisionId) return 'Restoring revision…'
    if (isCreatingCheckpoint) return 'Creating checkpoint…'
    if (isConvertingProjectFormat) return 'Converting document…'
    if (isExporting) return 'Exporting document…'
    if (isSavingToDrive) return 'Saving document…'
    return null
  }, [isConvertingProjectFormat, isCreatingCheckpoint, isExporting, isSavingToDrive, restoringRevisionId])
  const compileTargetSource = useMemo(() => {
    if (compileTargetFile.id === activeFile.id) {
      return ytext.toString()
    }
    return projectSearchIndex[compileTargetFile.id] || ''
  }, [activeFile.id, compileTargetFile.id, projectSearchIndex, ytext])
  const isPdfAsset = isPdfFile(activeFile)
  const saveStatus = isSavingToDrive ? 'saving' : collaborativeSaveStatus
  const dirtyFileId = saveStatus === 'saved' ? null : activeFile.id
  const connectionIssue = !isOnline
    ? 'You are offline. Changes will stay local until the network returns.'
    : authenticationError || (connectionStatus !== 'connected' && canCollaborateInEditor
      ? 'Realtime collaboration is reconnecting. Unsynced edits may still be local.'
      : null)
  const ecosystemProjectType = useMemo<'typst' | 'latex'>(() => {
    const mainFormat = mainFile ? inferProjectFormatFromFileName(mainFile.name) : null
    if (mainFormat === 'typst' || mainFormat === 'latex') {
      return mainFormat
    }

    const activeFormat = inferProjectFormatFromFileName(activeFile.name)
    return activeFormat === 'latex' ? 'latex' : 'typst'
  }, [activeFile.name, mainFile])
  const isRootFileUploadTarget = dropTargetPath === '__root__'
  const defaultNewFileName = ecosystemProjectType === 'latex' ? 'main.tex' : 'chapter.typ'

  const reportMutationError = useCallback((message: string, retry?: () => void) => {
    setMutationNotice({
      kind: 'error',
      message,
      actionLabel: retry ? 'Retry' : undefined,
      onAction: retry,
    })
  }, [])

  const clearMutationNotice = useCallback(() => {
    setMutationNotice(null)
  }, [])

  const handlePreviewModeChange = useCallback((mode: CompilePreviewFormat) => {
    if (canRenderLatex && !latexPreviewModeOptions.includes(mode)) {
      return
    }

    if (canRenderLatex && mode === 'pdf' && activeLatexWebPreviewEngine) {
      const pdfCompiler = ENABLED_LATEX_COMPILER_OPTIONS.find((option) => LATEX_PDF_COMPILERS.includes(option.value as LatexEngine))
      if (!pdfCompiler) {
        return
      }
      setLatexCompilerByFileId((current) => ({
        ...current,
        [compileTargetFile.id]: pdfCompiler.value,
      }))
    } else if (canRenderLatex && mode === 'svg' && !activeLatexWebPreviewEngine) {
      const webPreviewCompiler = ENABLED_LATEX_COMPILER_OPTIONS.find((option) => LATEX_WEB_PREVIEW_ENGINES.includes(option.value as LatexWebPreviewEngine))
      if (!webPreviewCompiler) {
        return
      }
      setLatexCompilerByFileId((current) => ({
        ...current,
        [compileTargetFile.id]: webPreviewCompiler.value,
      }))
    }

    setPreviewMode(mode)
  }, [activeLatexWebPreviewEngine, canRenderLatex, compileTargetFile.id, latexPreviewModeOptions])
  const previewCompileSelectionRef = useRef({
    previewMode,
    activeLatexCompiler,
    compileTargetFileId: compileTargetFile.id,
  })

  const handleLatexCompilerChange = useCallback((compiler: string) => {
    if (!canRenderLatex) {
      return
    }

    const normalized = ENABLED_LATEX_COMPILER_OPTIONS.some((option) => option.value === compiler)
      ? compiler as LatexCompilerPreference
      : DEFAULT_LATEX_COMPILER
    const nextPreviewMode: CompilePreviewFormat = LATEX_WEB_PREVIEW_ENGINES.includes(normalized as LatexWebPreviewEngine) ? 'svg' : 'pdf'
    const currentActiveFileSource = isEditableTextFile(activeFile)
      ? (projectSearchIndex[activeFile.id] || ytext.toString())
      : ''

    setLatexCompilerByFileId((current) => ({
      ...current,
      [compileTargetFile.id]: normalized,
    }))
    setPreviewMode(nextPreviewMode)

    previewCompileSelectionRef.current = {
      previewMode: nextPreviewMode,
      activeLatexCompiler: normalized,
      compileTargetFileId: compileTargetFile.id,
    }

    if (!canRender || !compileTargetSource.trim()) {
      return
    }

    window.setTimeout(() => {
      compileNow(compileTargetSource, {
        projectId: project.id,
        fileId: compileTargetFile.id,
        entryFilePath: compileTargetFile.path,
        documentFormat: 'latex',
        format: nextPreviewMode,
        latexEngine: LATEX_WEB_PREVIEW_ENGINES.includes(normalized as LatexWebPreviewEngine) ? undefined : normalized as LatexEngine,
        latexWebPreviewEngine: LATEX_WEB_PREVIEW_ENGINES.includes(normalized as LatexWebPreviewEngine) ? normalized as LatexWebPreviewEngine : undefined,
        previewSessionId: `${previewSessionIdRef.current}:${nextPreviewMode}`,
        activeFileId: compileTargetFile.id === activeFile.id ? undefined : activeFile.id,
        activeFilePath: compileTargetFile.id === activeFile.id ? undefined : activeFile.path,
        activeSource: compileTargetFile.id === activeFile.id ? undefined : currentActiveFileSource,
        files: project.files.map((file) => ({
          id: file.id,
          path: file.path,
          mimeType: file.mimeType,
          updatedAt: file.updatedAt,
          content: isEditableTextFile(file) ? (file.id === activeFile.id ? currentActiveFileSource : projectSearchIndex[file.id]) : undefined,
        })),
      })
    }, 0)
  }, [activeFile, canRender, canRenderLatex, compileNow, compileTargetFile.id, compileTargetFile.path, compileTargetSource, project.files, project.id, projectSearchIndex, ytext])

  const toggleSidebarPanel = useCallback(() => {
    const panel = sidebarPanelRef.current
    if (!panel) {
      return
    }

    setIsEditorFocused(false)

    if (!activeSidebarTab) {
      setActiveSidebarTab('files')
      panel.expand()
      panel.resize(SIDEBAR_EXPANDED_SIZE)
      return
    }

    setActiveSidebarTab(null)
    panel.collapse()
  }, [activeSidebarTab])

  const toggleSidebarTab = useCallback((tab: SidebarTabKey) => {
    if (isMobile) {
      setIsSidebarOpen(true)
      setActiveSidebarTab((current) => current === tab ? null : tab)
      return
    }

    const panel = sidebarPanelRef.current
    if (activeSidebarTab === tab) {
      setActiveSidebarTab(null)
      panel?.collapse()
      return
    }

    setActiveSidebarTab(tab)
    panel?.expand()
    panel?.resize(SIDEBAR_EXPANDED_SIZE)
  }, [activeSidebarTab, isMobile])

  const togglePreviewPanel = useCallback(() => {
    const panel = previewPanelRef.current
    if (!panel) {
      return
    }

    setIsEditorFocused(false)

    if (panel.isCollapsed()) {
      panel.expand()
      return
    }

    panel.collapse()
  }, [])

  const expandEditorPanel = useCallback(() => {
    const panel = editorPanelRef.current
    if (!panel || isMobile) {
      return
    }

    panel.expand()
    panel.resize('38%')
  }, [isMobile])

  const collapseEditorPanel = useCallback(() => {
    if (isMobile) {
      return
    }

    editorPanelRef.current?.collapse()
  }, [isMobile])

  const toggleEditorFocus = useCallback(() => {
    const sidebarPanel = sidebarPanelRef.current
    const previewPanel = previewPanelRef.current
    if (!sidebarPanel || !previewPanel || isMobile) {
      return
    }

    if (isEditorFocused) {
      sidebarPanel.expand()
      previewPanel.expand()
      sidebarPanel.resize(SIDEBAR_EXPANDED_SIZE)
      previewPanel.resize("38%")
      setIsEditorFocused(false)
      return
    }

    sidebarPanel.collapse()
    previewPanel.collapse()
    setIsEditorFocused(true)
  }, [isEditorFocused, isMobile])

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 960px)')
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const mobile = event.matches
      setIsMobile(mobile)
      setIsSidebarOpen(!mobile)
    }

    handleChange(mediaQuery)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    if (isMobile) {
      return
    }

    setActiveSidebarTab((current) => current ?? 'files')
  }, [isMobile])

  useEffect(() => {
    syncThemeFromStorage()
    setThemeHydrated(true)
  }, [syncThemeFromStorage])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === themeStorageKey || event.key === THEME_STORAGE_KEY) {
        syncThemeFromStorage()
      }
    }

    const handleThemeUpdated = () => {
      syncThemeFromStorage()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('typstr-theme-updated', handleThemeUpdated)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('typstr-theme-updated', handleThemeUpdated)
    }
  }, [syncThemeFromStorage, themeStorageKey])

  useEffect(() => {
    if (!themeHydrated) {
      return
    }

    safeStorage.setItem(themeStorageKey, JSON.stringify(theme))
    safeStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
    const timeoutId = window.setTimeout(() => {
      void apiClient.patch('/api/account/theme', { theme }).catch((error) => {
        console.error('Failed to save theme preference', error)
      })
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [theme, themeHydrated, themeStorageKey])

  useEffect(() => {
    try {
      const raw = safeStorage.getItem(shortcutStorageKey)
      if (!raw) {
        setShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
        return
      }

      setShortcutBindings(normalizeShortcutBindings(JSON.parse(raw) as Partial<ShortcutBindings>))
    } catch {
      safeStorage.removeItem(shortcutStorageKey)
      setShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    }
  }, [shortcutStorageKey])

  useEffect(() => {
    safeStorage.setItem(shortcutStorageKey, JSON.stringify(shortcutBindings))
  }, [shortcutBindings, shortcutStorageKey])

  useEffect(() => {
    try {
      const raw = safeStorage.getItem(trackChangesStorageKey)
      setTrackChangesEnabled(raw === '1')
    } catch {
      safeStorage.removeItem(trackChangesStorageKey)
      setTrackChangesEnabled(false)
    }
  }, [trackChangesStorageKey])

  useEffect(() => {
    safeStorage.setItem(trackChangesStorageKey, trackChangesEnabled ? '1' : '0')
  }, [trackChangesEnabled, trackChangesStorageKey])

  useEffect(() => {
    if (trackChangesEnabled) {
      return
    }

    if (trackChangesTimerRef.current !== null) {
      window.clearTimeout(trackChangesTimerRef.current)
      trackChangesTimerRef.current = null
    }
    trackChangesBaseSourceRef.current = null
    trackChangesLatestSourceRef.current = null
  }, [trackChangesEnabled])

  useEffect(() => () => {
    if (trackChangesTimerRef.current !== null) {
      window.clearTimeout(trackChangesTimerRef.current)
    }
    if (editorAutosaveTimerRef.current !== null) {
      window.clearTimeout(editorAutosaveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    try {
      const raw = safeStorage.getItem(openTabsStorageKey(project.id))
      if (!raw) {
        setOpenTabFileIds([activeFile.id])
        return
      }

      const validFileIds = new Set(project.files.map((file) => file.id))
      const parsed = JSON.parse(raw)
      const restored = Array.isArray(parsed)
        ? normalizeOpenTabFileIds(parsed, validFileIds)
        : []

      setOpenTabFileIds(restored.length > 0 ? restored : [activeFile.id])
    } catch {
      safeStorage.removeItem(openTabsStorageKey(project.id))
      setOpenTabFileIds([activeFile.id])
    }
  }, [project.files, project.id])

  useEffect(() => {
    const validFileIds = new Set(project.files.map((file) => file.id))

    setOpenTabFileIds((current) => {
      const filtered = normalizeOpenTabFileIds(current, validFileIds)
      const next = filtered.includes(activeFile.id) ? filtered : [...filtered, activeFile.id]
      return arraysEqual(current, next) ? current : next
    })
  }, [activeFile.id, project.files])

  useEffect(() => {
    const validFileIds = new Set(project.files.map((file) => file.id))
    const next = normalizeOpenTabFileIds(openTabFileIds, validFileIds)
    safeStorage.setItem(openTabsStorageKey(project.id), JSON.stringify(next))
    if (!arraysEqual(openTabFileIds, next)) {
      setOpenTabFileIds(next)
    }
  }, [openTabFileIds, project.files, project.id])

  useEffect(() => {
    setExpandedFolders((current) => {
      const next = { ...current }
      for (const file of project.files) {
        if (file.mimeType === DRIVE_FOLDER_MIME_TYPE && next[file.path] === undefined) {
          next[file.path] = true
        }
      }
      return next
    })
  }, [project.files])

  useEffect(() => {
    setFolderVisibleCounts((current) => {
      const next = { ...current }
      const folderPaths = new Set<string>()
      const tree = buildFileTree(project.files)

      const visit = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.type !== 'folder') {
            continue
          }

          folderPaths.add(node.path)
          next[node.path] = current[node.path] ?? 120
          visit(node.children)
        }
      }

      visit(tree)
      for (const path of Object.keys(next)) {
        if (!folderPaths.has(path)) {
          delete next[path]
        }
      }

      return next
    })
  }, [project.files])

  useEffect(() => {
    if (activeFile.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      setFocusedFolderPath(activeFile.path)
      return
    }

    setFocusedFolderPath((current) => {
      if (!current) {
        return null
      }

      return project.files.some((file) => file.mimeType === DRIVE_FOLDER_MIME_TYPE && file.path === current)
        ? current
        : null
    })
  }, [activeFile, project.files])

  useEffect(() => {
    const sharingOpen = showSharingPanel || activeSidebarTab === 'sharing'
    if (!sharingOpen || (project.role !== 'owner' && project.role !== 'manager')) {
      return
    }

    const refresh = () => {
      void onRefreshProject()
    }

    refresh()
    const stream = new EventSource(buildApiUrl(`/projects/${project.id}/sharing-events`), { withCredentials: true })
    stream.addEventListener('sharing-update', refresh)
    window.addEventListener('focus', refresh)

    return () => {
      stream.close()
      window.removeEventListener('focus', refresh)
    }
  }, [activeSidebarTab, onRefreshProject, project.id, project.role, showSharingPanel])

  useEffect(() => {
    if (!showSharingPanel) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSharingPanel(false)
        setSharePopoverPosition(null)
      }
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (sharePopoverRef.current?.contains(target)) {
        return
      }

      setShowSharingPanel(false)
      setSharePopoverPosition(null)
    }

    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('mousedown', closeOnOutsideClick)

    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('mousedown', closeOnOutsideClick)
    }
  }, [showSharingPanel])

  useEffect(() => {
    if (!isEditableTextFile(activeFile)) {
      return
    }

    const nextSource = ytext.toString()
    setProjectSearchIndex((current) => {
      const previousSource = current[activeFile.id]

      // When the Yjs document is recreated for a file switch, it can be
      // momentarily empty before collaboration sync completes. Do not let
      // that transient empty value overwrite a real cached copy of the file.
      if (!nextSource && (previousSource || !synced)) {
        return current
      }

      if (previousSource === nextSource) {
        return current
      }

      return {
        ...current,
        [activeFile.id]: nextSource,
      }
    })
  }, [activeFile.id, activeFile.mimeType, activeFile.name, synced, ytext])

  useEffect(() => {
    if (!isEditableTextFile(activeFile) || canCollaborateInEditor || ytext.length > 0) {
      return
    }

    const cachedSource = projectSearchIndex[activeFile.id]
    if (!cachedSource) {
      return
    }

    ytext.insert(0, cachedSource)
  }, [activeFile, canCollaborateInEditor, projectSearchIndex, ytext])

  useEffect(() => {
    if (!isEditableTextFile(activeFile)) {
      return
    }

    if (projectSearchIndex[activeFile.id] !== undefined && projectSearchIndex[activeFile.id]) {
      return
    }

    let cancelled = false
    void apiClient.get<string>(`/api/projects/${project.id}/files/${activeFile.id}/content`, {
      responseType: 'text',
    })
      .then((response) => {
        if (cancelled) {
          return
        }

        if (!canCollaborateInEditor && response.data.length > 0 && ytext.length === 0) {
          ytext.insert(0, response.data)
        }

        setProjectSearchIndex((current) => {
          if (current[activeFile.id]) {
            return current
          }

          return {
            ...current,
            [activeFile.id]: response.data,
          }
        })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [activeFile, canCollaborateInEditor, project.id, projectSearchIndex, ytext])

  useEffect(() => {
    if (!canLoadCommentsForActiveFile) {
      setCommentsError(null)
      setCommentSelection(null)
      setHighlightedCommentId(null)
      return
    }

    let cancelled = false
    setIsLoadingComments(true)
    setCommentsError(null)

    void apiClient.get<ProjectComment[]>(`/api/projects/${project.id}/files/${activeFile.id}/comments`)
      .then((response) => {
        if (cancelled) {
          return
        }

        setCommentsByFileId((current) => ({
          ...current,
          [activeFile.id]: sortComments(response.data),
        }))
      })
      .catch((error: any) => {
        if (cancelled) {
          return
        }

        setCommentsError(error?.response?.data?.error ?? 'Failed to load comments for this file.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingComments(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeFile.id, activeFile.mimeType, canLoadCommentsForActiveFile, project.id])

  useEffect(() => {
    if (!canCreateTextComments) {
      setCommentSelection(null)
    }
  }, [canCreateTextComments])

  useEffect(() => {
    if (!isEditableTextFile(activeFile)) {
      setSuggestionsError(null)
      return
    }

    let cancelled = false
    setIsLoadingSuggestions(true)
    setSuggestionsError(null)

    void apiClient.get<ProjectReviewSuggestion[]>(`/api/projects/${project.id}/files/${activeFile.id}/suggestions`)
      .then((response) => {
        if (cancelled) {
          return
        }

        setSuggestionsByFileId((current) => ({
          ...current,
          [activeFile.id]: response.data,
        }))
      })
      .catch((error: any) => {
        if (cancelled) {
          return
        }

        setSuggestionsError(error?.response?.data?.error ?? 'Failed to load suggested changes for this file.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSuggestions(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeFile.id, activeFile.mimeType, project.id])

  useEffect(() => {
    setCommentDraft('')
    setReplyDrafts({})
    setSuggestionDraft('')
    setCommentSelection(null)
    setHighlightedCommentId(null)
    setActiveNoteDialogCommentId(null)
    if (trackChangesTimerRef.current !== null) {
      window.clearTimeout(trackChangesTimerRef.current)
      trackChangesTimerRef.current = null
    }
    trackChangesBaseSourceRef.current = null
    trackChangesLatestSourceRef.current = null
  }, [activeFile.id])

  useEffect(() => {
    const updateCollaborators = () => {
      const entries: CollaboratorPresence[] = []
      awareness.getStates().forEach((value, clientId) => {
        const userState = value.user as { id?: string; name?: string; color?: string; avatarUrl?: string | null } | undefined
        const cursorState = value.typstrCursor as { filePath?: string | null; line?: number; column?: number } | undefined
        if (!userState?.name || clientId === awareness.clientID) {
          return
        }

        entries.push({
          clientId,
          userName: userState.name,
          color: userState.color ?? 'var(--accent)',
          avatarUrl: userState.avatarUrl ?? null,
          filePath: cursorState?.filePath ?? null,
          line: typeof cursorState?.line === 'number' ? cursorState.line : null,
          column: typeof cursorState?.column === 'number' ? cursorState.column : null,
        })
      })

      setCollaborators(entries)
    }

    updateCollaborators()
    awareness.on('change', updateCollaborators)
    return () => {
      awareness.off('change', updateCollaborators)
    }
  }, [awareness])

  useEffect(() => {
    if (activeSidebarTab !== 'collaboration') {
      return
    }

    let cancelled = false
    setIsLoadingChat(true)
    setChatError(null)
    setIsLoadingActivity(true)
    setActivityError(null)

    void Promise.all([
      apiClient.get<ProjectChatMessage[]>(`/api/projects/${project.id}/chat`),
      apiClient.get<ProjectActivityEvent[]>(`/api/projects/${project.id}/activity`, { params: { limit: 120 } }),
    ])
      .then(([chatResponse, activityResponse]) => {
        if (cancelled) {
          return
        }

        setChatMessages(chatResponse.data)
        setActivityEvents(activityResponse.data)
      })
      .catch((error: any) => {
        if (cancelled) {
          return
        }

        const message = error?.response?.data?.error ?? 'Failed to load collaboration history.'
        setChatError(message)
        setActivityError(message)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingChat(false)
          setIsLoadingActivity(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [project.id, activeSidebarTab])

  useEffect(() => {
    if (!followTargetClientId) {
      return
    }

    const target = collaborators.find((collaborator) => collaborator.clientId === followTargetClientId)
    if (!target || target.filePath !== activeFile.path || !target.line) {
      return
    }

    const nextKey = `${target.clientId}:${target.line}:${target.column ?? 1}`
    if (lastFollowedLocationRef.current === nextKey) {
      return
    }

    lastFollowedLocationRef.current = nextKey
    setRevealLocation({ line: target.line, column: target.column ?? 1, nonce: Date.now() })
    setCursorLocation({ line: target.line, column: target.column ?? 1 })
    setGoToLineValue(String(target.line))
    setGoToColumnValue(String(target.column ?? 1))
  }, [activeFile.path, collaborators, followTargetClientId])

  useEffect(() => {
    if (activeSidebarTab !== 'search' && activeSidebarTab !== 'nomenclature' && !canRender) {
      return
    }

    const searchableFiles = project.files.filter(isEditableTextFile)
    const missingFiles = searchableFiles.filter((file) => projectSearchIndex[file.id] === undefined && file.id !== activeFile.id)

    if (missingFiles.length === 0) {
      return
    }

    let cancelled = false
    setIsLoadingProjectSearch(true)
    setProjectSearchError(null)

    void Promise.all(missingFiles.map(async (file) => {
      const response = await apiClient.get<string>(`/api/projects/${project.id}/files/${file.id}/content`, {
        responseType: 'text',
      })
      return { fileId: file.id, content: response.data }
    }))
      .then((entries) => {
        if (cancelled) {
          return
        }

        setProjectSearchIndex((current) => {
          const next = { ...current }
          for (const entry of entries) {
            next[entry.fileId] = entry.content
          }
          return next
        })
      })
      .catch((error: any) => {
        if (cancelled) {
          return
        }

        setProjectSearchError(error?.response?.data?.error ?? 'Failed to build the project search index.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingProjectSearch(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeFile.id, activeSidebarTab, canRender, project.files, project.id, projectSearchIndex])

  useEffect(() => {
    const closeContextMenu = () => { setContextMenu(null); setTinymistContextMenu(null) }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        setTinymistContextMenu(null)
      }
    }

    window.addEventListener('mousedown', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      window.removeEventListener('mousedown', closeContextMenu)
      window.removeEventListener('scroll', closeContextMenu, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    if (!canRender) {
      resetCompile()
    }
  }, [canRender, resetCompile])

  useEffect(() => {
    setCursorLocation({ line: 1, column: 1 })
    setGoToLineValue('1')
    setGoToColumnValue('1')
  }, [activeFile.id])

  const themePreset = useMemo(
    () => THEME_PRESETS.find((preset) => preset.id === theme.presetId) ?? THEME_PRESETS[0],
    [theme.presetId],
  )

  const workspaceStyle = useMemo<CSSProperties>(
    () => ({
      ...(resolveThemeVars(themePreset.vars) as CSSProperties),
      '--ui-font': theme.uiFontFamily,
      '--ui-font-size': `${theme.uiFontSize}pt`,
      '--editor-font': theme.editorFontFamily,
      '--editor-font-size': `${theme.editorFontSize}pt`,
      fontFamily: theme.uiFontFamily,
      fontSize: `${theme.uiFontSize}pt`,
    }) as CSSProperties,
    [theme.editorFontFamily, theme.editorFontSize, theme.uiFontFamily, theme.uiFontSize, themePreset.vars],
  )

  const memberList = useMemo(() => project.members, [project.members])
  const filesById = useMemo(() => new Map(project.files.map((file) => [file.id, file] as const)), [project.files])
  const openTabs = useMemo(
    () => openTabFileIds
      .map((fileId) => filesById.get(fileId))
      .filter((file): file is ProjectFile => Boolean(file)),
    [filesById, openTabFileIds],
  )
  const fileTree = useMemo(() => buildFileTree(project.files), [project.files])
  const browserFileItems = useMemo(
    () => [...project.files]
      .filter((file) => parentDirectoryPath(file.path) === focusedFolderPath)
      .sort((left, right) => {
        const leftIsFolder = left.mimeType === DRIVE_FOLDER_MIME_TYPE
        const rightIsFolder = right.mimeType === DRIVE_FOLDER_MIME_TYPE
        if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1
        return left.name.localeCompare(right.name)
      }),
    [focusedFolderPath, project.files],
  )
  const focusedFolderSegments = useMemo(
    () => focusedFolderPath?.split('/').filter(Boolean) ?? [],
    [focusedFolderPath],
  )
  const activeEditorLanguage = useMemo<'typst' | 'latex' | 'plain'>(
    () => isRenderableTypstFile(activeFile) ? 'typst' : isRenderableLatexFile(activeFile) ? 'latex' : 'plain',
    [activeFile],
  )
  const assistFiles = useMemo(() => project.files.map((file) => ({ path: file.path, mimeType: file.mimeType })), [project.files])
  const [activeEditorSource, setActiveEditorSource] = useState(() => isEditableTextFile(activeFile) ? ytext.toString() : '')
  useEffect(() => {
    setActiveEditorSource(isEditableTextFile(activeFile) ? (ytext.toString() || projectSearchIndex[activeFile.id] || '') : '')
  }, [activeFile.id, activeFile.mimeType, projectSearchIndex, synced, ytext])
  const activeSource = isEditableTextFile(activeFile) ? activeEditorSource : ''
  const activePendingAiEdits = useMemo(
    () => pendingAiEdits.filter((edit) => edit.fileId === activeFile.id),
    [activeFile.id, pendingAiEdits],
  )
  const pendingAiEditCountsByFile = useMemo(() => {
    const counts = new Map<string, number>()
    for (const edit of pendingAiEdits) {
      counts.set(edit.fileId, (counts.get(edit.fileId) ?? 0) + 1)
    }
    return counts
  }, [pendingAiEdits])
  const pendingAiEditFileCount = pendingAiEditCountsByFile.size
  const activeSourceRef = useRef(activeSource)
  activeSourceRef.current = activeSource
  const assistTextEntries = useMemo(
    () => project.files
      .filter(isEditableTextFile)
      .filter((file) => {
        if (activeEditorLanguage === 'typst') {
          return /\.typ$/i.test(file.path) || /\.bib$/i.test(file.path)
        }
        if (activeEditorLanguage === 'latex') {
          return /\.tex$/i.test(file.path) || /\.bib$/i.test(file.path)
        }
        return false
      })
      .map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        content: file.id === activeFile.id ? activeSource : (projectSearchIndex[file.id] ?? ''),
      }))
      .filter((file) => file.content.trim().length > 0),
    [activeEditorLanguage, activeFile.id, activeSource, project.files, projectSearchIndex],
  )
  const breadcrumbSegments = useMemo(() => activeFile.path.split('/').filter(Boolean), [activeFile.path])
  const hasCachedActiveFileSource = useMemo(
    () => Object.prototype.hasOwnProperty.call(projectSearchIndex, activeFile.id),
    [activeFile.id, projectSearchIndex],
  )
  const fileLoadingMessage = useMemo(() => {
    if (!isEditableTextFile(activeFile)) {
      return null
    }

    if (!hasCachedActiveFileSource && !synced && connectionStatus !== 'connected' && connectionStatus !== 'disconnected' && !authenticationError) {
      return 'Loading file…'
    }

    return null
  }, [activeFile, authenticationError, connectionStatus, hasCachedActiveFileSource, synced])
  const mergedCompileDiagnostics = useMemo(
    () => mergeDiagnostics(compileDiagnostics, languageDiagnostics),
    [compileDiagnostics, languageDiagnostics],
  )
  const compileExplanations = useMemo(
    () => mergedCompileDiagnostics.slice(0, 5).map((diagnostic) => ({
      diagnostic,
      explanation: explainCompileDiagnostic(diagnostic),
    })),
    [mergedCompileDiagnostics],
  )
  const typstPreviewUrl = useMemo(() => {
    if (!typstPreviewSession?.ready || !typstPreviewSession.proxyPath) {
      return null
    }

    return buildApiUrl(`${typstPreviewSession.proxyPath.replace(/\/+$/, '')}/`)
  }, [typstPreviewSession])

  const outlineItems = useMemo(() => {
    const rootFile = mainFile ?? activeFile
    const fileContents = new Map<string, string>()
    for (const f of project.files) {
      if (!isEditableTextFile(f)) continue
      const content = f.id === activeFile.id ? activeSource : (projectSearchIndex[f.id] ?? '')
      if (content) fileContents.set(f.path, content)
    }
    return parseDocumentOutline(rootFile.path, fileContents)
  }, [activeFile, activeSource, mainFile, project.files, projectSearchIndex])
  const outlineTree = useMemo(() => buildOutlineTree(outlineItems), [outlineItems])
  const nomenclatureEntries = useMemo(() => {
    const textEntries = project.files
      .filter(isEditableTextFile)
      .map((file) => ({
        path: file.path,
        content: file.id === activeFile.id ? activeSource : (projectSearchIndex[file.id] ?? ''),
      }))
      .filter((entry) => entry.content.trim().length > 0)
    return scanNomenclatureEntries(textEntries)
  }, [activeFile.id, activeSource, project.files, projectSearchIndex])
  // Collapse state keyed by title-path so it survives line-number shifts as
  // the user types above a section. Default: everything expanded.
  const [collapsedOutlinePaths, setCollapsedOutlinePaths] = useState<Set<string>>(() => new Set())
  const toggleOutlineCollapsed = useCallback((path: string) => {
    setCollapsedOutlinePaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  const outlineCounts = useMemo(() => {
    return outlineItems.reduce<Record<OutlineItem['kind'], number>>((acc, item) => {
      acc[item.kind] += 1
      return acc
    }, {
      section: 0,
      figure: 0,
      table: 0,
      equation: 0,
      bibliography: 0,
      other: 0,
    })
  }, [outlineItems])
  const activeFileOutlineItems = useMemo(
    () => outlineItems.filter((item) => !item.filePath || item.filePath === activeFile.path),
    [activeFile.path, outlineItems],
  )
  const minimapSegments = useMemo(
    () => buildMinimapSegments(activeSource, cursorLocation.line, activeFileOutlineItems),
    [activeSource, cursorLocation.line, activeFileOutlineItems],
  )
  const featureClassName = useCallback((kind: OutlineItem['kind']): string => {
    switch (kind) {
      case 'section':
        return styles.featureSection
      case 'figure':
        return styles.featureFigure
      case 'table':
        return styles.featureTable
      case 'equation':
        return styles.featureEquation
      case 'bibliography':
        return styles.featureBibliography
      default:
        return styles.featureOther
    }
  }, [])
  const activeComments = useMemo(
    () => sortComments(commentsByFileId[activeFile.id] ?? []),
    [activeFile.id, commentsByFileId],
  )
  const convertedLatexSnippet = useMemo(
    () => latexConverterSource.trim() ? convertLatexSnippetToTypst(latexConverterSource) : '',
    [latexConverterSource],
  )
  const activeNoteDialogComment = useMemo(
    () => activeComments.find((comment) => comment.id === activeNoteDialogCommentId) ?? null,
    [activeComments, activeNoteDialogCommentId],
  )
  const warmedLanguageSessionKeyRef = useRef<string | null>(null)
  const pendingLanguageDiagnosticsRequestKeyRef = useRef<string | null>(null)
  const lastLanguageDiagnosticsRequestKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isEditableTextFile(activeFile)) {
      pendingLanguageDiagnosticsRequestKeyRef.current = null
      lastLanguageDiagnosticsRequestKeyRef.current = null
      warmedLanguageSessionKeyRef.current = null
      return
    }

    const documentFormat = inferProjectFormatFromFileName(activeFile.name)
    if (documentFormat !== 'typst' && documentFormat !== 'latex') {
      pendingLanguageDiagnosticsRequestKeyRef.current = null
      lastLanguageDiagnosticsRequestKeyRef.current = null
      warmedLanguageSessionKeyRef.current = null
      return
    }

    if (!activeSource.trim()) {
      return
    }

    const sessionKey = `${project.id}:${activeFile.id}:${documentFormat}`
    if (warmedLanguageSessionKeyRef.current === sessionKey) {
      return
    }
    warmedLanguageSessionKeyRef.current = sessionKey

    const controller = new AbortController()
    void apiClient.post<LanguageDiagnosticsSessionResponse>(`/api/projects/${project.id}/language-diagnostics-session`, {
      fileId: activeFile.id,
      source: activeSource,
      documentFormat,
    }, { signal: controller.signal, timeout: 20_000 }).then((response) => {
      setLanguageServerStatuses(response.data.statuses ?? [])
      if (response.data.timings) {
        console.debug('[Language diagnostics session]', {
          projectId: project.id,
          fileId: activeFile.id,
          documentFormat,
          warmed: response.data.warmed,
          ...response.data.timings,
        })
      }
    }).catch(() => {
      if (warmedLanguageSessionKeyRef.current === sessionKey) {
        warmedLanguageSessionKeyRef.current = null
      }
    })

    return () => {
      controller.abort()
    }
  }, [activeFile, activeSource, project.id])

  useEffect(() => {
    if (!isEditableTextFile(activeFile)) {
      pendingLanguageDiagnosticsRequestKeyRef.current = null
      lastLanguageDiagnosticsRequestKeyRef.current = null
      setLanguageDiagnostics([])
      return
    }

    const documentFormat = inferProjectFormatFromFileName(activeFile.name)
    if (documentFormat !== 'typst' && documentFormat !== 'latex') {
      pendingLanguageDiagnosticsRequestKeyRef.current = null
      lastLanguageDiagnosticsRequestKeyRef.current = null
      setLanguageDiagnostics([])
      return
    }

    if (!activeSource.trim()) {
      pendingLanguageDiagnosticsRequestKeyRef.current = null
      lastLanguageDiagnosticsRequestKeyRef.current = null
      setLanguageDiagnostics([])
      return
    }

    const requestKey = `${project.id}:${activeFile.id}:${documentFormat}:${activeSource}`
    if (
      lastLanguageDiagnosticsRequestKeyRef.current === requestKey
      || pendingLanguageDiagnosticsRequestKeyRef.current === requestKey
    ) {
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      pendingLanguageDiagnosticsRequestKeyRef.current = requestKey
      void apiClient.post<LanguageDiagnosticsResponse>(`/api/projects/${project.id}/language-diagnostics`, {
        fileId: activeFile.id,
        source: activeSource,
        documentFormat,
      }, { signal: controller.signal, timeout: 15_000 }).then((response) => {
        pendingLanguageDiagnosticsRequestKeyRef.current = null
        lastLanguageDiagnosticsRequestKeyRef.current = requestKey
        if (activeSourceRef.current !== activeSource) {
          return
        }
        setLanguageDiagnostics(response.data.diagnostics ?? [])
        setLanguageServerStatuses(response.data.statuses ?? [])
        if (response.data.timings) {
          console.debug('[Language diagnostics]', {
            projectId: project.id,
            fileId: activeFile.id,
            documentFormat,
            ...response.data.timings,
          })
        }
      }).catch(() => {
        if (pendingLanguageDiagnosticsRequestKeyRef.current === requestKey) {
          pendingLanguageDiagnosticsRequestKeyRef.current = null
        }
        if (!controller.signal.aborted && lastLanguageDiagnosticsRequestKeyRef.current === requestKey) {
          lastLanguageDiagnosticsRequestKeyRef.current = null
        }
      })
    }, 800)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
      if (pendingLanguageDiagnosticsRequestKeyRef.current === requestKey) {
        pendingLanguageDiagnosticsRequestKeyRef.current = null
      }
    }
  }, [activeFile, activeSource, project.id])

  // Tracks whether we've done the initial seed for the current compile target file.
  const tinymistSeededFileIdRef = useRef<string | null>(null)

  // Seed tinymistSyncSource once per file (when content first becomes available
  // after Yjs sync). Resets on file switch so the new file's content is used.
  useEffect(() => {
    if (!ENABLE_TINYMIST_PREVIEW || !activeIsRenderableTypstFile || previewMode !== 'svg') return
    if (tinymistSeededFileIdRef.current !== compileTargetFile.id) {
      tinymistSeededFileIdRef.current = null
    }
    if (tinymistSeededFileIdRef.current === null && compileTargetSource.trim()) {
      tinymistSeededFileIdRef.current = compileTargetFile.id
      setTinymistSyncSource(compileTargetSource)
    }
  }, [activeIsRenderableTypstFile, compileTargetFile.id, compileTargetSource, previewMode])

  // Refs so the tinymist session timeout can read the latest active-file info
  // without needing them as effect dependencies (which would over-trigger).
  const ytextRef = useRef(ytext)
  ytextRef.current = ytext
  const activeFileIdRef = useRef(activeFile.id)
  activeFileIdRef.current = activeFile.id
  const compileTargetFileIdRef = useRef(compileTargetFile.id)
  compileTargetFileIdRef.current = compileTargetFile.id

  useEffect(() => {
    if (!ENABLE_TINYMIST_PREVIEW || !activeIsRenderableTypstFile) {
      setTypstPreviewSession(null)
      return
    }

    if (previewMode !== 'svg') {
      return
    }

    if (!tinymistSyncSource.trim()) {
      setTypstPreviewSession(null)
      return
    }

    const controller = new AbortController()
    const isSubFile = activeFileIdRef.current !== compileTargetFileIdRef.current
    const body: Record<string, unknown> = {
      fileId: compileTargetFileIdRef.current,
      source: tinymistSyncSource,
      sessionId: `${previewSessionIdRef.current}:tinymist`,
    }
    if (isSubFile) {
      body.activeFileId = activeFileIdRef.current
      body.activeSource = ytextRef.current.toString()
    }
    void apiClient.post<TypstPreviewSessionResponse>(`/api/projects/${project.id}/typst-preview-session`, body, { signal: controller.signal, timeout: 20_000 }).then((response) => {
      setTypstPreviewSession(response.data)
      setLanguageServerStatuses(response.data.statuses ?? [])
      if (response.data.ready) {
        tinymistReconnectAttemptsRef.current = 0
      }
    }).catch((err) => {
      if (!controller.signal.aborted) {
        if (err.response?.status === 404) {
          // Reset session ID to force a new session on next attempt
          previewSessionIdRef.current = `preview:${project.id}:${compileTargetFileIdRef.current}:${tinymistClientIdRef.current}`
        }
        setTypstPreviewSession(null)
      }
    })

    return () => {
      controller.abort()
    }
  }, [activeIsRenderableTypstFile, compileTargetFile.id, tinymistSyncSource, tinymistReconnectNonce, previewMode, project.id])

  useEffect(() => {
    if (!ENABLE_TINYMIST_PREVIEW || !activeIsRenderableTypstFile || previewMode !== 'svg') {
      return
    }
    if (!tinymistSyncSource.trim() || typstPreviewSession?.ready) {
      return
    }
    const retryId = window.setTimeout(() => {
      tinymistReconnectAttemptsRef.current += 1
      if (tinymistReconnectAttemptsRef.current >= 5) {
        // Hard reset the session identity after repeated "not ready" responses
        // so we can escape a wedged backend preview process.
        previewSessionIdRef.current = `preview:${project.id}:${compileTargetFile.id}:${tinymistClientIdRef.current}:${Date.now().toString(36)}`
        tinymistReconnectAttemptsRef.current = 0
      }
      setTinymistReconnectNonce((n) => n + 1)
    }, 1200)
    return () => {
      window.clearTimeout(retryId)
    }
  }, [activeIsRenderableTypstFile, compileTargetFile.id, previewMode, project.id, tinymistSyncSource, typstPreviewSession?.ready, typstPreviewSession?.detail])

  const activeSuggestions = useMemo(
    () => suggestionsByFileId[activeFile.id] ?? [],
    [activeFile.id, suggestionsByFileId],
  )
  const activeFileWorkflow = useMemo(
    () => project.fileWorkflows.find((workflow) => workflow.fileId === activeFile.id) ?? null,
    [activeFile.id, project.fileWorkflows],
  )
  const activePdfAssetUrl = useMemo(
    () => isPdfAsset ? `/api/projects/${project.id}/files/${activeFile.id}/content` : null,
    [activeFile.id, isPdfAsset, project.id],
  )
  const contextFolderPath = contextMenu?.kind === 'root'
    ? null
    : contextMenu?.kind === 'folder'
      ? contextMenu.file.path
      : contextMenu?.kind === 'file'
        ? parentDirectoryPath(contextMenu.file.path)
        : null
  const targetFolderPath = contextFolderPath ?? focusedFolderPath ?? null
  const compileContext = useMemo(() => ({
    projectId: project.id,
    fileId: compileTargetFile.id,
    entryFilePath: compileTargetFile.path,
    documentFormat: canRenderLatex ? 'latex' as const : 'typst' as const,
    format: previewMode,
    latexEngine: canRenderLatex && activeLatexCompiler && !LATEX_WEB_PREVIEW_ENGINES.includes(activeLatexCompiler as LatexWebPreviewEngine) ? activeLatexCompiler as LatexEngine : undefined,
    latexWebPreviewEngine: canRenderLatex ? (activeLatexWebPreviewEngine ?? DEFAULT_LATEX_WEB_PREVIEW_ENGINE) : undefined,
    previewSessionId: `${previewSessionIdRef.current}:${previewMode}`,
  }), [activeLatexCompiler, activeLatexWebPreviewEngine, canRenderLatex, compileTargetFile.id, compileTargetFile.path, previewMode, project.id])
  const compileContextWithActiveSource = useCallback((activeSourceOverride: string) => ({
    ...compileContext,
    activeFileId: compileTargetFile.id === activeFile.id ? undefined : activeFile.id,
    activeFilePath: compileTargetFile.id === activeFile.id ? undefined : activeFile.path,
    activeSource: compileTargetFile.id === activeFile.id ? undefined : activeSourceOverride,
    files: project.files.map((f) => ({
      id: f.id,
      path: f.path,
      mimeType: f.mimeType,
      updatedAt: f.updatedAt,
      content: isEditableTextFile(f) ? (f.id === activeFile.id ? activeSourceOverride : projectSearchIndex[f.id]) : undefined,
    })),
  }), [activeFile.id, activeFile.path, compileContext, compileTargetFile.id, project.files, projectSearchIndex])

  const resolvedPreviewMode = effectivePreviewFormat === 'pdf' ? 'pdf' : previewMode
  const canAnnotatePdfPreview = canEdit && (isPdfAsset || resolvedPreviewMode === 'pdf')
  const shouldUseTinymistWebPreview = ENABLE_TINYMIST_PREVIEW && activeIsRenderableTypstFile && previewMode === 'svg'
  const prefersTinymistPreview = shouldUseTinymistWebPreview && Boolean(typstPreviewSession?.ready)
  const [retainedCompileOutput, setRetainedCompileOutput] = useState<{
    compileError: string | null
    compileLog: string | null
    diagnostics: CompileDiagnostic[]
  }>({
    compileError: null,
    compileLog: null,
    diagnostics: [],
  })
  const shouldRetainCompileOutput = shouldUseTinymistWebPreview && !typstPreviewSession?.ready
  const visibleCompileError = shouldRetainCompileOutput ? (compileError ?? retainedCompileOutput.compileError) : compileError
  const visibleCompileLog = shouldRetainCompileOutput ? (compileLog ?? retainedCompileOutput.compileLog) : compileLog
  const visibleCompileDiagnostics = shouldRetainCompileOutput && mergedCompileDiagnostics.length === 0
    ? retainedCompileOutput.diagnostics
    : mergedCompileDiagnostics
  const hasVisibleErrorDiagnostic = visibleCompileDiagnostics.some((diagnostic) => diagnostic.level === 'error')
  const hasPreviewCompilerOutput = !isPdfAsset && (
    Boolean(visibleCompileError)
    || visibleCompileDiagnostics.length > 0
    || Boolean(visibleCompileLog)
    || Boolean(compileNotice)
    || isCompiling
  )
  const livePageCount = useMemo(() => {
    if (resolvedPreviewMode === 'pdf' || isPdfAsset) {
      return pdfPreviewPageCount
    }

    return pageCount
  }, [isPdfAsset, pageCount, pdfPreviewPageCount, resolvedPreviewMode])

  useEffect(() => {
    if (!hasPreviewCompilerOutput) {
      setPreviewPanelTab('preview')
    }
  }, [hasPreviewCompilerOutput])
  const templateComplianceIssues = useMemo(
    () => evaluateTemplateCompliance({
      template: project.activeTemplate,
      activeSource,
      allSources: Object.entries(projectSearchIndex)
        .map(([fileId, source]) => `${project.files.find((file) => file.id === fileId)?.path ?? fileId}\n${source}`)
        .concat(isEditableTextFile(activeFile) ? [`${activeFile.path}\n${ytext.toString()}`] : []),
      livePageCount,
      configuredPageLimit: project.compileSettings.pageLimit,
    }),
    [activeFile, activeSource, livePageCount, project.activeTemplate, project.compileSettings.pageLimit, project.files, projectSearchIndex, ytext],
  )
  const previewSurfaceResetKey = [
    activeFile.id,
    resolvedPreviewMode,
    canRenderLatex ? (activeLatexCompiler ?? 'latex') : 'typst',
    prefersTinymistPreview ? 'tinymist' : 'local',
    typstPreviewUrl ?? 'none',
    activePdfAssetUrl ?? pdfUrl ?? 'no-pdf',
    webPreviewHtml ? `html:${webPreviewHtml.length}` : 'no-html',
  ].join('|')
  const editorSurfaceResetKey = [
    activeFile.id,
    canEdit ? 'editable' : 'readonly',
    themePreset.editorMode,
    theme.editorFontFamily,
    String(theme.editorFontSize),
  ].join('|')

  useEffect(() => {
    if (!compileError && !compileLog && mergedCompileDiagnostics.length === 0) {
      return
    }

    setRetainedCompileOutput({
      compileError,
      compileLog,
      diagnostics: mergedCompileDiagnostics,
    })
  }, [compileError, compileLog, mergedCompileDiagnostics])

  useEffect(() => {
    if (!prefersTinymistPreview || isCompiling || compileError || compileLog || mergedCompileDiagnostics.length > 0) {
      return
    }

    setRetainedCompileOutput({
      compileError: null,
      compileLog: null,
      diagnostics: [],
    })
  }, [compileError, compileLog, isCompiling, mergedCompileDiagnostics.length, prefersTinymistPreview])

  useEffect(() => {
    if (prefersTinymistPreview) {
      resetCompile()
    }
  }, [prefersTinymistPreview, resetCompile])

  useEffect(() => {
    try {
      const raw = safeStorage.getItem(`${LATEX_COMPILER_STORAGE_PREFIX}${project.id}`)
      if (!raw) {
        setLatexCompilerByFileId({})
        return
      }

      const parsed = JSON.parse(raw) as Record<string, LatexCompilerPreference>
      setLatexCompilerByFileId(parsed)
    } catch {
      safeStorage.removeItem(`${LATEX_COMPILER_STORAGE_PREFIX}${project.id}`)
      setLatexCompilerByFileId({})
    }
  }, [project.id])

  useEffect(() => {
    safeStorage.setItem(`${LATEX_COMPILER_STORAGE_PREFIX}${project.id}`, JSON.stringify(latexCompilerByFileId))
  }, [latexCompilerByFileId, project.id])

  useEffect(() => {
    if (!canRenderLatex) {
      return
    }

    if (latexCompilerByFileId[compileTargetFile.id] !== activeLatexCompiler) {
      setLatexCompilerByFileId((current) => ({
        ...current,
        [compileTargetFile.id]: activeLatexCompiler ?? DEFAULT_LATEX_COMPILER,
      }))
    }
  }, [activeLatexCompiler, canRenderLatex, compileTargetFile.id, latexCompilerByFileId])

  useEffect(() => {
    if (!canRenderLatex || !activeLatexCompiler) {
      return
    }

    setPreviewMode(activeLatexWebPreviewEngine ? 'svg' : 'pdf')
  }, [activeLatexCompiler, activeLatexWebPreviewEngine, canRenderLatex, compileTargetFile.id])

  useEffect(() => {
    const previous = previewCompileSelectionRef.current
    const changed = previous.previewMode !== previewMode
      || previous.activeLatexCompiler !== activeLatexCompiler
      || previous.compileTargetFileId !== compileTargetFile.id
    previewCompileSelectionRef.current = {
      previewMode,
      activeLatexCompiler,
      compileTargetFileId: compileTargetFile.id,
    }

    if (!changed || !canRender || !compileTargetSource.trim()) {
      return
    }

    if (!ENABLE_AUTO_COMPILE) return

    if (shouldUseTinymistWebPreview) {
      setTinymistSyncSource(compileTargetSource)
      return
    }

    compileNow(compileTargetSource, compileContextWithActiveSource(activeSource))
  }, [activeLatexCompiler, activeSource, canRender, compileContextWithActiveSource, compileNow, compileTargetFile.id, compileTargetSource, previewMode, shouldUseTinymistWebPreview])

  const AUTO_COMPILE_DEBOUNCE_MS = 800
  useEffect(() => {
    if (!ENABLE_AUTO_COMPILE) return
    if (!ENABLE_TINYMIST_PREVIEW || !activeIsRenderableTypstFile || previewMode !== 'svg') return
    if (!compileTargetSource.trim()) return
    const id = window.setTimeout(() => {
      setTinymistSyncSource((current) => current === compileTargetSource ? current : compileTargetSource)
    }, AUTO_COMPILE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [activeIsRenderableTypstFile, compileTargetSource, previewMode])

  useEffect(() => {
    if (!ENABLE_AUTO_COMPILE) return
    if (!canRender || shouldUseTinymistWebPreview || canRenderLatex) return
    if (previewMode === 'pdf') return
    if (!compileTargetSource.trim()) return
    const id = window.setTimeout(() => {
      compileNow(compileTargetSource, compileContextWithActiveSource(activeSource))
    }, AUTO_COMPILE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, canRender, canRenderLatex, compileContextWithActiveSource, compileNow, compileTargetSource, previewMode, shouldUseTinymistWebPreview])

  const initialCompileFiredRef = useRef<string | null>(null)
  useEffect(() => {
    if (!canRender) return
    if (canRenderLatex) return
    if (canCollaborateInEditor && !synced) return
    if (initialCompileFiredRef.current === project.id) return
    // Read ytext directly — memo is stale when Hocuspocus fills content without changing the ytext reference
    const source = (compileTargetFile.id === activeFile.id ? ytext.toString() : '') || projectSearchIndex[compileTargetFile.id] || ''
    if (!source.trim()) return
    initialCompileFiredRef.current = project.id
    if (shouldUseTinymistWebPreview) {
      setTinymistSyncSource(source)
      return
    }
    compileNow(source, compileContextWithActiveSource(source))
  }, [activeFile.id, canCollaborateInEditor, canRender, canRenderLatex, compileContextWithActiveSource, compileNow, compileTargetFile.id, project.id, projectSearchIndex, shouldUseTinymistWebPreview, synced, ytext])

  const latexInitialSourceRef = useRef<string | null>(null)
  const latexInitialSourceFileIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ENABLE_AUTO_COMPILE) return
    if (!canRenderLatex) return
    if (!compileTargetSource.trim()) return
    if (latexInitialSourceFileIdRef.current !== compileTargetFile.id) {
      latexInitialSourceFileIdRef.current = compileTargetFile.id
      latexInitialSourceRef.current = compileTargetSource
      return
    }
    if (latexInitialSourceRef.current === null) {
      latexInitialSourceRef.current = compileTargetSource
      return
    }
    if (compileTargetSource === latexInitialSourceRef.current) return
    const id = window.setTimeout(() => {
      compileNow(compileTargetSource, compileContextWithActiveSource(activeSource))
    }, AUTO_COMPILE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [activeSource, canRenderLatex, compileContextWithActiveSource, compileNow, compileTargetFile.id, compileTargetSource])

  const packageSuggestions = useMemo(
    () => ecosystem
      ? [
          ...ecosystem.settings.packagePins.map((pin) => ({
            label: `${pin.packageId}:${pin.version}`,
            detail: 'Pinned in this project',
          })),
          ...ecosystem.packageCatalog.map((entry) => ({
            label: `${entry.packageId}:${entry.latestVersion}`,
            detail: entry.description,
          })),
        ].filter((entry, index, entries) => entries.findIndex((candidate) => candidate.label === entry.label) === index)
      : [],
    [ecosystem],
  )

  const loadEcosystem = useCallback(async () => {
    setIsLoadingEcosystem(true)
    setEcosystemError(null)
    try {
      const response = await apiClient.get<ProjectEcosystemState>(`/api/projects/${project.id}/ecosystem`)
      setEcosystem(response.data)
    } catch (error: any) {
      setEcosystemError(error?.response?.data?.error ?? 'Failed to load project ecosystem settings.')
    } finally {
      setIsLoadingEcosystem(false)
    }
  }, [project.id])

  const loadFileRevisions = useCallback(async () => {
    if (!isEditableTextFile(activeFile)) {
      setFileRevisions([])
      setFileRevisionsError('Revision history is only available for text files.')
      return
    }

    setIsLoadingFileRevisions(true)
    setFileRevisionsError(null)
    try {
      const response = await apiClient.get<ProjectRevision[]>(`/api/projects/${project.id}/files/${activeFile.id}/revisions`, {
        params: { limit: 80 },
      })
      setFileRevisions(response.data)
    } catch (error: any) {
      setFileRevisionsError(error?.response?.data?.error ?? 'Failed to load revision history.')
    } finally {
      setIsLoadingFileRevisions(false)
    }
  }, [activeFile, project.id])

  const saveEcosystem = useCallback(async (payload: {
    settings?: Partial<{
      packagePins: ProjectPackagePin[]
      writingSnippets: ProjectWritingSnippet[]
      writingGoals: ProjectWritingGoals
    }>
    metadataFiles?: Array<{ path: string; content: string }>
  }) => {
    const mergedSettings = payload.settings === undefined
      ? undefined
      : {
          packagePins: payload.settings.packagePins ?? ecosystem?.settings.packagePins ?? [],
          writingSnippets: payload.settings.writingSnippets ?? ecosystem?.settings.writingSnippets ?? [],
          writingGoals: payload.settings.writingGoals ?? ecosystem?.settings.writingGoals ?? DEFAULT_WRITING_GOALS,
        }
    const response = await apiClient.patch<ProjectEcosystemState>(`/api/projects/${project.id}/ecosystem`, {
      ...payload,
      settings: mergedSettings,
    })
    setEcosystem(response.data)
    return response.data
  }, [ecosystem?.settings, project.id])

  useEffect(() => {
    void loadEcosystem()
  }, [loadEcosystem])

  useEffect(() => {
    if (activeSidebarTab !== 'ecosystem') {
      return
    }

    void loadEcosystem()
  }, [activeSidebarTab, loadEcosystem])

  useEffect(() => {
    if (!showRevisionPanel) {
      return
    }

    void loadFileRevisions()
  }, [loadFileRevisions, showRevisionPanel])

  useEffect(() => {
    if (activeSidebarTab === 'history') {
      void loadFileRevisions()
    }
  }, [activeSidebarTab, activeFile.id, loadFileRevisions])

  useEffect(() => {
    if (activeSidebarTab !== 'bibliography') {
      return
    }

    void loadEcosystem()
  }, [activeSidebarTab, loadEcosystem])

  useEffect(() => {
    if (activeSidebarTab !== 'tasks') return
    let cancelled = false
    setIsLoadingProjectTasks(true)
    void apiClient.get<ProjectComment[]>(`/api/projects/${project.id}/tasks`)
      .then(({ data }) => { if (!cancelled) setProjectTasks(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoadingProjectTasks(false) })
    return () => { cancelled = true }
  }, [activeSidebarTab, project.id])

  useEffect(() => {
    if (!canRender || compileTargetFile.id === activeFile.id) {
      return
    }

    if (projectSearchIndex[compileTargetFile.id] !== undefined) {
      return
    }

    let cancelled = false
    void apiClient.get<string>(`/api/projects/${project.id}/files/${compileTargetFile.id}/content`, {
      responseType: 'text',
    })
      .then((response) => {
        if (cancelled) {
          return
        }

        setProjectSearchIndex((current) => ({
          ...current,
          [compileTargetFile.id]: response.data,
        }))
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [activeFile.id, canRender, compileTargetFile.id, project.id, projectSearchIndex])

  const prevIsCompilingRef = useRef(false)
  const lastEcosystemRefreshAtRef = useRef(0)
  const prevCompileErrorRef = useRef<string | null>(null)
  useEffect(() => {
    const prevError = prevCompileErrorRef.current
    prevCompileErrorRef.current = compileError
    if (compileError && compileError !== prevError && compileLog) {
      setActiveSidebarTab('log')
      sidebarPanelRef.current?.expand()
    }
  }, [compileError, compileLog])

  useEffect(() => {
    const wasCompiling = prevIsCompilingRef.current
    prevIsCompilingRef.current = isCompiling
    if (wasCompiling && !isCompiling && !compileError) {
      // Throttle post-compile ecosystem refreshes. The ecosystem object is
      // large and replacing it cascades re-renders through the editor; doing
      // it after every keystroke-triggered auto-compile bogs typing down.
      // Citations/references/prose stats don't need to be live-fresh.
      const now = Date.now()
      if (now - lastEcosystemRefreshAtRef.current >= 5000) {
        lastEcosystemRefreshAtRef.current = now
        void loadEcosystem()
      }
    }
  }, [isCompiling, compileError, loadEcosystem])

  useEffect(() => {
    if (!isEditableTextFile(activeFile) || activeComments.length === 0 || !activeSource) {
      return
    }

    const missingComments = activeComments.filter((comment) => {
      if (comment.status === 'deleted' || comment.pdfAnnotation) {
        return false
      }

      const normalizedExcerpt = normalizeCommentExcerpt(comment.excerpt)
      return normalizedExcerpt ? !sourceContainsCommentExcerpt(activeSource, normalizedExcerpt) : false
    })

    if (missingComments.length === 0) {
      return
    }

    for (const comment of missingComments) {
      if (pendingDeletedCommentIdsRef.current.has(comment.id)) {
        continue
      }

      pendingDeletedCommentIdsRef.current.add(comment.id)
      void apiClient.patch<ProjectComment>(`/api/projects/${project.id}/files/${activeFile.id}/comments/${comment.id}`, {
        status: 'deleted',
      })
        .then((response) => {
          setCommentsByFileId((current) => ({
            ...current,
            [activeFile.id]: sortComments((current[activeFile.id] ?? []).map((entry) => entry.id === comment.id ? response.data : entry)),
          }))
          setHighlightedCommentId((current) => current === comment.id ? null : current)
        })
        .catch(() => {
          return undefined
        })
        .finally(() => {
          pendingDeletedCommentIdsRef.current.delete(comment.id)
        })
    }
  }, [activeComments, activeFile, activeSource, project.id])

  const projectSearchResults = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase()
    if (!query) {
      return [] as ProjectSearchResult[]
    }

    const results: ProjectSearchResult[] = []
    for (const file of project.files) {
      if (!isEditableTextFile(file)) {
        continue
      }

      const content = projectSearchIndex[file.id]
      if (!content) {
        continue
      }

      const lines = content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const lowerLine = lines[index].toLowerCase()
        const column = lowerLine.indexOf(query)
        if (column === -1) {
          continue
        }

        results.push({
          fileId: file.id,
          filePath: file.path,
          lineNumber: index + 1,
          column: column + 1,
          lineText: lines[index],
        })

        if (results.length >= 150) {
          return results
        }
      }
    }

    return results
  }, [project.files, projectSearchIndex, projectSearchQuery])

  const handleCompileNow = useCallback((options?: { sourceOverride?: string; activeSourceOverride?: string }) => {
    if (canRender) {
      const source = options?.sourceOverride ?? (compileTargetFile.id === activeFile.id ? ytext.toString() : compileTargetSource)
      const currentActiveSource = options?.activeSourceOverride ?? activeSource
      if (!source.trim()) {
        return
      }
      const hadVisibleTypstError = shouldUseTinymistWebPreview && (Boolean(visibleCompileError) || hasVisibleErrorDiagnostic)
      pendingLanguageDiagnosticsRequestKeyRef.current = null
      lastLanguageDiagnosticsRequestKeyRef.current = null
      setLanguageDiagnostics([])
      setRetainedCompileOutput({
        compileError: null,
        compileLog: null,
        diagnostics: [],
      })
      resetCompile()
      if (shouldUseTinymistWebPreview) {
        if (hadVisibleTypstError) {
          previewSessionIdRef.current = `preview:${project.id}:${compileTargetFile.id}:${tinymistClientIdRef.current}:${Date.now().toString(36)}`
          setTypstPreviewSession(null)
        }
        // Force a fresh Tinymist preview session request even when the source
        // text hasn't changed, so manual compile shortcuts remain reliable.
        setTinymistSyncSource((current) => current === source ? current : source)
        setTinymistReconnectNonce((current) => current + 1)
      }

      compileNow(source, compileContextWithActiveSource(currentActiveSource))
    }
  }, [activeFile.id, activeSource, canRender, compileContextWithActiveSource, compileNow, compileTargetFile.id, compileTargetSource, hasVisibleErrorDiagnostic, project.id, resetCompile, shouldUseTinymistWebPreview, visibleCompileError, ytext])

  useEffect(() => {
    const compileShortcut = shortcutBindings.compile.trim()
    if (!compileShortcut) {
      return
    }

    const matchesShortcut = (event: KeyboardEvent, binding: string) => {
      const parts = binding.toLowerCase().split('-').filter(Boolean)
      if (parts.length === 0) {
        return false
      }

      const keyToken = parts[parts.length - 1]
      const modifierTokens = new Set(parts.slice(0, -1))
      const wantsMod = modifierTokens.has('mod')
      const wantsCtrl = wantsMod || modifierTokens.has('ctrl')
      const wantsMeta = wantsMod || modifierTokens.has('meta') || modifierTokens.has('cmd')
      const wantsShift = modifierTokens.has('shift')
      const wantsAlt = modifierTokens.has('alt') || modifierTokens.has('option')

      const ctrlOrMetaPressed = event.ctrlKey || event.metaKey
      const modSatisfied = wantsMod ? ctrlOrMetaPressed : true

      if (!modSatisfied) return false
      if (!wantsMod && wantsCtrl !== event.ctrlKey) return false
      if (!wantsMod && wantsMeta !== event.metaKey) return false
      if (event.shiftKey !== wantsShift) return false
      if (event.altKey !== wantsAlt) return false

      const normalizedEventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
      return normalizedEventKey === keyToken
    }

    const onCompileShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isEditableTarget = Boolean(target?.closest('[contenteditable="true"]'))
        || tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'

      if (isEditableTarget) {
        return
      }

      if (!matchesShortcut(event, compileShortcut)) {
        return
      }

      event.preventDefault()
      handleCompileNow()
    }

    window.addEventListener('keydown', onCompileShortcut)
    return () => window.removeEventListener('keydown', onCompileShortcut)
  }, [handleCompileNow, shortcutBindings.compile])

  const handleDownloadExport = useCallback((format: ExportFormat) => {
    const source = canRenderLatex ? compileTargetSource : ytext.toString()
    if (!source.trim()) {
      appendConversionLog('error', 'Nothing to export from the current file.')
      return
    }

    exportDocument(
      source,
      format,
      `${project.title}-${compileTargetFile.name.replace(/\.[^.]+$/, '')}`,
      compileContext,
    )
  }, [appendConversionLog, canRenderLatex, compileContext, compileTargetFile.name, compileTargetSource, exportDocument, project.title, ytext])

  const handleSaveExportToDrive = useCallback(async (format: ExportFormat) => {
    try {
      const source = canRenderLatex ? compileTargetSource : ytext.toString()
      if (!source.trim()) {
        appendConversionLog('error', 'Nothing to export from the current file.')
        return
      }

      await saveExportToDrive(source, format, compileContext)
    } catch (error: any) {
      appendConversionLog('error', error?.response?.data?.error ?? 'Failed to save export to Google Drive.')
    }
  }, [appendConversionLog, canRenderLatex, compileContext, compileTargetSource, saveExportToDrive, ytext])

  const handleQuickExport = useCallback(() => {
    const format = project.compileSettings.defaultExportFormat
    if (project.compileSettings.defaultExportDestination === 'drive') {
      void handleSaveExportToDrive(format)
      return
    }

    handleDownloadExport(format)
  }, [handleDownloadExport, handleSaveExportToDrive, project.compileSettings.defaultExportDestination, project.compileSettings.defaultExportFormat])

  const handleRunSelectedExport = useCallback(() => {
    if (selectedExportDestination === 'drive') {
      void handleSaveExportToDrive(selectedExportFormat)
      return
    }

    handleDownloadExport(selectedExportFormat)
  }, [handleDownloadExport, handleSaveExportToDrive, selectedExportDestination, selectedExportFormat])

  const handleDownloadProjectZip = useCallback(async () => {
    try {
      await downloadProjectZip(
        {
          projectId: project.id,
          fileId: isEditableTextFile(activeFile) ? activeFile.id : undefined,
          projectTitle: project.title,
        },
        isEditableTextFile(activeFile) ? ytext.toString() : undefined,
      )
    } catch (error: any) {
      appendConversionLog('error', error?.response?.data?.error ?? 'Failed to download the project as a ZIP archive.')
    }
  }, [activeFile, appendConversionLog, downloadProjectZip, project.id, project.title, ytext])

  const handleDownloadProjectAsTypstZip = useCallback(async () => {
    try {
      await downloadProjectZip(
        {
          projectId: project.id,
          fileId: isEditableTextFile(activeFile) ? activeFile.id : undefined,
          projectTitle: `${project.title}-typst`,
          targetProjectFormat: 'typst',
        },
        isEditableTextFile(activeFile) ? ytext.toString() : undefined,
      )
    } catch (error: any) {
      appendConversionLog('error', error?.response?.data?.error ?? 'Failed to export the project as a Typst ZIP archive.')
    }
  }, [activeFile, appendConversionLog, downloadProjectZip, project.id, project.title, ytext])

  const handleCreateTypstProjectCopy = useCallback(async () => {
    try {
      const response = await apiClient.post<ProjectDetail>(`/api/projects/${project.id}/create-typst-copy`, {
        sourceFileId: isEditableTextFile(activeFile) ? activeFile.id : undefined,
        source: isEditableTextFile(activeFile) ? ytext.toString() : undefined,
      })
      appendConversionLog('info', `Created Typst project copy: ${response.data.title}.`)
      navigate(`/projects/${response.data.id}`)
    } catch (error: any) {
      appendConversionLog('error', error?.response?.data?.error ?? 'Failed to create a Typst copy of this project.')
    }
  }, [activeFile, appendConversionLog, navigate, project.id, ytext])

  const handleProjectRename = useCallback(async (title: string) => {
    try {
      const response = await apiClient.patch<ProjectDetail>(`/api/projects/${project.id}`, { title })
      onProjectChange(response.data)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to rename project.')
    }
  }, [onProjectChange, project.id])

  const handleCompileSettingsChange = useCallback(async (compileSettings: ProjectCompileSettings) => {
    const response = await apiClient.patch<ProjectDetail>(`/api/projects/${project.id}`, { compileSettings })
    onProjectChange(response.data)
  }, [onProjectChange, project.id])


  const handleConvertProjectFormat = useCallback(async (targetFormat: ProjectFormat) => {
    if (!isEditableTextFile(activeFile)) {
      throw new Error('Only text files can be converted.')
    }

    setIsConvertingProjectFormat(true)
    try {
      const response = await apiClient.post<{
        file?: { id: string; path: string; name: string }
        sourceFormat: ProjectFormat
        targetFormat: ProjectFormat
      }>(`/api/projects/${project.id}/convert`, {
        sourceFileId: activeFile.id,
        source: ytext.toString(),
        targetFormat,
      })

      const refreshed = await apiClient.get<ProjectDetail>(`/api/projects/${project.id}`)
      onProjectChange(refreshed.data)
      if (response.data.file?.id) {
        onSelectFile(response.data.file.id)
      }
      appendConversionLog('info', `Converted ${response.data.sourceFormat} to ${response.data.targetFormat}.`)
    } catch (error: any) {
      appendConversionLog('error', error?.response?.data?.error ?? error?.message ?? 'Failed to convert this file.')
      throw error
    } finally {
      setIsConvertingProjectFormat(false)
    }
  }, [activeFile, appendConversionLog, onProjectChange, onSelectFile, project.id, ytext])

  const handleSaveConvertedFile = useCallback(async (targetFormat: ProjectFormat) => {
    if (!isEditableTextFile(activeFile)) {
      throw new Error('Only text files can be saved this way.')
    }

    const response = await apiClient.post<{
      file?: { id: string; path: string; name: string }
      sourceFormat: ProjectFormat
      targetFormat: ProjectFormat
      message?: string
    }>(`/api/projects/${project.id}/convert`, {
      sourceFileId: activeFile.id,
      source: ytext.toString(),
      targetFormat,
      createCopy: true,
    })

    const refreshed = await apiClient.get<ProjectDetail>(`/api/projects/${project.id}`)
    onProjectChange(refreshed.data)
    if (response.data.file?.id) {
      onSelectFile(response.data.file.id)
    }
    appendConversionLog('info', response.data.message ?? `Saved ${response.data.targetFormat} output to the project.`)
  }, [activeFile, appendConversionLog, onProjectChange, onSelectFile, project.id, ytext])

  const handleSetMainFile = useCallback(async (file: ProjectFile) => {
    if (!canEdit || !isRenderableDocumentFile(file)) {
      return
    }

    const response = await apiClient.patch<ProjectDetail>(`/api/projects/${project.id}`, { mainFileId: file.id })
    onProjectChange(response.data)
  }, [canEdit, onProjectChange, project.id])

  const handleDiagnosticClick = useCallback((diagnostic: CompileDiagnostic) => {
    if (!diagnostic.filePath) {
      return
    }

    const targetFile = project.files.find((file) => file.path === diagnostic.filePath)
    if (!targetFile) {
      return
    }

    onSelectFile(targetFile.id)
    setRevealLocation({
      line: diagnostic.line ?? 1,
      column: diagnostic.column ?? 1,
      nonce: Date.now(),
    })
  }, [onSelectFile, project.files])

  const { setIsChatOpen } = useGeminiContext()
  const aiLoading = gemini.loading
  const [askingAiDiagnosticKey, setAskingAiDiagnosticKey] = useState<string | null>(null)

  // Stash mutable inputs in refs so handleAskAiAboutDiagnostic has a stable
  // identity. Without this, the callback is recreated whenever LSP diagnostics
  // refire (every typing pause), which re-renders CompileOutputPanel and
  // re-keys all virtualized rows — perceived as editor lag.
  const askAiInputsRef = useRef({
    activeFileId: activeFile.id,
    activeFilePath: activeFile.path,
    files: project.files,
    projectId: project.id,
    projectSearchIndex,
    languageDiagnostics,
    ytext,
    setIsChatOpen,
    generateAi: gemini.generate,
  })
  useEffect(() => {
    askAiInputsRef.current = {
      activeFileId: activeFile.id,
      activeFilePath: activeFile.path,
      files: project.files,
      projectId: project.id,
      projectSearchIndex,
      languageDiagnostics,
      ytext,
      setIsChatOpen,
      generateAi: gemini.generate,
    }
  }, [activeFile.id, activeFile.path, gemini.generate, languageDiagnostics, project.files, project.id, projectSearchIndex, setIsChatOpen, ytext])

  const handleAskAiAboutDiagnostic = useCallback(async (diagnostic: CompileDiagnostic) => {
    const inputs = askAiInputsRef.current
    const key = `${diagnostic.filePath ?? 'global'}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}:${diagnostic.message}`
    setAskingAiDiagnosticKey(key)

    const filePath = diagnostic.filePath ?? inputs.activeFilePath
    const lang = /\.(tex|sty|cls|bib)$/i.test(filePath) ? 'latex'
      : /\.typ$/i.test(filePath) ? 'typst'
      : 'source'

    let snippet = ''
    if (diagnostic.filePath) {
      const targetFile = inputs.files.find((file) => file.path === diagnostic.filePath)
      const source = targetFile?.id === inputs.activeFileId
        ? inputs.ytext.toString()
        : (targetFile ? inputs.projectSearchIndex[targetFile.id] : undefined) ?? ''
      if (source) {
        const lines = source.split(/\r?\n/)
        const focus = (diagnostic.line ?? 1) - 1
        const start = Math.max(0, focus - 8)
        const end = Math.min(lines.length, focus + 9)
        snippet = lines
          .slice(start, end)
          .map((text, i) => `${String(start + i + 1).padStart(4, ' ')}  ${text}`)
          .join('\n')
      }
    }

    const locationDesc = diagnostic.filePath
      ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''}`
      : 'project-level'

    const isLspDiagnostic = inputs.languageDiagnostics.some((d) =>
      d.message === diagnostic.message &&
      d.filePath === diagnostic.filePath &&
      d.line === diagnostic.line &&
      d.column === diagnostic.column &&
      d.level === diagnostic.level,
    )
    const sourceLabel = isLspDiagnostic
      ? `language server (${lang === 'latex' ? 'texlab' : lang === 'typst' ? 'tinymist' : 'LSP'})`
      : 'compiler'

    const contextParts = [
      `Language: ${lang}`,
      `Diagnostic source: ${sourceLabel}`,
      `Location: ${locationDesc}`,
      `Severity: ${diagnostic.level}`,
      `Message: ${diagnostic.message}`,
    ]
    if (snippet) {
      contextParts.push(`Code around the issue (line numbers prepended):\n${snippet}`)
    }
    const contextBlock = contextParts.join('\n\n')

    const prompt = isLspDiagnostic
      ? `I'm getting the following ${lang} ${diagnostic.level} from the language server (real-time linter). Note that language-server diagnostics are sometimes about style, unresolved references, or partial syntax mid-typing rather than hard compile failures — so consider whether the code is genuinely broken or merely incomplete. Explain in plain English what the message means and suggest a concrete fix; show a corrected snippet if useful.`
      : `I'm getting the following ${lang} compiler ${diagnostic.level} in my document. Explain in plain English what's wrong and suggest a concrete fix. If you can, show the corrected snippet.`

    inputs.setIsChatOpen(true)
    try {
      await inputs.generateAi(prompt, contextBlock, inputs.projectId)
    } catch {
      // useGemini already surfaces the error; nothing more to do here
    } finally {
      setAskingAiDiagnosticKey(null)
    }
  }, [])

  const handleCreateFile = useCallback((parentPath: string | null = targetFolderPath) => {
    if (!canEdit) {
      return
    }

    if (parentPath) {
      setExpandedFolders((current) => ({ ...current, [parentPath]: true }))
      setFocusedFolderPath(parentPath)
    } else {
      setFocusedFolderPath(null)
    }

    setInlineCreateState({
      kind: 'file',
      parentPath,
      name: defaultNewFileName,
      error: null,
      isSubmitting: false,
    })
  }, [canEdit, defaultNewFileName, targetFolderPath])

  const handleCreateFolder = useCallback((parentPath: string | null = targetFolderPath) => {
    if (!canEdit) {
      return
    }

    if (parentPath) {
      setExpandedFolders((current) => ({ ...current, [parentPath]: true }))
      setFocusedFolderPath(parentPath)
    } else {
      setFocusedFolderPath(null)
    }

    setInlineCreateState({
      kind: 'folder',
      parentPath,
      name: 'figures',
      error: null,
      isSubmitting: false,
    })
  }, [canEdit, targetFolderPath])

  const handleInlineCreateSubmit = useCallback(async () => {
    if (!inlineCreateState) {
      return
    }

    const trimmedName = inlineCreateState.name.trim()
    if (!trimmedName) {
      setInlineCreateState((current) => current ? {
        ...current,
        error: current.kind === 'file' ? 'File name is required.' : 'Folder name is required.',
      } : current)
      return
    }

    setInlineCreateState((current) => current ? { ...current, isSubmitting: true, error: null } : current)

    try {
      if (inlineCreateState.kind === 'file') {
        const response = await apiClient.post<ProjectFile>(`/api/projects/${project.id}/files`, {
          name: trimmedName,
          parentPath: inlineCreateState.parentPath,
        })
        onProjectChange((current) => current ? {
          ...current,
          fileCount: current.fileCount + 1,
          files: [...current.files, response.data].sort((left, right) => left.path.localeCompare(right.path)),
        } : current)
        onSelectFile(response.data.id)
        setFocusedFolderPath(parentDirectoryPath(response.data.path))
        setExpandedFolders((current) => expandAncestorPaths(current, response.data.path))
        setInlineCreateState(null)
        return
      }

      const response = await apiClient.post<ProjectFile>(`/api/projects/${project.id}/folders`, {
        name: trimmedName,
        parentPath: inlineCreateState.parentPath,
      })
      onProjectChange((current) => current ? {
        ...current,
        files: [...current.files, response.data].sort((left, right) => left.path.localeCompare(right.path)),
      } : current)
      setFocusedFolderPath(response.data.path)
      setExpandedFolders((current) => ({ ...expandAncestorPaths(current, response.data.path), [response.data.path]: true }))
      setInlineCreateState(null)
    } catch (error: any) {
      setInlineCreateState((current) => current ? {
        ...current,
        isSubmitting: false,
        error: error?.response?.data?.error ?? `Failed to create ${current.kind}.`,
      } : current)
    }
  }, [inlineCreateState, onProjectChange, onSelectFile, project.id])

  const handleInlineCreateCancel = useCallback(() => {
    setInlineCreateState(null)
  }, [])

  const handleInlineCreateNameChange = useCallback((name: string) => {
    setInlineCreateState((current) => current ? { ...current, name, error: null } : current)
  }, [])

  const handleUploadFiles = useCallback(async (files: FileList | null) => {
    if (!canEdit || !files?.length) {
      return
    }

    const selectedFiles = Array.from(files)
    const uploaded: ProjectFile[] = []
    const parentPath = pendingUploadFolderPathRef.current ?? targetFolderPath
    pendingUploadFolderPathRef.current = null
    const optimisticFiles = selectedFiles.map((file, index) => createOptimisticUploadedFile(file, parentPath, index))

    onProjectChange((current) => current ? {
      ...current,
      fileCount: current.fileCount + optimisticFiles.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE).length,
      files: [...current.files, ...optimisticFiles].sort((left, right) => left.path.localeCompare(right.path)),
    } : current)

    try {
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        if (parentPath) {
          formData.append('parentPath', parentPath)
        }

        const response = await apiClient.post<ProjectFile>(`/api/projects/${project.id}/uploads`, formData)
        uploaded.push(response.data)
      }
    } catch (error: any) {
      onProjectChange((current) => current ? {
        ...current,
        fileCount: current.fileCount - optimisticFiles.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE).length,
        files: current.files.filter((file) => !optimisticFiles.some((optimisticFile) => optimisticFile.id === file.id)),
      } : current)
      reportMutationError(
        error?.response?.data?.error ?? 'Failed to upload one or more files.',
        () => { void handleUploadFiles(fileListFromArray(selectedFiles)) },
      )
      return
    }

    onProjectChange((current) => current ? {
      ...current,
      fileCount: current.fileCount - optimisticFiles.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE).length + uploaded.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE).length,
      files: [...current.files.filter((file) => !optimisticFiles.some((optimisticFile) => optimisticFile.id === file.id)), ...uploaded].sort((left, right) => left.path.localeCompare(right.path)),
    } : current)
    clearMutationNotice()

    if (uploaded.some((f) => f.name.endsWith('.bib'))) {
      void loadEcosystem()
    }

    const firstUploaded = uploaded[0]
    if (firstUploaded) {
      setFocusedFolderPath(parentPath)
      setExpandedFolders((current) => expandAncestorPaths(current, firstUploaded.path))
      const firstTextFile = uploaded.find(isEditableTextFile)
      if (firstTextFile) {
        onSelectFile(firstTextFile.id)
      }
    }
  }, [canEdit, clearMutationNotice, loadEcosystem, onProjectChange, onSelectFile, project.id, reportMutationError, targetFolderPath])

  const handleRenameItem = useCallback(async (file: ProjectFile) => {
    if (!canEdit) {
      return
    }

    const label = file.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder' : 'file'
    const name = prompt(`Rename ${label}`, file.name)?.trim()
    if (!name || name === file.name) {
      return
    }

    const nextPath = joinProjectPath(parentDirectoryPath(file.path), name)
    onProjectChange((current) => current ? { ...current, files: applyOptimisticPathUpdate(current.files, file, name, nextPath) } : current)

    try {
      await apiClient.patch<ProjectFile>(`/api/projects/${project.id}/files/${file.id}`, { name })
      clearMutationNotice()
      await onRefreshProject()
    } catch (error: any) {
      await onRefreshProject()
      reportMutationError(error?.response?.data?.error ?? `Failed to rename ${label}.`, () => { void handleRenameItem(file) })
    }
  }, [canEdit, clearMutationNotice, onProjectChange, onRefreshProject, project.id, reportMutationError])

  const handleDeleteItem = useCallback(async (file: ProjectFile) => {
    if (!canEdit) {
      return
    }

    const label = file.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder and its contents' : 'file'
    if (!window.confirm(`Delete ${label} ${file.name}?`)) {
      return
    }

    const removedFiles = collectOptimisticallyRemovedFiles(project.files, file)
    onProjectChange((current) => current ? {
      ...current,
      fileCount: current.fileCount - removedFiles.filter((entry) => entry.mimeType !== DRIVE_FOLDER_MIME_TYPE).length,
      files: current.files.filter((entry) => !removedFiles.some((removed) => removed.id === entry.id)),
    } : current)

    try {
      await apiClient.delete(`/api/projects/${project.id}/files/${file.id}`)
      clearMutationNotice()
    } catch (error: any) {
      await onRefreshProject()
      reportMutationError(error?.response?.data?.error ?? `Failed to delete ${label}.`, () => { void handleDeleteItem(file) })
      return
    }

    await onRefreshProject()
  }, [canEdit, clearMutationNotice, onProjectChange, onRefreshProject, project.files, project.id, reportMutationError])

  const handleSyncDrive = useCallback(async () => {
    const response = await apiClient.post<ProjectSummary[]>('/api/projects/sync')
    const refreshedProject = response.data.find((entry) => entry.id === project.id)

    if (!refreshedProject) {
      await onRefreshProject()
      return
    }

    await onRefreshProject()
  }, [onRefreshProject, project.id])

  const handleInvite = useCallback(async (email: string, role: Exclude<ProjectRole, 'owner'>) => {
    const optimisticInvitation = createOptimisticInvitation(project.id, email, role, user?.id ?? userId, user?.name ?? 'You')
    onProjectChange((current) => current ? {
      ...current,
      invitations: [optimisticInvitation, ...current.invitations.filter((invitation) => invitation.id !== optimisticInvitation.id)],
    } : current)

    try {
      const response = await apiClient.post<ProjectInvitation>(`/api/projects/${project.id}/shares`, { email, role })
      onProjectChange((current) => current ? {
        ...current,
        invitations: [response.data, ...current.invitations.filter((invitation) => invitation.id !== response.data.id && invitation.id !== optimisticInvitation.id)],
      } : current)
      clearMutationNotice()
    } catch (error: any) {
      onProjectChange((current) => current ? {
        ...current,
        invitations: current.invitations.filter((invitation) => invitation.id !== optimisticInvitation.id),
      } : current)
      reportMutationError(error?.response?.data?.error ?? 'Failed to share this project.', () => { void handleInvite(email, role) })
    }
  }, [clearMutationNotice, onProjectChange, project.id, reportMutationError, user?.id, user?.name, userId])

  const handleMemberRoleChange = useCallback(async (memberUserId: string, role: Exclude<ProjectRole, 'owner'>) => {
    const previousMembers = project.members
    onProjectChange((current) => current ? {
      ...current,
      members: current.members.map((member) => member.userId === memberUserId ? { ...member, role } : member),
    } : current)

    try {
      const response = await apiClient.patch<ProjectMember[]>(`/api/projects/${project.id}/members/${memberUserId}`, { role })
      onProjectChange((current) => current ? { ...current, members: response.data } : current)
      clearMutationNotice()
    } catch (error: any) {
      onProjectChange((current) => current ? { ...current, members: previousMembers } : current)
      reportMutationError(error?.response?.data?.error ?? 'Failed to update member role.', () => { void handleMemberRoleChange(memberUserId, role) })
    }
  }, [clearMutationNotice, onProjectChange, project.id, project.members, reportMutationError])

  const handleRevokeMember = useCallback(async (memberUserId: string) => {
    const previousMembers = project.members
    onProjectChange((current) => current ? {
      ...current,
      members: current.members.filter((member) => member.userId !== memberUserId),
    } : current)

    try {
      await apiClient.delete(`/api/projects/${project.id}/members/${memberUserId}`)
      clearMutationNotice()
    } catch (error: any) {
      onProjectChange((current) => current ? { ...current, members: previousMembers } : current)
      reportMutationError(error?.response?.data?.error ?? 'Failed to revoke member access.', () => { void handleRevokeMember(memberUserId) })
    }
  }, [clearMutationNotice, onProjectChange, project.id, project.members, reportMutationError])

  const handleRevokeInvitation = useCallback(async (invitationId: string) => {
    const previousInvitations = project.invitations
    onProjectChange((current) => current ? {
      ...current,
      invitations: current.invitations.filter((invitation) => invitation.id !== invitationId),
    } : current)

    try {
      await apiClient.delete(`/api/projects/${project.id}/invitations/${invitationId}`)
      clearMutationNotice()
    } catch (error: any) {
      onProjectChange((current) => current ? { ...current, invitations: previousInvitations } : current)
      reportMutationError(error?.response?.data?.error ?? 'Failed to revoke invitation.', () => { void handleRevokeInvitation(invitationId) })
    }
  }, [clearMutationNotice, onProjectChange, project.id, project.invitations, reportMutationError])

  const handlePublish = useCallback(async () => {
    await apiClient.post(`/api/share/${project.id}/publish`)
    onProjectChange((current) => current ? { ...current, publishedAt: Date.now() } : current)
  }, [project.id, onProjectChange])

  const handleUnpublish = useCallback(async () => {
    await apiClient.delete(`/api/share/${project.id}/publish`)
    onProjectChange((current) => current ? { ...current, publishedAt: null } : current)
  }, [project.id, onProjectChange])

  const handleTransferOwnership = useCallback(async (toUserId: string) => {
    await apiClient.post(`/api/share/${project.id}/transfer`, { toUserId })
    await onRefreshProject()
  }, [project.id, onRefreshProject])

  const handleSave = useCallback(async () => {
    if (!canEdit || !isEditableTextFile(activeFile)) {
      return
    }

    const currentEditorSource = ytext.toString()

    const shouldCompileOnSave = shouldUseTinymistWebPreview
      || (canRenderLatex && Boolean(activeLatexWebPreviewEngine))

    if (shouldCompileOnSave) {
      handleCompileNow({
        sourceOverride: compileTargetFile.id === activeFile.id ? currentEditorSource : compileTargetSource,
        activeSourceOverride: currentEditorSource,
      })
    }

    if (!isOnline) {
      reportMutationError('You are offline. Reconnect before saving to Drive.', () => { void handleSave() })
      return
    }

    setIsSavingToDrive(true)
    try {
      await apiClient.post(`/api/projects/${project.id}/files/${activeFile.id}/save`, {
        source: currentEditorSource,
      })
      editorAutosaveLastSavedRef.current[activeFile.id] = currentEditorSource
      clearMutationNotice()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to save this file to Google Drive.', () => { void handleSave() })
    } finally {
      setIsSavingToDrive(false)
    }
  }, [activeFile, activeLatexWebPreviewEngine, canEdit, canRenderLatex, clearMutationNotice, compileTargetFile.id, compileTargetSource, handleCompileNow, isOnline, project.id, reportMutationError, shouldUseTinymistWebPreview, ytext])

  const handleCreateRevisionCheckpoint = useCallback(async (message?: string) => {
    if (!canEdit || !isEditableTextFile(activeFile)) {
      return
    }

    if (!isOnline) {
      reportMutationError('You are offline. Reconnect before creating a checkpoint.', () => { void handleCreateRevisionCheckpoint() })
      return
    }

    const source = ytext.toString()
    if (!source.trim()) {
      alert('Cannot checkpoint an empty file.')
      return
    }

    setIsCreatingCheckpoint(true)
    try {
      await apiClient.post(`/api/projects/${project.id}/files/${activeFile.id}/save`, { source, label: message?.trim() || undefined })
      await loadFileRevisions()
      clearMutationNotice()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to create checkpoint.', () => { void handleCreateRevisionCheckpoint() })
    } finally {
      setIsCreatingCheckpoint(false)
    }
  }, [activeFile, canEdit, clearMutationNotice, isOnline, loadFileRevisions, project.id, reportMutationError, ytext])

  const handleRestoreRevision = useCallback(async (revisionId: string) => {
    if (!canEdit || !isEditableTextFile(activeFile)) {
      return
    }

    if (!window.confirm('Restore this revision? Current content will be backed up automatically before restore.')) {
      return
    }

    setRestoringRevisionId(revisionId)
    try {
      await apiClient.post(`/api/projects/${project.id}/files/${activeFile.id}/revisions/${revisionId}/restore`)
      await Promise.all([onRefreshProject(), loadFileRevisions()])
      clearMutationNotice()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to restore revision.', () => { void handleRestoreRevision(revisionId) })
    } finally {
      setRestoringRevisionId(null)
    }
  }, [activeFile, canEdit, clearMutationNotice, loadFileRevisions, onRefreshProject, project.id, reportMutationError])

  const handleMoveItem = useCallback(async (fileId: string, parentPath: string | null) => {
    const file = project.files.find((entry) => entry.id === fileId)
    if (!file) {
      return
    }

    const currentParentPath = parentDirectoryPath(file.path)
    if (currentParentPath === parentPath) {
      return
    }

    if (file.mimeType === DRIVE_FOLDER_MIME_TYPE && parentPath && (parentPath === file.path || parentPath.startsWith(`${file.path}/`))) {
      alert('A folder cannot be moved into itself.')
      return
    }

    try {
      onProjectChange((current) => current ? { ...current, files: applyOptimisticPathUpdate(current.files, file, file.name, joinProjectPath(parentPath, file.name)) } : current)
      await apiClient.patch<ProjectFile>(`/api/projects/${project.id}/files/${fileId}`, {
        name: file.name,
        parentPath,
      })
      await onRefreshProject()
      setFocusedFolderPath(parentPath)
      clearMutationNotice()
    } catch (error: any) {
      await onRefreshProject()
      reportMutationError(error?.response?.data?.error ?? 'Failed to move file or folder.', () => { void handleMoveItem(fileId, parentPath) })
    }
  }, [clearMutationNotice, onProjectChange, onRefreshProject, project.files, project.id, reportMutationError])

  const handleMoveItemPrompt = useCallback(async (file: ProjectFile) => {
    if (!canEdit) {
      return
    }

    const currentParent = parentDirectoryPath(file.path) ?? '/'
    const input = prompt('Move to folder path. Use / for the project root.', currentParent)?.trim()
    if (input === undefined || input === null) {
      return
    }

    const nextParentPath = !input || input === '/' ? null : input.replace(/^\/+|\/+$/g, '')
    await handleMoveItem(file.id, nextParentPath)
  }, [canEdit, handleMoveItem])

  const openContextMenu = useCallback((event: ReactMouseEvent, nextContextMenu: ContextMenuState) => {
    if (nextContextMenu.kind !== 'tab' && !canEdit) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setContextMenu(nextContextMenu)
  }, [canEdit])

  const openContextMenuFromButton = useCallback((button: HTMLButtonElement, nextContextMenu: ContextMenuState) => {
    if (nextContextMenu.kind !== 'tab' && !canEdit) {
      return
    }

    const rect = button.getBoundingClientRect()
    setContextMenu({ ...nextContextMenu, x: rect.right - 8, y: rect.bottom + 6 })
  }, [canEdit])

  const runContextAction = useCallback((action: () => void | Promise<void>) => {
    setContextMenu(null)
    void action()
  }, [])

  const openUploadPicker = useCallback((parentPath: string | null) => {
    pendingUploadFolderPathRef.current = parentPath
    uploadInputRef.current?.click()
  }, [])

  const revealEditorLocation = useCallback((line: number, column = 1) => {
    setRevealLocation({ line, column, nonce: Date.now() })
    setCursorLocation({ line, column })
    setGoToLineValue(String(line))
    setGoToColumnValue(String(column))
  }, [])

  const forwardSyncRequestRef = useRef<number>(0)

  const handleLatexPreviewClick = useCallback((position: { page: number; x: number; y: number; pdfX?: number; pdfY?: number; text?: string; textOffset?: number }) => {
    if (!canRenderLatex || latexSyncTex.length === 0) {
      return
    }

    // The client-side entry heuristic + PDF text-layer word match already
    // performs well here. Calling `synctex edit` on the server would require
    // converting normalized [0,1] PDF click coordinates into TeX coordinates,
    // which needs the absolute PDF page dimensions — we don't have those, and
    // approximating via the entries' bounding box drops coordinates outside
    // the page's text region.
    const match = findNearestLatexSyncTexEntry(latexSyncTex, position)
    if (!match) {
      return
    }

    const targetFile = project.files.find((file) => normalizeProjectPath(file.path) === normalizeProjectPath(match.filePath))
    const targetSource = targetFile?.id === activeFile.id
      ? activeSource
      : targetFile ? (projectSearchIndex[targetFile.id] ?? '') : ''
    const targetColumn = match.column
      ?? estimateLatexColumnFromPdfClick(latexSyncTex, match, position.x, targetSource, position.text, position.textOffset, position.pdfX)
    if (targetFile && targetFile.mimeType !== DRIVE_FOLDER_MIME_TYPE && targetFile.id !== activeFile.id) {
      onSelectFile(targetFile.id)
    }
    revealEditorLocation(match.line, targetColumn)
  }, [activeFile.id, activeSource, canRenderLatex, latexSyncTex, onSelectFile, project.files, projectSearchIndex, revealEditorLocation])

  useEffect(() => {
    if (!canRenderLatex || resolvedPreviewMode !== 'pdf' || latexSyncTex.length === 0) {
      return
    }

    const targetPath = normalizeProjectPath(compileTargetFile.path)
    const activePath = normalizeProjectPath(activeFile.path)
    const cursorPath = activeFile.id === compileTargetFile.id ? targetPath : activePath
    const match = findLatexSyncTexEntryForSource(latexSyncTex, cursorPath, cursorLocation.line, cursorLocation.column)
    if (!match) {
      return
    }

    // Immediate client-side scroll using cached entries.
    setLatexPreviewSyncTarget({ page: match.page, y: normalizeLatexSyncTexY(latexSyncTex, match), nonce: Date.now() })

    // Debounced server-side refinement via `synctex view`. This gives a more
    // accurate (line, column) → (page, y) mapping when the cached entries are
    // ambiguous (e.g. same line text appears in multiple PDF locations). We
    // only use page+y for scroll — drawing a precise highlight rectangle
    // would need the absolute PDF page dimensions, which aren't available
    // here, and approximating via the entries' bounding box would land the
    // rectangle inside the page margins.
    if (!latexSyncTexToken) return
    const filePath = latexSyncTexEntryPath && activeFile.id === compileTargetFile.id ? latexSyncTexEntryPath : cursorPath
    const line = cursorLocation.line
    const column = cursorLocation.column
    const requestNonce = ++forwardSyncRequestRef.current
    const timer = window.setTimeout(() => {
      void apiClient.post<SyncTexViewResponse>('/api/synctex/view', {
        token: latexSyncTexToken,
        filePath,
        line,
        column,
      }).then(({ data }) => {
        if (forwardSyncRequestRef.current !== requestNonce) return
        const best = pickBestForwardBox(data.boxes, latexSyncTex, line, column)
        if (!best) return
        const pageEntries = latexSyncTex.filter((entry) => entry.page === best.page)
        const yRange = latexSyncTexPageRange(pageEntries, 'y')
        const ySpan = Math.max(0.01, yRange.max - yRange.min)
        const normY = Math.max(0, Math.min(1, (best.y - yRange.min) / ySpan))
        setLatexPreviewSyncTarget({ page: best.page, y: normY, nonce: Date.now() })
      }).catch(() => undefined)
    }, 180)

    return () => window.clearTimeout(timer)
  }, [activeFile.id, activeFile.path, canRenderLatex, compileTargetFile.id, compileTargetFile.path, cursorLocation.line, cursorLocation.column, latexSyncTex, latexSyncTexToken, latexSyncTexEntryPath, resolvedPreviewMode])

  const handleTinymistSessionLost = useCallback(() => {
    previewSessionIdRef.current = `preview:${project.id}:${compileTargetFile.id}:${tinymistClientIdRef.current}:${Date.now().toString(36)}`
    tinymistReconnectAttemptsRef.current = 0
    setTypstPreviewSession(null)
    setTinymistReconnectNonce((n) => n + 1)
  }, [compileTargetFile.id, project.id])

  // Preview → Editor: tinymist sends start/end as [line, character] arrays (0-based).
  const tinymistLastJumpRef = useRef<{ fileId: string; line: number; column: number; at: number } | null>(null)

  // Opens the comment panel anchored to a tinymist-mapped source range.
  // When tinymist gives start===end (cursor, not range), falls back to the whole trimmed line.
  const openTinymistComment = useCallback((
    _fileId: string,
    source: string,
    line: number,
    column: number,
    endLocation: { line: number; column: number } | null,
  ) => {
    const lines = source.split('\n')
    const hasWordRange = endLocation && (endLocation.line > line || endLocation.column > column)
    const endLine = hasWordRange ? endLocation!.line : line
    const endCol = hasWordRange ? endLocation!.column : Math.max(column, (lines[line - 1] ?? '').trimEnd().length || column)
    const startCol = hasWordRange ? column : Math.max(1, (lines[line - 1] ?? '').search(/\S/) + 1 || column)
    const excerpt = lines.slice(line - 1, endLine).join(' ').trim().slice(0, 120) || `Line ${line}`
    setCommentSelection({ excerpt, startLine: line, startColumn: startCol, endLine, endColumn: endCol })
    setActiveSidebarTab('comments')
    setRevealLocation({ line, column: startCol, endLine, endColumn: endCol, nonce: Date.now() })
  }, [])

  const handleTinymistJump = useCallback((jump: TinymistJumpEvent) => {
    const workspaceDir = typstPreviewSession?.workspaceDir
    let targetFile = compileTargetFile
    if (jump.filepath) {
      let rel: string | null = null
      if (workspaceDir && jump.filepath.startsWith(workspaceDir)) {
        rel = jump.filepath.slice(workspaceDir.length).replace(/^[\\/]+/, '')
      } else if (!jump.filepath.startsWith('/') && !jump.filepath.startsWith('\\') && !jump.filepath.includes(':')) {
        rel = jump.filepath.replace(/^(\.\/)+/, '')
      }
      if (rel) {
        const resolvedTargetFile = project.files.find((f) => f.path === rel || f.path.replace(/\\/g, '/') === rel.replace(/\\/g, '/'))
        if (resolvedTargetFile && resolvedTargetFile.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
          targetFile = resolvedTargetFile
        }
      }
    }

    const targetSource = targetFile.id === activeFile.id ? ytext.toString() : (projectSearchIndex[targetFile.id] ?? '')
    const startLocation = tinymistJumpLocation(jump.start, targetSource)
    if (!startLocation) return
    const { line, column } = startLocation
    const endLocation = tinymistJumpLocation(jump.end, targetSource)

    if (targetFile.id !== activeFile.id) {
      onSelectFile(targetFile.id)
    }

    // Double-click detection: two preview jumps close together in the same source file
    // create a normal editor text comment anchored to the mapped source word/token range.
    const now = Date.now()
    const last = tinymistLastJumpRef.current
    if (last && last.fileId === targetFile.id && now - last.at < 500 && Math.abs(line - last.line) <= 3 && canCreateTextComments) {
      tinymistLastJumpRef.current = null
      openTinymistComment(targetFile.id, targetSource, line, column, endLocation)
    } else {
      tinymistLastJumpRef.current = { fileId: targetFile.id, line, column, at: now }
      setRevealLocation({ line, column, nonce: Date.now() })
    }
  }, [activeFile.id, canCreateTextComments, compileTargetFile, onSelectFile, openTinymistComment, project.files, projectSearchIndex, typstPreviewSession?.workspaceDir, ytext])

  const handleTinymistContextMenu = useCallback((event: TinymistContextMenuEvent) => {
    if (!canCreateTextComments) return
    setTinymistContextMenu({ x: event.x, y: event.y, selectedText: event.selectedText })
  }, [canCreateTextComments])

  const handleTinymistContextMenuComment = useCallback(() => {
    const last = tinymistLastJumpRef.current
    const source = last ? (last.fileId === activeFile.id ? ytext.toString() : (projectSearchIndex[last.fileId] ?? '')) : ''
    if (last && source) {
      openTinymistComment(last.fileId, source, last.line, last.column, null)
    }
    setTinymistContextMenu(null)
  }, [activeFile.id, openTinymistComment, projectSearchIndex, ytext])

  // Editor → Preview: tinymist panelScrollTo expects { line, character } (0-based).
  const tinymistCursorPosition = useMemo(() => {
    if (!prefersTinymistPreview) return null
    return {
      line: Math.max(0, cursorLocation.line - 1),
      character: Math.max(0, cursorLocation.column - 1),
    }
  }, [cursorLocation, prefersTinymistPreview])

  const toggleSharingPanel = useCallback((button: HTMLButtonElement) => {
    setShowCompileSettingsPanel(false)
    setShowNavigationPanel(false)
    setShowRevisionPanel(false)
    setShowSharingPanel((current) => {
      const next = !current
      if (!next) {
        setSharePopoverPosition(null)
        return next
      }

      const pageRect = pageRef.current?.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const viewportWidth = pageRect?.width ?? window.innerWidth
      const popoverWidth = Math.min(380, viewportWidth - 32)
      const relativeLeft = pageRect ? buttonRect.left - pageRect.left : buttonRect.left
      const relativeTop = pageRect ? buttonRect.bottom - pageRect.top : buttonRect.bottom

      setSharePopoverPosition({
        left: Math.max(12, Math.min(relativeLeft, viewportWidth - popoverWidth - 12)),
        top: relativeTop + 8,
      })
      return next
    })
  }, [])

  const toggleNavigationPanel = useCallback(() => {
    setShowSharingPanel(false)
    setShowCompileSettingsPanel(false)
    setShowRevisionPanel(false)
    setShowNavigationPanel(false)
    setActiveSidebarTab('outline')
    sidebarPanelRef.current?.expand()
  }, [])

  const handleOpenSearch = useCallback(() => {
    setSearchPanelRequest({ action: 'open', nonce: Date.now() })
  }, [])

  const handleOpenProjectSearch = useCallback(() => {
    setShowSharingPanel(false)
    setShowCompileSettingsPanel(false)
    setShowNavigationPanel(false)
    setActiveSidebarTab('search')
    sidebarPanelRef.current?.expand()
  }, [])

  const handleSavePackagePins = useCallback(async (packagePins: ProjectPackagePin[]) => {
    try {
      await saveEcosystem({ settings: { packagePins } })
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to save package pins.')
    }
  }, [saveEcosystem])

  const handleSaveMetadataFiles = useCallback(async (metadataFiles: Array<{ path: string; content: string }>) => {
    try {
      await saveEcosystem({ metadataFiles })
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to save metadata files.')
    }
  }, [saveEcosystem])

  const handleSaveWritingTools = useCallback(async (writingSnippets: ProjectWritingSnippet[], writingGoals: ProjectWritingGoals) => {
    try {
      await saveEcosystem({ settings: { writingSnippets, writingGoals } })
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to save writing tools.')
    }
  }, [saveEcosystem])

  const handleInsertIntoEditor = useCallback((text: string, selectInsertedText = false) => {
    if (!canEdit || !isEditableTextFile(activeFile)) {
      return
    }

    setEditorInsertRequest({ text, selectInsertedText, nonce: Date.now() })
  }, [activeFile, canEdit])

  const handleSuggestDocumentEdits = useCallback((editedDocument: string): number => {
    if (!canEdit || !isEditableTextFile(activeFile)) {
      return 0
    }

    const currentSource = ytext.toString()
    const normalizedEditedDocument = normalizeAiEditedDocument(editedDocument)
    const edits = computeAiEditSuggestions({
      fileId: activeFile.id,
      previousSource: currentSource,
      nextSource: normalizedEditedDocument,
    })

    setPendingAiEdits((current) => [
      ...current.filter((edit) => edit.fileId !== activeFile.id),
      ...edits,
    ])

    return edits.length
  }, [activeFile, canEdit, ytext])

  const loadProjectFilesForAi = useCallback(async (): Promise<AiCollaborationProjectFile[]> => {
    const currentSearchIndex = projectSearchIndexRef.current
    const textFiles = project.files.filter(isAiCollaborationTextFile)
    const missingFiles = textFiles.filter((file) => file.id !== activeFile.id && currentSearchIndex[file.id] === undefined)
    const loadedEntries = missingFiles.length > 0
      ? await Promise.all(missingFiles.map(async (file) => {
        const response = await apiClient.get<string>(`/api/projects/${project.id}/files/${file.id}/content`, {
          responseType: 'text',
        })
        return { fileId: file.id, content: response.data }
      }))
      : []
    const loadedByFileId = new Map(loadedEntries.map((entry) => [entry.fileId, entry.content] as const))

    if (loadedEntries.length > 0) {
      projectSearchIndexRef.current = {
        ...projectSearchIndexRef.current,
        ...Object.fromEntries(loadedEntries.map((entry) => [entry.fileId, entry.content])),
      }
      setProjectSearchIndex((current) => {
        const next = { ...current }
        for (const entry of loadedEntries) {
          next[entry.fileId] = entry.content
        }
        return next
      })
    }

    const nextSearchIndex = projectSearchIndexRef.current
    return textFiles.map((file) => ({
      fileId: file.id,
      path: file.path,
      mimeType: file.mimeType,
      content: file.id === activeFile.id
        ? ytext.toString()
        : loadedByFileId.get(file.id) ?? nextSearchIndex[file.id] ?? '',
    }))
  }, [activeFile.id, project.files, project.id, ytext])

  const handleSuggestProjectEdits = useCallback((editedFiles: AiCollaborationEditedFile[]): { editCount: number; filePaths: string[] } => {
    if (!canEdit) {
      return { editCount: 0, filePaths: [] }
    }

    const fileById = new Map(project.files.map((file) => [file.id, file] as const))
    const fileByPath = new Map(project.files.map((file) => [normalizeAiFilePath(file.path), file] as const))
    const touchedFileIds = new Set<string>()
    const changedFilePaths: string[] = []
    const nextEdits: AiEditSuggestion[] = []

    for (const editedFile of editedFiles) {
      const targetFile = (editedFile.fileId ? fileById.get(editedFile.fileId) : undefined)
        ?? fileByPath.get(normalizeAiFilePath(editedFile.path))
      if (!targetFile || !isEditableTextFile(targetFile)) {
        continue
      }

      touchedFileIds.add(targetFile.id)
      const currentSource = targetFile.id === activeFile.id ? ytext.toString() : (projectSearchIndexRef.current[targetFile.id] ?? '')
      const normalizedEditedDocument = normalizeAiEditedDocument(editedFile.content)
      const edits = computeAiEditSuggestions({
        fileId: targetFile.id,
        previousSource: currentSource,
        nextSource: normalizedEditedDocument,
      })
      if (edits.length > 0) {
        nextEdits.push(...edits)
        changedFilePaths.push(targetFile.path)
      }
    }

    setPendingAiEdits((current) => [
      ...current.filter((edit) => !touchedFileIds.has(edit.fileId)),
      ...nextEdits,
    ])

    return {
      editCount: nextEdits.length,
      filePaths: [...new Set(changedFilePaths)],
    }
  }, [activeFile.id, canEdit, project.files, ytext])

  const applyAiEdit = useCallback((edit: AiEditSuggestion) => {
    const source = ytext.toString()
    const range = resolveAiEditRange(source, edit)
    ytext.delete(range.from, range.to - range.from)
    ytext.insert(range.from, edit.replacementText)
  }, [ytext])

  // After mutating ytext, re-anchor each remaining edit by searching for its
  // `originalText` in the new source. This is more robust than manually
  // shifting `from`/`to` by a delta — manual shifts can desync when the
  // accepted edit's resolved range wasn't exactly the original `from`/`to`,
  // and a desynced edit silently renders at the wrong offset (or as a
  // zero-length range that looks "hidden"). Edits whose `originalText` no
  // longer exists in the source are dropped.
  const reanchorPendingAiEditsForFile = useCallback((edits: AiEditSuggestion[], fileId: string): AiEditSuggestion[] => {
    const source = ytext.toString()
    const result: AiEditSuggestion[] = []
    for (const edit of edits) {
      if (edit.fileId !== fileId) {
        result.push(edit)
        continue
      }
      const resolved = resolveAiEditRange(source, edit)
      if (edit.originalText && source.slice(resolved.from, resolved.to) !== edit.originalText) {
        // Couldn't relocate this edit — drop it rather than render a broken widget.
        continue
      }
      result.push({ ...edit, from: resolved.from, to: resolved.to })
    }
    return result
  }, [ytext])

  const handleAiEditDecision = useCallback((editId: string, action: 'accept' | 'reject') => {
    const edit = pendingAiEdits.find((candidate) => candidate.id === editId)
    if (!edit || edit.fileId !== activeFile.id) {
      return
    }

    if (action === 'accept') {
      applyAiEdit(edit)
      setPendingAiEdits((current) => reanchorPendingAiEditsForFile(
        current.filter((candidate) => candidate.id !== editId),
        edit.fileId,
      ))
    } else {
      setPendingAiEdits((current) => current.filter((candidate) => candidate.id !== editId))
    }
  }, [activeFile.id, applyAiEdit, pendingAiEdits, reanchorPendingAiEditsForFile])

  const handleAiEditBulkDecision = useCallback((action: 'accept' | 'reject') => {
    const edits = pendingAiEdits.filter((edit) => edit.fileId === activeFile.id)
    if (edits.length === 0) {
      return
    }

    if (action === 'accept') {
      const applyAll = () => {
        for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
          const source = ytext.toString()
          const range = resolveAiEditRange(source, edit)
          ytext.delete(range.from, range.to - range.from)
          ytext.insert(range.from, edit.replacementText)
        }
      }
      if (ytext.doc) {
        ytext.doc.transact(applyAll)
      } else {
        applyAll()
      }
    }

    setPendingAiEdits((current) => current.filter((edit) => edit.fileId !== activeFile.id))
  }, [activeFile.id, pendingAiEdits, ytext])

  const handleAllAiEditBulkDecision = useCallback((action: 'accept' | 'reject') => {
    if (pendingAiEdits.length === 0) {
      return
    }

    if (action === 'accept') {
      const editsByFileId = new Map<string, AiEditSuggestion[]>()
      for (const edit of pendingAiEdits) {
        const entries = editsByFileId.get(edit.fileId) ?? []
        entries.push(edit)
        editsByFileId.set(edit.fileId, entries)
      }

      const inactiveUpdates: Array<{ fileId: string; source: string }> = []
      for (const [fileId, edits] of editsByFileId) {
        const file = project.files.find((candidate) => candidate.id === fileId)
        if (!file || !isEditableTextFile(file)) {
          continue
        }

        if (fileId === activeFile.id) {
          const applyAll = () => {
            for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
              const source = ytext.toString()
              const range = resolveAiEditRange(source, edit)
              ytext.delete(range.from, range.to - range.from)
              ytext.insert(range.from, edit.replacementText)
            }
          }
          if (ytext.doc) {
            ytext.doc.transact(applyAll)
          } else {
            applyAll()
          }
          continue
        }

        const currentSource = projectSearchIndexRef.current[fileId] ?? ''
        inactiveUpdates.push({
          fileId,
          source: applyAiEditsToSource(currentSource, edits),
        })
      }

      if (inactiveUpdates.length > 0) {
        projectSearchIndexRef.current = {
          ...projectSearchIndexRef.current,
          ...Object.fromEntries(inactiveUpdates.map((update) => [update.fileId, update.source])),
        }
        setProjectSearchIndex((current) => {
          const next = { ...current }
          for (const update of inactiveUpdates) {
            next[update.fileId] = update.source
          }
          return next
        })

        void Promise.all(inactiveUpdates.map((update) => apiClient.post(`/api/projects/${project.id}/files/${update.fileId}/autosave`, { source: update.source })))
          .catch((error: any) => {
            reportMutationError(error?.response?.data?.error ?? 'Failed to save one or more accepted AI edits.')
          })
      }
    }

    setPendingAiEdits([])
  }, [activeFile.id, pendingAiEdits, project.files, project.id, reportMutationError, ytext])

  const handleFormat = useCallback((prefix: string, suffix: string, placeholder: string) => {
    if (!canEdit || !isEditableTextFile(activeFile)) return
    setFormatRequest({ prefix, suffix, placeholder, nonce: Date.now() })
  }, [activeFile, canEdit])

  const handleTagRevision = useCallback(async (revisionId: string, tag: string) => {
    try {
      await apiClient.patch(`/api/projects/${project.id}/files/${activeFile.id}/revisions/${revisionId}/label`, { label: tag })
      await loadFileRevisions()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to update revision label.')
    }
  }, [activeFile.id, loadFileRevisions, project.id, reportMutationError])

  const handleCreateSubmissionSnapshot = useCallback(async (label: string) => {
    await handleCreateRevisionCheckpoint(label)
    setActiveSidebarTab('history')
  }, [handleCreateRevisionCheckpoint])

  const handleJumpToProjectPath = useCallback((filePath: string, line = 1) => {
    const targetFile = project.files.find((file) => file.path === filePath)
    if (!targetFile) {
      return
    }

    onSelectFile(targetFile.id)
    setRevealLocation({ line, column: 1, nonce: Date.now() })
  }, [onSelectFile, project.files])

  const handleUpsertProjectTextFile = useCallback(async (
    filePath: string,
    source: string,
    options?: { open?: boolean },
  ) => {
    if (!canEdit) {
      return
    }

    const normalizedPath = filePath.trim().replace(/^\/+/, '')
    if (!normalizedPath) {
      return
    }

    const existingFile = project.files.find((file) => file.path === normalizedPath && file.mimeType !== DRIVE_FOLDER_MIME_TYPE)
    let targetFile = existingFile

    try {
      if (!targetFile) {
        const segments = normalizedPath.split('/')
        const name = segments.pop() ?? normalizedPath
        const parentPath = segments.length ? segments.join('/') : null
        const response = await apiClient.post<ProjectFile>(`/api/projects/${project.id}/files`, {
          name,
          parentPath,
        })
        targetFile = response.data
      }

      if (!targetFile) return
      const resolvedFile = targetFile
      await apiClient.post(`/api/projects/${project.id}/files/${resolvedFile.id}/save`, { source })

      if (resolvedFile.id === activeFile.id && isEditableTextFile(resolvedFile)) {
        if (ytext.toString() !== source) {
          ytext.delete(0, ytext.length)
          ytext.insert(0, source)
        }
        setProjectSearchIndex((current) => ({
          ...current,
          [resolvedFile.id]: source,
        }))
      }

      await onRefreshProject()
      await loadEcosystem()

      if (options?.open !== false) {
        onSelectFile(targetFile.id)
      }
    } catch (error: any) {
      alert(error?.response?.data?.error ?? `Failed to update ${normalizedPath}.`)
    }
  }, [activeFile.id, canEdit, loadEcosystem, onRefreshProject, onSelectFile, project.files, project.id, ytext])

  const handleAddBibEntry = useCallback(async (entry: string) => {
    const firstBib = ecosystem?.bibliographyFiles[0]
    if (!firstBib) {
      await handleUpsertProjectTextFile('references.bib', entry + '\n', { open: true })
      return
    }
    try {
      const res = await apiClient.get<string>(`/api/projects/${project.id}/files/${firstBib.fileId}/content`, {
        responseType: 'text',
      })
      const current = typeof res.data === 'string' ? res.data : ''
      const newEntries = normalizeBibtexEntriesForAppend(current, entry)
      if (!newEntries) {
        return
      }
      const newContent = current.trimEnd() + '\n\n' + newEntries + '\n'
      await handleUpsertProjectTextFile(firstBib.path, newContent, { open: false })
    } catch (error: any) {
      console.error('Failed to add bib entry:', error)
      const message = error?.response?.data?.error ?? error?.message ?? 'Unknown error'
      alert(`Failed to add citation to ${firstBib.path}: ${message}`)
      handleInsertIntoEditor(entry + '\n\n')
    }
  }, [ecosystem?.bibliographyFiles, handleInsertIntoEditor, handleUpsertProjectTextFile, project.id])

  const handleResolveCitationIdentifier = useCallback(async (identifier: string): Promise<string | null> => {
    if (!canEdit) {
      return null
    }

    const response = await apiClient.post<{ entry: string }>(`/api/projects/${project.id}/ecosystem/bib-import`, {
      identifier,
    })
    const key = extractBibtexEntryKey(response.data.entry)
    if (key && ecosystem?.citations.some((citation) => citation.key.toLowerCase() === key.toLowerCase())) {
      return key
    }
    await handleAddBibEntry(response.data.entry)
    return key
  }, [canEdit, ecosystem?.citations, handleAddBibEntry, project.id])

  const [citeSearchState, setCiteSearchState] = useState<{ query: string; anchorRect: DOMRect | null; shortcutMode: boolean } | null>(null)
  const citeShortcutModeRef = useRef(false)
  const citeTriggerLengthRef = useRef(0)

  const handleCiteSearch = useCallback((query: string, anchorRect: DOMRect | null, shortcutMode?: boolean, triggerLength?: number) => {
    const isShortcut = shortcutMode ?? false
    citeShortcutModeRef.current = isShortcut
    citeTriggerLengthRef.current = triggerLength ?? 0
    setCiteSearchState({ query, anchorRect, shortcutMode: isShortcut })
  }, [])

  const handleCiteSearchClose = useCallback(() => {
    citeShortcutModeRef.current = false
    citeTriggerLengthRef.current = 0
    setCiteSearchState(null)
  }, [])

  const handleCiteSearchSelect = useCallback(async (result: import('./CitationSearchPopup').CitationSearchResult) => {
    const key = result.bibEntry ? result.bibEntry.match(/@\w+\{([^,\s]+)/)?.[1] ?? null : null
    if (!key) return

    let insert: string
    const isShortcut = citeShortcutModeRef.current
    const triggerLength = citeTriggerLengthRef.current

    if (isShortcut) {
      // Opened via shortcut — no trigger text exists, insert full cite command after selection
      insert = activeEditorLanguage === 'latex' ? `\\cite{${key}}` : `@${key}`
    } else {
      // User typed \cite{ or @ — insert only key (and closing brace for LaTeX)
      insert = activeEditorLanguage === 'latex' ? `${key}}` : key
    }
    setEditorInsertRequest({
      text: insert,
      appendOnly: isShortcut,
      replaceBefore: isShortcut ? 0 : triggerLength,
      nonce: Date.now(),
    })
    citeShortcutModeRef.current = false
    citeTriggerLengthRef.current = 0
    setCiteSearchState(null)

    if (result.bibEntry) {
      await handleAddBibEntry(result.bibEntry)
    }
  }, [activeEditorLanguage, handleAddBibEntry])

  const handleCreateReviewComment = useCallback(async (excerpt: string, content: string) => {
    // Find the actual range in the document for the suggested excerpt
    const source = ytext.toString()
    const index = source.indexOf(excerpt)
    
    // If exact match not found, try finding a normalized match
    let startOffset = index
    let resolvedExcerpt = excerpt
    if (startOffset === -1) {
      const normalizedSource = source.replace(/\s+/g, ' ')
      const normalizedExcerpt = excerpt.replace(/\s+/g, ' ').trim()
      const normIndex = normalizedSource.indexOf(normalizedExcerpt)
      if (normIndex !== -1) {
        // This is tricky to map back to original offsets perfectly, but let's try a simpler approach:
        // just find where the first 20 chars match if exact match failed
        const startChunk = excerpt.trim().slice(0, 20)
        startOffset = source.indexOf(startChunk)
        resolvedExcerpt = excerpt.trim()
      }
    }

    if (startOffset === -1) {
      console.warn('Gemini review: Could not find excerpt in document:', excerpt)
      return
    }

    const before = source.slice(0, startOffset)
    const linesBefore = before.split('\n')
    const startLine = linesBefore.length
    const startColumn = linesBefore[linesBefore.length - 1].length + 1

    const linesMiddle = resolvedExcerpt.split('\n')
    const endLine = startLine + linesMiddle.length - 1
    const endColumn = linesMiddle.length === 1 
      ? startColumn + resolvedExcerpt.length 
      : linesMiddle[linesMiddle.length - 1].length + 1

    try {
      const response = await apiClient.post<ProjectComment>(`/api/projects/${project.id}/files/${activeFile.id}/comments`, {
        excerpt: resolvedExcerpt,
        content,
        startLine,
        startColumn,
        endLine,
        endColumn,
      })
      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: sortComments([...(current[activeFile.id] ?? []), response.data]),
      }))
    } catch (error: any) {
      console.error('Failed to create review comment', error?.response?.data || error)
    }
  }, [activeFile.id, project.id, ytext])

  const updatePrimaryBibliographyFile = useCallback(async (transform: (current: string) => string) => {
    const firstBib = ecosystem?.bibliographyFiles[0]
    if (!firstBib) {
      throw new Error('No bibliography file found.')
    }

    const response = await apiClient.get<string>(`/api/projects/${project.id}/files/${firstBib.fileId}/content`, {
      responseType: 'text',
    })
    const current = typeof response.data === 'string' ? response.data : ''
    const next = transform(current)
    await handleUpsertProjectTextFile(firstBib.path, next, { open: false })
  }, [ecosystem?.bibliographyFiles, handleUpsertProjectTextFile, project.id])

  const handleFormatBibliography = useCallback(async () => {
    await updatePrimaryBibliographyFile((current) => formatBibtexFileContent(current))
  }, [updatePrimaryBibliographyFile])

  const handleSortBibliography = useCallback(async () => {
    await updatePrimaryBibliographyFile((current) => sortBibtexFileContent(current))
  }, [updatePrimaryBibliographyFile])

  const applyBibTransformToActiveFile = useCallback((transform: (current: string) => string) => {
    if (!canEdit || !isEditableTextFile(activeFile)) return
    const current = ytext.toString()
    const next = transform(current)
    if (next === current) return
    ytext.doc?.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, next)
    })
  }, [activeFile, canEdit, ytext])

  const handleActiveBibSort = useCallback(() => {
    applyBibTransformToActiveFile(sortBibtexFileContent)
  }, [applyBibTransformToActiveFile])

  const handleActiveBibFormat = useCallback(() => {
    applyBibTransformToActiveFile(formatBibtexFileContent)
  }, [applyBibTransformToActiveFile])

  const handleActiveBibDeduplicate = useCallback(() => {
    applyBibTransformToActiveFile(deduplicateBibtexFileContent)
  }, [applyBibTransformToActiveFile])

  const handleInsertBibEntry = useCallback((prefix: string, suffix: string, placeholder: string) => {
    if (!canEdit || !isEditableTextFile(activeFile)) return
    setFormatRequest({ prefix, suffix, placeholder, nonce: Date.now() })
  }, [activeFile, canEdit])

  const handleUploadProjectFont = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) {
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await apiClient.post<ProjectEcosystemState>(`/api/projects/${project.id}/ecosystem/fonts`, formData)
      setEcosystem(response.data)
      await onRefreshProject()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to upload project font.')
    }
  }, [onRefreshProject, project.id])

  const handleUploadReusableAsset = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) {
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await apiClient.post<ProjectEcosystemState>(`/api/projects/${project.id}/ecosystem/library-assets`, formData)
      setEcosystem(response.data)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to upload reusable asset.')
    }
  }, [project.id])

  const handleAddCurrentFileToLibrary = useCallback(async () => {
    if (activeFile.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return
    }

    try {
      const response = await apiClient.post<ProjectEcosystemState>(`/api/projects/${project.id}/ecosystem/library-assets/from-project-file`, {
        fileId: activeFile.id,
      })
      setEcosystem(response.data)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to add the current file to your reusable asset library.')
    }
  }, [activeFile.id, activeFile.mimeType, project.id])

  const handleImportReusableAsset = useCallback(async (asset: ReusableAsset) => {
    try {
      const response = await apiClient.post<ProjectEcosystemState>(`/api/projects/${project.id}/ecosystem/library-assets/${encodeURIComponent(asset.id)}/import`, {
        parentPath: targetFolderPath,
      })
      setEcosystem(response.data)
      await onRefreshProject()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to import reusable asset into this project.')
    }
  }, [onRefreshProject, project.id, targetFolderPath])

  const handleDeleteReusableAsset = useCallback(async (asset: ReusableAsset) => {
    try {
      await apiClient.delete(`/api/projects/${project.id}/ecosystem/library-assets/${encodeURIComponent(asset.id)}`)
      await loadEcosystem()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to remove reusable asset from your library.')
    }
  }, [loadEcosystem, project.id])

  const handleProjectSearchResultClick = useCallback((result: ProjectSearchResult) => {
    onSelectFile(result.fileId)
    revealEditorLocation(result.lineNumber, result.column)
  }, [onSelectFile, revealEditorLocation])

  const handleSelectionRangeChange = useCallback((selection: CommentSelectionAnchor | null) => {
    setCommentSelection(selection)
  }, [])

  const handleStartCommentFromSelection = useCallback((selection: CommentSelectionAnchor) => {
    setCommentSelection(selection)
    setActiveSidebarTab('comments')
  }, [])

  const handleCreateComment = useCallback(async () => {
    const content = commentDraft.trim()
    if (!canCreateTextComments || !commentSelection || !content) {
      return
    }

    try {
      const response = await apiClient.post<ProjectComment>(`/api/projects/${project.id}/files/${activeFile.id}/comments`, {
        content,
        excerpt: commentSelection.excerpt,
        startLine: commentSelection.startLine,
        startColumn: commentSelection.startColumn,
        endLine: commentSelection.endLine,
        endColumn: commentSelection.endColumn,
        assigneeUserId: commentDraftAssigneeUserId,
      })

      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: sortComments([...(current[activeFile.id] ?? []), response.data]),
      }))
      setCommentDraft('')
      setCommentDraftAssigneeUserId(null)
      setHighlightedCommentId(response.data.id)
      revealEditorLocation(response.data.startLine, response.data.startColumn)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to create comment.')
    }
  }, [activeFile, canCreateTextComments, commentDraft, commentDraftAssigneeUserId, commentSelection, project.id, revealEditorLocation])

  const handleCreatePdfComment = useCallback(async ({
    annotation,
    content,
  }: {
    annotation: ProjectCommentPdfAnnotation
    content: string
  }) => {
    const normalizedContent = content.trim() || 'Handwritten note'

    try {
      const response = await apiClient.post<ProjectComment>(`/api/projects/${project.id}/files/${activeFile.id}/comments`, {
        content: normalizedContent,
        excerpt: `Handwritten note on PDF page ${annotation.page}`,
        startLine: annotation.page,
        startColumn: 1,
        endLine: annotation.page,
        endColumn: 1,
        pdfAnnotation: annotation,
      })

      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: sortComments([...(current[activeFile.id] ?? []), response.data]),
      }))
      setHighlightedCommentId(response.data.id)
      setActiveSidebarTab('comments')
      setActiveNoteDialogCommentId(response.data.id)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to save handwritten note.')
      throw error
    }
  }, [activeFile.id, project.id])

  const handleCommentClick = useCallback((comment: ProjectComment) => {
    setHighlightedCommentId(comment.id)
    if (comment.pdfAnnotation) {
      setActiveNoteDialogCommentId(comment.id)
      return
    }

    if (comment.status !== 'deleted') {
      revealEditorLocation(comment.startLine, comment.startColumn)
    }
  }, [revealEditorLocation])

  const handleCommentActivateFromEditor = useCallback((commentId: string) => {
    const comment = activeComments.find((entry) => entry.id === commentId)
    if (!comment) {
      return
    }

    setHighlightedCommentId(comment.id)
    setActiveSidebarTab('comments')
    setActiveNoteDialogCommentId(comment.id)
    if (comment.pdfAnnotation) {
      return
    }
    if (comment.status !== 'deleted') {
      revealEditorLocation(comment.startLine, comment.startColumn)
    }
  }, [activeComments, revealEditorLocation])

  const handleReplyDraftChange = useCallback((commentId: string, value: string) => {
    setReplyDrafts((current) => ({ ...current, [commentId]: value }))
  }, [])

  const handleCreateReply = useCallback(async (commentId: string) => {
    const content = replyDrafts[commentId]?.trim()
    if (!content) {
      return
    }

    try {
      const response = await apiClient.post<ProjectComment>(`/api/projects/${project.id}/files/${activeFile.id}/comments/${commentId}/replies`, {
        content,
      })

      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: sortComments((current[activeFile.id] ?? []).map((comment) => comment.id === commentId ? response.data : comment)),
      }))
      setReplyDrafts((current) => ({ ...current, [commentId]: '' }))
      setHighlightedCommentId(commentId)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to add reply.')
    }
  }, [activeFile.id, project.id, replyDrafts])

  const handleToggleCommentResolved = useCallback(async (comment: ProjectComment, resolved: boolean) => {
    try {
      const response = await apiClient.patch<ProjectComment>(`/api/projects/${project.id}/files/${activeFile.id}/comments/${comment.id}`, {
        status: resolved ? 'resolved' : 'open',
      })

      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: sortComments((current[activeFile.id] ?? []).map((entry) => entry.id === comment.id ? response.data : entry)),
      }))
      setHighlightedCommentId(comment.id)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? `Failed to ${resolved ? 'resolve' : 'reopen'} comment.`)
    }
  }, [activeFile.id, project.id])

  const handleAssignComment = useCallback(async (comment: ProjectComment, assigneeUserId: string | null) => {
    try {
      const { data } = await apiClient.patch<ProjectComment>(
        `/api/projects/${project.id}/files/${activeFile.id}/comments/${comment.id}/assign`,
        { assigneeUserId }
      )
      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: (current[activeFile.id] ?? []).map((c) => c.id === data.id ? data : c),
      }))
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to assign comment.')
    }
  }, [activeFile.id, project.id])

  const handleDeleteComment = useCallback(async (comment: ProjectComment) => {
    if (!window.confirm('Delete this comment thread permanently?')) {
      return
    }

    try {
      await apiClient.delete(`/api/projects/${project.id}/files/${activeFile.id}/comments/${comment.id}`)
      setCommentsByFileId((current) => ({
        ...current,
        [activeFile.id]: (current[activeFile.id] ?? []).filter((entry) => entry.id !== comment.id),
      }))
      setReplyDrafts((current) => {
        const next = { ...current }
        delete next[comment.id]
        return next
      })
      setHighlightedCommentId((current) => current === comment.id ? null : current)
      setActiveNoteDialogCommentId((current) => current === comment.id ? null : current)
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to delete comment.')
    }
  }, [activeFile.id, project.id])

  useEffect(() => {
    if (!activeNoteDialogCommentId) {
      return
    }

    if (!activeComments.some((comment) => comment.id === activeNoteDialogCommentId)) {
      setActiveNoteDialogCommentId(null)
    }
  }, [activeComments, activeNoteDialogCommentId])

  const createSuggestionForRange = useCallback(async ({
    excerpt,
    replacementText,
    startLine,
    startColumn,
    endLine,
    endColumn,
  }: {
    excerpt: string
    replacementText: string
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }) => {
    const response = await apiClient.post<ProjectReviewSuggestion>(`/api/projects/${project.id}/files/${activeFile.id}/suggestions`, {
      excerpt,
      replacementText,
      startLine,
      startColumn,
      endLine,
      endColumn,
    })
    setSuggestionsByFileId((current) => ({
      ...current,
      [activeFile.id]: [response.data, ...(current[activeFile.id] ?? [])],
    }))
  }, [activeFile.id, project.id])

  const handleCreateSuggestion = useCallback(async () => {
    if (!isEditableTextFile(activeFile) || !commentSelection) {
      return
    }

    try {
      await createSuggestionForRange({
        excerpt: commentSelection.excerpt,
        replacementText: suggestionDraft,
        startLine: commentSelection.startLine,
        startColumn: commentSelection.startColumn,
        endLine: commentSelection.endLine,
        endColumn: commentSelection.endColumn,
      })
      setSuggestionDraft('')
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to add suggested change.')
    }
  }, [activeFile, commentSelection, createSuggestionForRange, suggestionDraft])

  const handleTrackedLocalEdit = useCallback((previousSource: string, nextSource: string) => {
    if (!trackChangesEnabled || !canEdit || !isEditableTextFile(activeFile)) {
      return
    }

    if (previousSource === nextSource) {
      return
    }

    if (trackChangesBaseSourceRef.current === null) {
      trackChangesBaseSourceRef.current = previousSource
    }
    trackChangesLatestSourceRef.current = nextSource

    if (trackChangesTimerRef.current !== null) {
      window.clearTimeout(trackChangesTimerRef.current)
    }

    trackChangesTimerRef.current = window.setTimeout(() => {
      const base = trackChangesBaseSourceRef.current
      const latest = trackChangesLatestSourceRef.current
      trackChangesTimerRef.current = null
      trackChangesBaseSourceRef.current = null
      trackChangesLatestSourceRef.current = null

      if (!base || latest === null) {
        return
      }

      const patch = computeSingleRangeReplacement(base, latest)
      if (!patch) {
        return
      }

      const start = offsetToLineColumn(base, patch.startOffset)
      const end = offsetToLineColumn(base, patch.endOffset)
      void createSuggestionForRange({
        excerpt: patch.excerpt,
        replacementText: patch.replacementText,
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column,
      }).catch(() => {
        // Avoid interrupting typing if a tracked-change request fails.
      })
    }, 600)
  }, [activeFile, canEdit, createSuggestionForRange, trackChangesEnabled])

  const handleEditorChange = useCallback((source: string) => {
    setActiveEditorSource(source)

    if (!canEdit || !isEditableTextFile(activeFile) || !isOnline || !source.trim()) {
      return
    }

    if (editorAutosaveLastSavedRef.current[activeFile.id] === source) {
      return
    }

    editorAutosaveLatestRef.current = {
      projectId: project.id,
      fileId: activeFile.id,
      source,
    }

    if (editorAutosaveTimerRef.current !== null) {
      window.clearTimeout(editorAutosaveTimerRef.current)
    }

    editorAutosaveTimerRef.current = window.setTimeout(() => {
      const pending = editorAutosaveLatestRef.current
      editorAutosaveTimerRef.current = null

      if (!pending || pending.projectId !== project.id || pending.fileId !== activeFile.id) {
        return
      }

      void apiClient.post(`/api/projects/${pending.projectId}/files/${pending.fileId}/autosave`, {
        source: pending.source,
      })
        .then(() => {
          editorAutosaveLastSavedRef.current[pending.fileId] = pending.source
          setProjectSearchIndex((current) => current[pending.fileId] === pending.source
            ? current
            : {
                ...current,
                [pending.fileId]: pending.source,
              })
          clearMutationNotice()
        })
        .catch(() => undefined)
    }, 350)
  }, [activeFile, canEdit, clearMutationNotice, isOnline, project.id])

  const handleSuggestionDecision = useCallback(async (suggestionId: string, action: 'accept' | 'reject') => {
    try {
      const response = await apiClient.patch<ProjectReviewSuggestion>(`/api/projects/${project.id}/files/${activeFile.id}/suggestions/${suggestionId}`, {
        action,
      })
      setSuggestionsByFileId((current) => ({
        ...current,
        [activeFile.id]: (current[activeFile.id] ?? []).map((suggestion) => suggestion.id === suggestionId ? response.data : suggestion),
      }))
      if (action === 'accept') {
        await onRefreshProject()
      }
    } catch (error: any) {
      alert(error?.response?.data?.error ?? `Failed to ${action} suggested change.`)
    }
  }, [activeFile.id, onRefreshProject, project.id])

  const handleDuplicateItem = useCallback(async (file: ProjectFile) => {
    try {
      await apiClient.post<ProjectFile[]>(`/api/projects/${project.id}/files/${file.id}/duplicate`)
      await onRefreshProject()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to duplicate file or folder.', () => { void handleDuplicateItem(file) })
    }
  }, [onRefreshProject, project.id, reportMutationError])

  const handleToggleFileLock = useCallback(async () => {
    if (!canEdit) {
      return
    }

    try {
      if (activeFileWorkflow?.lockedByUserId === userId) {
        await apiClient.delete(`/api/projects/${project.id}/files/${activeFile.id}/lock`)
      } else {
        await apiClient.post(`/api/projects/${project.id}/files/${activeFile.id}/lock`)
      }
      await onRefreshProject()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to update file lock.')
    }
  }, [activeFile.id, activeFileWorkflow?.lockedByUserId, canEdit, onRefreshProject, project.id, userId])

  const handleAssignReviewOwner = useCallback(async (memberUserId: string | null) => {
    try {
      await apiClient.patch(`/api/projects/${project.id}/files/${activeFile.id}/review-owner`, {
        reviewOwnerUserId: memberUserId,
      })
      await onRefreshProject()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to update review ownership.')
    }
  }, [activeFile.id, onRefreshProject, project.id])

  const handlePostChatMessage = useCallback(async () => {
    const content = chatDraft.trim()
    if (!content) {
      return
    }

    try {
      const response = await apiClient.post<ProjectChatMessage>(`/api/projects/${project.id}/chat`, { content })
      setChatMessages((current) => [...current, response.data])
      setChatDraft('')
    } catch (error: any) {
      setChatError(error?.response?.data?.error ?? 'Failed to post chat message.')
    }
  }, [chatDraft, project.id])

  const handleRestoreTrashedFile = useCallback(async (file: ProjectFile) => {
    try {
      await apiClient.post(`/api/projects/${project.id}/files/${file.id}/restore`)
      await onRefreshProject()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to restore file from trash.')
    }
  }, [onRefreshProject, project.id, reportMutationError])

  const handleDeleteTrashedFilePermanently = useCallback(async (file: ProjectFile) => {
    try {
      await apiClient.delete(`/api/projects/${project.id}/files/${file.id}`, { params: { permanent: 1 } })
      await onRefreshProject()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to permanently delete trashed file.')
    }
  }, [onRefreshProject, project.id, reportMutationError])

  const handleEmptyProjectTrash = useCallback(async () => {
    if (!canEdit || project.trashedFiles.length === 0) {
      return
    }

    if (!window.confirm('Delete every item in this project trash permanently?')) {
      return
    }

    try {
      await apiClient.post(`/api/projects/${project.id}/trash/empty`)
      await onRefreshProject()
    } catch (error: any) {
      reportMutationError(error?.response?.data?.error ?? 'Failed to empty project trash.')
    }
  }, [canEdit, onRefreshProject, project.id, project.trashedFiles.length, reportMutationError])

  const handleTreeSelectionToggle = useCallback((fileId: string, additive: boolean) => {
    setSelectedTreeFileIds((current) => {
      if (!additive) {
        return [fileId]
      }

      return current.includes(fileId)
        ? current.filter((entry) => entry !== fileId)
        : [...current, fileId]
    })
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (selectedTreeFileIds.length === 0) {
      return
    }

    for (const fileId of selectedTreeFileIds) {
      try {
        await apiClient.delete(`/api/projects/${project.id}/files/${fileId}`)
      } catch {
        continue
      }
    }

    setSelectedTreeFileIds([])
    await onRefreshProject()
  }, [onRefreshProject, project.id, selectedTreeFileIds])

  const handleBulkDuplicate = useCallback(async () => {
    for (const fileId of selectedTreeFileIds) {
      try {
        await apiClient.post(`/api/projects/${project.id}/files/${fileId}/duplicate`)
      } catch {
        continue
      }
    }

    await onRefreshProject()
  }, [onRefreshProject, project.id, selectedTreeFileIds])

  const handleGoToLine = useCallback((event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    const parsedLine = Number(goToLineValue)
    const parsedColumn = Number(goToColumnValue)
    if (!Number.isFinite(parsedLine) || parsedLine < 1) {
      return
    }

    revealEditorLocation(
      Math.round(parsedLine),
      Number.isFinite(parsedColumn) && parsedColumn > 0 ? Math.round(parsedColumn) : 1,
    )
  }, [goToColumnValue, goToLineValue, revealEditorLocation])

  useEffect(() => {
    const onGoToShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        toggleNavigationPanel()
      }
    }

    window.addEventListener('keydown', onGoToShortcut)
    return () => window.removeEventListener('keydown', onGoToShortcut)
  }, [toggleNavigationPanel])

  useEffect(() => {
    const SIDEBAR_SHORTCUTS: Record<string, SidebarTabKey> = {
      'f': 'files',
      'e': 'export',
      's': 'search',
      'o': 'outline',
      'b': 'bibliography',
      'n': 'nomenclature',
      'a': 'academic',
      'h': 'history',
      'c': 'comments',
      'l': 'log',
      't': 'tasks',
      'k': 'gemini',
    }
    const onAltShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      const tab = SIDEBAR_SHORTCUTS[key]
      if (tab) {
        event.preventDefault()
        setActiveSidebarTab(tab)
        sidebarPanelRef.current?.expand()
      }
    }
    window.addEventListener('keydown', onAltShortcut)
    return () => window.removeEventListener('keydown', onAltShortcut)
  }, [])

  const handleCloseTab = useCallback((fileId: string) => {
    if (!openTabFileIds.includes(fileId)) {
      return
    }

    const closingIndex = openTabFileIds.indexOf(fileId)
    const nextOpenTabFileIds = openTabFileIds.filter((openFileId) => openFileId !== fileId)

    if (nextOpenTabFileIds.length === 0) {
      setOpenTabFileIds([])
      collapseEditorPanel()
      return
    }

    if (fileId === activeFile.id) {
      const nextActiveId = nextOpenTabFileIds[closingIndex] ?? nextOpenTabFileIds[closingIndex - 1] ?? nextOpenTabFileIds[0]
      if (nextActiveId) {
        onSelectFile(nextActiveId)
      }
    }

    setOpenTabFileIds(nextOpenTabFileIds)
  }, [activeFile.id, collapseEditorPanel, onSelectFile, openTabFileIds])

  const openFileInEditor = useCallback((fileId: string) => {
    setOpenTabFileIds((current) => (current.includes(fileId) ? current : [...current, fileId]))
    onSelectFile(fileId)
    expandEditorPanel()
  }, [expandEditorPanel, onSelectFile])

  const handleCloseOtherTabs = useCallback((fileId: string) => {
    if (!openTabFileIds.includes(fileId)) {
      return
    }

    if (activeFile.id !== fileId) {
      onSelectFile(fileId)
    }

    setOpenTabFileIds([fileId])
  }, [activeFile.id, onSelectFile, openTabFileIds])

  const startDrag = useCallback((event: React.DragEvent<HTMLElement>, fileId: string) => {
    if (!canEdit) {
      return
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DRAG_FILE_ID_MIME_TYPE, fileId)
    event.dataTransfer.setData('text/plain', fileId)
    dragFileIdRef.current = fileId
    setDraggedFileId(fileId)
  }, [canEdit])

  const endDrag = useCallback(() => {
    dragFileIdRef.current = null
    setDraggedFileId(null)
    setDropTargetPath(null)
  }, [])

  const readDraggedFileId = useCallback((event: React.DragEvent<HTMLElement>) => {
    return dragFileIdRef.current
      ?? event.dataTransfer.getData(DRAG_FILE_ID_MIME_TYPE)
      ?? event.dataTransfer.getData('text/plain')
      ?? null
  }, [])

  const isExternalFileDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    const { dataTransfer } = event
    if (dataTransfer.files.length > 0) {
      return true
    }

    return Array.from(dataTransfer.types).includes('Files')
  }, [])

  const canDropInto = useCallback((fileId: string, parentPath: string | null) => {
    const file = project.files.find((entry) => entry.id === fileId)
    if (!file) {
      return false
    }

    if (file.mimeType === DRIVE_FOLDER_MIME_TYPE && parentPath && (parentPath === file.path || parentPath.startsWith(`${file.path}/`))) {
      return false
    }

    return parentDirectoryPath(file.path) !== parentPath
  }, [project.files])

  const handleRootDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) {
      return
    }

    if (isExternalFileDrag(event)) {
      event.preventDefault()
      setDropTargetPath('__root__')
      return
    }

    const fileId = readDraggedFileId(event)
    if (!fileId || !canDropInto(fileId, null)) {
      return
    }

    event.preventDefault()
    setDropTargetPath('__root__')
  }, [canDropInto, canEdit, isExternalFileDrag, readDraggedFileId])

  const handleRootDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) {
      return
    }

    if (isExternalFileDrag(event)) {
      event.preventDefault()
      pendingUploadFolderPathRef.current = null
      void handleUploadFiles(event.dataTransfer.files)
      endDrag()
      return
    }

    const fileId = readDraggedFileId(event)
    if (!fileId || !canDropInto(fileId, null)) {
      endDrag()
      return
    }

    event.preventDefault()
    endDrag()
    void handleMoveItem(fileId, null)
  }, [canDropInto, canEdit, endDrag, handleMoveItem, handleUploadFiles, isExternalFileDrag, readDraggedFileId])

  const renderInlineCreateRow = useCallback((parentPath: string | null, depth: number) => {
    if (!inlineCreateState || inlineCreateState.parentPath !== parentPath) {
      return null
    }

    return (
      <form
        key={`inline-create-${parentPath ?? 'root'}`}
        className={styles.inlineCreateRow}
        style={treeDepthStyle(depth, 22)}
        onSubmit={(event) => {
          event.preventDefault()
          void handleInlineCreateSubmit()
        }}
      >
          <span
            className={[
              styles.treeIconBadge,
              inlineCreateState.kind === 'file' ? styles.treeIconTypst : styles.treeIconFolder,
            ].join(' ')}
          >
            {inlineCreateState.kind === 'file' ? (
              <FileIconLucide size={13} strokeWidth={1.9} aria-hidden />
            ) : (
              <FolderIcon size={13} strokeWidth={1.9} aria-hidden />
            )}
          </span>
        <input
          className={styles.inlineCreateInput}
          value={inlineCreateState.name}
          onChange={(event) => handleInlineCreateNameChange(event.target.value)}
          placeholder={inlineCreateState.kind === 'file' ? defaultNewFileName : 'figures'}
          autoFocus
          maxLength={255}
        />
        <button
          type="submit"
          className={styles.inlineCreateConfirmBtn}
          disabled={inlineCreateState.isSubmitting || !inlineCreateState.name.trim()}
          aria-label={`Create ${inlineCreateState.kind}`}
        >
          {inlineCreateState.isSubmitting ? '…' : <CheckIcon size={14} strokeWidth={2.5} aria-hidden />}
        </button>
        <button
          type="button"
          className={styles.inlineCreateCancelBtn}
          onClick={handleInlineCreateCancel}
          disabled={inlineCreateState.isSubmitting}
          aria-label="Cancel creation"
        >
          <XIcon size={14} strokeWidth={2.5} aria-hidden />
        </button>
        {inlineCreateState.error ? <span className={styles.inlineCreateError}>{inlineCreateState.error}</span> : null}
      </form>
    )
  }, [defaultNewFileName, handleInlineCreateCancel, handleInlineCreateNameChange, handleInlineCreateSubmit, inlineCreateState])

  const renderFileViewItem = useCallback((file: ProjectFile, viewMode: FileViewMode): ReactNode => {
    const isFolder = file.mimeType === DRIVE_FOLDER_MIME_TYPE
    const isActive = file.id === activeFile.id
    const isFocusedFolder = isFolder && focusedFolderPath === file.path
    const isMain = project.mainFileId === file.id
    const isDirty = dirtyFileId === file.id
    const aiEditCount = pendingAiEditCountsByFile.get(file.id) ?? 0
    const isDropTarget = isFolder && dropTargetPath === file.path
    const itemClassName = viewMode === 'gallery'
      ? [styles.fileGalleryItem, isActive ? styles.fileGalleryItemActive : '', isFocusedFolder ? styles.fileGalleryItemFocused : '', isDropTarget ? styles.dropTarget : ''].filter(Boolean).join(' ')
      : [styles.fileListItem, isActive ? styles.fileListItemActive : '', isFocusedFolder ? styles.fileListItemFocused : '', isDropTarget ? styles.dropTarget : ''].filter(Boolean).join(' ')

    const handleOpen = () => {
      if (isFolder) {
        setFocusedFolderPath(file.path)
        setExpandedFolders((current) => ({ ...current, [file.path]: true }))
        return
      }

      handleTreeSelectionToggle(file.id, false)
      openFileInEditor(file.id)
    }

    if (viewMode !== 'gallery') {
      return (
        <div key={`${viewMode}:${file.id}`} className={styles.fileListRow}>
          <button
            type="button"
            className={itemClassName}
            title={file.path}
            draggable={canEdit}
            onContextMenu={(event) => openContextMenu(event, { kind: isFolder ? 'folder' : 'file', x: event.clientX, y: event.clientY, file })}
            onDragStart={(event) => startDrag(event, file.id)}
            onDragEnd={endDrag}
            onDragOver={isFolder ? (event) => {
              if (isExternalFileDrag(event)) {
                event.preventDefault()
                event.stopPropagation()
                setDropTargetPath(file.path)
                return
              }

              const fileId = readDraggedFileId(event)
              if (!canEdit || !fileId || !canDropInto(fileId, file.path)) {
                return
              }

              event.preventDefault()
              event.stopPropagation()
              setDropTargetPath(file.path)
            } : undefined}
            onDragLeave={isFolder ? (event) => {
              event.stopPropagation()
              if (dropTargetPath === file.path) {
                setDropTargetPath(null)
              }
            } : undefined}
            onDrop={isFolder ? (event) => {
              if (isExternalFileDrag(event)) {
                event.preventDefault()
                event.stopPropagation()
                pendingUploadFolderPathRef.current = file.path
                void handleUploadFiles(event.dataTransfer.files)
                endDrag()
                return
              }

              const fileId = readDraggedFileId(event)
              if (!canEdit || !fileId || !canDropInto(fileId, file.path)) {
                endDrag()
                return
              }

              event.preventDefault()
              event.stopPropagation()
              endDrag()
              void handleMoveItem(fileId, file.path)
            } : undefined}
            onClick={handleOpen}
          >
            {isFolder ? (
              <ChevronRight
                size={10}
                strokeWidth={2}
                className={isFocusedFolder ? styles.treeChevronExpanded : styles.treeChevron}
                aria-hidden
              />
            ) : null}
            {!isFolder ? (
              <span className={[styles.treeIconBadge, iconClassNameForFile(file, styles)].join(' ')} aria-hidden>
                {fileIconForFile(file, 13)}
              </span>
            ) : null}
            <span className={styles.treeLabelRow}>
              <span className={styles.treeLabel}>{file.name}</span>
              {isMain ? (
                <span className={styles.treeMainMarker} title="Main file" aria-label="Main file">
                  <Star size={10} fill="currentColor" strokeWidth={2.2} aria-hidden />
                </span>
              ) : null}
              {isDirty ? <span className={styles.treeDirtyMarker} title="Unsaved changes" aria-label="Unsaved changes" /> : null}
              {aiEditCount > 0 ? <span className={styles.treeAiEditMarker} title={`${aiEditCount} pending AI edit${aiEditCount === 1 ? '' : 's'}`} aria-label={`${aiEditCount} pending AI edit${aiEditCount === 1 ? '' : 's'}`}>{aiEditCount}</span> : null}
            </span>
          </button>
          {canEdit ? (
            <button
              type="button"
              className={styles.treeActionBtn}
              aria-label={`Open actions for ${file.name}`}
              onClick={(event) => {
                event.stopPropagation()
                openContextMenuFromButton(event.currentTarget, { kind: isFolder ? 'folder' : 'file', x: 0, y: 0, file })
              }}
            >
              ⋯
            </button>
          ) : null}
        </div>
      )
    }

    return (
      <button
        key={`${viewMode}:${file.id}`}
        type="button"
        className={itemClassName}
        title={file.path}
        draggable={canEdit}
        onContextMenu={(event) => openContextMenu(event, { kind: isFolder ? 'folder' : 'file', x: event.clientX, y: event.clientY, file })}
        onDragStart={(event) => startDrag(event, file.id)}
        onDragEnd={endDrag}
        onDragOver={isFolder ? (event) => {
          if (isExternalFileDrag(event)) {
            event.preventDefault()
            event.stopPropagation()
            setDropTargetPath(file.path)
            return
          }

          const fileId = readDraggedFileId(event)
          if (!canEdit || !fileId || !canDropInto(fileId, file.path)) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          setDropTargetPath(file.path)
        } : undefined}
        onDragLeave={isFolder ? (event) => {
          event.stopPropagation()
          if (dropTargetPath === file.path) {
            setDropTargetPath(null)
          }
        } : undefined}
        onDrop={isFolder ? (event) => {
          if (isExternalFileDrag(event)) {
            event.preventDefault()
            event.stopPropagation()
            pendingUploadFolderPathRef.current = file.path
            void handleUploadFiles(event.dataTransfer.files)
            endDrag()
            return
          }

          const fileId = readDraggedFileId(event)
          if (!canEdit || !fileId || !canDropInto(fileId, file.path)) {
            endDrag()
            return
          }

          event.preventDefault()
          event.stopPropagation()
          endDrag()
          void handleMoveItem(fileId, file.path)
        } : undefined}
        onClick={handleOpen}
      >
        {isFolder ? (
          <ChevronRight
            size={10}
            strokeWidth={2}
            className={isFocusedFolder ? styles.treeChevronExpanded : styles.treeChevron}
            aria-hidden
          />
        ) : null}
        {!isFolder ? (
          <span className={[styles.treeIconBadge, iconClassNameForFile(file, styles)].join(' ')} aria-hidden>
            {fileIconForFile(file, viewMode === 'gallery' ? 18 : 13)}
          </span>
        ) : null}
        <span className={viewMode === 'gallery' ? styles.fileGalleryLabel : styles.treeLabelRow}>
          <span className={styles.treeLabel}>{file.name}</span>
          {isMain ? (
            <span className={styles.treeMainMarker} title="Main file" aria-label="Main file">
              <Star size={10} fill="currentColor" strokeWidth={2.2} aria-hidden />
            </span>
          ) : null}
          {isDirty ? <span className={styles.treeDirtyMarker} title="Unsaved changes" aria-label="Unsaved changes" /> : null}
          {aiEditCount > 0 ? <span className={styles.treeAiEditMarker} title={`${aiEditCount} pending AI edit${aiEditCount === 1 ? '' : 's'}`} aria-label={`${aiEditCount} pending AI edit${aiEditCount === 1 ? '' : 's'}`}>{aiEditCount}</span> : null}
        </span>
      </button>
    )
  }, [activeFile.id, canDropInto, canEdit, dirtyFileId, dropTargetPath, endDrag, focusedFolderPath, handleMoveItem, handleTreeSelectionToggle, handleUploadFiles, isExternalFileDrag, openContextMenu, openContextMenuFromButton, openFileInEditor, pendingAiEditCountsByFile, project.mainFileId, readDraggedFileId, startDrag])

  const renderTree = useCallback((nodes: TreeNode[], depth = 0): ReactNode => nodes.flatMap((node) => {
    if (node.type === 'folder') {
      const expanded = expandedFolders[node.path] ?? false
      const isFocused = focusedFolderPath === node.path
      const isDropTarget = dropTargetPath === node.path
      const folderFile = node.file
      const folderFileId = folderFile?.id ?? null
      const visibleChildren = folderVisibleCounts[node.path] ?? 120
      const renderedChildren = expanded ? node.children.slice(0, visibleChildren) : []
      const remainingChildren = Math.max(0, node.children.length - renderedChildren.length)

      return (
        <div
          key={node.path}
          className={[styles.treeFolderGroup, expanded ? styles.treeFolderGroupExpanded : ''].filter(Boolean).join(' ')}
          style={expanded ? treeDepthStyle(depth, 0) : undefined}
        >
          <div className={styles.treeRow} style={treeDepthStyle(depth, 0, depth === 0 ? 1 : 0)}>
            <button
              type="button"
              className={styles.treeDisclosureBtn}
              onClick={() => {
                setFocusedFolderPath(node.path)
                setExpandedFolders((current) => ({ ...current, [node.path]: !expanded }))
              }}
              aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            >
              <ChevronRight
                size={10}
                strokeWidth={2}
                className={expanded ? styles.treeChevronExpanded : styles.treeChevron}
                aria-hidden
              />
            </button>
            <button
              className={[styles.treeItemButton, isFocused ? styles.folderItemActive : styles.folderItem, isDropTarget ? styles.dropTarget : ''].filter(Boolean).join(' ')}
              draggable={canEdit && Boolean(folderFileId)}
              onContextMenu={folderFile ? (event) => openContextMenu(event, { kind: 'folder', x: event.clientX, y: event.clientY, file: folderFile }) : undefined}
              onDragStart={folderFileId ? (event) => startDrag(event, folderFileId) : undefined}
              onDragEnd={endDrag}
              onDragOver={(event) => {
                if (isExternalFileDrag(event)) {
                  event.preventDefault()
                  event.stopPropagation()
                  setDropTargetPath(node.path)
                  return
                }

                const fileId = readDraggedFileId(event)
                if (!canEdit || !fileId || !canDropInto(fileId, node.path)) {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                setDropTargetPath(node.path)
              }}
              onDragLeave={(event) => {
                event.stopPropagation()
                if (dropTargetPath === node.path) {
                  setDropTargetPath(null)
                }
              }}
              onDrop={(event) => {
                if (isExternalFileDrag(event)) {
                  event.preventDefault()
                  event.stopPropagation()
                  pendingUploadFolderPathRef.current = node.path
                  void handleUploadFiles(event.dataTransfer.files)
                  endDrag()
                  return
                }

                const fileId = readDraggedFileId(event)
                if (!canEdit || !fileId || !canDropInto(fileId, node.path)) {
                  endDrag()
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                endDrag()
                void handleMoveItem(fileId, node.path)
              }}
              onClick={() => {
                setFocusedFolderPath(node.path)
                setExpandedFolders((current) => ({ ...current, [node.path]: !expanded }))
              }}
            >
              <span className={styles.treeTextBlock}>
                <span className={styles.treeLabel}>{node.name}</span>
              </span>
            </button>
            {folderFile && canEdit ? (
              <button
                type="button"
                className={styles.treeActionBtn}
                aria-label={`Open actions for ${folderFile.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  openContextMenuFromButton(event.currentTarget, { kind: 'folder', x: 0, y: 0, file: folderFile })
                }}
              >
                ⋯
              </button>
            ) : null}
          </div>
          {expanded ? (
            <>
              {renderedChildren.length > 0 ? renderTree(renderedChildren, depth + 1) : null}
              {remainingChildren > 0 ? (
                <div className={styles.treeLoadMoreRow} style={treeDepthStyle(depth + 1, 22)}>
                  <button
                    type="button"
                    className={styles.treeLoadMoreBtn}
                    onClick={() => {
                      setFolderVisibleCounts((current) => ({
                        ...current,
                        [node.path]: Math.min(node.children.length, visibleChildren + 120),
                      }))
                    }}
                  >
                    Load {Math.min(remainingChildren, 120)} more item{Math.min(remainingChildren, 120) === 1 ? '' : 's'}
                  </button>
                  <span className={styles.treeMetaLabel}>{remainingChildren} still hidden</span>
                </div>
              ) : null}
              {renderInlineCreateRow(node.path, depth + 1)}
            </>
          ) : null}
        </div>
      )
    }

    const isActive = node.file.id === activeFile.id
    const isMain = project.mainFileId === node.file.id
    const isDirty = dirtyFileId === node.file.id
    const aiEditCount = pendingAiEditCountsByFile.get(node.file.id) ?? 0

    return (
      <div
        key={node.file.id}
        className={styles.treeRow}
        style={treeDepthStyle(depth, 0, depth === 0 ? 1 : 0)}
      >
        <button
          className={[styles.treeItemButton, isActive ? styles.activeFile : styles.fileItem, draggedFileId === node.file.id ? styles.dropTarget : ''].filter(Boolean).join(' ')}
          draggable={canEdit}
          onContextMenu={(event) => openContextMenu(event, { kind: 'file', x: event.clientX, y: event.clientY, file: node.file })}
          onDragStart={(event) => startDrag(event, node.file.id)}
          onDragEnd={endDrag}
          onClick={(event) => {
            setFocusedFolderPath(null)
            handleTreeSelectionToggle(node.file.id, event.metaKey || event.ctrlKey)
            openFileInEditor(node.file.id)
          }}
        >
          <span className={[styles.treeIconBadge, iconClassNameForFile(node.file, styles)].join(' ')} aria-hidden>
            {fileIconForFile(node.file)}
          </span>
          <span className={styles.treeTextBlock}>
            <span className={styles.treeLabelRow}>
              <span className={styles.treeLabel}>{node.name}</span>
              {isMain ? (
                <span className={styles.treeMainMarker} title="Main file" aria-label="Main file">
                  <Star size={10} fill="currentColor" strokeWidth={2.2} aria-hidden />
                </span>
              ) : null}
              {isDirty ? <span className={styles.treeDirtyMarker} title="Unsaved changes" aria-label="Unsaved changes" /> : null}
              {aiEditCount > 0 ? <span className={styles.treeAiEditMarker} title={`${aiEditCount} pending AI edit${aiEditCount === 1 ? '' : 's'}`} aria-label={`${aiEditCount} pending AI edit${aiEditCount === 1 ? '' : 's'}`}>{aiEditCount}</span> : null}
            </span>
          </span>
        </button>
        {canEdit ? (
          <button
            type="button"
            className={styles.treeActionBtn}
            aria-label={`Open actions for ${node.file.name}`}
            onClick={(event) => {
              event.stopPropagation()
              openContextMenuFromButton(event.currentTarget, { kind: 'file', x: 0, y: 0, file: node.file })
            }}
          >
            ⋯
          </button>
        ) : null}
      </div>
    )
  }), [activeFile.id, canDropInto, canEdit, dirtyFileId, draggedFileId, dropTargetPath, endDrag, expandedFolders, focusedFolderPath, folderVisibleCounts, handleMoveItem, handleTreeSelectionToggle, handleUploadFiles, isExternalFileDrag, openContextMenu, openContextMenuFromButton, openFileInEditor, pendingAiEditCountsByFile, project.mainFileId, readDraggedFileId, renderInlineCreateRow, selectedTreeFileIds, startDrag])

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) {
      return []
    }

    if (contextMenu.kind === 'tab') {
      return [
        { label: 'Close', action: () => handleCloseTab(contextMenu.file.id) },
        { label: 'Close Others', action: () => handleCloseOtherTabs(contextMenu.file.id) },
      ]
    }

    if (!canEdit) {
      return []
    }

    if (contextMenu.kind === 'root') {
      return [
        { label: 'New file', action: () => handleCreateFile(null) },
        { label: 'New folder', action: () => handleCreateFolder(null) },
        { label: 'Upload Files', action: () => openUploadPicker(null) },
        { label: 'Sync From Drive', action: () => handleSyncDrive() },
      ]
    }

    if (contextMenu.kind === 'folder') {
      return [
        { label: 'New file', action: () => handleCreateFile(contextMenu.file.path) },
        { label: 'New folder', action: () => handleCreateFolder(contextMenu.file.path) },
        { label: 'Upload Files', action: () => openUploadPicker(contextMenu.file.path) },
        { label: 'Duplicate Folder', action: () => handleDuplicateItem(contextMenu.file) },
        { label: 'Move…', action: () => handleMoveItemPrompt(contextMenu.file) },
        { label: 'Move To Project Root', action: () => handleMoveItem(contextMenu.file.id, null) },
        { label: 'Rename', action: () => handleRenameItem(contextMenu.file) },
        { label: 'Delete', action: () => handleDeleteItem(contextMenu.file), danger: true },
      ]
    }

    return [
      ...(isRenderableDocumentFile(contextMenu.file)
        ? [{ label: 'Open and Render', action: () => onSelectFile(contextMenu.file.id) }]
        : []),
      ...(isRenderableDocumentFile(contextMenu.file) && project.mainFileId !== contextMenu.file.id
        ? [{ label: 'Set As Main Document', action: () => handleSetMainFile(contextMenu.file) }]
        : []),
      { label: 'Duplicate File', action: () => handleDuplicateItem(contextMenu.file) },
      { label: 'Move…', action: () => handleMoveItemPrompt(contextMenu.file) },
      { label: 'Move To Project Root', action: () => handleMoveItem(contextMenu.file.id, null) },
      { label: 'Rename', action: () => handleRenameItem(contextMenu.file) },
      { label: 'Delete', action: () => handleDeleteItem(contextMenu.file), danger: true },
    ]
  }, [canEdit, contextMenu, handleCloseOtherTabs, handleCloseTab, handleCreateFile, handleCreateFolder, handleDeleteItem, handleDuplicateItem, handleMoveItem, handleMoveItemPrompt, handleRenameItem, handleSetMainFile, handleSyncDrive, openUploadPicker, project.mainFileId])

  const sidebarToolActions = useMemo<Array<{ label: string; action: () => void; disabled?: boolean }>>(() => ([
  ]), [])

  useEffect(() => {
    try {
      const raw = safeStorage.getItem(sidebarTabOrderStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const allowed: SidebarTabKey[] = ['files', 'export', 'search', 'outline', 'tools', 'bibliography', 'nomenclature', 'academic', 'plots', 'history', 'peerReview', 'comments', 'sharing', 'collaboration', 'ecosystem', 'gemini', 'log', 'tasks']
      const unique = parsed.filter((key): key is SidebarTabKey => typeof key === 'string' && allowed.includes(key as SidebarTabKey))
      const completed = [...unique, ...allowed.filter((key) => !unique.includes(key))]
      setSidebarTabOrder(completed)
    } catch {
      safeStorage.removeItem(sidebarTabOrderStorageKey)
    }
  }, [sidebarTabOrderStorageKey])

  useEffect(() => {
    safeStorage.setItem(sidebarTabOrderStorageKey, JSON.stringify(sidebarTabOrder))
  }, [sidebarTabOrder, sidebarTabOrderStorageKey])

  const sidebarTabItems = useMemo<Array<{ key: SidebarTabKey; icon: ReactNode; title: string }>>(() => ([
    { key: 'files', icon: <FolderIcon size={18} aria-hidden />, title: 'Files (⌥F)' },
    { key: 'export', icon: <FileOutput size={18} aria-hidden />, title: 'Export (⌥E)' },
    { key: 'search', icon: <SearchIcon size={18} aria-hidden />, title: 'Search (⌥S)' },
    { key: 'outline', icon: <ListTree size={18} aria-hidden />, title: 'Outline (⌥O)' },
    { key: 'tools', icon: <Wrench size={18} aria-hidden />, title: 'Tools' },
    { key: 'bibliography', icon: <BibIcon size={18} aria-hidden />, title: 'Bibliography (⌥B)' },
    { key: 'nomenclature', icon: <Database size={18} aria-hidden />, title: 'Nomenclature & Abbreviations (⌥N)' },
    { key: 'academic', icon: <GraduationCap size={18} aria-hidden />, title: 'Academic Search (⌥A)' },
    { key: 'plots', icon: <BarChart2 size={18} aria-hidden />, title: 'Plots' },
    { key: 'history', icon: <HistoryIcon size={18} aria-hidden />, title: 'History (⌥H)' },
    { key: 'peerReview', icon: <PeerReviewIcon size={18} aria-hidden />, title: 'Peer Review' },
    { key: 'comments', icon: <CommentsIcon size={18} aria-hidden />, title: 'Comments (⌥C)' },
    { key: 'sharing', icon: <ShareLucide size={18} aria-hidden />, title: 'Sharing' },
    { key: 'collaboration', icon: <UsersLucide size={18} aria-hidden />, title: 'Collaboration' },
    { key: 'ecosystem', icon: <Leaf size={18} aria-hidden />, title: 'Ecosystem' },
    { key: 'gemini', icon: <Sparkles size={18} aria-hidden />, title: 'Gemini (⌥K)' },
    { key: 'log', icon: <Terminal size={18} aria-hidden />, title: 'Log (⌥L)' },
    { key: 'tasks', icon: <TasksIcon size={18} aria-hidden />, title: 'Tasks (⌥T)' },
  ]), [])

  const sidebarTabLabel = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '')

  const sidebarRail = (
    <div className={styles.sidebarTabBar}>
      {sidebarTabOrder.map((tabKey) => {
        const tab = sidebarTabItems.find((entry) => entry.key === tabKey)
        if (!tab) return null
        return (
          <button
            key={tab.key}
            className={[styles.sidebarTabButton, activeSidebarTab === tab.key ? styles.sidebarTabButtonActive : ''].filter(Boolean).join(' ')}
            onClick={() => toggleSidebarTab(tab.key as SidebarTabKey)}
            title={tab.title}
            aria-label={sidebarTabLabel(tab.title)}
          >
            {tab.icon}
          </button>
        )
      })}
      <div className={styles.sidebarBottomGroup}>
        <button
          className={styles.sidebarTabRailBtn}
          onClick={() => toggleSidebarTab('settings')}
          title="Settings"
          aria-label="Open settings"
        >
          <SettingsLucide size={20} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.sidebarTabRailInfo}
          onClick={() => navigate('/?settings=profile')}
          title={`Signed in as ${user?.email ?? userId}. Open profile settings`}
          aria-label="Open profile settings"
          style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
        >
          {user?.avatarUrl
            ? <img src={user.avatarUrl} alt={user?.name ?? ''} className={styles.sidebarAvatar} referrerPolicy="no-referrer" />
            : <UsersLucide size={20} aria-hidden />
          }
        </button>
        <button
          className={styles.sidebarTabRailBtn}
          onClick={() => void logout()}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOutLucide size={20} aria-hidden />
        </button>
      </div>
    </div>
  )

  const sidebarMenuContent = (
    <div className={styles.sidebarSection}>
      <div className={styles.sidebarBody}>
        <div className={styles.sidebarMenuPane}>
        <section className={[styles.sidebarCard, styles.sidebarFilesCard].join(' ')}>
            <div
              className={[styles.sidebarTabPanel, activeSidebarTab === 'files' && isRootFileUploadTarget ? styles.fileUploadDropZoneActive : ''].filter(Boolean).join(' ')}
              style={{ flex: 1, overflowY: activeSidebarTab === 'log' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}
              onDragOver={activeSidebarTab === 'files' ? handleRootDragOver : undefined}
              onDragLeave={activeSidebarTab === 'files' ? (event) => {
                const relatedTarget = event.relatedTarget as Node | null
                if (!event.currentTarget.contains(relatedTarget) && dropTargetPath === '__root__') {
                  setDropTargetPath(null)
                }
              } : undefined}
              onDrop={activeSidebarTab === 'files' ? handleRootDrop : undefined}
            >
              {activeSidebarTab === 'files' ? (
                <>
                  <div className={styles.sidebarHeaderRow}>
                    <div>
                      <p className={styles.sidebarLabel}>Files</p>
                    </div>
                    <div className={styles.sidebarActions}>
                      {canEdit ? (
                        <>
                          <button className={styles.sidebarIconBtn} onClick={() => void handleCreateFile()} title="New file" aria-label="New file">
                            <FilePlus size={18} aria-hidden />
                          </button>
                          <button className={styles.sidebarIconBtn} onClick={() => void handleCreateFolder()} title="New folder" aria-label="New folder">
                            <FolderPlus size={18} aria-hidden />
                          </button>
                          <button className={styles.sidebarIconBtn} onClick={() => openUploadPicker(targetFolderPath)} title="Upload files" aria-label="Upload files">
                            <UploadIcon size={18} aria-hidden />
                          </button>
                        </>
                      ) : null}
                      <button className={styles.sidebarIconBtn} onClick={() => void handleSyncDrive()} title="Sync Drive" aria-label="Sync Drive">
                        <RefreshCw size={20} aria-hidden />
                      </button>
                    </div>
                  </div>

              <div className={styles.fileViewToggle} role="group" aria-label="File view">
                <button
                  type="button"
                  className={fileViewMode === 'tree' ? styles.fileViewBtnActive : styles.fileViewBtn}
                  onClick={() => setFileViewMode('tree')}
                  title="Tree view"
                  aria-label="Tree view"
                >
                  <ListTree size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className={fileViewMode === 'list' ? styles.fileViewBtnActive : styles.fileViewBtn}
                  onClick={() => setFileViewMode('list')}
                  title="Browser view"
                  aria-label="Browser view"
                >
                  <ListIcon size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className={fileViewMode === 'gallery' ? styles.fileViewBtnActive : styles.fileViewBtn}
                  onClick={() => setFileViewMode('gallery')}
                  title="Icon view"
                  aria-label="Icon view"
                >
                  <LayoutGrid size={15} aria-hidden />
                </button>
              </div>

              {selectedTreeFileIds.length > 1 ? (
                <div className={styles.bulkActionBar}>
                  <span>{selectedTreeFileIds.length} selected</span>
                  <div className={styles.panelIconActions}>
                    <button className={styles.panelIconBtn} onClick={() => void handleBulkDuplicate()} title="Duplicate selected files" aria-label="Duplicate selected files">
                      <CopyIcon size={16} aria-hidden />
                    </button>
                    <button className={styles.dangerIconBtn} onClick={() => void handleBulkDelete()} title="Trash selected files" aria-label="Trash selected files">
                      <TrashIcon size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : null}
              <div className={styles.treeSummaryBar}>
                <span>{project.files.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE).length} files</span>
                <span>{project.files.filter((file) => file.mimeType === DRIVE_FOLDER_MIME_TYPE).length} folders</span>
                <span>{dirtyFileId ? 'Unsaved changes present' : 'All files saved'}</span>
              </div>
              {canEdit ? (
                <div className={[styles.fileUploadHint, isRootFileUploadTarget ? styles.fileUploadHintActive : ''].filter(Boolean).join(' ')}>
                  {isRootFileUploadTarget ? 'Drop files to upload into this folder view' : 'Drag files here to upload'}
                </div>
              ) : null}
              <div
                className={styles.treeScroller}
                onContextMenu={(event) => {
                  if (event.target === event.currentTarget) {
                    openContextMenu(event, { kind: 'root', x: event.clientX, y: event.clientY })
                  }
                }}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    setFocusedFolderPath(null)
                    setSelectedTreeFileIds([])
                  }
                }}
                onDragOver={handleRootDragOver}
                onDragLeave={(event) => {
                  if (event.target === event.currentTarget && dropTargetPath === '__root__') {
                    setDropTargetPath(null)
                  }
                }}
                onDrop={handleRootDrop}
              >
                {fileViewMode === 'tree' ? (
                  <>
                    <div className={styles.treeTopMarker} aria-hidden />
                    <div
                      className={[styles.treeFolderGroup, isRootExpanded ? styles.treeFolderGroupExpanded : ''].filter(Boolean).join(' ')}
                      style={isRootExpanded ? treeDepthStyle(0, 0, 1) : undefined}
                    >
                      <div className={styles.treeRow} style={treeDepthStyle(0, 0, 1)}>
                        <button
                          type="button"
                          className={styles.treeDisclosureBtn}
                          onClick={() => setIsRootExpanded((current) => !current)}
                          aria-label={isRootExpanded ? 'Collapse project root' : 'Expand project root'}
                        >
                          <ChevronRight
                            size={10}
                            strokeWidth={2}
                            className={isRootExpanded ? styles.treeChevronExpanded : styles.treeChevron}
                            aria-hidden
                          />
                        </button>
                        <button
                          type="button"
                          className={[styles.treeItemButton, styles.treeRootItem].join(' ')}
                          onClick={() => setIsRootExpanded((current) => !current)}
                        >
                          <span className={[styles.treeIconBadge, styles.treeIconWorkspace].join(' ')} aria-hidden>
                            <PackageCheck size={13} strokeWidth={1.9} />
                          </span>
                          <span className={styles.treeTextBlock}>
                            <span className={styles.treeLabelRow}>
                              <span className={[styles.treeLabel, styles.treeRootLabel].join(' ')}>{workspaceLabel}</span>
                            </span>
                          </span>
                        </button>
                      </div>
                      {isRootExpanded ? (
                        <>
                          {renderInlineCreateRow(null, 1)}
                          {renderTree(fileTree, 1)}
                        </>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    {inlineCreateState ? renderInlineCreateRow(inlineCreateState.parentPath, 0) : null}
                    <div className={styles.fileBrowserBar}>
                      <button
                        type="button"
                        className={styles.fileBrowserCrumb}
                        onClick={() => setFocusedFolderPath(null)}
                      >
                        {workspaceLabel}
                      </button>
                      {focusedFolderSegments.map((segment, index) => {
                        const path = focusedFolderSegments.slice(0, index + 1).join('/')
                        return (
                          <button
                            key={path}
                            type="button"
                            className={styles.fileBrowserCrumb}
                            onClick={() => setFocusedFolderPath(path)}
                          >
                            {segment}
                          </button>
                        )
                      })}
                      {focusedFolderPath ? (
                        <button
                          type="button"
                          className={styles.fileBrowserUpBtn}
                          onClick={() => setFocusedFolderPath(parentDirectoryPath(focusedFolderPath))}
                          title="Up one folder"
                          aria-label="Up one folder"
                        >
                          <ChevronUp size={14} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    <div
                      className={fileViewMode === 'gallery' ? styles.fileGalleryView : styles.fileListView}
                      onClick={(event) => {
                        if (event.target === event.currentTarget) {
                          setFocusedFolderPath(null)
                          setSelectedTreeFileIds([])
                        }
                      }}
                    >
                      {browserFileItems.length > 0 ? (
                        browserFileItems.map((file) => renderFileViewItem(file, fileViewMode))
                      ) : (
                        <p className={styles.fileBrowserEmpty}>This folder is empty.</p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className={styles.filesTrashDock}>
                <div className={styles.sidebarHeaderRow}>
                  <div>
                    <p className={styles.sidebarLabel}>Trash</p>
                    <p className={styles.sidebarHint}>{project.trashedFiles.length} item{project.trashedFiles.length === 1 ? '' : 's'} ready for restore or permanent removal</p>
                  </div>
                  {canEdit ? (
                    <button className={styles.sidebarIconBtn} onClick={() => void handleEmptyProjectTrash()} disabled={project.trashedFiles.length === 0} title="Empty trash" aria-label="Empty trash" style={{ color: 'var(--danger)' }}>
                      <TrashIcon size={16} aria-hidden />
                    </button>
                  ) : null}
                </div>
                {project.trashedFiles.length > 0 ? (
                  <div className={styles.trashPanelList}>
                    {project.trashedFiles.map((file) => (
                      <div key={file.id} className={styles.trashPanelItem}>
                        <div className={styles.trashPanelMeta}>
                          <strong>{file.name}</strong>
                          <span className={styles.cardDate}>Stored in project trash</span>
                        </div>
                        <div className={styles.trashPanelActions}>
                          <button className={styles.panelIconBtn} onClick={() => void handleRestoreTrashedFile(file)} disabled={!canEdit} title={`Restore ${file.name}`} aria-label={`Restore ${file.name}`}>
                            <HistoryIcon size={16} aria-hidden />
                          </button>
                          <button className={styles.dangerIconBtn} onClick={() => void handleDeleteTrashedFilePermanently(file)} disabled={!canEdit} title={`Delete ${file.name} permanently`} aria-label={`Delete ${file.name} permanently`}>
                            <TrashIcon size={16} aria-hidden />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.panelDescription}>Trash is empty.</p>
                )}
              </div>
            </>
          ) : null}
          {activeSidebarTab === 'export' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Export</p>
                  <p className={styles.sidebarHint}></p>
                </div>
                <div className={styles.sidebarActions}>
                  <button
                    className={styles.panelIconBtn}
                    onClick={clearAllExportLogs}
                    disabled={allExportLogs.length === 0}
                    title="Clear export logs"
                    aria-label="Clear export logs"
                  >
                    <TrashIcon size={16} aria-hidden />
                  </button>
                </div>
              </div>

              <div className={styles.exportPanelContent}>
                <section className={styles.exportSectionCard}>
                  <div className={styles.exportSectionHeader}>
                    <h3 className={styles.exportSectionTitle}>Current file</h3>
                    <p className={styles.exportSectionDescription}>{compileTargetFile.name}</p>
                  </div>
                  <div className={styles.exportOptionGrid}>
                    <label className={styles.exportOptionField}>
                      <span>Format</span>
                      <select value={selectedExportFormat} onChange={(event) => setSelectedExportFormat(event.target.value as ExportFormat)}>
                        {EXPORT_FORMAT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.exportOptionField}>
                      <span>Destination</span>
                      <select value={selectedExportDestination} onChange={(event) => setSelectedExportDestination(event.target.value as ExportDestination)}>
                        {EXPORT_DESTINATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={styles.exportIconRow}>
                    <button
                      className={selectedExportDestination === 'drive' ? styles.primaryIconBtn : styles.panelIconBtn}
                      onClick={handleRunSelectedExport}
                      disabled={isExporting || !canRender}
                      title={selectedExportDestination === 'drive' ? `Save ${selectedExportFormat.toUpperCase()} to Drive` : `Download ${selectedExportFormat.toUpperCase()}`}
                      aria-label={selectedExportDestination === 'drive' ? `Save ${selectedExportFormat.toUpperCase()} to Drive` : `Download ${selectedExportFormat.toUpperCase()}`}
                    >
                      {selectedExportDestination === 'drive' ? <Save size={16} aria-hidden /> : <DownloadIcon size={16} aria-hidden />}
                    </button>
                  </div>
                </section>

                <section className={styles.exportSectionCard}>
                  <div className={styles.exportSectionHeader}>
                    <h3 className={styles.exportSectionTitle}>File conversion</h3>
                    <p className={styles.exportSectionDescription}></p>
                  </div>
                  <div className={styles.exportLabeledActionRow}>
                    {activeSourceFormat === 'typst' ? (
                      <button
                        className={styles.exportActionBtn}
                        disabled={!isEditableTextFile(activeFile) || isConvertingProjectFormat}
                        onClick={() => {
                          void handleSaveConvertedFile('gdoc').catch(() => {})
                        }}
                        title="Export to Google Docs"
                        aria-label="Export to Google Docs"
                      >
                        <FileOutput size={16} aria-hidden />
                        <span>Google Docs</span>
                      </button>
                    ) : null}
                    {activeSourceFormat && activeSourceFormat !== 'typst' ? (
                      <button
                        className={styles.exportActionBtn}
                        disabled={!isEditableTextFile(activeFile) || isConvertingProjectFormat}
                        onClick={() => {
                          void handleSaveConvertedFile('typst').catch(() => {})
                        }}
                        title="Save as Typst source (.typ)"
                        aria-label="Save as Typst source (.typ)"
                      >
                        <FileText size={16} aria-hidden />
                        <span>Save .typ</span>
                      </button>
                    ) : null}
                    {activeSourceFormat && activeSourceFormat !== 'typst' ? (
                      <button
                        className={styles.exportActionBtn}
                        disabled={!isEditableTextFile(activeFile) || isConvertingProjectFormat}
                        onClick={() => {
                          void handleConvertProjectFormat('typst').catch(() => {})
                        }}
                        title="Convert active file to Typst"
                        aria-label="Convert active file to Typst"
                      >
                        <RefreshCw size={16} aria-hidden />
                        <span>Convert to Typst</span>
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className={styles.exportSectionCard}>
                  <div className={styles.exportSectionHeader}>
                    <h3 className={styles.exportSectionTitle}>Project export</h3>
                    <p className={styles.exportSectionDescription}></p>
                  </div>
                  <div className={styles.exportLabeledActionRow}>
                    <button className={styles.exportActionBtn} disabled={isExporting} onClick={() => void handleDownloadProjectZip()} title="Download project as ZIP" aria-label="Download project as ZIP">
                      <DownloadIcon size={16} aria-hidden />
                      <span>Project ZIP</span>
                    </button>
                    {ecosystemProjectType === 'latex' ? (
                      <button className={styles.exportActionBtn} disabled={isExporting} onClick={() => void handleCreateTypstProjectCopy()} title="Create Typst project copy" aria-label="Create Typst project copy">
                        <CopyIcon size={16} aria-hidden />
                        <span>Typst copy</span>
                      </button>
                    ) : null}
                    {ecosystemProjectType === 'latex' ? (
                      <button className={styles.exportActionBtn} disabled={isExporting} onClick={() => void handleDownloadProjectAsTypstZip()} title="Export project as Typst ZIP" aria-label="Export project as Typst ZIP">
                        <PackageCheck size={16} aria-hidden />
                        <span>Typst ZIP</span>
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className={styles.exportSectionCard}>
                  <div className={styles.exportSectionHeader}>
                    <h3 className={styles.exportSectionTitle}>Logs</h3>
                    <p className={styles.exportSectionDescription}></p>
                  </div>
                  {allExportLogs.length === 0 ? (
                    <p className={styles.panelDescription}>No export or conversion logs yet.</p>
                  ) : (
                    <div className={styles.exportLogList}>
                      {allExportLogs.map((entry) => (
                        <div key={entry.id} className={[styles.exportLogItem, entry.level === 'error' ? styles.exportLogError : styles.exportLogInfo].join(' ')}>
                          <div className={styles.exportLogMetaRow}>
                            <span className={styles.exportLogLevel}>{entry.level === 'error' ? 'Error' : 'Info'}</span>
                            <span className={styles.exportLogTimestamp}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <p>{entry.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : null}

          {activeSidebarTab === 'search' ? (
            <ProjectSearchPanel
              query={projectSearchQuery}
              onQueryChange={setProjectSearchQuery}
              onClose={() => setActiveSidebarTab('files')}
              isLoading={isLoadingProjectSearch}
              error={projectSearchError}
              results={projectSearchResults}
              onSelectResult={handleProjectSearchResultClick}
              inSidebar
            />
          ) : null}

          {activeSidebarTab === 'tools' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Tools</p>
                  <p className={styles.sidebarHint}></p>
                </div>
              </div>
              <div className={styles.toolsPanelContent}>
                {sidebarToolActions.length > 0 ? (
                  <div className={styles.toolsActionList}>
                    {sidebarToolActions.map((item) => (
                      <button
                        key={item.label}
                        className={styles.toolsActionBtn}
                        onClick={item.action}
                        disabled={item.disabled}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <section className={styles.themeSection}>
                  <h3>LaTeX To Typst</h3>
                  <textarea
                    className={styles.commentInput}
                    rows={8}
                    value={latexConverterSource}
                    onChange={(event) => setLatexConverterSource(event.target.value)}
                    placeholder="Paste LaTeX for equations, sections, tables, citations, or labels…"
                  />
                  <textarea
                    className={styles.commentInput}
                    rows={8}
                    value={convertedLatexSnippet}
                    readOnly
                    placeholder="Converted Typst will appear here."
                  />
                  <div className={styles.panelIconActions}>
                    <button className={styles.primaryIconBtn} onClick={() => handleInsertIntoEditor(convertedLatexSnippet)} disabled={!convertedLatexSnippet || !canEdit || !isEditableTextFile(activeFile)} title="Insert into editor" aria-label="Insert into editor">
                      <FileOutput size={16} aria-hidden />
                    </button>
                    <button className={styles.panelIconBtn} onClick={() => setLatexConverterSource('')} disabled={!latexConverterSource} title="Clear converter input" aria-label="Clear converter input">
                      <XIcon size={16} aria-hidden />
                    </button>
                  </div>
                </section>
              </div>
            </>
          ) : null}
          {activeSidebarTab === 'outline' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Outline</p>
                  <p className={styles.sidebarHint}></p>
                </div>
              </div>
              <div className={styles.outlinePanelContent}>
                <div className={styles.outlineStatsRow}>
                  <span className={[styles.outlineStatChip, styles.featureSection].join(' ')}>Sections {outlineCounts.section}</span>
                  <span className={[styles.outlineStatChip, styles.featureFigure].join(' ')}>Figures {outlineCounts.figure}</span>
                  <span className={[styles.outlineStatChip, styles.featureTable].join(' ')}>Tables {outlineCounts.table}</span>
                  <span className={[styles.outlineStatChip, styles.featureEquation].join(' ')}>Equations {outlineCounts.equation}</span>
                  <span className={[styles.outlineStatChip, styles.featureBibliography].join(' ')}>Refs {outlineCounts.bibliography}</span>
                </div>
                {outlineItems.length === 0 ? (
                  <p className={styles.panelDescription}>No headings found yet. Add headings to build an outline.</p>
                ) : (
                  <div className={[styles.outlineList, styles.outlineListFull].join(' ')}>
                    {outlineTree.map((node) => (
                      <OutlineTreeNode
                        key={`outline-node-${node.path}`}
                        node={node}
                        collapsed={collapsedOutlinePaths}
                        onToggle={toggleOutlineCollapsed}
                        onReveal={(line, filePath) => {
                          if (filePath && filePath !== activeFile.path) {
                            const target = project.files.find((f) => f.path === filePath)
                            if (target) onSelectFile(target.id)
                          }
                          revealEditorLocation(line, 1)
                        }}
                        featureClassName={featureClassName}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          {activeSidebarTab === 'bibliography' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>References</p>
                  <p className={styles.sidebarHint}></p>
                </div>
              </div>
              <Suspense fallback={<PanelLoadingMessage message="Loading references…" />}>
                <BibliographyPanel
                  projectId={project.id}
                  role={project.role}
                  ecosystem={ecosystem}
                  isLoading={isLoadingEcosystem}
                  error={ecosystemError}
                  onInsertAtCursor={handleInsertIntoEditor}
                  onAddBibEntry={handleAddBibEntry}
                  onFormatBibliography={handleFormatBibliography}
                  onSortBibliography={handleSortBibliography}
                  onUpsertProjectTextFile={handleUpsertProjectTextFile}
                  onJumpToReference={handleJumpToProjectPath}
                  onRefresh={loadEcosystem}
                  onGenerateAI={gemini.generate}
                  />              </Suspense>
            </>
          ) : null}

          {activeSidebarTab === 'nomenclature' ? (
            <NomenclaturePanel
              entries={nomenclatureEntries}
              isIndexing={isLoadingProjectSearch}
              canEdit={canEdit}
              onJump={(entry) => handleJumpToProjectPath(entry.filePath, entry.line)}
              onSave={async (entries) => {
                const symbols = entries.filter((entry) => entry.kind === 'symbol')
                const abbreviations = entries.filter((entry) => entry.kind === 'abbreviation')
                await handleUpsertProjectTextFile('nomenclature.typ', formatNomenclatureTypst(symbols, 'Nomenclature', 'Symbol'), { open: false })
                await handleUpsertProjectTextFile('abbreviations.typ', formatNomenclatureTypst(abbreviations, 'Abbreviations', 'Abbreviation'), { open: false })
              }}
              onDefinitionUpdate={async (entry, definition) => {
                const file = project.files.find((candidate) => candidate.path === entry.filePath)
                if (!file || !isEditableTextFile(file)) return false
                const source = file.id === activeFile.id ? activeSource : (projectSearchIndex[file.id] ?? '')
                const revised = reviseNomenclatureDefinitionInSource(source, entry, definition)
                if (!revised || revised === source) return false
                await handleUpsertProjectTextFile(file.path, revised, { open: false })
                return true
              }}
            />
          ) : null}

          {activeSidebarTab === 'academic' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Academic Search</p>
                  <p className={styles.sidebarHint}></p>
                </div>
              </div>
              <Suspense fallback={<PanelLoadingMessage message="Loading academic search…" />}>
                <AcademicPanel
                  projectId={project.id}
                  canEdit={project.role !== 'viewer'}
                  citationKeys={new Set((ecosystem?.citations ?? []).map((c) => c.key.toLowerCase()))}
                  onAddBibEntry={handleAddBibEntry}
                  onInsertAtCursor={handleInsertIntoEditor}
                />
              </Suspense>
            </>
          ) : null}

          {activeSidebarTab === 'plots' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Plot & Figure Generator</p>
                  <p className={styles.sidebarHint}>
                    {ecosystemProjectType === 'latex'
                      ? 'Build pgfplots charts and TikZ figures from CSV data or templates'
                      : 'Build CeTZ plots and figures from CSV data or templates'}
                  </p>
                </div>
              </div>
              <Suspense fallback={<PanelLoadingMessage message="Loading plot tools…" />}>
                <PlotPanel
                  projectFormat={ecosystemProjectType}
                  canEdit={canEdit}
                  onInsertAtCursor={handleInsertIntoEditor}
                />
              </Suspense>
            </>
          ) : null}

          {activeSidebarTab === 'history' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Revision History</p>
                  <p className={styles.sidebarHint}></p>
                </div>
              </div>
              <RevisionHistoryPanel
                role={project.role}
                activeFile={activeFile}
                revisions={fileRevisions}
                isLoading={isLoadingFileRevisions}
                error={fileRevisionsError}
                isCreatingCheckpoint={isCreatingCheckpoint}
                restoringRevisionId={restoringRevisionId}
                onRefresh={loadFileRevisions}
                onCreateCheckpoint={handleCreateRevisionCheckpoint}
                onTagRevision={handleTagRevision}
                onRestoreRevision={handleRestoreRevision}
                currentSource={isEditableTextFile(activeFile) ? ytext.toString() : ''}
                onClose={() => setActiveSidebarTab('files')}
                inSidebar
              />
            </>
          ) : null}

          {activeSidebarTab === 'peerReview' ? (
            <>
              <div className={styles.sidebarHeaderRow}>
                <div>
                  <p className={styles.sidebarLabel}>Peer Review</p>
                  <p className={styles.sidebarHint}></p>
                </div>
              </div>
              <PeerReviewPanel
                role={project.role}
                projectId={project.id}
                projectTitle={project.title}
                ecosystem={ecosystem}
                isLoading={isLoadingEcosystem}
                error={ecosystemError}
                activeFile={activeFile}
                activeSource={isEditableTextFile(activeFile) ? ytext.toString() : ''}
                entryFile={compileTargetFile}
                projectType={ecosystemProjectType}
                onRefresh={loadEcosystem}
                onSaveMetadataFiles={handleSaveMetadataFiles}
                onUpsertProjectTextFile={handleUpsertProjectTextFile}
                onCreateSubmissionSnapshot={handleCreateSubmissionSnapshot}
                inSidebar
              />
            </>
          ) : null}

          {activeSidebarTab === 'comments' ? (
            <CommentsPanel
              canComment={canCreateTextComments}
              canCreatePdfNotes={canAnnotatePdfPreview}
              comments={activeComments}
              suggestions={activeSuggestions}
              commentDraft={commentDraft}
              suggestionDraft={suggestionDraft}
              replyDrafts={replyDrafts}
              commentSelection={commentSelection}
              commentsError={commentsError}
              isLoadingComments={isLoadingComments}
              suggestionsError={suggestionsError}
              isLoadingSuggestions={isLoadingSuggestions}
              highlightedCommentId={highlightedCommentId}
              trackChangesEnabled={trackChangesEnabled}
              commentDraftAssigneeUserId={commentDraftAssigneeUserId}
              onCommentDraftChange={setCommentDraft}
              onCommentDraftAssigneeChange={setCommentDraftAssigneeUserId}
              onSuggestionDraftChange={setSuggestionDraft}
              onTrackChangesEnabledChange={setTrackChangesEnabled}
              onReplyDraftChange={handleReplyDraftChange}
              onCreateComment={handleCreateComment}
              onCreateSuggestion={handleCreateSuggestion}
              onSuggestionDecision={handleSuggestionDecision}
              onCreateReply={handleCreateReply}
              onDeleteComment={handleDeleteComment}
              onToggleResolved={handleToggleCommentResolved}
              onAssignComment={handleAssignComment}
              canManageComments={canEdit}
              currentUserId={userId}
              members={project.members}
              onClose={() => setActiveSidebarTab('files')}
              onCommentClick={handleCommentClick}
              inSidebar
            />
          ) : null}
          {activeSidebarTab === 'sharing' ? (
            <Suspense fallback={<PanelLoadingMessage message="Loading sharing controls…" />}>
              <SharingPanel
                visible
                variant="sidebar"
                inSidebar
                project={project}
                projectRole={project.role}
                members={project.members}
                invitations={project.invitations}
                onClose={() => setActiveSidebarTab('files')}
                onInvite={handleInvite}
                onChangeMemberRole={handleMemberRoleChange}
                onRevokeMember={handleRevokeMember}
                onRevokeInvitation={handleRevokeInvitation}
                onPublish={handlePublish}
                onUnpublish={handleUnpublish}
                onTransferOwnership={handleTransferOwnership}
              />
            </Suspense>
          ) : null}

          {activeSidebarTab === 'collaboration' ? (
            <CollaborationPanel
              canEdit={canEdit}
              currentUserId={userId}
              activeFilePath={activeFile.path}
              activeFileWorkflow={activeFileWorkflow}
              memberList={memberList}
              collaborators={collaborators}
              followTargetClientId={followTargetClientId}
              chatMessages={chatMessages}
              chatDraft={chatDraft}
              chatError={chatError}
              isLoadingChat={isLoadingChat}
              activityEvents={activityEvents}
              activityError={activityError}
              isLoadingActivity={isLoadingActivity}
              onChatDraftChange={setChatDraft}
              onSendChatMessage={handlePostChatMessage}
              onToggleFileLock={() => void handleToggleFileLock()}
              onAssignReviewOwner={(memberUserId) => void handleAssignReviewOwner(memberUserId)}
              onToggleFollowCollaborator={(clientId) => {
                const collaborator = collaborators.find((entry) => entry.clientId === clientId)
                setFollowTargetClientId((current) => current === clientId ? null : clientId)
                if (collaborator?.filePath === activeFile.path && collaborator.line) {
                  revealEditorLocation(collaborator.line, collaborator.column ?? 1)
                }
              }}
              onClose={() => setActiveSidebarTab('files')}
              inSidebar
            />
            ) : null}
            {activeSidebarTab === 'ecosystem' ? (
            <EcosystemPanel
              role={project.role}
              projectType={ecosystemProjectType}
              targetFolderPath={targetFolderPath}
              ecosystem={ecosystem}
              isLoading={isLoadingEcosystem}
              error={ecosystemError}
              activeFile={activeFile}
              activeTemplate={project.activeTemplate}
              livePageCount={livePageCount}
              complianceIssues={templateComplianceIssues}
              onClose={() => setActiveSidebarTab('files')}
              onRefresh={loadEcosystem}
              onSavePackagePins={handleSavePackagePins}
              onSaveWritingTools={handleSaveWritingTools}
              onSaveMetadataFiles={handleSaveMetadataFiles}
              onInsertAtCursor={handleInsertIntoEditor}
              onJumpToReference={handleJumpToProjectPath}
              symbolPalette={SYMBOL_PALETTE}
              onUploadProjectFont={() => fontUploadInputRef.current?.click()}
              onUploadReusableAsset={() => libraryUploadInputRef.current?.click()}
              onAddCurrentFileToLibrary={handleAddCurrentFileToLibrary}
              onImportReusableAsset={handleImportReusableAsset}
              onDeleteReusableAsset={handleDeleteReusableAsset}
              inSidebar
            />
            ) : null}
            {activeSidebarTab === 'gemini' ? (
                <GeminiPanel 
                  context={`Project: ${project.title}\nFiles: ${project.files.map(f => f.path).join(', ')}\n\nActive File Content:\n${activeSource}`} 
                  activeSource={activeSource}
                  projectId={project.id}
                  fileId={activeFile.id}
                  ecosystem={ecosystem}
                  onSaveSettings={saveEcosystem}
                  onAddBibEntry={handleAddBibEntry}
                  onCreateComment={handleCreateReviewComment}
                  onSuggestDocumentEdits={handleSuggestDocumentEdits}
                  onSuggestProjectEdits={handleSuggestProjectEdits}
                  loadProjectFilesForAi={loadProjectFilesForAi}
                  aiEditCount={pendingAiEdits.length}
                  aiEditFileCount={pendingAiEditFileCount}
                  onAcceptAllAiEdits={() => handleAllAiEditBulkDecision('accept')}
                  onRejectAllAiEdits={() => handleAllAiEditBulkDecision('reject')}
                  onClose={() => setActiveSidebarTab('files')}
                  inSidebar
                />
            ) : null}
            {activeSidebarTab === 'log' ? (

            <CompileOutputPanel
              isPdfAsset={isPdfAsset}
              isCompiling={isCompiling}
              compileNotice={compileNotice}
              compileError={visibleCompileError}
              compileLog={visibleCompileLog}
              diagnostics={visibleCompileDiagnostics}
              explanations={compileExplanations}
              workspaceLabel={workspaceLabel}
              defaultFilePath={compileTargetFile.path}
              statuses={user?.isAdmin ? languageServerStatuses : []}
              onDiagnosticClick={handleDiagnosticClick}
              onAskAi={handleAskAiAboutDiagnostic}
              askingAiKey={askingAiDiagnosticKey}
              aiLoading={aiLoading}
            />
          ) : null}
          {activeSidebarTab === 'tasks' ? (
            <TasksPanel
              comments={projectTasks}
              isLoading={isLoadingProjectTasks}
              currentUserId={userId}
              showProjectName={false}
              onNavigate={(_projectId, commentId) => {
                setHighlightedCommentId(commentId)
                setActiveSidebarTab('comments')
              }}
              onCommentsChange={setProjectTasks}
            />
          ) : null}
          {activeSidebarTab === 'settings' ? (
            <SettingsPanel
              role={project.role}
              compileSettings={project.compileSettings}
              activeFile={activeFile}
              isConverting={isConvertingProjectFormat}
              onSaveCompileSettings={handleCompileSettingsChange}
              onConvertFormat={handleConvertProjectFormat}
              sidebarTabOrder={sidebarTabOrder}
              onMoveSidebarTab={(key, direction) => {
                setSidebarTabOrder((current) => {
                  const index = current.indexOf(key)
                  if (index < 0) return current
                  const target = direction === 'up' ? index - 1 : index + 1
                  if (target < 0 || target >= current.length) return current
                  const next = [...current]
                  const [item] = next.splice(index, 1)
                  next.splice(target, 0, item)
                  return next
                })
              }}
              onClose={() => setActiveSidebarTab('files')}
              inSidebar
            />
          ) : null}
        </div>
      </section>
      </div>
      </div>
    </div>
  )

  const sidebarContent = (
    <div className={styles.sidebarShell}>
      {sidebarRail}
      {activeSidebarTab ? sidebarMenuContent : null}
    </div>
  )

  return (
    <div ref={pageRef} className={styles.page} style={workspaceStyle}>
      <EditorToolbar
        title={project.title}
        activeFileName={activeFile.name}
        mainFileName={mainFile?.name ?? null}
        role={project.role}
        canRender={canRender}
        previewMode={resolvedPreviewMode}
        previewModeOptions={latexPreviewModeOptions}
        onPreviewModeChange={handlePreviewModeChange}
        onTitleChange={handleProjectRename}
        awareness={awareness}
        saveStatus={saveStatus}
        isCompiling={isCompiling}
        compileError={compileError}
        onShare={toggleSharingPanel}
        onCompile={handleCompileNow}
        onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
        showSidebarToggle={isMobile}
        connectionError={connectionIssue}
        connectionStatus={connectionStatus}
        collaborators={collaborators}
        latexCompiler={canRenderLatex ? activeLatexCompiler : null}
        latexCompilerOptions={canRenderLatex ? ENABLED_LATEX_COMPILER_OPTIONS : []}
        onLatexCompilerChange={canRenderLatex ? handleLatexCompilerChange : undefined}
      />

      {mutationNotice ? (
        <div className={mutationNotice.kind === 'error' ? styles.reliabilityBannerError : styles.reliabilityBanner}>
          <span>{mutationNotice.message}</span>
          <div className={styles.reliabilityBannerActions}>
            {mutationNotice.onAction && mutationNotice.actionLabel ? (
              <button className={styles.reliabilityBannerBtn} onClick={mutationNotice.onAction}>
                {mutationNotice.actionLabel}
              </button>
            ) : null}
            <button className={styles.reliabilityBannerBtn} onClick={clearMutationNotice}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {blockingTaskMessage || fileLoadingMessage || isCompiling ? (
        <div className={styles.busyOverlay} role="alert" aria-live="assertive" aria-busy="true">
          <div className={styles.busyCard}>
            <div className={styles.busySpinner} aria-hidden="true" />
            <strong>{blockingTaskMessage ?? fileLoadingMessage ?? 'Compiling…'}</strong>
            <span>{blockingTaskMessage ? 'Please wait until this task finishes.' : isCompiling ? 'Building your document preview.' : 'Preparing the selected file…'}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.workspace}>
        {isMobile && isSidebarOpen ? (
          <div className={styles.mobileSidebarBackdrop} onClick={() => setIsSidebarOpen(false)}>
            <aside className={styles.mobileSidebarDrawer} onClick={(event) => event.stopPropagation()}>
              {sidebarContent}
            </aside>
          </div>
        ) : null}

        {!isMobile ? (
          <div className={styles.sidebarRailDock}>
            {sidebarRail}
          </div>
        ) : null}

        <PanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className={styles.panels}>
          {!isMobile ? (
            <>
              <Panel panelRef={sidebarPanelRef} defaultSize={SIDEBAR_EXPANDED_SIZE} minSize={SIDEBAR_MIN_SIZE} maxSize={SIDEBAR_MAX_SIZE} collapsible collapsedSize={0}>
                <div className={styles.sidebarShell}>
                  {sidebarMenuContent}
                </div>
              </Panel>
              <PanelResizeHandle className={styles.resizeHandle} onDoubleClick={toggleSidebarPanel}>
                <ResizeHandleCenter
                  label="Toggle left panel"
                  direction="left"
                  onToggle={toggleSidebarPanel}
                  onFocus={toggleEditorFocus}
                />
              </PanelResizeHandle>
            </>
          ) : null}

          <Panel panelRef={editorPanelRef} defaultSize={isMobile ? "58%" : "38%"} minSize="20%" collapsible collapsedSize="0%">
            <div className={styles.editorPanel}>
              <div className={styles.breadcrumbBar}>
                {breadcrumbSegments.map((segment, index) => (
                  <span key={`${segment}-${index}`} className={styles.breadcrumbItem}>
                    {segment}
                  </span>
                ))}
              </div>

              <div className={styles.tabStrip}>
                {openTabs.map((file) => {
                  const isTabActive = file.id === activeFile.id
                  const isTabMain = project.mainFileId === file.id
                  const isTabDirty = dirtyFileId === file.id
                  const fileTypeClassName = iconClassNameForFile(file, styles)

                  return (
                    <div
                      key={file.id}
                      className={[styles.tabItem, isTabActive ? styles.tabItemActive : ''].filter(Boolean).join(' ')}
                      onContextMenu={(event) => openContextMenu(event, { kind: 'tab', x: event.clientX, y: event.clientY, file })}
                    >
                      <button
                        className={styles.tabSelectButton}
                        onClick={() => onSelectFile(file.id)}
                      >
                        <span className={styles.tabLabelRow}>
                          <span className={[styles.tabTitle, fileTypeClassName].join(' ')}>{file.name}</span>
                          <span className={styles.tabStatusGroup} aria-hidden>
                            <span className={styles.tabSaveIndicator}>
                              {isTabDirty ? (
                                <span className={styles.treeDirtyMarker} />
                              ) : isTabActive ? (
                                <CheckIcon size={10} strokeWidth={2.4} />
                              ) : (
                                <span className={styles.tabSaveIndicatorPlaceholder} />
                              )}
                            </span>
                            {isTabMain ? (
                              <span className={styles.treeMainMarker}>
                                <Star size={10} fill="currentColor" strokeWidth={2.2} />
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                      {openTabs.length > 0 ? (
                        <button
                          className={styles.tabCloseButton}
                          aria-label={`Close ${file.name}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleCloseTab(file.id)
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {isEditableTextFile(activeFile) && canEdit && activeIsBibFile ? (
                <BibToolbar
                  entryCount={countBibtexEntries(activeSource)}
                  canEdit={canEdit}
                  onInsertEntry={handleInsertBibEntry}
                  onSort={handleActiveBibSort}
                  onFormat={handleActiveBibFormat}
                  onDeduplicate={handleActiveBibDeduplicate}
                />
              ) : isEditableTextFile(activeFile) && canEdit ? (
                <FormatToolbar
                  projectFormat={isRenderableTypstFile(activeFile) ? 'typst' : isRenderableLatexFile(activeFile) ? 'latex' : 'plain'}
                  onFormat={handleFormat}
                />
              ) : null}

              {signatureHint && isEditableTextFile(activeFile) ? (
                <div className={styles.signatureHintBar}>
                  <strong>{signatureHint.label}</strong>
                  <span>{signatureHint.signature ?? signatureHint.summary}</span>
                  {signatureHint.parameters && signatureHint.activeParameter !== null ? (
                    <span className={styles.signatureHintActiveParam}>
                      Active: {signatureHint.parameters[signatureHint.activeParameter] ?? signatureHint.parameters[0]}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className={styles.editorSurface}>
                {isReviewMode ? (
                  <div className={styles.reviewModeBanner}>
                    Review mode is active. Source editing is locked, but you can still select text, leave comments, reply in threads, and resolve or reopen review items.
                  </div>
                ) : null}
                <div className={styles.editorSurfaceLayout}>
                  <div className={styles.editorPrimaryPane}>
                    <PreviewErrorBoundary
                      resetKey={editorSurfaceResetKey}
                      message="The editor surface hit a rendering error."
                      retryLabel="Reload editor"
                    >
                      {isEditableTextFile(activeFile) ? (
                        <CodeMirrorEditor
                          key={activeFile.id}
                          ytext={ytext}
                          awareness={awareness}
                          projectId={project.id}
                          onCompile={handleCompileNow}
                          onChange={handleEditorChange}
                          onLocalEdit={trackChangesEnabled ? handleTrackedLocalEdit : undefined}
                          onSave={handleSave}
                          readOnly={!canEdit}
                          editorLanguage={activeEditorLanguage}
                          currentFilePath={activeFile.path}
                          projectFiles={assistFiles}
                          projectTextEntries={assistTextEntries}
                          packageSuggestions={packageSuggestions}
                          editorMode={themePreset.editorMode}
                          fontFamily={theme.editorFontFamily}
                          fontSize={theme.editorFontSize}
                          insertRequest={editorInsertRequest}
                          formatRequest={formatRequest}
                          revealLocation={revealLocation}
                          searchPanelRequest={searchPanelRequest}
                          onCursorLocationChange={setCursorLocation}
                          comments={activeComments}
                          highlightedCommentId={highlightedCommentId}
                          aiEditSuggestions={activePendingAiEdits}
                          onAiEditDecision={handleAiEditDecision}
                          onAiEditBulkDecision={handleAiEditBulkDecision}
                          onSelectionRangeChange={handleSelectionRangeChange}
                          onStartCommentFromSelection={handleStartCommentFromSelection}
                          onCommentActivate={handleCommentActivateFromEditor}
                          shortcutBindings={shortcutBindings}
                          onOpenSearch={handleOpenSearch}
                          onOpenProjectSearch={handleOpenProjectSearch}
                          onToggleNavigation={toggleNavigationPanel}
                          onQuickExport={handleQuickExport}
                          onTogglePreview={togglePreviewPanel}
                          onFocusEditor={toggleEditorFocus}
                          onSignatureHelpChange={setSignatureHint}
                          onResolveCitationIdentifier={handleResolveCitationIdentifier}
                          onCiteSearch={handleCiteSearch}
                          onCiteSearchClose={handleCiteSearchClose}
                          citeSearchOpen={citeSearchState !== null}
                        />
                      ) : (
                        <AssetPanel projectId={project.id} file={activeFile} />
                      )}
                    </PreviewErrorBoundary>
                  </div>
                  {isEditableTextFile(activeFile) ? (
                    <aside className={styles.editorNavRail}>
                      <div className={styles.editorNavMiniMap}>
                        {minimapSegments.map((segment) => (
                          <button
                            key={`rail-segment-${segment.index}`}
                            className={[
                              styles.editorNavMiniMapSegment,
                              segment.isActive ? styles.editorNavMiniMapSegmentActive : '',
                              segment.featureKind ? featureClassName(segment.featureKind) : '',
                            ].filter(Boolean).join(' ')}
                            title={segment.featureLabel
                              ? `${segment.featureLabel} · lines ${segment.startLine}-${segment.endLine}`
                              : `Lines ${segment.startLine}-${segment.endLine}`}
                            onClick={() => revealEditorLocation(segment.startLine, 1)}
                          />
                        ))}
                      </div>
                    </aside>
                  ) : null}
                </div>
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className={isMobile ? styles.resizeHandleHorizontal : styles.resizeHandle} onDoubleClick={togglePreviewPanel}>
            {!isMobile ? (
              <ResizeHandleCenter
                label="Toggle preview panel"
                direction="right"
                onToggle={togglePreviewPanel}
                onFocus={toggleEditorFocus}
              />
            ) : null}
          </PanelResizeHandle>

          <Panel panelRef={previewPanelRef} defaultSize={isMobile ? "42%" : "38%"} minSize="20%" collapsible collapsedSize="0%">
            <div className={styles.previewPanel}>
              <div className={styles.previewPanelTabs} role="tablist" aria-label="Preview panel">
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewPanelTab === 'preview'}
                  className={previewPanelTab === 'preview' ? styles.previewPanelTabActive : styles.previewPanelTab}
                  onClick={() => setPreviewPanelTab('preview')}
                  title="Preview"
                  aria-label="Preview"
                >
                  <Eye size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewPanelTab === 'log'}
                  className={previewPanelTab === 'log' ? styles.previewPanelTabActive : styles.previewPanelTab}
                  onClick={() => setPreviewPanelTab('log')}
                  title="Compiler log"
                  aria-label="Compiler log"
                >
                  <Terminal size={16} aria-hidden />
                  {hasPreviewCompilerOutput ? (
                    <span className={hasVisibleErrorDiagnostic || visibleCompileError ? styles.previewPanelTabBadgeError : styles.previewPanelTabBadge}>
                      {visibleCompileDiagnostics.length > 0 ? visibleCompileDiagnostics.length : isCompiling ? '...' : '!'}
                    </span>
                  ) : null}
                </button>
              </div>
              <div className={styles.previewPanelBody}>
                <PreviewErrorBoundary resetKey={previewSurfaceResetKey}>
                  <div
                    className={previewPanelTab === 'preview' ? styles.previewPanelPane : styles.previewPanelPaneHidden}
                    aria-hidden={previewPanelTab !== 'preview'}
                  >
                    {isPdfAsset ? (
                      <Suspense fallback={<PanelLoadingMessage message="Loading PDF preview…" compact />}>
                        <PdfPreview
                          key={activePdfAssetUrl ?? 'pdf-asset'}
                          pdfUrl={activePdfAssetUrl}
                          compileError={null}
                          isCompiling={false}
                          comments={activeComments}
                          highlightedCommentId={highlightedCommentId}
                          canWriteInkComments={canAnnotatePdfPreview}
                          onCreateInkComment={handleCreatePdfComment}
                          onCommentSelect={handleCommentClick}
                          onPageCountChange={setPdfPreviewPageCount}
                        />
                      </Suspense>
                    ) : resolvedPreviewMode === 'pdf' ? (
                      <Suspense fallback={<PanelLoadingMessage message="Loading PDF preview…" compact />}>
                        <PdfPreview
                          key={pdfUrl ?? `pdf:${activeFile.id}`}
                          pdfUrl={pdfUrl}
                          compileError={compileError}
                          isCompiling={isCompiling}
                          comments={activeComments}
                          highlightedCommentId={highlightedCommentId}
                          canWriteInkComments={canAnnotatePdfPreview}
                          onCreateInkComment={handleCreatePdfComment}
                          onCommentSelect={handleCommentClick}
                          onPageCountChange={setPdfPreviewPageCount}
                          onPreviewClick={handleLatexPreviewClick}
                          syncTarget={latexPreviewSyncTarget}
                        />
                      </Suspense>
                    ) : canRenderLatex ? (
                      <HtmlPreview
                        key={webPreviewHtml ? `html:${activeFile.id}:${webPreviewHtml.length}` : `html:${activeFile.id}:empty`}
                        html={webPreviewHtml}
                        compileError={compileError}
                        isCompiling={isCompiling}
                      />
                    ) : typstPreviewUrl ? (
                      <TypstPreviewFrame
                        key={typstPreviewUrl ?? `typst:${activeFile.id}`}
                        src={typstPreviewUrl}
                        entryAbsPath={typstPreviewSession?.entryAbsPath}
                        onSessionLost={handleTinymistSessionLost}
                        onJump={handleTinymistJump}
                        onContextMenu={handleTinymistContextMenu}
                        cursorPosition={tinymistCursorPosition}
                      />
                    ) : shouldUseTinymistWebPreview ? (
                      <div className={styles.placeholder}>
                        <span>{typstPreviewSession?.detail || 'Tinymist preview is initializing…'}</span>
                      </div>
                    ) : pages.length > 0 || visibleCompileError || isCompiling ? (
                      <Suspense fallback={<PanelLoadingMessage message="Loading SVG preview…" compact />}>
                        <SvgPreview
                          key={`svg:${activeFile.id}:${pageOffset}:${pageCount}`}
                          pages={pages}
                          pageCount={pageCount}
                          pageOffset={pageOffset}
                          compileError={visibleCompileError}
                          isCompiling={isCompiling}
                        />
                      </Suspense>
                    ) : (
                      <div className={styles.placeholder}>
                        <span>{typstPreviewSession?.detail || 'Tinymist preview is initializing…'}</span>
                      </div>
                    )}
                  </div>
                  <div
                    className={previewPanelTab === 'log' ? styles.previewPanelPane : styles.previewPanelPaneHidden}
                    aria-hidden={previewPanelTab !== 'log'}
                  >
                    <CompileOutputPanel
                      isPdfAsset={isPdfAsset}
                      isCompiling={isCompiling}
                      compileNotice={compileNotice}
                      compileError={visibleCompileError}
                      compileLog={visibleCompileLog}
                      diagnostics={visibleCompileDiagnostics}
                      explanations={compileExplanations}
                      workspaceLabel={workspaceLabel}
                      defaultFilePath={compileTargetFile.path}
                      statuses={languageServerStatuses}
                      onDiagnosticClick={handleDiagnosticClick}
                      onAskAi={handleAskAiAboutDiagnostic}
                      askingAiKey={askingAiDiagnosticKey}
                      aiLoading={aiLoading}
                    />
                  </div>
                </PreviewErrorBoundary>
              </div>
            </div>
          </Panel>
        </PanelGroup>

        {showSharingPanel && (project.role === 'owner' || project.role === 'manager') ? (
          <div
            ref={sharePopoverRef}
            className={styles.sharePopover}
            style={{
              left: `${sharePopoverPosition?.left ?? 12}px`,
              top: `${sharePopoverPosition?.top ?? 56}px`,
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={<PanelLoadingMessage message="Loading sharing controls…" />}>
              <SharingPanel
                visible={showSharingPanel}
                variant="popover"
                project={project}
                projectRole={project.role}
                members={project.members}
                invitations={project.invitations}
                onClose={() => setShowSharingPanel(false)}
                onInvite={handleInvite}
                onChangeMemberRole={handleMemberRoleChange}
                onRevokeMember={handleRevokeMember}
                onRevokeInvitation={handleRevokeInvitation}
                onPublish={handlePublish}
                onUnpublish={handleUnpublish}
                onTransferOwnership={handleTransferOwnership}
              />
            </Suspense>
          </div>
        ) : null}

        {showCompileSettingsPanel ? (
          <div className={styles.panelOverlay}>
            <CompileSettingsPanel
              role={project.role}
              compileSettings={project.compileSettings}
              activeFile={activeFile}
              isConverting={isConvertingProjectFormat}
              onClose={() => setShowCompileSettingsPanel(false)}
              onSave={handleCompileSettingsChange}
              onConvert={handleConvertProjectFormat}
              activeTemplate={project.activeTemplate}
              livePageCount={livePageCount}
              complianceIssues={templateComplianceIssues}
            />
          </div>
        ) : null}

        {showRevisionPanel ? (
          <div className={styles.panelOverlay}>
            <RevisionHistoryPanel
              role={project.role}
              activeFile={activeFile}
              revisions={fileRevisions}
              isLoading={isLoadingFileRevisions}
              error={fileRevisionsError}
              isCreatingCheckpoint={isCreatingCheckpoint}
              restoringRevisionId={restoringRevisionId}
              onRefresh={loadFileRevisions}
              onCreateCheckpoint={handleCreateRevisionCheckpoint}
              onTagRevision={handleTagRevision}
              onRestoreRevision={handleRestoreRevision}
              currentSource={isEditableTextFile(activeFile) ? ytext.toString() : ''}
              onClose={() => setShowRevisionPanel(false)}
            />
          </div>
        ) : null}

        {showNavigationPanel ? (
          <div className={styles.panelOverlay}>
            <NavigationPanel
              filePath={activeFile.path}
              cursorLocation={cursorLocation}
              goToLineValue={goToLineValue}
              goToColumnValue={goToColumnValue}
              onGoToLineValueChange={setGoToLineValue}
              onGoToColumnValueChange={setGoToColumnValue}
              onSubmitGoToLine={handleGoToLine}
              outlineItems={outlineItems}
              minimapSegments={minimapSegments}
              onSelectLine={(line, column) => revealEditorLocation(line, column)}
              onClose={() => setShowNavigationPanel(false)}
            />
          </div>
        ) : null}

        {activeNoteDialogComment ? (
          <div className={styles.panelOverlay}>
            <NoteThreadDialog
              comment={activeNoteDialogComment}
              replyDraft={replyDrafts[activeNoteDialogComment.id] ?? ''}
              currentUserId={userId}
              canManageComments={canEdit}
              onReplyDraftChange={handleReplyDraftChange}
              onCreateReply={handleCreateReply}
              onToggleResolved={handleToggleCommentResolved}
              onDeleteComment={handleDeleteComment}
              onClose={() => setActiveNoteDialogCommentId(null)}
            />
          </div>
        ) : null}


        <input
          ref={uploadInputRef}
          type="file"
          className={styles.hiddenInput}
          multiple
          onChange={(event) => {
            void handleUploadFiles(event.target.files)
            event.currentTarget.value = ''
          }}
        />

        <input
          ref={fontUploadInputRef}
          type="file"
          className={styles.hiddenInput}
          accept=".ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          onChange={(event) => {
            void handleUploadProjectFont(event.target.files)
            event.currentTarget.value = ''
          }}
        />

        <input
          ref={libraryUploadInputRef}
          type="file"
          className={styles.hiddenInput}
          onChange={(event) => {
            void handleUploadReusableAsset(event.target.files)
            event.currentTarget.value = ''
          }}
        />

        {contextMenu && contextMenuItems.length > 0 ? (
          <div
            className={styles.contextMenu}
            style={{ left: `${Math.max(12, contextMenu.x)}px`, top: `${Math.max(12, contextMenu.y)}px` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {contextMenuItems.map((item) => (
              <button
                key={item.label}
                className={[styles.contextMenuItem, item.danger ? styles.contextMenuItemDanger : ''].filter(Boolean).join(' ')}
                onClick={() => runContextAction(item.action)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {tinymistContextMenu && canCreateTextComments ? (
          <div
            className={styles.contextMenu}
            style={{ left: `${Math.max(12, tinymistContextMenu.x)}px`, top: `${Math.max(12, tinymistContextMenu.y)}px` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className={styles.contextMenuItem} onClick={handleTinymistContextMenuComment}>
              Add comment
            </button>
          </div>
        ) : null}

        {citeSearchState && canEdit ? (
          <CitationSearchPopup
            projectId={project.id}
            query={citeSearchState.query}
            existingKeys={new Set((ecosystem?.citations ?? []).map((c) => c.key.toLowerCase()))}
            anchorRect={citeSearchState.anchorRect}
            onSelect={handleCiteSearchSelect}
            onClose={handleCiteSearchClose}
          />
        ) : null}
      </div>
    </div>
  )
}

function ResizeHandleCenter({
  label,
  direction,
  onToggle,
  onFocus,
}: {
  label: string
  direction: 'left' | 'right'
  onToggle: () => void
  onFocus: () => void
}) {
  const clickTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current)
      }
    }
  }, [])

  return (
    <button
      type="button"
      className={styles.resizeHandleCenter}
      title={`${label}. Click to focus the editor. Double-click to collapse or expand the adjacent panel.`}
      aria-label={`${label}. Click to focus the editor. Double-click to collapse or expand the adjacent panel.`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        if (clickTimeoutRef.current !== null) {
          window.clearTimeout(clickTimeoutRef.current)
        }

        clickTimeoutRef.current = window.setTimeout(() => {
          onFocus()
          clickTimeoutRef.current = null
        }, 180)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (clickTimeoutRef.current !== null) {
          window.clearTimeout(clickTimeoutRef.current)
          clickTimeoutRef.current = null
        }
        onToggle()
      }}
    >
      <span className={styles.resizeHandleGlyph} aria-hidden="true">{direction === 'left' ? '◂▸' : '▸◂'}</span>
    </button>
  )
}

function PanelLoadingMessage({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      className={styles.panelDescription}
      style={compact ? { padding: '16px' } : undefined}
    >
      {message}
    </div>
  )
}

function labelForRevisionReason(reason: ProjectRevision['reason']): string {
  if (reason === 'manual-save') return 'Manual save'
  if (reason === 'collaboration-checkpoint') return 'Checkpoint'
  if (reason === 'pre-restore') return 'Pre-restore backup'
  return 'Restore'
}

function CompileSettingsPanel({
  role,
  compileSettings,
  activeFile,
  isConverting,
  activeTemplate,
  livePageCount,
  complianceIssues,
  onClose,
  onSave,
  onConvert,
}: {
  role: ProjectRole
  compileSettings: ProjectCompileSettings
  activeFile: ProjectFile
  isConverting: boolean
  activeTemplate: ProjectDetail['activeTemplate']
  livePageCount: number
  complianceIssues: Array<{ level: 'warning' | 'error'; message: string }>
  onClose: () => void
  onSave: (compileSettings: ProjectCompileSettings) => Promise<void>
  onConvert: (targetFormat: ProjectFormat) => Promise<void>
}) {
  const [draft, setDraft] = useState<ProjectCompileSettings>(compileSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [targetFormat, setTargetFormat] = useState<ProjectFormat>('typst')

  useEffect(() => {
    setDraft(compileSettings)
  }, [compileSettings])

  useEffect(() => {
    const next = inferProjectFormatFromFileName(activeFile.name)
    setTargetFormat(next ?? 'typst')
  }, [activeFile.name])

  const canEdit = role !== 'viewer'
  const sourceFormat = inferProjectFormatFromFileName(activeFile.name)
  const canConvert = canEdit && Boolean(sourceFormat)

  const updateDraft = <K extends keyof ProjectCompileSettings,>(key: K, value: ProjectCompileSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleSave = async () => {
    if (!canEdit) {
      onClose()
      return
    }

    setIsSaving(true)
    try {
      await onSave(draft)
      onClose()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Failed to save compile settings.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleConvert = async () => {
    if (!canConvert) {
      return
    }

    await onConvert(targetFormat)
  }

  return (
    <aside className={styles.themePanel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>Compile</p>
          <h2>Compile Settings</h2>
          <p className={styles.panelDescription}>Set project compile and export options.</p>
        </div>
        <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
          <XIcon size={16} aria-hidden />
        </button>
      </div>

      <section className={styles.themeSection}>
        <h3>Quick Export Target</h3>
        <label className={styles.themeField}>
          <span>Format</span>
          <select
            className={styles.themeSelect}
            value={draft.defaultExportFormat}
            onChange={(event) => updateDraft('defaultExportFormat', event.target.value as ExportFormat)}
            disabled={!canEdit || isSaving}
          >
            {EXPORT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className={styles.themeField}>
          <span>Destination</span>
          <select
            className={styles.themeSelect}
            value={draft.defaultExportDestination}
            onChange={(event) => updateDraft('defaultExportDestination', event.target.value as ExportDestination)}
            disabled={!canEdit || isSaving}
          >
            {EXPORT_DESTINATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.themeSection}>
        <h3>Page Limit</h3>
        <p className={styles.panelDescription}>
          {activeTemplate?.pageLimit
            ? `${activeTemplate.title} recommends a ${activeTemplate.pageLimit}-page limit.`
            : 'Set an optional project-wide page cap and compare it against the live preview page count.'}
        </p>
        <label className={styles.themeField}>
          <span>Configured page limit</span>
          <input
            className={styles.shortcutInput}
            type="number"
            min="1"
            max="10000"
            value={draft.pageLimit ?? ''}
            onChange={(event) => updateDraft('pageLimit', event.target.value ? Number(event.target.value) : null)}
            disabled={!canEdit || isSaving}
            placeholder={activeTemplate?.pageLimit ? String(activeTemplate.pageLimit) : 'No limit'}
          />
        </label>
        <p className={styles.panelDescription}>
          Current preview: {livePageCount || 0} page{livePageCount === 1 ? '' : 's'}
          {draft.pageLimit ? ` · ${Math.max(0, draft.pageLimit - livePageCount)} page${Math.max(0, draft.pageLimit - livePageCount) === 1 ? '' : 's'} remaining` : ''}
        </p>
      </section>

      <section className={styles.themeSection}>
        <h3>Style Compliance</h3>
        <p className={styles.panelDescription}>
          {activeTemplate
            ? `Checks are based on the ${activeTemplate.title} template profile and the currently loaded project text files.`
            : 'This project is not associated with a template profile yet.'}
        </p>
        <div className={styles.validationList}>
          {complianceIssues.length ? complianceIssues.map((issue, index) => (
            <div key={`${issue.message}-${index}`} className={styles.validationCard}>
              <div className={styles.validationHeaderRow}>
                <strong>{issue.message}</strong>
                <span className={issue.level === 'warning' ? styles.commentStatusOpen : styles.commentStatusDeleted}>{issue.level}</span>
              </div>
            </div>
          )) : <p className={styles.panelDescription}>No template compliance issues detected right now.</p>}
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Document Conversion</h3>
        <p className={styles.panelDescription}>
          {sourceFormat
            ? `Current file format: ${PROJECT_FORMAT_OPTIONS.find((option) => option.value === sourceFormat)?.label ?? sourceFormat}`
            : 'Current file format is not supported for conversion.'}
        </p>
        <label className={styles.themeField}>
          <span>Convert current file to</span>
          <select
            className={styles.themeSelect}
            value={targetFormat}
            onChange={(event) => setTargetFormat(event.target.value as ProjectFormat)}
            disabled={!canConvert || isConverting}
          >
            {PROJECT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          className={styles.panelIconBtn}
          onClick={() => void handleConvert()}
          disabled={!canConvert || isConverting || sourceFormat === targetFormat}
          title={isConverting ? 'Converting current file' : 'Convert current file'}
          aria-label={isConverting ? 'Converting current file' : 'Convert current file'}
        >
          {isConverting ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <FileOutput size={16} aria-hidden />}
        </button>
      </section>

      <div className={styles.panelIconActions}>
        <button className={styles.panelIconBtn} onClick={onClose} disabled={isSaving} title="Cancel" aria-label="Cancel">
          <XIcon size={16} aria-hidden />
        </button>
        <button className={styles.primaryIconBtn} onClick={handleSave} disabled={isSaving} title={isSaving ? 'Saving settings' : canEdit ? 'Save settings' : 'Close'} aria-label={isSaving ? 'Saving settings' : canEdit ? 'Save settings' : 'Close'}>
          {isSaving ? <Loader2 size={16} aria-hidden className={styles.spin} /> : canEdit ? <Save size={16} aria-hidden /> : <XIcon size={16} aria-hidden />}
        </button>
      </div>
    </aside>
  )
}

function NavigationPanel({
  filePath,
  cursorLocation,
  goToLineValue,
  goToColumnValue,
  onGoToLineValueChange,
  onGoToColumnValueChange,
  onSubmitGoToLine,
  outlineItems,
  minimapSegments,
  onSelectLine,
  onClose,
}: {
  filePath: string
  cursorLocation: { line: number; column: number }
  goToLineValue: string
  goToColumnValue: string
  onGoToLineValueChange: (value: string) => void
  onGoToColumnValueChange: (value: string) => void
  onSubmitGoToLine: (event?: React.FormEvent<HTMLFormElement>) => void
  outlineItems: OutlineItem[]
  minimapSegments: MinimapSegment[]
  onSelectLine: (line: number, column?: number) => void
  onClose: () => void
}) {
  const featureClassName = (kind: OutlineItem['kind']) => {
    switch (kind) {
      case 'section':
        return styles.featureSection
      case 'figure':
        return styles.featureFigure
      case 'table':
        return styles.featureTable
      case 'equation':
        return styles.featureEquation
      case 'bibliography':
        return styles.featureBibliography
      default:
        return styles.featureOther
    }
  }

  return (
    <aside className={styles.themePanel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>Navigate</p>
          <h2>Document Navigation</h2>
          <p className={styles.panelDescription}>Jump by line, browse the heading outline, and skim the current file structure.</p>
        </div>
        <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
          <XIcon size={16} aria-hidden />
        </button>
      </div>

      <section className={styles.themeSection}>
        <h3>Current Position</h3>
        <p className={styles.panelDescription}>{filePath}</p>
        <p className={styles.panelDescription}>Line {cursorLocation.line}, Column {cursorLocation.column}</p>
      </section>

      <section className={styles.themeSection}>
        <h3>Go To Line</h3>
        <form className={styles.goToForm} onSubmit={onSubmitGoToLine}>
          <input
            className={styles.themeSelect}
            inputMode="numeric"
            value={goToLineValue}
            onChange={(event) => onGoToLineValueChange(event.target.value)}
            placeholder="Line"
          />
          <input
            className={styles.themeSelect}
            inputMode="numeric"
            value={goToColumnValue}
            onChange={(event) => onGoToColumnValueChange(event.target.value)}
            placeholder="Column"
          />
          <button className={styles.primaryIconBtn} type="submit" title="Jump to line" aria-label="Jump to line">
            <SearchIcon size={16} aria-hidden />
          </button>
        </form>
      </section>

      <section className={styles.themeSection}>
        <h3>Symbol Outline</h3>
        {outlineItems.length === 0 ? (
          <p className={styles.panelDescription}>No structural markers found in the current file yet.</p>
        ) : (
          <div className={styles.outlineList}>
            {outlineItems.map((item) => (
              <button
                key={item.id}
                className={styles.outlineItem}
                style={{ paddingLeft: `${12 + (item.depth - 1) * 14}px` }}
                onClick={() => onSelectLine(item.line, 1)}
              >
                <span className={[styles.outlineFeatureDot, featureClassName(item.kind)].join(' ')} />
                <span className={styles.outlineTitle}>{item.title}</span>
                <span className={styles.outlineMeta}>L{item.line}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.themeSection}>
        <h3>Minimap</h3>
        <div className={styles.minimapPanel}>
          {minimapSegments.map((segment) => (
            <button
              key={segment.index}
              className={[
                styles.minimapSegment,
                segment.isActive ? styles.minimapSegmentActive : '',
                segment.featureKind ? featureClassName(segment.featureKind) : '',
              ].filter(Boolean).join(' ')}
              title={segment.featureLabel
                ? `${segment.featureLabel} · lines ${segment.startLine}-${segment.endLine}`
                : `Lines ${segment.startLine}-${segment.endLine}`}
              onClick={() => onSelectLine(segment.startLine, 1)}
            />
          ))}
        </div>
      </section>
    </aside>
  )
}

type SettingsTab = 'compile' | 'workspace'

function SettingsPanel({
  role,
  compileSettings,
  activeFile: _activeFile,
  isConverting: _isConverting,
  onSaveCompileSettings,
  onConvertFormat: _onConvertFormat,
  sidebarTabOrder,
  onMoveSidebarTab,
  onClose,
  inSidebar = false,
}: {
  role: ProjectRole
  compileSettings: ProjectCompileSettings
  activeFile: ProjectFile
  isConverting: boolean
  onSaveCompileSettings: (s: ProjectCompileSettings) => Promise<void>
  onConvertFormat: (fmt: ProjectFormat) => Promise<void>
  sidebarTabOrder: SidebarTabKey[]
  onMoveSidebarTab: (key: SidebarTabKey, direction: 'up' | 'down') => void
  onClose: () => void
  inSidebar?: boolean
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('compile')
  const [compileDraft, setCompileDraft] = useState<ProjectCompileSettings>(compileSettings)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => { setCompileDraft(compileSettings) }, [compileSettings])

  const canEdit = role !== 'viewer'

  const SETTINGS_TABS: Array<[SettingsTab, string]> = [
    ['compile', 'Compile'],
    ['workspace', 'Workspace'],
  ]

  const content = (
    <>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>Settings</p>
          <p>Workspace Settings</p>
        </div>
        {!inSidebar ? (
          <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
            <XIcon size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className={styles.settingsTabBar}>
        {SETTINGS_TABS.map(([key, label]) => (
          <button
            key={key}
            className={[styles.settingsTabBtn, activeTab === key ? styles.settingsTabBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'compile' ? (
        <>
          <section className={styles.themeSection}>
            <h3>Quick Export Target</h3>
            <label className={styles.themeField}>
              <span>Format</span>
              <select className={styles.themeSelect} value={compileDraft.defaultExportFormat} onChange={(e) => setCompileDraft((p) => ({ ...p, defaultExportFormat: e.target.value as ExportFormat }))} disabled={!canEdit}>
                <option value="pdf">PDF</option>
                <option value="docx">Word (.docx)</option>
                <option value="html">HTML</option>
              </select>
            </label>
            <label className={styles.themeField}>
              <span>Destination</span>
              <select className={styles.themeSelect} value={compileDraft.defaultExportDestination} onChange={(e) => setCompileDraft((p) => ({ ...p, defaultExportDestination: e.target.value as 'download' | 'drive' }))} disabled={!canEdit}>
                <option value="download">Download</option>
                <option value="drive">Google Drive</option>
              </select>
            </label>
            <label className={styles.themeField}>
              <span>Page limit</span>
              <input className={styles.shortcutInput} type="number" min="1" max="10000" value={compileDraft.pageLimit ?? ''} onChange={(e) => setCompileDraft((p) => ({ ...p, pageLimit: e.target.value ? Number(e.target.value) : null }))} disabled={!canEdit} placeholder="No limit" />
            </label>
          </section>
          {canEdit ? (
            <div className={styles.panelIconActions}>
              <button className={styles.primaryIconBtn} disabled={isSaving} onClick={async () => { setIsSaving(true); try { await onSaveCompileSettings(compileDraft) } finally { setIsSaving(false) } }} title={isSaving ? 'Saving compile settings' : 'Save compile settings'} aria-label={isSaving ? 'Saving compile settings' : 'Save compile settings'}>
                {isSaving ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <Save size={16} aria-hidden />}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === 'workspace' ? (
        <>
          <section className={styles.themeSection}>
            <h3>Sidebar Icon Order</h3>
            <p className={styles.panelDescription}>Reorder project menu icons for this project and your account.</p>
            <div className={styles.shortcutList}>
              {sidebarTabOrder.map((key, index) => (
                <div key={key} className={styles.shortcutRow}>
                  <div className={styles.shortcutMeta}>
                    <strong>{key.charAt(0).toUpperCase() + key.slice(1)}</strong>
                  </div>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button className={styles.panelIconBtn} onClick={() => onMoveSidebarTab(key, 'up')} disabled={index === 0} title={`Move ${key} up`} aria-label={`Move ${key} up`}>
                      <ChevronUp size={16} aria-hidden />
                    </button>
                    <button className={styles.panelIconBtn} onClick={() => onMoveSidebarTab(key, 'down')} disabled={index === sidebarTabOrder.length - 1} title={`Move ${key} down`} aria-label={`Move ${key} down`}>
                      <ChevronDown size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </>
  )

  if (inSidebar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {content}
      </div>
    )
  }

  return (
    <aside className={styles.themePanel}>
      {content}
    </aside>
  )
}

function RevisionHistoryPanel({
  role,
  activeFile,
  revisions,
  isLoading,
  error,
  isCreatingCheckpoint,
  restoringRevisionId,
  onRefresh,
  onCreateCheckpoint,
  onTagRevision,
  onRestoreRevision,
  currentSource,
  onClose,
  inSidebar = false,
}: {
  role: ProjectRole
  activeFile: ProjectFile
  revisions: ProjectRevision[]
  isLoading: boolean
  error: string | null
  isCreatingCheckpoint: boolean
  restoringRevisionId: string | null
  onRefresh: () => Promise<void>
  onCreateCheckpoint: (message?: string) => Promise<void>
  onTagRevision: (revisionId: string, tag: string) => Promise<void>
  onRestoreRevision: (revisionId: string) => Promise<void>
  currentSource: string
  onClose: () => void
  inSidebar?: boolean
}) {
  const canEdit = role !== 'viewer'
  const isTextFile = isEditableTextFile(activeFile)
  const [checkpointMsg, setCheckpointMsg] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [diffRevisionId, setDiffRevisionId] = useState<string | null>(null)
  const [compareLeftId, setCompareLeftId] = useState('')
  const [compareRightId, setCompareRightId] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const compareLeft = revisions.find((revision) => revision.id === compareLeftId)
  const compareRight = revisions.find((revision) => revision.id === compareRightId)
  const compareDiff = compareLeft && compareRight ? buildLineDiff(compareLeft.source, compareRight.source) : []

  const handleTag = async (revisionId: string) => {
    await onTagRevision(revisionId, tagDraft.trim())
    setEditingTagId(null)
    setTagDraft('')
  }

  const content = (
    <>
      {!isTextFile ? <p className={styles.panelDescription}>Revision history is only available for text files.</p> : null}
      {error ? <p className={styles.searchError}>{error}</p> : null}

      <section className={styles.themeSection}>
        <h3>New Checkpoint</h3>
        <p className={styles.panelDescription}>Save a snapshot of the current file state with an optional commit message.</p>
        <input
          className={styles.shortcutInput}
          style={{ marginBottom: 8 }}
          placeholder="Commit message (optional)"
          value={checkpointMsg}
          onChange={(e) => setCheckpointMsg(e.target.value)}
          disabled={!canEdit || !isTextFile}
          maxLength={120}
        />
        <div className={styles.panelIconActions}>
          <button
            className={styles.primaryIconBtn}
            onClick={() => { void onCreateCheckpoint(checkpointMsg); setCheckpointMsg('') }}
            disabled={!canEdit || !isTextFile || isCreatingCheckpoint}
            title={isCreatingCheckpoint ? 'Saving checkpoint' : 'Create checkpoint'}
            aria-label={isCreatingCheckpoint ? 'Saving checkpoint' : 'Create checkpoint'}
          >
            {isCreatingCheckpoint ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <Save size={16} aria-hidden />}
          </button>
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Compare Snapshots</h3>
        <div className={styles.inlineFieldRow}>
          <select className={styles.themeSelect} value={compareLeftId} onChange={(event) => setCompareLeftId(event.target.value)}>
            <option value="">Older snapshot</option>
            {revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.label}</option>)}
          </select>
          <select className={styles.themeSelect} value={compareRightId} onChange={(event) => setCompareRightId(event.target.value)}>
            <option value="">Newer snapshot</option>
            {revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.label}</option>)}
          </select>
        </div>
        {compareDiff.length ? (
          <div className={styles.revisionDiffBox}>
            {compareDiff.slice(0, 240).map((entry, index) => (
              <pre key={`${entry.kind}:${entry.lineNumber}:${index}`} className={[
                styles.revisionDiffLine,
                entry.kind === 'added' ? styles.revisionDiffAdded : entry.kind === 'removed' ? styles.revisionDiffRemoved : '',
              ].filter(Boolean).join(' ')}>
                {entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '-' : ' '} {entry.lineNumber ? `${entry.lineNumber}: ` : ''}{entry.text || ' '}
              </pre>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.themeSection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3>Timeline ({revisions.length})</h3>
          <button className={styles.panelIconBtn} onClick={() => void onRefresh()} disabled={isLoading} title={isLoading ? 'Loading revisions' : 'Refresh revisions'} aria-label={isLoading ? 'Loading revisions' : 'Refresh revisions'}>
            {isLoading ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <RefreshCw size={16} aria-hidden />}
          </button>
        </div>
        <div className={styles.commentList}>
          {revisions.map((revision) => {
            const isExpanded = expandedId === revision.id
            const isEditingTag = editingTagId === revision.id
            const isDiffOpen = diffRevisionId === revision.id
            const reasonLabel = labelForRevisionReason(revision.reason)
            const isRelease = revision.label.startsWith('🏷')
            const diffEntries = isDiffOpen ? buildLineDiff(revision.source, currentSource) : []
            return (
              <div
                key={revision.id}
                className={[styles.commentCard, isExpanded ? styles.commentCardActive : ''].filter(Boolean).join(' ')}
              >
                <div className={styles.commentCardHeader}>
                  <button
                    className={styles.sidebarHintButton}
                    style={{ textAlign: 'left', flex: 1 }}
                    onClick={() => setExpandedId((prev) => prev === revision.id ? null : revision.id)}
                  >
                    <strong style={{ color: isRelease ? 'var(--accent)' : undefined }}>
                      {revision.label}
                    </strong>
                  </button>
                  <span className={styles.commentMeta}>{formatCommentTimestamp(revision.createdAt)}</span>
                </div>
                <p className={styles.panelDescription} style={{ fontSize: 11 }}>
                  {reasonLabel} · {revision.actorName ?? 'System'}
                </p>

                {isExpanded ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {/* Tag / release editor */}
                    {canEdit ? (
                      isEditingTag ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            className={styles.shortcutInput}
                            style={{ flex: 1, fontSize: 12 }}
                            placeholder="Tag name (e.g. v1.0, submission)"
                            value={tagDraft}
                            onChange={(e) => setTagDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleTag(revision.id); if (e.key === 'Escape') { setEditingTagId(null); setTagDraft('') } }}
                            autoFocus
                            maxLength={80}
                          />
                          <button className={styles.primaryIconBtn} onClick={() => void handleTag(revision.id)} title="Save tag" aria-label="Save tag">
                            <Save size={16} aria-hidden />
                          </button>
                          <button className={styles.panelIconBtn} onClick={() => { setEditingTagId(null); setTagDraft('') }} title="Cancel tag edit" aria-label="Cancel tag edit">
                            <XIcon size={16} aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <button
                          className={styles.panelIconBtn}
                          onClick={() => { setEditingTagId(revision.id); setTagDraft(revision.label) }}
                          title="Edit tag or label"
                          aria-label="Edit tag or label"
                        >
                          <FileText size={16} aria-hidden />
                        </button>
                      )
                    ) : null}

                    {/* Diff preview — first 20 lines */}
                    <details>
                      <summary className={styles.panelDescription} style={{ cursor: 'pointer', userSelect: 'none' }}>Show snapshot preview</summary>
                      <pre style={{ fontSize: 10, fontFamily: 'var(--code-font)', color: 'var(--text-soft)', background: 'var(--editor-bg)', padding: '8px', borderRadius: 6, marginTop: 6, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {revision.source.split('\n').slice(0, 20).join('\n')}{revision.source.split('\n').length > 20 ? '\n…' : ''}
                      </pre>
                    </details>

                    <button
                      className={styles.panelIconBtn}
                      onClick={() => setDiffRevisionId((current) => current === revision.id ? null : revision.id)}
                      title={isDiffOpen ? 'Hide current diff' : 'Compare current draft'}
                      aria-label={isDiffOpen ? 'Hide current diff' : 'Compare current draft'}
                    >
                      <GitFork size={16} aria-hidden />
                    </button>

                    {isDiffOpen ? (
                      <div className={styles.revisionDiffBox}>
                        {diffEntries.slice(0, 240).map((entry, index) => (
                          <pre key={`${entry.kind}:${entry.lineNumber}:${index}`} className={[
                            styles.revisionDiffLine,
                            entry.kind === 'added' ? styles.revisionDiffAdded : entry.kind === 'removed' ? styles.revisionDiffRemoved : '',
                          ].filter(Boolean).join(' ')}>
                            {entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '-' : ' '} {entry.lineNumber ? `${entry.lineNumber}: ` : ''}{entry.text || ' '}
                          </pre>
                        ))}
                        {diffEntries.length > 240 ? <p className={styles.panelDescription}>Diff truncated after 240 lines.</p> : null}
                        {diffEntries.every((entry) => entry.kind === 'context') ? <p className={styles.panelDescription}>No line-level changes against the current draft.</p> : null}
                      </div>
                    ) : null}

                    {canEdit ? (
                      <button
                        className={styles.panelIconBtn}
                        onClick={() => void onRestoreRevision(revision.id)}
                        disabled={restoringRevisionId !== null}
                        title={restoringRevisionId === revision.id ? 'Restoring version' : 'Restore this version'}
                        aria-label={restoringRevisionId === revision.id ? 'Restoring version' : 'Restore this version'}
                      >
                        {restoringRevisionId === revision.id ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <HistoryIcon size={16} aria-hidden />}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {canEdit && !isExpanded ? (
                  <button
                    className={styles.panelIconBtn}
                    style={{ marginTop: 4 }}
                    onClick={() => void onRestoreRevision(revision.id)}
                    disabled={restoringRevisionId !== null}
                    title={restoringRevisionId === revision.id ? 'Restoring version' : 'Restore version'}
                    aria-label={restoringRevisionId === revision.id ? 'Restoring version' : 'Restore version'}
                  >
                    {restoringRevisionId === revision.id ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <HistoryIcon size={16} aria-hidden />}
                  </button>
                ) : null}
              </div>
            )
          })}
          {!isLoading && revisions.length === 0 ? <p className={styles.panelDescription}>No revisions yet.</p> : null}
        </div>
      </section>
    </>
  )

  if (inSidebar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {content}
      </div>
    )
  }

  return (
    <aside className={styles.themePanel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>History</p>
          <h2>Revision History</h2>
          <p className={styles.panelDescription}>Checkpoints, tags, and restore for {activeFile.name}.</p>
        </div>
        {!inSidebar ? (
          <div className={styles.panelActionCluster}>
            <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
              <XIcon size={16} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      {content}
    </aside>
  )
}

function CompileOutputPanel({
  isPdfAsset,
  isCompiling,
  compileNotice,
  compileError,
  compileLog,
  diagnostics,
  explanations,
  workspaceLabel,
  defaultFilePath,
  statuses,
  onDiagnosticClick,
  onAskAi,
  askingAiKey,
  aiLoading,
}: {
  isPdfAsset: boolean
  isCompiling: boolean
  compileNotice: string | null
  compileError: string | null
  compileLog: string | null
  diagnostics: CompileDiagnostic[]
  explanations: Array<{ diagnostic: CompileDiagnostic; explanation: string }>
  workspaceLabel: string
  defaultFilePath: string | null
  statuses: LanguageToolServerStatus[]
  onDiagnosticClick: (diagnostic: CompileDiagnostic) => void
  onAskAi: (diagnostic: CompileDiagnostic) => void
  askingAiKey: string | null
  aiLoading: boolean
}) {
  const logEntries = useMemo(() => parseCompileLogEntries(compileLog, defaultFilePath), [compileLog, defaultFilePath])
  const errorEntries = useMemo(() => parseCompileLogEntries(compileError, defaultFilePath), [compileError, defaultFilePath])
  const diagnosticsParentRef = useRef<HTMLDivElement>(null)
  const logParentRef = useRef<HTMLDivElement>(null)
  const diagnosticsVirtualizer = useVirtualizer({
    count: diagnostics.length,
    getScrollElement: () => diagnosticsParentRef.current,
    estimateSize: () => 74,
    overscan: 6,
  })
  const logVirtualizer = useVirtualizer({
    count: logEntries.length,
    getScrollElement: () => logParentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  })

  return (
    <div className={styles.compileOutputPanel}>
      <div className={styles.compileOutputHeader}>
        <p className={styles.sidebarLabel}>Compiler Output</p>
        <span className={styles.compileOutputMeta}>
          {isCompiling ? 'Compiling…' : diagnostics.length > 0 ? `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}` : compileError ? 'Compile failed' : isPdfAsset ? 'No compiler for asset preview' : 'No issues'}
        </span>
      </div>

      {compileNotice ? (
        <div className={styles.compileOutputNotice}>{compileNotice}</div>
      ) : null}

      {statuses.length > 0 ? (
        <div className={styles.compileOutputNotice}>
          <div className={styles.compileOutputStatusList}>
            {statuses.map((status) => (
              <div key={status.name} className={styles.compileOutputStatusItem}>
                <strong>{status.name}</strong>
                <span>{describeLanguageServerStatus(status)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {explanations.length > 0 ? (
        <div className={styles.compileExplanationList}>
          {explanations.map(({ diagnostic, explanation }, index) => (
            <div key={`${diagnostic.message}-${diagnostic.filePath ?? 'global'}-${index}`} className={styles.compileExplanationCard}>
              <strong>{diagnostic.level === 'warning' ? 'Plain-English warning' : 'Plain-English error'}</strong>
              <p>{explanation}</p>
            </div>
          ))}
        </div>
      ) : null}

      {diagnostics.length > 0 ? (
        <div ref={diagnosticsParentRef} className={styles.compileOutputList}>
          <div style={{ height: diagnosticsVirtualizer.getTotalSize(), position: 'relative' }}>
            {diagnosticsVirtualizer.getVirtualItems().map((virtualItem) => {
              const diagnostic = diagnostics[virtualItem.index]
              return (
                <div
                  key={`${diagnostic.message}-${diagnostic.filePath ?? 'global'}-${diagnostic.line ?? 0}-${virtualItem.index}`}
                  ref={diagnosticsVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${virtualItem.start}px)` }}
                >
                  <div className={styles.compileOutputItem}>
                    <button
                      type="button"
                      className={styles.compileOutputItemBody}
                      onClick={() => onDiagnosticClick(diagnostic)}
                    >
                      <div className={styles.compileOutputItemHeader}>
                        <strong>{diagnostic.level.toUpperCase()}</strong>
                        <span>{diagnostic.filePath ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''}` : workspaceLabel}</span>
                      </div>
                      <p>{diagnostic.message}</p>
                    </button>
                    {(() => {
                      const key = `${diagnostic.filePath ?? 'global'}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}:${diagnostic.message}`
                      const busy = aiLoading && askingAiKey === key
                      return (
                        <button
                          type="button"
                          className={styles.compileOutputItemAi}
                          onClick={(e) => { e.stopPropagation(); onAskAi(diagnostic) }}
                          disabled={aiLoading}
                          title={busy ? 'Asking AI…' : 'Ask AI to suggest a fix'}
                          aria-label="Ask AI to suggest a fix"
                        >
                          <Sparkles size={14} />
                          <span>{busy ? 'Asking…' : 'Ask AI'}</span>
                        </button>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {compileError ? (
        <div className={styles.compileOutputError}>
          {errorEntries.length > 0 ? errorEntries.map((entry, index) => entry.diagnostic ? (
            <button
              key={`${entry.text}-${index}`}
              type="button"
              className={styles.compileOutputErrorLineLink}
              onClick={() => {
                if (entry.diagnostic) {
                  onDiagnosticClick(entry.diagnostic)
                }
              }}
            >
              {entry.text}
            </button>
          ) : (
            <div key={`${entry.text}-${index}`} className={styles.compileOutputErrorLine}>
              {entry.text}
            </div>
          )) : compileError}
        </div>
      ) : null}

      {logEntries.length > 0 ? (
        <details className={styles.compileOutputLogSection}>
          <summary className={styles.compileOutputLogHeader}>
            <strong>Show full compiler log</strong>
            <span>{logEntries.length} line{logEntries.length === 1 ? '' : 's'}</span>
          </summary>
          <div ref={logParentRef} className={styles.compileOutputLog}>
            <div style={{ height: logVirtualizer.getTotalSize(), position: 'relative' }}>
              {logVirtualizer.getVirtualItems().map((virtualItem) => {
                const entry = logEntries[virtualItem.index]
                return (
                  <div
                    key={`${entry.text}-${virtualItem.index}`}
                    ref={logVirtualizer.measureElement}
                    data-index={virtualItem.index}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${virtualItem.start}px)` }}
                  >
                    {entry.diagnostic ? (
                      <button
                        className={styles.compileOutputLogLineLink}
                        onClick={() => {
                          if (entry.diagnostic) {
                            onDiagnosticClick(entry.diagnostic)
                          }
                        }}
                      >
                        {entry.text}
                      </button>
                    ) : (
                      <div className={styles.compileOutputLogLine}>
                        {entry.text}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </details>
      ) : null}

      {!compileError && diagnostics.length === 0 && !compileNotice && logEntries.length === 0 ? (
        <div className={styles.compileOutputEmpty}>
          {isPdfAsset
            ? 'This file is a PDF asset preview, so there is no compile output for it.'
            : 'Compile messages and diagnostics will appear here.'}
        </div>
      ) : null}
    </div>
  )
}

function parseCompileLogEntries(rawLog: string | null, defaultFilePath: string | null): Array<{ text: string; diagnostic: CompileDiagnostic | null }> {
  if (!rawLog) {
    return []
  }

  const lines = rawLog.split(/\r?\n/)
  const entries: Array<{ text: string; diagnostic: CompileDiagnostic | null }> = []
  let pendingTexDiagnosticIndex: number | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    if (!line.trim()) {
      continue
    }
    if (isBusytexWrapperLogLine(line)) {
      continue
    }

    const diagnostic = diagnosticFromCompileLogLine(line, defaultFilePath)
    const entry = { text: line, diagnostic }
    entries.push(entry)
    const entryIndex = entries.length - 1

    if (diagnostic) {
      if (pendingTexDiagnosticIndex !== null && !entries[pendingTexDiagnosticIndex].diagnostic) {
        entries[pendingTexDiagnosticIndex].diagnostic = {
          ...diagnostic,
          message: entries[pendingTexDiagnosticIndex].text.trim(),
          raw: `${entries[pendingTexDiagnosticIndex].text}\n${line}`,
        }
      }
      pendingTexDiagnosticIndex = null
      continue
    }

    if (isTexErrorLogLine(line) || isTexWarningLogLine(line)) {
      pendingTexDiagnosticIndex = entryIndex
    }
  }

  return entries
}

function isBusytexWrapperLogLine(line: string): boolean {
  const normalized = line.trim()
  return /(?:^|\s)\/bin\/busytex\s+(?:stdout|stderr):/i.test(normalized)
    || /^dependency:\s+datafile_build\/wasm\/texlive-(?:basic|recommended|extra)\.data$/i.test(normalized)
    || /\bstill waiting on run dependencies\b/i.test(normalized)
    || /\bDownloading data\.\.\./i.test(normalized)
    || /\(end of list\)$/.test(normalized)
}

function mergeDiagnostics(primary: CompileDiagnostic[], secondary: CompileDiagnostic[]): CompileDiagnostic[] {
  const seen = new Set<string>()
  const merged: CompileDiagnostic[] = []
  for (const diagnostic of [...primary, ...secondary]) {
    const key = [
      diagnostic.level,
      diagnostic.message,
      diagnostic.filePath ?? '',
      diagnostic.line ?? '',
      diagnostic.column ?? '',
    ].join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(diagnostic)
  }
  return merged
}

function describeLanguageServerStatus(status: LanguageToolServerStatus | null | undefined): string {
  if (!status) {
    return 'Status unavailable.'
  }

  if (status.running) {
    return status.detail?.trim() || 'Connected.'
  }

  if (status.detail?.trim()) {
    return status.detail.trim()
  }

  return status.available ? 'Installed, but not currently connected.' : 'Unavailable.'
}

function diagnosticFromCompileLogLine(line: string, defaultFilePath: string | null): CompileDiagnostic | null {
  const normalized = line.trim()
  const fileLineMatch = normalized.match(/([./A-Za-z0-9_-][^:\s]*\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/)
  if (fileLineMatch) {
    return {
      level: /^warning[:\s]/i.test(normalized) ? 'warning' : 'error',
      message: normalized,
      filePath: normalizeCompileLogPath(fileLineMatch[1]),
      line: Number(fileLineMatch[2]),
      column: fileLineMatch[3] ? Number(fileLineMatch[3]) : 1,
      raw: normalized,
    }
  }

  const texLineMatch = normalized.match(/\bl\.(\d+)\b/)
  if (texLineMatch && defaultFilePath) {
    return {
      level: /^warning[:\s]/i.test(normalized) ? 'warning' : 'error',
      message: normalized,
      filePath: defaultFilePath,
      line: Number(texLineMatch[1]),
      column: 1,
      raw: normalized,
    }
  }

  return null
}

function isTexErrorLogLine(line: string): boolean {
  const normalized = line.trim()
  return normalized.startsWith('!')
    || /^error[:\s]/i.test(normalized)
    || /\b(fatal error|emergency stop|undefined control sequence|missing \$ inserted|runaway argument)\b/i.test(normalized)
}

function isTexWarningLogLine(line: string): boolean {
  return /\b(?:LaTeX|Package|Class|pdfTeX|LuaTeX|XeTeX)\s+Warning\b/i.test(line)
}

function normalizeCompileLogPath(path: string): string {
  return path.replace(/^\.\//, '')
}

function CommentsPanel({
  canComment,
  canCreatePdfNotes,
  canManageComments,
  currentUserId,
  members,
  onAssignComment,
  comments,
  suggestions,
  commentDraft,
  commentDraftAssigneeUserId,
  suggestionDraft,
  replyDrafts,
  commentSelection,
  commentsError,
  isLoadingComments,
  suggestionsError,
  isLoadingSuggestions,
  highlightedCommentId,
  trackChangesEnabled,
  onCommentDraftChange,
  onCommentDraftAssigneeChange,
  onSuggestionDraftChange,
  onTrackChangesEnabledChange,
  onReplyDraftChange,
  onCreateComment,
  onCreateSuggestion,
  onSuggestionDecision,
  onCreateReply,
  onDeleteComment,
  onToggleResolved,
  onClose,
  onCommentClick,
  inSidebar = false,
}: {
  canComment: boolean
  canCreatePdfNotes: boolean
  canManageComments: boolean
  currentUserId: string
  comments: ProjectComment[]
  suggestions: ProjectReviewSuggestion[]
  commentDraft: string
  commentDraftAssigneeUserId: string | null
  onCommentDraftAssigneeChange: (userId: string | null) => void
  suggestionDraft: string
  replyDrafts: Record<string, string>
  commentSelection: CommentSelectionAnchor | null
  commentsError: string | null
  isLoadingComments: boolean
  suggestionsError: string | null
  isLoadingSuggestions: boolean
  highlightedCommentId: string | null
  trackChangesEnabled: boolean
  onCommentDraftChange: (value: string) => void
  onSuggestionDraftChange: (value: string) => void
  onTrackChangesEnabledChange: (enabled: boolean) => void
  onReplyDraftChange: (commentId: string, value: string) => void
  onCreateComment: () => void
  onCreateSuggestion: () => void
  onSuggestionDecision: (suggestionId: string, action: 'accept' | 'reject') => void
  onCreateReply: (commentId: string) => void
  onDeleteComment: (comment: ProjectComment) => void
  onToggleResolved: (comment: ProjectComment, resolved: boolean) => void
  onAssignComment: (comment: ProjectComment, assigneeUserId: string | null) => void
  onClose: () => void
  onCommentClick: (comment: ProjectComment) => void
  members: ProjectMember[]
  inSidebar?: boolean
}) {
  const commentsParentRef = useRef<HTMLDivElement>(null)
  const commentsVirtualizer = useVirtualizer({
    count: comments.length,
    getScrollElement: () => commentsParentRef.current,
    estimateSize: () => 180,
    overscan: 5,
  })

  return (
    <aside className={styles.themePanel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>Review & Comments</p>
          <p className={styles.panelDescription}></p>
        </div>
        {!inSidebar ? (
          <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
            <XIcon size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <section className={styles.themeSection}>
        <h3>New Comment</h3>
        <p className={styles.panelDescription}>
          {canComment
            ? commentSelection
              ? `Selected ${formatCommentRange(commentSelection.startLine, commentSelection.startColumn, commentSelection.endLine, commentSelection.endColumn)}.`
              : 'Select a non-empty range in the editor to anchor a comment.'
            : canCreatePdfNotes
              ? 'PDF preview note mode is available. Draw on the preview, then save the handwritten note into this thread list.'
              : 'Comments are only available on text files or PDF previews.'}
        </p>
        {commentSelection ? (
          <div className={styles.commentSelectionPreview}>{commentSelection.excerpt}</div>
        ) : null}
        <textarea
          className={styles.commentInput}
          rows={4}
          value={commentDraft}
          onChange={(event) => onCommentDraftChange(event.target.value)}
          placeholder={canComment ? 'Add context, suggested change, or review feedback…' : 'Open a text file to comment.'}
          disabled={!canComment}
          maxLength={5000}
        />
        {canComment && members.length > 1 ? (
          <div className={styles.commentAssignRow}>
            <label className={styles.commentAssignLabel}>Assign to</label>
            <select
              className={styles.commentAssignSelect}
              value={commentDraftAssigneeUserId ?? ''}
              onChange={(e) => onCommentDraftAssigneeChange(e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name || m.email}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={styles.panelIconActions}>
          <button
            className={styles.primaryIconBtn}
            onClick={onCreateComment}
            disabled={!canComment || !commentSelection || !commentDraft.trim()}
            title="Add comment"
            aria-label="Add comment"
          >
            <CommentsIcon size={16} aria-hidden />
          </button>
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Suggested Change</h3>
        <p className={styles.panelDescription}>Use tracked suggestions for change proposals that reviewers can accept or reject later.</p>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={trackChangesEnabled}
            onChange={(event) => onTrackChangesEnabledChange(event.target.checked)}
            disabled={!canComment}
          />
          <span>Track changes while typing</span>
        </label>
        <textarea
          className={styles.commentInput}
          rows={3}
          value={suggestionDraft}
          onChange={(event) => onSuggestionDraftChange(event.target.value)}
          placeholder={canComment ? 'Replacement text. Leave empty to suggest deleting the selected range.' : 'Open a text file to suggest a change.'}
          disabled={!canComment}
          maxLength={50000}
        />
        <div className={styles.panelIconActions}>
          <button
            className={styles.panelIconBtn}
            onClick={onCreateSuggestion}
            disabled={!canComment || !commentSelection}
            title="Add suggested change"
            aria-label="Add suggested change"
          >
            <FileOutput size={16} aria-hidden />
          </button>
        </div>
        {suggestionsError ? <p className={styles.searchError}>{suggestionsError}</p> : null}
        {isLoadingSuggestions ? <p className={styles.panelDescription}>Loading suggested changes…</p> : null}
        <div className={styles.commentList}>
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className={styles.commentCard}>
              <div className={styles.commentCardHeader}>
                <div className={styles.commentAuthorBlock}>
                  <strong>{suggestion.authorName}</strong>
                  <span className={styles.commentMeta}>{formatCommentTimestamp(suggestion.createdAt)}</span>
                </div>
                <span className={commentStatusClassName(suggestion.status === 'open' ? 'open' : suggestion.status === 'accepted' ? 'resolved' : 'deleted')}>
                  {suggestion.status}
                </span>
              </div>
              <span className={styles.commentRange}>{formatCommentRange(suggestion.startLine, suggestion.startColumn, suggestion.endLine, suggestion.endColumn)}</span>
              <div className={styles.commentExcerpt}>{suggestion.excerpt || '(insertion point)'}</div>
              <p className={styles.commentBody}>{suggestion.replacementText || '(delete selection)'}</p>
              {suggestion.status === 'open' ? (
                <div className={styles.commentActionButtons}>
                  <button className={styles.primaryIconBtn} onClick={() => onSuggestionDecision(suggestion.id, 'accept')} title="Accept suggestion" aria-label="Accept suggestion">
                    <CheckIcon size={16} aria-hidden />
                  </button>
                  <button className={styles.panelIconBtn} onClick={() => onSuggestionDecision(suggestion.id, 'reject')} title="Reject suggestion" aria-label="Reject suggestion">
                    <XIcon size={16} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {!isLoadingSuggestions && suggestions.length === 0 ? <p className={styles.panelDescription}>No suggested changes on this file yet.</p> : null}
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Anchored Threads</h3>
        {commentsError ? <p className={styles.searchError}>{commentsError}</p> : null}
        {isLoadingComments ? <p className={styles.panelDescription}>Loading comments…</p> : null}
        {!isLoadingComments && comments.length === 0 ? (
          <p className={styles.panelDescription}>No comments on this file yet.</p>
        ) : null}

        <div ref={commentsParentRef} className={styles.commentList}>
          <div style={{ height: commentsVirtualizer.getTotalSize(), position: 'relative' }}>
            {commentsVirtualizer.getVirtualItems().map((virtualItem) => {
              const comment = comments[virtualItem.index]
              return (
                <div
                  key={comment.id}
                  ref={commentsVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${virtualItem.start}px)` }}
                >
                  <button
                    className={[styles.commentCard, highlightedCommentId === comment.id ? styles.commentCardActive : ''].filter(Boolean).join(' ')}
                    onClick={() => onCommentClick(comment)}
                  >
                    <div className={styles.commentCardHeader}>
                      <div className={styles.commentAuthorBlock}>
                        <strong>{comment.authorName}</strong>
                        <span className={styles.commentMeta}>{formatCommentTimestamp(comment.createdAt)}</span>
                      </div>
                      <span className={commentStatusClassName(comment.status)}>
                        {commentStatusLabel(comment.status)}
                      </span>
                    </div>
                    <span className={styles.commentRange}>{formatCommentAnchor(comment)}</span>
                    <div className={styles.commentExcerpt}>{comment.excerpt}</div>
                    <p className={styles.commentBody}>{comment.content}</p>
                    {comment.status === 'resolved' && comment.resolvedAt ? (
                      <p className={styles.commentResolutionMeta}>
                        Resolved by {comment.resolvedByName ?? 'a collaborator'} on {formatCommentTimestamp(comment.resolvedAt)}
                      </p>
                    ) : null}
                    {comment.status === 'deleted' ? (
                      <p className={styles.commentDeletedMeta}>The anchored text is no longer present in the document.</p>
                    ) : null}

                    {comment.replies.length > 0 ? (
                      <div className={styles.replyList}>
                        {comment.replies.map((reply) => (
                          <div key={reply.id} className={styles.replyCard}>
                            <div className={styles.replyHeader}>
                              <strong>{reply.authorName}</strong>
                              <span className={styles.commentMeta}>{formatCommentTimestamp(reply.createdAt)}</span>
                            </div>
                            <p className={styles.replyBody}>{reply.content}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className={styles.commentActionRow} onClick={(event) => event.stopPropagation()}>
                      {comment.status !== 'deleted' && canManageComments ? (
                        <div className={styles.commentAssignRow}>
                          <label className={styles.commentAssignLabel}>Assign to</label>
                          <select
                            className={styles.commentAssignSelect}
                            value={comment.assigneeUserId ?? ''}
                            onChange={(event) => onAssignComment(comment, event.target.value || null)}
                          >
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
                            ))}
                          </select>
                        </div>
                      ) : comment.assigneeUserId ? (
                        <p className={styles.commentAssignedTo}>Assigned to {comment.assigneeName ?? comment.assigneeEmail}</p>
                      ) : null}
                      {comment.status !== 'deleted' ? (
                        <textarea
                          className={styles.replyInput}
                          rows={2}
                          value={replyDrafts[comment.id] ?? ''}
                          onChange={(event) => onReplyDraftChange(comment.id, event.target.value)}
                          placeholder="Reply to this thread…"
                        />
                      ) : null}
                      <div className={styles.commentActionButtons}>
                        {comment.status !== 'deleted' ? (
                          <button
                            className={styles.panelIconBtn}
                            onClick={() => onCreateReply(comment.id)}
                            disabled={!replyDrafts[comment.id]?.trim()}
                            title="Reply"
                            aria-label="Reply"
                          >
                            <CommentsIcon size={16} aria-hidden />
                          </button>
                        ) : null}
                        {comment.status !== 'deleted' ? (
                          <button
                            className={comment.status === 'resolved' ? styles.panelIconBtn : styles.primaryIconBtn}
                            onClick={() => onToggleResolved(comment, comment.status !== 'resolved')}
                            title={comment.status === 'resolved' ? 'Reopen thread' : 'Resolve thread'}
                            aria-label={comment.status === 'resolved' ? 'Reopen thread' : 'Resolve thread'}
                          >
                            {comment.status === 'resolved' ? <RefreshCw size={16} aria-hidden /> : <CheckIcon size={16} aria-hidden />}
                          </button>
                        ) : null}
                        {(canManageComments || comment.authorUserId === currentUserId) ? (
                          <button
                            className={styles.dangerIconBtn}
                            onClick={() => onDeleteComment(comment)}
                            title="Delete thread"
                            aria-label="Delete thread"
                          >
                            <TrashIcon size={16} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </aside>
  )
}

function NoteThreadDialog({
  comment,
  replyDraft,
  currentUserId,
  canManageComments,
  onReplyDraftChange,
  onCreateReply,
  onToggleResolved,
  onDeleteComment,
  onClose,
}: {
  comment: ProjectComment
  replyDraft: string
  currentUserId: string
  canManageComments: boolean
  onReplyDraftChange: (commentId: string, value: string) => void
  onCreateReply: (commentId: string) => void
  onToggleResolved: (comment: ProjectComment, resolved: boolean) => void
  onDeleteComment: (comment: ProjectComment) => void
  onClose: () => void
}) {
  return (
    <div className={styles.noteDialogBackdrop} onClick={onClose}>
      <aside className={styles.noteDialog} onClick={(event) => event.stopPropagation()}>
        <div className={styles.noteDialogHeader}>
          <div>
            <p className={styles.sidebarLabel}>Review Note</p>
            <h2>Thread</h2>
            <p className={styles.panelDescription}>Review the anchored note, continue the thread, or resolve it without leaving the editor.</p>
          </div>
          <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
            <XIcon size={16} aria-hidden />
          </button>
        </div>

        <section className={styles.noteDialogSection}>
          <div className={styles.commentCard}>
            <div className={styles.commentCardHeader}>
              <div className={styles.commentAuthorBlock}>
                <strong>{comment.authorName}</strong>
                <span className={styles.commentMeta}>{formatCommentTimestamp(comment.createdAt)}</span>
              </div>
              <span className={commentStatusClassName(comment.status)}>
                {commentStatusLabel(comment.status)}
              </span>
            </div>
            <span className={styles.commentRange}>{formatCommentAnchor(comment)}</span>
            <div className={styles.commentExcerpt}>{comment.excerpt}</div>
            <p className={styles.commentBody}>{comment.content}</p>
            {comment.status === 'resolved' && comment.resolvedAt ? (
              <p className={styles.commentResolutionMeta}>
                Resolved by {comment.resolvedByName ?? 'a collaborator'} on {formatCommentTimestamp(comment.resolvedAt)}
              </p>
            ) : null}
            {comment.status === 'deleted' ? (
              <p className={styles.commentDeletedMeta}>The anchored text is no longer present in the document.</p>
            ) : null}
          </div>
        </section>

        <section className={styles.noteDialogSection}>
          <div className={styles.noteDialogSectionHeader}>
            <h3>Replies</h3>
            <span className={styles.commentMeta}>{comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}</span>
          </div>
          {comment.replies.length > 0 ? (
            <div className={styles.replyList}>
              {comment.replies.map((reply) => (
                <div key={reply.id} className={styles.replyCard}>
                  <div className={styles.replyHeader}>
                    <strong>{reply.authorName}</strong>
                    <span className={styles.commentMeta}>{formatCommentTimestamp(reply.createdAt)}</span>
                  </div>
                  <p className={styles.replyBody}>{reply.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.panelDescription}>No replies yet.</p>
          )}
        </section>

        <section className={styles.noteDialogSection}>
          <div className={styles.noteDialogSectionHeader}>
            <h3>Reply</h3>
            <span className={styles.commentMeta}>Continue the thread inline.</span>
          </div>
          {comment.status !== 'deleted' ? (
            <textarea
              className={styles.replyInput}
              rows={3}
              value={replyDraft}
              onChange={(event) => onReplyDraftChange(comment.id, event.target.value)}
              placeholder="Reply to this thread…"
            />
          ) : (
            <p className={styles.panelDescription}>Deleted notes can still be reviewed, but they cannot receive new replies.</p>
          )}
          <div className={styles.noteDialogActions}>
            {comment.status !== 'deleted' ? (
              <button
                className={styles.panelIconBtn}
                onClick={() => onCreateReply(comment.id)}
                disabled={!replyDraft.trim()}
                title="Reply"
                aria-label="Reply"
              >
                <CommentsIcon size={16} aria-hidden />
              </button>
            ) : null}
            {comment.status !== 'deleted' ? (
              <button
                className={comment.status === 'resolved' ? styles.panelIconBtn : styles.primaryIconBtn}
                onClick={() => onToggleResolved(comment, comment.status !== 'resolved')}
                title={comment.status === 'resolved' ? 'Reopen thread' : 'Resolve thread'}
                aria-label={comment.status === 'resolved' ? 'Reopen thread' : 'Resolve thread'}
              >
                {comment.status === 'resolved' ? <RefreshCw size={16} aria-hidden /> : <CheckIcon size={16} aria-hidden />}
              </button>
            ) : null}
            {(canManageComments || comment.authorUserId === currentUserId) ? (
              <button
                className={styles.dangerIconBtn}
                onClick={() => onDeleteComment(comment)}
                title="Delete thread"
                aria-label="Delete thread"
              >
                <TrashIcon size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  )
}

function NomenclaturePanel({
  entries,
  isIndexing,
  canEdit,
  onJump,
  onSave,
  onDefinitionUpdate,
}: {
  entries: NomenclatureEntry[]
  isIndexing: boolean
  canEdit: boolean
  onJump: (entry: NomenclatureEntry) => void
  onSave: (entries: NomenclatureEntry[]) => Promise<void>
  onDefinitionUpdate: (entry: NomenclatureEntry, definition: string) => Promise<boolean>
}) {
  const [activeTab, setActiveTab] = useState<'symbol' | 'abbreviation'>('symbol')
  const [definitions, setDefinitions] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setDefinitions((current) => {
      const next = { ...current }
      for (const entry of entries) {
        if (next[entry.id] === undefined) {
          next[entry.id] = entry.definition
        }
      }
      return next
    })
  }, [entries])

  const symbols = entries.filter((entry) => entry.kind === 'symbol')
  const abbreviations = entries.filter((entry) => entry.kind === 'abbreviation')
  const activeEntries = activeTab === 'symbol' ? symbols : abbreviations
  const hydratedEntries = entries.map((entry) => ({
    ...entry,
    definition: definitions[entry.id] ?? entry.definition,
    source: definitions[entry.id] && definitions[entry.id] !== entry.definition ? 'edited' as const : entry.source,
  }))

  const handleSave = async () => {
    setIsSaving(true)
    setStatus('')
    try {
      await onSave(hydratedEntries)
      setStatus('Saved nomenclature.typ and abbreviations.typ.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save nomenclature files.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDefinitionCommit = async (entry: NomenclatureEntry) => {
    const nextDefinition = (definitions[entry.id] ?? entry.definition).trim()
    if (!canEdit || !nextDefinition || nextDefinition === entry.definition) return
    setStatus('')
    try {
      const didReviseSource = await onDefinitionUpdate(entry, nextDefinition)
      setStatus(didReviseSource ? `Updated ${entry.term} in the source document.` : `Updated ${entry.term}; no source phrase was safe to rewrite.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Failed to update ${entry.term}.`)
    }
  }

  return (
    <div className={styles.nomenclaturePanel}>
      <div className={styles.sidebarHeaderRow}>
        <div>
          <p className={styles.sidebarLabel}>Nomenclature</p>
          <p className={styles.sidebarHint}>Auto-scanned from project text.</p>
        </div>
        <button
          className={styles.panelIconBtn}
          onClick={() => void handleSave()}
          disabled={!canEdit || isSaving || entries.length === 0}
          title={isSaving ? 'Saving nomenclature files' : 'Save generated files'}
          aria-label={isSaving ? 'Saving nomenclature files' : 'Save generated files'}
        >
          {isSaving ? <Loader2 size={16} className={styles.spin} aria-hidden /> : <Save size={16} aria-hidden />}
        </button>
      </div>

      <div className={styles.nomenclatureTabs} role="tablist" aria-label="Nomenclature views">
        <button
          type="button"
          className={activeTab === 'symbol' ? styles.nomenclatureTabActive : styles.nomenclatureTab}
          onClick={() => setActiveTab('symbol')}
        >
          Symbols <span>{symbols.length}</span>
        </button>
        <button
          type="button"
          className={activeTab === 'abbreviation' ? styles.nomenclatureTabActive : styles.nomenclatureTab}
          onClick={() => setActiveTab('abbreviation')}
        >
          Abbreviations <span>{abbreviations.length}</span>
        </button>
      </div>

      {isIndexing ? <p className={styles.panelDescription}>Scanning project files…</p> : null}
      {status ? <p className={styles.panelDescription}>{status}</p> : null}

      <div className={styles.nomenclatureList} role="list">
        {activeEntries.length === 0 ? (
          <p className={styles.panelDescription}>
            {activeTab === 'symbol'
              ? 'No symbols detected yet. Use inline math, displayed equations, or “where x is …” style definitions.'
              : 'No abbreviations detected yet. Use “Full Term (ABC)” patterns to seed this list.'}
          </p>
        ) : null}
        {activeEntries.map((entry) => (
          <article key={entry.id} className={styles.nomenclatureRow} role="listitem">
            <button type="button" className={styles.nomenclatureTermButton} onClick={() => onJump(entry)}>
                <strong>{entry.term}</strong>
                <span>{entry.filePath}:{entry.line} · {entry.count} use{entry.count === 1 ? '' : 's'}</span>
            </button>
            <input
                className={styles.nomenclatureDefinitionInput}
                value={definitions[entry.id] ?? entry.definition}
                onChange={(event) => setDefinitions((current) => ({ ...current, [entry.id]: event.target.value }))}
                onBlur={() => void handleDefinitionCommit(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
                placeholder={entry.kind === 'symbol' ? 'Describe the symbol.' : 'Expand or describe the abbreviation.'}
                disabled={!canEdit}
              />
          </article>
        ))}
      </div>
    </div>
  )
}

function ProjectSearchPanel({
  query,
  onQueryChange,
  onClose,
  isLoading,
  error,
  results,
  onSelectResult,
  inSidebar = false,
}: {
  query: string
  onQueryChange: (value: string) => void
  onClose: () => void
  isLoading: boolean
  error: string | null
  results: ProjectSearchResult[]
  onSelectResult: (result: ProjectSearchResult) => void
  inSidebar?: boolean
}) {
  const content = (
    <>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>Project Search</p>
          <p className={styles.panelDescription}></p>
        </div>
        {!inSidebar ? (
          <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
            <XIcon size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <section className={styles.themeSection}>
        <input
          className={styles.themeSelect}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search project text"
        />
      </section>

      {isLoading ? <p className={styles.panelDescription}>Indexing project files…</p> : null}
      {error ? <p className={styles.searchError}>{error}</p> : null}

      {!query.trim() ? (
        <p className={styles.panelDescription}>Type a query to search the current project.</p>
      ) : null}

      {query.trim() && !isLoading && !error && results.length === 0 ? (
        <p className={styles.panelDescription}>No matches found.</p>
      ) : null}

      {results.length > 0 ? (
        <div className={styles.searchResults}>
          {results.map((result, index) => (
            <button
              key={`${result.fileId}-${result.lineNumber}-${result.column}-${index}`}
              className={styles.searchResultItem}
              onClick={() => onSelectResult(result)}
            >
              <strong>{result.filePath}</strong>
              <span className={styles.searchResultMeta}>Line {result.lineNumber}, Column {result.column}</span>
              <code className={styles.searchResultLine}>{result.lineText.trim() || '(blank line)'}</code>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )

  if (inSidebar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {content}
      </div>
    )
  }

  return (
    <aside className={styles.themePanel}>
      {content}
    </aside>
  )
}

const ACTIVITY_DEFAULT_LIMIT = 5

function ActivitySection({
  activityEvents,
  activityError,
  isLoadingActivity,
}: {
  activityEvents: ProjectActivityEvent[]
  activityError: string | null
  isLoadingActivity: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? activityEvents : activityEvents.slice(0, ACTIVITY_DEFAULT_LIMIT)
  const hasMore = activityEvents.length > ACTIVITY_DEFAULT_LIMIT

  return (
    <section className={styles.themeSection}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3>Project Activity</h3>
        {hasMore ? (
          <button
            className={styles.panelIconBtn}
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? 'Show fewer activity events' : `Show all ${activityEvents.length} activity events`}
            aria-label={showAll ? 'Show fewer activity events' : `Show all ${activityEvents.length} activity events`}
          >
            {showAll ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
          </button>
        ) : null}
      </div>
      {activityError ? <p className={styles.searchError}>{activityError}</p> : null}
      {isLoadingActivity ? <p className={styles.panelDescription}>Loading activity…</p> : null}
      <div className={styles.commentList}>
        {visible.map((event) => (
          <div key={event.id} className={styles.commentCard}>
            <div className={styles.commentCardHeader}>
              <strong>{event.actorName ?? 'System'}</strong>
              <span className={styles.commentMeta}>{formatCommentTimestamp(event.createdAt)}</span>
            </div>
            <p className={styles.commentBody}>{event.summary}</p>
          </div>
        ))}
        {!isLoadingActivity && activityEvents.length === 0 ? (
          <p className={styles.panelDescription}>No recent activity yet.</p>
        ) : null}
      </div>
      {hasMore && !showAll ? (
        <p className={styles.panelDescription} style={{ textAlign: 'center' }}>
          Showing 5 of {activityEvents.length}
        </p>
      ) : null}
    </section>
  )
}

function CollaborationPanel({
  canEdit,
  currentUserId,
  activeFilePath,
  activeFileWorkflow,
  memberList,
  collaborators,
  followTargetClientId,
  chatMessages,
  chatDraft,
  chatError,
  isLoadingChat,
  activityEvents,
  activityError,
  isLoadingActivity,
  onChatDraftChange,
  onSendChatMessage,
  onToggleFileLock,
  onAssignReviewOwner,
  onToggleFollowCollaborator,
  onClose,
  inSidebar = false,
}: {
  canEdit: boolean
  currentUserId: string
  activeFilePath: string
  activeFileWorkflow: ProjectDetail['fileWorkflows'][number] | null
  memberList: ProjectMember[]
  collaborators: CollaboratorPresence[]
  followTargetClientId: number | null
  chatMessages: ProjectChatMessage[]
  chatDraft: string
  chatError: string | null
  isLoadingChat: boolean
  activityEvents: ProjectActivityEvent[]
  activityError: string | null
  isLoadingActivity: boolean
  onChatDraftChange: (value: string) => void
  onSendChatMessage: () => void
  onToggleFileLock: () => void
  onAssignReviewOwner: (memberUserId: string | null) => void
  onToggleFollowCollaborator: (clientId: number) => void
  onClose: () => void
  inSidebar?: boolean
}) {
  return (
    <aside className={styles.themePanel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.sidebarLabel}>Chat & Activity</p>
          <p className={styles.panelDescription}></p>
        </div>
        {!inSidebar ? (
          <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
            <XIcon size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <section className={styles.themeSection}>
        <h3>People & Presence</h3>
        <div className={styles.fileWorkflowCard}>
          <strong>Current file workflow</strong>
          <span className={styles.panelDescription}>{activeFileWorkflow?.lockedByName ? `Locked by ${activeFileWorkflow.lockedByName}` : 'Not locked'}</span>
          <span className={styles.panelDescription}>{activeFileWorkflow?.reviewOwnerName ? `Review owner: ${activeFileWorkflow.reviewOwnerName}` : 'No review owner assigned'}</span>
          {canEdit ? (
            <div className={styles.commentActionButtons}>
              <button
                className={styles.panelIconBtn}
                onClick={onToggleFileLock}
                title={activeFileWorkflow?.lockedByUserId === currentUserId ? 'Unlock file' : 'Lock file'}
                aria-label={activeFileWorkflow?.lockedByUserId === currentUserId ? 'Unlock file' : 'Lock file'}
              >
                <Shield size={16} aria-hidden />
              </button>
              <select
                className={styles.themeSelect}
                value={activeFileWorkflow?.reviewOwnerUserId ?? ''}
                onChange={(event) => onAssignReviewOwner(event.target.value || null)}
              >
                <option value="">No review owner</option>
                {memberList.map((member) => (
                  <option key={member.userId} value={member.userId}>{member.name}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <ul className={styles.memberList}>
          {memberList.map((member) => (
            <li key={member.userId} className={styles.memberItem}>
              <span>{member.name}</span>
              <span className={styles.memberRole}>{roleLabel(member.role)}</span>
            </li>
          ))}
        </ul>
        {collaborators.length > 0 ? (
          <div className={styles.presenceList}>
            {collaborators.map((collaborator) => (
              <button key={collaborator.clientId} className={styles.presenceCard} onClick={() => onToggleFollowCollaborator(collaborator.clientId)}>
                <span className={styles.roleBadge} style={{ background: collaborator.color }}>{collaborator.userName}</span>
                <span className={styles.cardDate}>{collaborator.filePath ?? 'No active file'}{collaborator.line ? ` · L${collaborator.line}` : ''}</span>
                <span className={styles.cardDate}>
                  {followTargetClientId === collaborator.clientId
                    ? 'Following cursor'
                    : collaborator.filePath === activeFilePath
                      ? 'Jump and follow'
                      : 'Follow presence'}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.themeSection}>
        <h3>Project Chat</h3>
        {chatError ? <p className={styles.searchError}>{chatError}</p> : null}
        {isLoadingChat ? <p className={styles.panelDescription}>Loading chat…</p> : null}
        <div className={styles.commentList}>
          {chatMessages.map((message) => (
            <div key={message.id} className={styles.commentCard}>
              <div className={styles.commentCardHeader}>
                <strong>{message.authorName}</strong>
                <span className={styles.commentMeta}>{formatCommentTimestamp(message.createdAt)}</span>
              </div>
              <p className={styles.commentBody}>{message.content}</p>
            </div>
          ))}
          {!isLoadingChat && chatMessages.length === 0 ? <p className={styles.panelDescription}>No chat messages yet.</p> : null}
        </div>
        <textarea
          className={styles.commentInput}
          rows={3}
          value={chatDraft}
          onChange={(event) => onChatDraftChange(event.target.value)}
          placeholder="Send a message to collaborators"
          maxLength={5000}
        />
        <div className={styles.panelIconActions}>
          <button className={styles.primaryIconBtn} onClick={onSendChatMessage} disabled={!chatDraft.trim()} title="Send message" aria-label="Send message">
            <CommentsIcon size={16} aria-hidden />
          </button>
        </div>
      </section>

      <ActivitySection
        activityEvents={activityEvents}
        activityError={activityError}
        isLoadingActivity={isLoadingActivity}
      />
    </aside>
  )
}

function PeerReviewPanel({
  role,
  projectId,
  projectTitle,
  ecosystem,
  isLoading,
  error,
  activeFile,
  activeSource,
  entryFile,
  projectType,
  onRefresh,
  onSaveMetadataFiles,
  onUpsertProjectTextFile,
  onCreateSubmissionSnapshot,
  inSidebar = false,
}: {
  role: ProjectRole
  projectId: string
  projectTitle: string
  ecosystem: ProjectEcosystemState | null
  isLoading: boolean
  error: string | null
  activeFile: ProjectFile
  activeSource: string
  entryFile: ProjectFile
  projectType: 'typst' | 'latex'
  onRefresh: () => Promise<void>
  onSaveMetadataFiles: (metadataFiles: Array<{ path: string; content: string }>) => Promise<void>
  onUpsertProjectTextFile: (path: string, source: string, options?: { open?: boolean }) => Promise<void>
  onCreateSubmissionSnapshot: (label: string) => Promise<void>
  inSidebar?: boolean
}) {
  const canEdit = role !== 'viewer'
  const [metadataDraft, setMetadataDraft] = useState<Record<string, string>>({})
  const [submissionDraft, setSubmissionDraft] = useState<PeerReviewSubmissionRecord>({
    venue: '',
    submissionDate: '',
    manuscriptId: '',
    editorContact: '',
    roundLabel: '',
  })
  const [reviewerCommentsDraft, setReviewerCommentsDraft] = useState('')
  const [supervisorEmail, setSupervisorEmail] = useState('')
  const [supervisorName, setSupervisorName] = useState('')
  const [reviewRequestMessage, setReviewRequestMessage] = useState('')
  const [reviewRequestUrl, setReviewRequestUrl] = useState('')
  const [supervisorReviewRequests, setSupervisorReviewRequests] = useState<SupervisorReviewRequest[]>([])
  const [reviewRequestEdits, setReviewRequestEdits] = useState<Record<string, { supervisorName: string; message: string; expiresDate: string }>>({})
  const [peerReviewStatus, setPeerReviewStatus] = useState<string | null>(null)
  const [isSavingPeerReview, setIsSavingPeerReview] = useState(false)
  const [arxivQuery, setArxivQuery] = useState('')
  const [arxivResults, setArxivResults] = useState<ArxivLookupResult[]>([])
  const [isLookingUpArxiv, setIsLookingUpArxiv] = useState(false)
  const [archiveFormat, setArchiveFormat] = useState<'zip' | 'tar.gz'>('zip')
  const reviewerCommentFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMetadataDraft(Object.fromEntries((ecosystem?.metadataFiles ?? []).map((file) => [file.path, file.content])))
  }, [ecosystem?.metadataFiles])

  useEffect(() => {
    let cancelled = false
    apiClient.get<SupervisorReviewRequest[]>(`/api/projects/${projectId}/review-requests`)
      .then((response) => {
        if (!cancelled) setSupervisorReviewRequests(response.data)
        if (!cancelled) setReviewRequestEdits(buildReviewRequestEdits(response.data))
      })
      .catch(() => {
        if (!cancelled) setSupervisorReviewRequests([])
      })
    return () => { cancelled = true }
  }, [projectId, reviewRequestUrl])

  const peerReviewMetadata = useMemo(
    () => parsePeerReviewMetadata(metadataDraft[PROJECT_METADATA_JSON_PATH]),
    [metadataDraft],
  )
  const arxivMetadata = useMemo(
    () => parseArxivMetadata(metadataDraft[PROJECT_METADATA_JSON_PATH]),
    [metadataDraft],
  )

  useEffect(() => {
    const latest = peerReviewMetadata.submissions[0]
    if (latest) setSubmissionDraft(latest)
  }, [metadataDraft])

  const handleSubmissionDraftChange = (field: keyof PeerReviewSubmissionRecord, value: string) => {
    setSubmissionDraft((current) => ({ ...current, [field]: value }))
  }

  const handleSaveSubmissionRecord = async () => {
    if (!submissionDraft.venue.trim() && !submissionDraft.roundLabel.trim()) {
      setPeerReviewStatus('Add at least a venue or round label before saving a submission record.')
      return
    }

    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      const nextContent = updatePeerReviewMetadataContent(metadataDraft[PROJECT_METADATA_JSON_PATH], submissionDraft)
      const nextMetadataDraft = { ...metadataDraft, [PROJECT_METADATA_JSON_PATH]: nextContent }
      setMetadataDraft(nextMetadataDraft)
      await onSaveMetadataFiles(Object.entries(nextMetadataDraft).map(([path, content]) => ({ path, content })))
      setPeerReviewStatus('Saved submission metadata.')
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const handleCreatePeerReviewFiles = async () => {
    const comments = parseReviewerComments(reviewerCommentsDraft)
    if (comments.length === 0) {
      setPeerReviewStatus('Paste or upload reviewer comments before generating response files.')
      return
    }

    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      const roundSlug = slugifyReviewToken(submissionDraft.roundLabel || submissionDraft.venue || 'review')
      await onUpsertProjectTextFile(`review/${roundSlug}-reviewer-comments.md`, buildReviewerCommentsDocument(comments, submissionDraft), { open: false })
      await onUpsertProjectTextFile(`review/${roundSlug}-response-to-reviewers.md`, buildPointByPointResponseDocument(comments, submissionDraft), { open: true })
      setPeerReviewStatus(`Generated ${comments.length} point-by-point response ${comments.length === 1 ? 'item' : 'items'}.`)
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const handleUploadReviewerComments = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setReviewerCommentsDraft(await file.text())
  }

  const handleCreateSubmissionRoundSnapshot = async () => {
    const label = submissionDraft.roundLabel.trim()
      || [submissionDraft.venue.trim(), submissionDraft.submissionDate.trim()].filter(Boolean).join(' — ')
      || 'Submission snapshot'
    await onCreateSubmissionSnapshot(label)
    setPeerReviewStatus(`Created snapshot "${label}".`)
  }

  const handleSendReviewRequest = async () => {
    if (!supervisorEmail.trim()) {
      setPeerReviewStatus('Add a supervisor email before requesting review.')
      return
    }

    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      const response = await apiClient.post<{ reviewUrl: string }>(`/api/projects/${projectId}/files/${activeFile.id}/review-requests`, {
        supervisorEmail,
        supervisorName,
        message: reviewRequestMessage,
        source: activeSource,
      })
      setReviewRequestUrl(response.data.reviewUrl)
      setPeerReviewStatus('Review request sent. The signed link is ready to share.')
      const requests = await apiClient.get<SupervisorReviewRequest[]>(`/api/projects/${projectId}/review-requests`)
      setSupervisorReviewRequests(requests.data)
      setReviewRequestEdits(buildReviewRequestEdits(requests.data))
    } catch (error: any) {
      setPeerReviewStatus(error?.response?.data?.error ?? 'Failed to send review request.')
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const refreshSupervisorReviewRequests = async () => {
    const requests = await apiClient.get<SupervisorReviewRequest[]>(`/api/projects/${projectId}/review-requests`)
    setSupervisorReviewRequests(requests.data)
    setReviewRequestEdits(buildReviewRequestEdits(requests.data))
  }

  const handleReviewRequestEditChange = (requestId: string, field: 'supervisorName' | 'message' | 'expiresDate', value: string) => {
    setReviewRequestEdits((current) => ({
      ...current,
      [requestId]: { ...(current[requestId] ?? createEmptyReviewRequestEdit()), [field]: value },
    }))
  }

  const handleUpdateReviewRequest = async (request: SupervisorReviewRequest) => {
    const edit = reviewRequestEdits[request.id]
    if (!edit) return

    const expiresAt = reviewDateInputToTimestamp(edit.expiresDate)
    if (!expiresAt) {
      setPeerReviewStatus('Choose a future expiration date before saving.')
      return
    }

    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      await apiClient.patch(`/api/projects/${projectId}/review-requests/${request.id}`, {
        supervisorName: edit.supervisorName,
        message: edit.message,
        expiresAt,
      })
      await refreshSupervisorReviewRequests()
      setPeerReviewStatus('Updated supervisor review request.')
    } catch (error: any) {
      setPeerReviewStatus(error?.response?.data?.error ?? 'Failed to update review request.')
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const handleRevokeReviewRequest = async (request: SupervisorReviewRequest) => {
    const confirmed = window.confirm(`Revoke the review link for ${request.supervisor_email}?`)
    if (!confirmed) return

    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      await apiClient.delete(`/api/projects/${projectId}/review-requests/${request.id}`)
      await refreshSupervisorReviewRequests()
      setPeerReviewStatus('Revoked supervisor review link.')
    } catch (error: any) {
      setPeerReviewStatus(error?.response?.data?.error ?? 'Failed to revoke review request.')
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const handleArxivLookup = async () => {
    const query = arxivQuery.trim()
    if (!query) return
    setIsLookingUpArxiv(true)
    setPeerReviewStatus(null)
    try {
      const response = await apiClient.get<{ results: ArxivLookupResult[] }>('/api/export/arxiv-lookup', { params: { q: query } })
      setArxivResults(response.data.results)
      if (response.data.results.length === 0) setPeerReviewStatus('No arXiv metadata results found.')
    } catch (error: any) {
      setPeerReviewStatus(error?.response?.data?.error ?? 'arXiv metadata lookup failed.')
    } finally {
      setIsLookingUpArxiv(false)
    }
  }

  const handleImportArxivMetadata = async (paper: ArxivLookupResult) => {
    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      const nextSubmission = {
        venue: 'arXiv',
        submissionDate: paper.published?.slice(0, 10) ?? '',
        manuscriptId: paper.id,
        editorContact: '',
        roundLabel: `arXiv ${paper.id}`,
      }
      setSubmissionDraft(nextSubmission)
      const withSubmission = updatePeerReviewMetadataContent(metadataDraft[PROJECT_METADATA_JSON_PATH], nextSubmission)
      const nextContent = updateArxivMetadataContent(withSubmission, paper)
      const nextMetadataDraft = { ...metadataDraft, [PROJECT_METADATA_JSON_PATH]: nextContent }
      setMetadataDraft(nextMetadataDraft)
      await onSaveMetadataFiles(Object.entries(nextMetadataDraft).map(([path, content]) => ({ path, content })))
      setPeerReviewStatus(`Imported arXiv metadata for ${paper.id}.`)
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const handleDownloadArxivPackage = async () => {
    setIsSavingPeerReview(true)
    setPeerReviewStatus(null)
    try {
      const response = await apiClient.post('/api/export/arxiv-package', {
        projectId,
        entryFileId: entryFile.id,
        activeFileId: isEditableTextFile(activeFile) ? activeFile.id : undefined,
        activeSource: isEditableTextFile(activeFile) ? activeSource : undefined,
        archiveFormat,
        metadata: buildArxivPackageMetadata(submissionDraft, arxivMetadata),
      }, { responseType: 'blob', timeout: 120000 })
      downloadBlobResponse(response, `${projectTitle}-arxiv.${archiveFormat === 'zip' ? 'zip' : 'tar.gz'}`)
      setPeerReviewStatus('Prepared arXiv package for manual upload.')
    } catch (error: any) {
      setPeerReviewStatus(await readBlobError(error, 'Failed to prepare arXiv package.'))
    } finally {
      setIsSavingPeerReview(false)
    }
  }

  const content = (
    <>
      {error ? <p className={styles.searchError}>{error}</p> : null}
      {isLoading && !ecosystem ? <p className={styles.panelDescription}>Loading peer-review metadata…</p> : null}
      <div className={styles.peerReviewToolbar}>
        <button className={styles.panelIconBtn} onClick={() => void onRefresh()} disabled={isLoading} title="Refresh peer-review metadata" aria-label="Refresh peer-review metadata">
          <RefreshCw size={16} aria-hidden />
        </button>
      </div>

      <section className={[styles.themeSection, styles.peerReviewSection].join(' ')}>
        <h3>Supervisor Review Link</h3>
        <div className={[styles.inlineFieldRow, styles.peerReviewFullRows].join(' ')}>
          <label className={styles.themeField}>
            <span>Supervisor email</span>
            <input className={styles.shortcutInput} type="email" value={supervisorEmail} onChange={(event) => setSupervisorEmail(event.target.value)} placeholder="advisor@example.edu" disabled={!canEdit || isSavingPeerReview} />
          </label>
          <label className={styles.themeField}>
            <span>Name</span>
            <input className={styles.shortcutInput} value={supervisorName} onChange={(event) => setSupervisorName(event.target.value)} placeholder="Optional" disabled={!canEdit || isSavingPeerReview} />
          </label>
        </div>
        <label className={styles.themeField}>
          <span>Message</span>
          <textarea className={styles.commentInput} rows={3} value={reviewRequestMessage} onChange={(event) => setReviewRequestMessage(event.target.value)} placeholder="Optional note for this review round" disabled={!canEdit || isSavingPeerReview} />
        </label>
        <div className={styles.panelIconActions}>
          <button className={styles.primaryIconBtn} onClick={() => void handleSendReviewRequest()} disabled={!canEdit || isSavingPeerReview || !supervisorEmail.trim() || !isEditableTextFile(activeFile)} title={isSavingPeerReview ? 'Sending review request' : 'Send review request'} aria-label={isSavingPeerReview ? 'Sending review request' : 'Send review request'}>
            {isSavingPeerReview ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <FileOutput size={16} aria-hidden />}
          </button>
          {reviewRequestUrl ? (
            <button className={styles.panelIconBtn} onClick={() => void navigator.clipboard?.writeText(reviewRequestUrl)} title="Copy signed review link" aria-label="Copy signed review link">
              <CopyIcon size={16} aria-hidden />
            </button>
          ) : null}
        </div>
        {reviewRequestUrl ? <p className={styles.panelDescription} style={{ wordBreak: 'break-all' }}>{reviewRequestUrl}</p> : null}
        <div className={styles.submissionRecordList}>
          {supervisorReviewRequests.slice(0, 6).map((request) => (
            <div key={request.id} className={styles.submissionRecordCard}>
              {(() => {
                const edit = reviewRequestEdits[request.id] ?? {
                  supervisorName: request.supervisor_name ?? '',
                  message: request.message ?? '',
                  expiresDate: timestampToDateInput(request.expires_at),
                }
                const expired = request.expires_at <= Date.now()
                const active = request.status === 'open' && !expired
                return (
                  <>
              <strong>{request.supervisor_name || request.supervisor_email}</strong>
              <span>{request.file_path} · {request.open_comments} open · {request.resolved_comments} addressed · {active ? 'active' : request.status === 'closed' ? 'revoked' : 'expired'}</span>
              <span>Sent {formatCommentTimestamp(request.created_at)} · expires {formatCommentTimestamp(request.expires_at)}</span>
              <div className={[styles.inlineFieldRow, styles.peerReviewFullRows].join(' ')}>
                <label className={styles.themeField}>
                  <span>Name</span>
                  <input className={styles.shortcutInput} value={edit.supervisorName} onChange={(event) => handleReviewRequestEditChange(request.id, 'supervisorName', event.target.value)} disabled={!canEdit || isSavingPeerReview || request.status === 'closed'} />
                </label>
                <label className={styles.themeField}>
                  <span>Expires</span>
                  <input className={styles.shortcutInput} type="date" value={edit.expiresDate} onChange={(event) => handleReviewRequestEditChange(request.id, 'expiresDate', event.target.value)} disabled={!canEdit || isSavingPeerReview || request.status === 'closed'} />
                </label>
              </div>
              <label className={styles.themeField}>
                <span>Message</span>
                <textarea className={styles.commentInput} rows={2} value={edit.message} onChange={(event) => handleReviewRequestEditChange(request.id, 'message', event.target.value)} disabled={!canEdit || isSavingPeerReview || request.status === 'closed'} />
              </label>
              <div className={styles.panelIconActions}>
                <button className={styles.panelIconBtn} onClick={() => void handleUpdateReviewRequest(request)} disabled={!canEdit || isSavingPeerReview || request.status === 'closed'} title="Save review request changes" aria-label="Save review request changes">
                  <Save size={16} aria-hidden />
                </button>
                <button className={styles.panelIconBtn} onClick={() => void handleRevokeReviewRequest(request)} disabled={!canEdit || isSavingPeerReview || request.status === 'closed'} title="Revoke review link" aria-label="Revoke review link">
                  <TrashIcon size={16} aria-hidden />
                </button>
              </div>
                  </>
                )
              })()}
            </div>
          ))}
        </div>
      </section>

      <section className={[styles.themeSection, styles.peerReviewSection].join(' ')}>
        <h3>Submission Record</h3>
        <div className={[styles.inlineFieldRow, styles.peerReviewFullRows].join(' ')}>
          <label className={styles.themeField}>
            <span>Venue</span>
            <input className={styles.shortcutInput} value={submissionDraft.venue} onChange={(event) => handleSubmissionDraftChange('venue', event.target.value)} placeholder="NeurIPS 2025" disabled={!canEdit || isSavingPeerReview} />
          </label>
          <label className={styles.themeField}>
            <span>Submission date</span>
            <input className={styles.shortcutInput} type="date" value={submissionDraft.submissionDate} onChange={(event) => handleSubmissionDraftChange('submissionDate', event.target.value)} disabled={!canEdit || isSavingPeerReview} />
          </label>
        </div>
        <div className={[styles.inlineFieldRow, styles.peerReviewFullRows].join(' ')}>
          <label className={styles.themeField}>
            <span>Manuscript ID</span>
            <input className={styles.shortcutInput} value={submissionDraft.manuscriptId} onChange={(event) => handleSubmissionDraftChange('manuscriptId', event.target.value)} placeholder="Paper #1234 or arXiv ID" disabled={!canEdit || isSavingPeerReview} />
          </label>
          <label className={styles.themeField}>
            <span>Editor contact</span>
            <input className={styles.shortcutInput} value={submissionDraft.editorContact} onChange={(event) => handleSubmissionDraftChange('editorContact', event.target.value)} placeholder="editor@example.org" disabled={!canEdit || isSavingPeerReview} />
          </label>
        </div>
        <label className={styles.themeField}>
          <span>Submission round label</span>
          <input className={styles.shortcutInput} value={submissionDraft.roundLabel} onChange={(event) => handleSubmissionDraftChange('roundLabel', event.target.value)} placeholder="Submission v1 — NeurIPS 2025" disabled={!canEdit || isSavingPeerReview} />
        </label>
        <div className={styles.panelIconActions}>
          <button className={styles.primaryIconBtn} onClick={() => void handleSaveSubmissionRecord()} disabled={!canEdit || isSavingPeerReview} title={isSavingPeerReview ? 'Saving metadata' : 'Save metadata'} aria-label={isSavingPeerReview ? 'Saving metadata' : 'Save metadata'}>
            <Save size={16} aria-hidden />
          </button>
          <button className={styles.panelIconBtn} onClick={() => void handleCreateSubmissionRoundSnapshot()} disabled={!canEdit || isSavingPeerReview || !isEditableTextFile(activeFile)} title="Create named snapshot" aria-label="Create named snapshot">
            <Camera size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.submissionRecordList}>
          {peerReviewMetadata.submissions.map((record, index) => (
            <div key={`${record.roundLabel}:${record.venue}:${index}`} className={styles.submissionRecordCard}>
              <strong>{record.roundLabel || record.venue || `Submission ${index + 1}`}</strong>
              <span>{[record.venue, record.submissionDate, record.manuscriptId, record.editorContact].filter(Boolean).join(' · ') || 'No metadata fields filled yet.'}</span>
            </div>
          ))}
          {peerReviewMetadata.submissions.length === 0 ? <p className={styles.panelDescription}>No submission records saved yet.</p> : null}
        </div>
      </section>

      <section className={[styles.themeSection, styles.peerReviewSection].join(' ')}>
        <h3>Reviewer Response Letter</h3>
        <label className={styles.themeField}>
          <span>Reviewer comments</span>
          <textarea className={styles.commentInput} rows={8} value={reviewerCommentsDraft} onChange={(event) => setReviewerCommentsDraft(event.target.value)} placeholder="Paste reviewer comments. Headings like Reviewer 1 or Reviewer #2 are preserved." disabled={!canEdit || isSavingPeerReview} />
        </label>
        <input ref={reviewerCommentFileRef} type="file" accept=".txt,.md,.rtf" style={{ display: 'none' }} onChange={(event) => { void handleUploadReviewerComments(event.target.files); event.currentTarget.value = '' }} />
        <div className={styles.panelIconActions}>
          <button className={styles.panelIconBtn} onClick={() => reviewerCommentFileRef.current?.click()} disabled={!canEdit || isSavingPeerReview} title="Upload reviewer comments" aria-label="Upload reviewer comments">
            <UploadIcon size={16} aria-hidden />
          </button>
          <button className={styles.primaryIconBtn} onClick={() => void handleCreatePeerReviewFiles()} disabled={!canEdit || isSavingPeerReview || !reviewerCommentsDraft.trim()} title="Generate response letter" aria-label="Generate response letter">
            <FileOutput size={16} aria-hidden />
          </button>
        </div>
      </section>

      <section className={[styles.themeSection, styles.peerReviewSection].join(' ')}>
        <h3>arXiv Metadata Lookup</h3>
        <div className={[styles.inlineFieldRow, styles.peerReviewLookupRow].join(' ')}>
          <input className={styles.shortcutInput} value={arxivQuery} onChange={(event) => setArxivQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleArxivLookup() }} placeholder="arXiv ID, title, author, or keyword" />
          <button className={styles.panelIconBtn} onClick={() => void handleArxivLookup()} disabled={isLookingUpArxiv || !arxivQuery.trim()} title={isLookingUpArxiv ? 'Looking up metadata' : 'Look up arXiv metadata'} aria-label={isLookingUpArxiv ? 'Looking up metadata' : 'Look up arXiv metadata'}>
            {isLookingUpArxiv ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <SearchIcon size={16} aria-hidden />}
          </button>
        </div>
        <div className={styles.submissionRecordList}>
          {arxivResults.map((paper) => (
            <div key={paper.id} className={styles.submissionRecordCard}>
              <strong>{paper.title}</strong>
              <span>{paper.id} · {paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ' et al.' : ''}</span>
              <span>{paper.categories.join(', ')}{paper.published ? ` · ${paper.published.slice(0, 10)}` : ''}</span>
              <div className={styles.panelIconActions}>
                <button className={styles.panelIconBtn} onClick={() => void handleImportArxivMetadata(paper)} disabled={!canEdit || isSavingPeerReview} title="Import metadata" aria-label="Import metadata">
                  <Database size={16} aria-hidden />
                </button>
                {paper.pdfUrl ? (
                  <a className={styles.panelIconLink} href={paper.pdfUrl} target="_blank" rel="noreferrer" title="Open PDF" aria-label="Open PDF">
                    <ExternalLink size={16} aria-hidden />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={[styles.themeSection, styles.peerReviewSection].join(' ')}>
        <h3>arXiv Package Handoff</h3>
        <p className={styles.panelDescription}>Builds a clean source archive with compiled PDF and `arxiv-submission-checklist.md`. arXiv submission still requires manual author review and upload.</p>
        <div className={styles.validationList}>
          <div className={styles.validationCard}><strong>Main file</strong><span className={styles.searchResultMeta}>{entryFile.path}</span></div>
          <div className={styles.validationCard}><strong>Project type</strong><span className={styles.searchResultMeta}>{projectType === 'latex' ? 'LaTeX source package' : 'Typst source plus converted-main.tex helper'}</span></div>
          <div className={styles.validationCard}><strong>Metadata</strong><span className={styles.searchResultMeta}>{arxivMetadata?.id ? `Imported ${arxivMetadata.id}` : 'Use lookup/import or fill fields manually'}</span></div>
        </div>
        <label className={styles.themeField}>
          <span>Archive format</span>
          <select className={styles.themeSelect} value={archiveFormat} onChange={(event) => setArchiveFormat(event.target.value as 'zip' | 'tar.gz')}>
            <option value="zip">ZIP</option>
            <option value="tar.gz">tar.gz</option>
          </select>
        </label>
        <div className={styles.panelIconActions}>
          <button className={styles.primaryIconBtn} onClick={() => void handleDownloadArxivPackage()} disabled={isSavingPeerReview || !isEditableTextFile(entryFile)} title={isSavingPeerReview ? 'Preparing arXiv package' : 'Download arXiv package'} aria-label={isSavingPeerReview ? 'Preparing arXiv package' : 'Download arXiv package'}>
            {isSavingPeerReview ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <PackageCheck size={16} aria-hidden />}
          </button>
          <button className={styles.panelIconBtn} onClick={() => window.open('https://arxiv.org/submit', '_blank', 'noopener,noreferrer')} title="Open arXiv submission page" aria-label="Open arXiv submission page">
            <ExternalLink size={16} aria-hidden />
          </button>
        </div>
      </section>

      {peerReviewStatus ? <p className={styles.panelDescription}>{peerReviewStatus}</p> : null}
    </>
  )

  if (inSidebar) {
    return <div className={styles.peerReviewPanel}>{content}</div>
  }

  return <aside className={styles.themePanel}>{content}</aside>
}

function EcosystemPanel({
  role,
  projectType,
  targetFolderPath,
  ecosystem,
  isLoading,
  error,
  activeFile,
  activeTemplate,
  livePageCount,
  complianceIssues,
  onClose,
  onRefresh,
  onSavePackagePins,
  onSaveWritingTools,
  onSaveMetadataFiles,
  onInsertAtCursor,
  onJumpToReference,
  symbolPalette,
  onUploadProjectFont,
  onUploadReusableAsset,
  onAddCurrentFileToLibrary,
  onImportReusableAsset,
  onDeleteReusableAsset,
  inSidebar = false,
}: {
  role: ProjectRole
  projectType: 'typst' | 'latex'
  targetFolderPath: string | null
  ecosystem: ProjectEcosystemState | null
  isLoading: boolean
  error: string | null
  activeFile: ProjectFile
  activeTemplate: ProjectDetail['activeTemplate']
  livePageCount: number
  complianceIssues: Array<{ level: 'warning' | 'error'; message: string }>
  onClose: () => void
  onRefresh: () => Promise<void>
  onSavePackagePins: (pins: ProjectPackagePin[]) => Promise<void>
  onSaveWritingTools: (writingSnippets: ProjectWritingSnippet[], writingGoals: ProjectWritingGoals) => Promise<void>
  onSaveMetadataFiles: (metadataFiles: Array<{ path: string; content: string }>) => Promise<void>
  onInsertAtCursor: (text: string, selectInsertedText?: boolean) => void
  onJumpToReference: (filePath: string, line?: number) => void
  symbolPalette: SymbolPaletteGroup[]
  onUploadProjectFont: () => void
  onUploadReusableAsset: () => void
  onAddCurrentFileToLibrary: () => Promise<void>
  onImportReusableAsset: (asset: ReusableAsset) => Promise<void>
  onDeleteReusableAsset: (asset: ReusableAsset) => Promise<void>
  inSidebar?: boolean
}) {
  const canEdit = role !== 'viewer'
  const isLatexProject = projectType === 'latex'
  const activeSymbolPalette = isLatexProject ? LATEX_SYMBOL_PALETTE : symbolPalette
  const [packageQuery, setPackageQuery] = useState('')
  const deferredPackageQuery = useDeferredValue(packageQuery)
  const [packagePinsDraft, setPackagePinsDraft] = useState<ProjectPackagePin[]>([])
  const [metadataDraft, setMetadataDraft] = useState<Record<string, string>>({})
  const [writingSnippetsDraft, setWritingSnippetsDraft] = useState<ProjectWritingSnippet[]>([])
  const [writingGoalsDraft, setWritingGoalsDraft] = useState<ProjectWritingGoals>(DEFAULT_WRITING_GOALS)
  const [isSavingPins, setIsSavingPins] = useState(false)
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)
  const [isSavingWritingTools, setIsSavingWritingTools] = useState(false)

  useEffect(() => {
    setPackagePinsDraft(ecosystem?.settings.packagePins ?? [])
  }, [ecosystem?.settings.packagePins])

  useEffect(() => {
    setWritingSnippetsDraft(ecosystem?.settings.writingSnippets ?? [])
  }, [ecosystem?.settings.writingSnippets])

  useEffect(() => {
    setWritingGoalsDraft(ecosystem?.settings.writingGoals ?? DEFAULT_WRITING_GOALS)
  }, [ecosystem?.settings.writingGoals])

  useEffect(() => {
    setMetadataDraft(Object.fromEntries((ecosystem?.metadataFiles ?? []).map((file) => [file.path, file.content])))
  }, [ecosystem?.metadataFiles])

  const filteredCatalog = useMemo(() => {
    const query = deferredPackageQuery.trim().toLowerCase()
    const pinnedIds = new Set(packagePinsDraft.map((pin) => pin.packageId))

    return (ecosystem?.packageCatalog ?? []).filter((entry) => {
      if (pinnedIds.has(entry.packageId) && !query) {
        return false
      }

      if (!query) {
        return true
      }

      return [entry.packageId, entry.title, entry.description, ...entry.keywords]
        .some((value) => value.toLowerCase().includes(query))
    })
  }, [deferredPackageQuery, ecosystem?.packageCatalog, packagePinsDraft])

  const handlePinVersionChange = (packageId: string, version: string) => {
    setPackagePinsDraft((current) => current.map((pin) => pin.packageId === packageId ? { ...pin, version } : pin))
  }

  const handleAddPackage = (packageId: string, version: string) => {
    setPackagePinsDraft((current) => current.some((pin) => pin.packageId === packageId)
      ? current
      : [...current, { packageId, version }].sort((left, right) => left.packageId.localeCompare(right.packageId)))
  }

  const handleRemovePackage = (packageId: string) => {
    setPackagePinsDraft((current) => current.filter((pin) => pin.packageId !== packageId))
  }

  const handleSavePins = async () => {
    setIsSavingPins(true)
    try {
      await onSavePackagePins(packagePinsDraft)
    } finally {
      setIsSavingPins(false)
    }
  }

  const handleSaveMetadata = async () => {
    setIsSavingMetadata(true)
    try {
      await onSaveMetadataFiles(Object.entries(metadataDraft).map(([path, content]) => ({ path, content })))
    } finally {
      setIsSavingMetadata(false)
    }
  }

  const handleSnippetChange = (snippetId: string, field: keyof ProjectWritingSnippet, value: string) => {
    setWritingSnippetsDraft((current) => current.map((snippet) => snippet.id === snippetId ? { ...snippet, [field]: value } : snippet))
  }

  const handleAddSnippet = () => {
    setWritingSnippetsDraft((current) => [...current, {
      id: `snippet-${Date.now()}`,
      name: 'New snippet',
      description: 'Reusable content block',
      content: '',
    }])
  }

  const handleRemoveSnippet = (snippetId: string) => {
    setWritingSnippetsDraft((current) => current.filter((snippet) => snippet.id !== snippetId))
  }

  const handleSaveWritingToolSettings = async () => {
    setIsSavingWritingTools(true)
    try {
      await onSaveWritingTools(writingSnippetsDraft, writingGoalsDraft)
    } finally {
      setIsSavingWritingTools(false)
    }
  }

  const content = (
    <>
      <div className={styles.panelHeader}>
        <div>
          
          <p className={styles.sidebarLabel}>{isLatexProject ? 'LaTeX Ecosystem' : 'Typst Ecosystem'}</p>
          <p className={styles.panelDescription}>
          </p>
        </div>
        <div className={styles.panelActionCluster}>
          <button className={styles.panelIconBtn} onClick={() => void onRefresh()} disabled={isLoading} title={isLoading ? 'Refreshing ecosystem' : 'Refresh ecosystem'} aria-label={isLoading ? 'Refreshing ecosystem' : 'Refresh ecosystem'}>
            {isLoading ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <RefreshCw size={16} aria-hidden />}
          </button>
          {!inSidebar ? (
            <button className={styles.panelIconBtn} onClick={onClose} title="Close" aria-label="Close">
              <XIcon size={16} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className={styles.searchError}>{error}</p> : null}
      {isLoading && !ecosystem ? <p className={styles.panelDescription}>Loading project ecosystem…</p> : null}

      <section className={styles.themeSection}>
        <h3>Writing Goals And Stats</h3>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}><strong>{ecosystem?.writingStats.totalWords ?? 0}</strong><span>Total words</span></div>
          <div className={styles.statCard}><strong>{ecosystem?.writingStats.readingTimeMinutes ?? 0} min</strong><span>Reading time</span></div>
          <div className={styles.statCard}><strong>{ecosystem?.writingStats.characterCount ?? 0}</strong><span>Characters</span></div>
          <div className={styles.statCard}><strong>{ecosystem?.writingStats.sectionCount ?? 0}</strong><span>Sections</span></div>
        </div>
        <div className={styles.inlineFieldRow}>
          <label className={styles.themeField}>
            <span>Target words</span>
            <input className={styles.shortcutInput} type="number" min="0" value={writingGoalsDraft.targetWords ?? ''} onChange={(event) => setWritingGoalsDraft((current) => ({ ...current, targetWords: event.target.value ? Number(event.target.value) : null }))} disabled={!canEdit || isSavingWritingTools} />
          </label>
          <label className={styles.themeField}>
            <span>Daily words</span>
            <input className={styles.shortcutInput} type="number" min="0" value={writingGoalsDraft.dailyWords ?? ''} onChange={(event) => setWritingGoalsDraft((current) => ({ ...current, dailyWords: event.target.value ? Number(event.target.value) : null }))} disabled={!canEdit || isSavingWritingTools} />
          </label>
          <label className={styles.themeField}>
            <span>Deadline</span>
            <input className={styles.shortcutInput} type="date" value={writingGoalsDraft.deadline ?? ''} onChange={(event) => setWritingGoalsDraft((current) => ({ ...current, deadline: event.target.value || null }))} disabled={!canEdit || isSavingWritingTools} />
          </label>
        </div>
        {writingGoalsDraft.targetWords ? (
          <p className={styles.panelDescription}>{Math.max(0, writingGoalsDraft.targetWords - (ecosystem?.writingStats.totalWords ?? 0))} words remaining to reach the project target.</p>
        ) : null}
        <div className={styles.sectionStatsList}>
          {(ecosystem?.writingStats.sections ?? []).slice(0, 8).map((section) => (
            <button key={`${section.filePath}:${section.line}`} className={styles.sectionStatCard} onClick={() => onJumpToReference(section.filePath, section.line)}>
              <strong>{section.title}</strong>
              <span>{section.words} words · {section.readingTimeMinutes} min · {section.filePath}:{section.line}</span>
            </button>
          ))}
        </div>
        <div className={styles.panelIconActions}>
          <button className={styles.primaryIconBtn} onClick={() => void handleSaveWritingToolSettings()} disabled={!canEdit || isSavingWritingTools} title={isSavingWritingTools ? 'Saving goals and snippets' : 'Save goals and snippets'} aria-label={isSavingWritingTools ? 'Saving goals and snippets' : 'Save goals and snippets'}>
            {isSavingWritingTools ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <Save size={16} aria-hidden />}
          </button>
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Spellcheck And Grammar Assistance</h3>
        <p className={styles.panelDescription}>Heuristic prose checks highlight likely typos, repeated words, long sentences, and spacing issues in project text files.</p>
        <div className={styles.validationList}>
          {(ecosystem?.proseSuggestions ?? []).map((suggestion) => (
            <div key={suggestion.id} className={styles.validationCard}>
              <div className={styles.validationHeaderRow}>
                <strong>{suggestion.message}</strong>
                <span className={styles.searchResultMeta}>{suggestion.kind}</span>
              </div>
              <p className={styles.panelDescription}>{suggestion.excerpt}</p>
              <div className={styles.assetLibraryActions}>
                <span className={styles.searchResultMeta}>{suggestion.filePath}:{suggestion.line}</span>
                <button className={styles.panelIconBtn} onClick={() => onJumpToReference(suggestion.filePath, suggestion.line)} title="Jump to issue" aria-label="Jump to issue">
                  <FileText size={16} aria-hidden />
                </button>
              </div>
            </div>
          ))}
          {!(ecosystem?.proseSuggestions.length) ? <p className={styles.panelDescription}>No prose assistance issues detected right now.</p> : null}
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Snippets And Reusable Content Blocks</h3>
        <div className={styles.panelIconActions}>
          {canEdit ? (
            <button className={styles.panelIconBtn} onClick={handleAddSnippet} title="Add snippet" aria-label="Add snippet">
              <Plus size={16} aria-hidden />
            </button>
          ) : null}
        </div>
        <div className={styles.metadataEditorList}>
          {writingSnippetsDraft.map((snippet) => (
            <div key={snippet.id} className={styles.writingSnippetCard}>
              <label className={styles.themeField}>
                <span>Name</span>
                <input className={styles.shortcutInput} value={snippet.name} maxLength={255} onChange={(event) => handleSnippetChange(snippet.id, 'name', event.target.value)} disabled={!canEdit || isSavingWritingTools} />
              </label>
              <label className={styles.themeField}>
                <span>Description</span>
                <input className={styles.shortcutInput} value={snippet.description} maxLength={255} onChange={(event) => handleSnippetChange(snippet.id, 'description', event.target.value)} disabled={!canEdit || isSavingWritingTools} />
              </label>
              <label className={styles.themeField}>
                <span>Content</span>
                <textarea className={styles.commentInput} rows={6} value={snippet.content} maxLength={5000} onChange={(event) => handleSnippetChange(snippet.id, 'content', event.target.value)} disabled={!canEdit || isSavingWritingTools} />
              </label>
              <div className={styles.assetLibraryActions}>
                {canEdit ? (
                  <button className={styles.panelIconBtn} onClick={() => onInsertAtCursor(snippet.content, true)} title="Insert snippet" aria-label="Insert snippet">
                    <FileOutput size={16} aria-hidden />
                  </button>
                ) : null}
                {canEdit ? (
                  <button className={styles.dangerIconBtn} onClick={() => handleRemoveSnippet(snippet.id)} disabled={isSavingWritingTools} title="Remove snippet" aria-label="Remove snippet">
                    <TrashIcon size={16} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Symbol Picker And Math Helper</h3>
        <div className={styles.symbolPaletteList}>
          {activeSymbolPalette.map((group) => (
            <div key={group.title} className={styles.symbolPaletteGroup}>
              <strong>{group.title}</strong>
              <div className={styles.symbolPaletteButtons}>
                {group.items.map((item) => (
                  <button key={`${group.title}:${item.label}`} className={styles.quickInsertBtn} onClick={() => onInsertAtCursor(item.insert)} disabled={!canEdit || activeFile.mimeType === DRIVE_FOLDER_MIME_TYPE}>{item.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {!isLatexProject ? (
        <>
          <section className={styles.themeSection}>
            <h3>Package Pins</h3>
            <p className={styles.panelDescription}>Use package pins to keep imports stable across collaborators and future revisions.</p>
            <div className={styles.packagePinList}>
              {packagePinsDraft.length === 0 ? <p className={styles.panelDescription}>No packages pinned yet.</p> : null}
              {packagePinsDraft.map((pin) => {
                const packageEntry = ecosystem?.packageCatalog.find((entry) => entry.packageId === pin.packageId)
                return (
                  <div key={pin.packageId} className={styles.packagePinCard}>
                    <div>
                      <strong>{pin.packageId}</strong>
                      <p className={styles.panelDescription}>{packageEntry?.description ?? 'Pinned for this project.'}</p>
                    </div>
                    <div className={styles.packagePinControls}>
                      <input
                        className={styles.shortcutInput}
                        value={pin.version}
                        onChange={(event) => handlePinVersionChange(pin.packageId, event.target.value)}
                        disabled={!canEdit || isSavingPins}
                      />
                      {canEdit ? (
                        <button className={styles.dangerIconBtn} onClick={() => handleRemovePackage(pin.packageId)} disabled={isSavingPins} title={`Remove ${pin.packageId}`} aria-label={`Remove ${pin.packageId}`}>
                          <TrashIcon size={16} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className={styles.panelIconActions}>
              <button className={styles.primaryIconBtn} onClick={() => void handleSavePins()} disabled={!canEdit || isSavingPins} title={isSavingPins ? 'Saving package pins' : 'Save package pins'} aria-label={isSavingPins ? 'Saving package pins' : 'Save package pins'}>
                {isSavingPins ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <Save size={16} aria-hidden />}
              </button>
            </div>
          </section>

          <section className={styles.themeSection}>
            <h3>Package Discovery</h3>
            <input
              className={styles.themeSelect}
              value={packageQuery}
              onChange={(event) => setPackageQuery(event.target.value)}
              placeholder="Search Typst packages"
            />
            <div className={styles.packageCatalogList}>
              {filteredCatalog.map((entry) => (
                <div key={entry.packageId} className={styles.packageCatalogCard}>
                  <div>
                    <strong>{entry.packageId}</strong>
                    <p className={styles.panelDescription}>{entry.description}</p>
                    <span className={styles.searchResultMeta}>Latest suggested version: {entry.latestVersion}</span>
                  </div>
                  {canEdit ? (
                    <button className={styles.panelIconBtn} onClick={() => handleAddPackage(entry.packageId, entry.latestVersion)} title={`Pin ${entry.packageId}`} aria-label={`Pin ${entry.packageId}`}>
                      <Plus size={16} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))}
              {!filteredCatalog.length ? <p className={styles.panelDescription}>No catalog packages matched the current query.</p> : null}
            </div>
          </section>

          <section className={styles.themeSection}>
            <h3>Project Fonts</h3>
            <p className={styles.panelDescription}>Upload `.ttf`, `.otf`, `.ttc`, `.woff`, or `.woff2` files. They will be available to Typst during compile and export.</p>
            <div className={styles.assetLibraryList}>
              {ecosystem?.projectFonts.length ? ecosystem.projectFonts.map((font) => (
                <div key={font.fileId} className={styles.assetLibraryCard}>
                  <div>
                    <strong>{font.name}</strong>
                    <p className={styles.panelDescription}>{font.path}</p>
                  </div>
                </div>
              )) : <p className={styles.panelDescription}>No project fonts uploaded yet.</p>}
            </div>
            <div className={styles.panelIconActions}>
              <button className={styles.primaryIconBtn} onClick={onUploadProjectFont} disabled={!canEdit} title="Upload font" aria-label="Upload font">
                <UploadIcon size={16} aria-hidden />
              </button>
            </div>
          </section>
        </>
      ) : null}

      <section className={styles.themeSection}>
        <h3>Reusable Asset Library</h3>
        <p className={styles.panelDescription}>Keep diagrams, logos, templates, and shared media in a personal library you can import into any project.</p>
        <div className={styles.assetLibraryControls}>
          <button className={styles.panelIconBtn} onClick={onUploadReusableAsset} title="Upload to library" aria-label="Upload to library">
            <UploadIcon size={16} aria-hidden />
          </button>
          <button className={styles.panelIconBtn} onClick={() => void onAddCurrentFileToLibrary()} disabled={activeFile.mimeType === DRIVE_FOLDER_MIME_TYPE} title="Add current file to library" aria-label="Add current file to library">
            <Plus size={16} aria-hidden />
          </button>
        </div>
        <p className={styles.panelDescription}>Imports will go to {targetFolderPath ? targetFolderPath : 'the project root'}.</p>
        <div className={styles.assetLibraryList}>
          {ecosystem?.reusableAssets.length ? ecosystem.reusableAssets.map((asset) => (
            <div key={asset.id} className={styles.assetLibraryCard}>
              <div>
                <strong>{asset.name}</strong>
                <p className={styles.panelDescription}>{asset.path}</p>
              </div>
              <div className={styles.assetLibraryActions}>
                {canEdit ? (
                  <button className={styles.panelIconBtn} onClick={() => void onImportReusableAsset(asset)} title={`Import ${asset.name}`} aria-label={`Import ${asset.name}`}>
                    <DownloadIcon size={16} aria-hidden />
                  </button>
                ) : null}
                <button className={styles.dangerIconBtn} onClick={() => void onDeleteReusableAsset(asset)} title={`Delete ${asset.name}`} aria-label={`Delete ${asset.name}`}>
                  <TrashIcon size={16} aria-hidden />
                </button>
              </div>
            </div>
          )) : <p className={styles.panelDescription}>Your reusable asset library is empty.</p>}
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Metadata Files</h3>
        <p className={styles.panelDescription}>
          {isLatexProject
            ? 'Edit managed workspace metadata files used by your LaTeX project.'
            : 'Edit the managed project files used for workspace metadata and Typst configuration.'}
        </p>
        <div className={styles.metadataEditorList}>
          {(ecosystem?.metadataFiles ?? []).map((file: ProjectMetadataFile) => (
            <label key={file.path} className={styles.themeField}>
              <span>{file.path}</span>
              <span className={styles.panelDescription}>{file.description}</span>
              <textarea
                className={styles.commentInput}
                rows={file.path.endsWith('.toml') ? 8 : 10}
                value={metadataDraft[file.path] ?? ''}
                onChange={(event) => setMetadataDraft((current) => ({ ...current, [file.path]: event.target.value }))}
                disabled={!canEdit || isSavingMetadata}
              />
            </label>
          ))}
        </div>
        <div className={styles.panelIconActions}>
          <button className={styles.primaryIconBtn} onClick={() => void handleSaveMetadata()} disabled={!canEdit || isSavingMetadata} title={isSavingMetadata ? 'Saving metadata files' : 'Save metadata files'} aria-label={isSavingMetadata ? 'Saving metadata files' : 'Save metadata files'}>
            {isSavingMetadata ? <Loader2 size={16} aria-hidden className={styles.spin} /> : <Save size={16} aria-hidden />}
          </button>
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Validation</h3>
        <p className={styles.panelDescription}>
          {isLatexProject
            ? 'Static checks run across project files to catch missing includes, assets, and metadata mistakes before they surprise the compiler.'
            : 'Static checks run across project files to catch missing includes, assets, metadata mistakes, and package pin mismatches before they surprise the compiler.'}
        </p>
        <div className={styles.validationList}>
          {ecosystem?.validationIssues.length ? ecosystem.validationIssues.map((issue: EcosystemValidationIssue, index) => (
            <div key={`${issue.code}-${issue.filePath ?? 'global'}-${issue.line ?? 0}-${index}`} className={styles.validationCard}>
              <div className={styles.validationHeaderRow}>
                <strong>{issue.message}</strong>
                <span className={issue.level === 'warning' ? styles.commentStatusOpen : styles.commentStatusDeleted}>{issue.level}</span>
              </div>
              <span className={styles.searchResultMeta}>{issue.filePath ? `${issue.filePath}${issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : ''}` : 'Project-wide setting'}</span>
            </div>
          )) : <p className={styles.panelDescription}>No ecosystem issues detected right now.</p>}
        </div>
      </section>

      <section className={styles.themeSection}>
        <h3>Template Compliance</h3>
        <p className={styles.panelDescription}>
          {activeTemplate
            ? `${activeTemplate.title} · ${livePageCount || 0} live preview page${livePageCount === 1 ? '' : 's'}${(activeTemplate.pageLimit ?? null) ? ` · recommended limit ${activeTemplate.pageLimit}` : ''}`
            : 'Assigning a starter template enables style and page-limit checks here.'}
        </p>
        <div className={styles.validationList}>
          {complianceIssues.length ? complianceIssues.map((issue, index) => (
            <div key={`${issue.message}-${index}`} className={styles.validationCard}>
              <div className={styles.validationHeaderRow}>
                <strong>{issue.message}</strong>
                <span className={issue.level === 'warning' ? styles.commentStatusOpen : styles.commentStatusDeleted}>{issue.level}</span>
              </div>
            </div>
          )) : <p className={styles.panelDescription}>No template compliance issues detected right now.</p>}
        </div>
      </section>
    </>
  )

  if (inSidebar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {content}
      </div>
    )
  }

  return (
    <aside className={styles.themePanel}>
      {content}
    </aside>
  )
}

function AssetPanel({ projectId, file }: { projectId: string; file: ProjectFile }) {
  const assetUrl = `/api/projects/${projectId}/files/${file.id}/content`
  const thumbnailUrl = `/api/projects/${projectId}/files/${file.id}/thumbnail`

  if (file.mimeType.startsWith('image/')) {
    return (
      <div className={styles.assetPanel}>
        <div className={styles.assetMeta}>
          <span className={styles.assetTag}>Image Asset</span>
          <h3>{file.name}</h3>
          <p>{file.path}</p>
        </div>
        <img className={styles.assetImage} src={thumbnailUrl} alt={file.name} loading="lazy" />
      </div>
    )
  }

  return (
    <div className={styles.assetPanel}>
      <div className={styles.assetMeta}>
        <span className={styles.assetTag}>Binary Asset</span>
        <h3>{file.name}</h3>
        <p>{file.path}</p>
        <p>{file.mimeType || 'application/octet-stream'}</p>
        <a className={styles.assetLink} href={`${assetUrl}?download=1`}>Download file</a>
      </div>
    </div>
  )
}

function roleLabel(role: ProjectRole): string {
  if (role === 'owner') {
    return 'owner'
  }

  if (role === 'manager') {
    return 'manager'
  }

  return role === 'editor' ? 'writer' : 'reviewer'
}

function buildFileTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = []
  const folderMap = new Map<string, Extract<TreeNode, { type: 'folder' }>>()
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path))

  for (const file of sorted) {
    const segments = file.path.split('/')
    const name = segments[segments.length - 1]
    const parentSegments = segments.slice(0, -1)
    const parentNode = parentSegments.length ? ensureFolderChain(parentSegments, root, folderMap) : null

    const node: TreeNode = file.mimeType === DRIVE_FOLDER_MIME_TYPE
      ? upsertFolderNode(folderMap, file, name)
      : { type: 'file', name, file }

    const siblings = parentNode ? parentNode.children : root
    if (!siblings.some((existing) => existing.type === 'folder' && node.type === 'folder'
      ? existing.path === node.path
      : existing.type === 'file' && node.type === 'file' && existing.file.id === node.file.id)) {
      siblings.push(node)
    }
  }

  return sortTree(root)
}

function ensureFolderChain(
  segments: string[],
  root: TreeNode[],
  folderMap: Map<string, Extract<TreeNode, { type: 'folder' }>>,
): Extract<TreeNode, { type: 'folder' }> | null {
  let currentPath = ''
  let parent: Extract<TreeNode, { type: 'folder' }> | null = null

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    let folder = folderMap.get(currentPath)
    if (!folder) {
      folder = { type: 'folder', name: segment, path: currentPath, file: null, children: [] }
      folderMap.set(currentPath, folder)
      ;(parent ? parent.children : root).push(folder)
    }
    parent = folder
  }

  return parent
}

function upsertFolderNode(
  folderMap: Map<string, Extract<TreeNode, { type: 'folder' }>>,
  file: ProjectFile,
  name: string,
): Extract<TreeNode, { type: 'folder' }> {
  const existing = folderMap.get(file.path)
  if (existing) {
    existing.name = name
    existing.file = file
    return existing
  }

  const folder: Extract<TreeNode, { type: 'folder' }> = { type: 'folder', name, path: file.path, file, children: [] }
  folderMap.set(file.path, folder)
  return folder
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1
      }

      const leftName = left.type === 'folder' ? left.name : left.file.name
      const rightName = right.type === 'folder' ? right.name : right.file.name
      return leftName.localeCompare(rightName)
    })
    .map((node) => node.type === 'folder' ? { ...node, children: sortTree(node.children) } : node)
}

function expandAncestorPaths(current: Record<string, boolean>, path: string): Record<string, boolean> {
  const next = { ...current }
  const segments = path.split('/')
  segments.pop()

  let runningPath = ''
  for (const segment of segments) {
    runningPath = runningPath ? `${runningPath}/${segment}` : segment
    next[runningPath] = true
  }

  return next
}

function normalizeBibtexEntriesForAppend(existingContent: string, incomingContent: string): string {
  const existingKeys = collectBibtexKeys(existingContent)
  const usedKeys = new Set(existingKeys)
  const entries = splitBibtexEntries(incomingContent)

  if (entries.length === 0) {
    return incomingContent.trim()
  }

  const newEntries = entries.filter((entry) => {
    const parsed = parseBibtexEntryHeader(entry)
    return !parsed || !usedKeys.has(parsed.key)
  })

  if (newEntries.length === 0) {
    return ''
  }

  return newEntries.map((entry) => {
    const parsed = parseBibtexEntryHeader(entry)
    if (!parsed) {
      return entry.trim()
    }

    const nextKey = createUniqueBibtexKey(parsed.key, usedKeys)
    usedKeys.add(nextKey)
    const keyedEntry = nextKey === parsed.key
      ? entry.trim()
      : rewriteBibtexEntryKey(entry, parsed.key, nextKey)

    return sanitizeBibtexEntryDates(keyedEntry)
  }).join('\n\n')
}

function collectBibtexKeys(content: string): Set<string> {
  return new Set(splitBibtexEntries(content)
    .map((entry) => parseBibtexEntryHeader(entry)?.key)
    .filter((key): key is string => Boolean(key)))
}

function splitBibtexEntries(content: string): string[] {
  // More robust splitting that handles nested braces better
  const results: string[] = []
  const entryPattern = /@([A-Za-z]+)\s*\{/g
  let match: RegExpExecArray | null

  while ((match = entryPattern.exec(content)) !== null) {
    const start = match.index
    let depth = 0
    let end = -1
    for (let i = start + match[0].length - 1; i < content.length; i++) {
      if (content[i] === '{') depth++
      else if (content[i] === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    if (end !== -1) {
      results.push(content.slice(start, end).trim())
      entryPattern.lastIndex = end
    }
  }

  return results
}

function parseBibtexEntryHeader(entry: string): { entryType: string; key: string } | null {
  const match = entry.match(/^@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,/)
  if (!match) {
    return null
  }

  return {
    entryType: match[1],
    key: match[2],
  }
}

function extractBibtexEntryKey(entry: string): string | null {
  return parseBibtexEntryHeader(entry)?.key ?? null
}

function parsePeerReviewMetadata(content: string | undefined): { submissions: PeerReviewSubmissionRecord[] } {
  if (!content?.trim()) {
    return { submissions: [] }
  }

  try {
    const parsed = JSON.parse(content) as { peerReview?: { submissions?: unknown[] } }
    const submissions = Array.isArray(parsed.peerReview?.submissions)
      ? parsed.peerReview.submissions.map(normalizeSubmissionRecord).filter((record): record is PeerReviewSubmissionRecord => Boolean(record))
      : []
    return { submissions }
  } catch {
    return { submissions: [] }
  }
}

function parseArxivMetadata(content: string | undefined): ArxivLookupResult | null {
  if (!content?.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(content) as { arxiv?: unknown }
    return normalizeArxivMetadata(parsed.arxiv)
  } catch {
    return null
  }
}

function normalizeArxivMetadata(input: unknown): ArxivLookupResult | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const paper = input as Partial<ArxivLookupResult>
  return {
    id: typeof paper.id === 'string' ? paper.id : '',
    title: typeof paper.title === 'string' ? paper.title : '',
    authors: Array.isArray(paper.authors) ? paper.authors.filter((value): value is string => typeof value === 'string') : [],
    summary: typeof paper.summary === 'string' ? paper.summary : '',
    published: typeof paper.published === 'string' ? paper.published : null,
    updated: typeof paper.updated === 'string' ? paper.updated : null,
    categories: Array.isArray(paper.categories) ? paper.categories.filter((value): value is string => typeof value === 'string') : [],
    doi: typeof paper.doi === 'string' ? paper.doi : null,
    journalRef: typeof paper.journalRef === 'string' ? paper.journalRef : null,
    pdfUrl: typeof paper.pdfUrl === 'string' ? paper.pdfUrl : null,
  }
}

function normalizeSubmissionRecord(input: unknown): PeerReviewSubmissionRecord | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const record = input as Partial<Record<keyof PeerReviewSubmissionRecord, unknown>>
  return {
    venue: typeof record.venue === 'string' ? record.venue : '',
    submissionDate: typeof record.submissionDate === 'string' ? record.submissionDate : '',
    manuscriptId: typeof record.manuscriptId === 'string' ? record.manuscriptId : '',
    editorContact: typeof record.editorContact === 'string' ? record.editorContact : '',
    roundLabel: typeof record.roundLabel === 'string' ? record.roundLabel : '',
  }
}

function updatePeerReviewMetadataContent(existingContent: string | undefined, record: PeerReviewSubmissionRecord): string {
  let parsed: Record<string, unknown> = {}
  if (existingContent?.trim()) {
    try {
      parsed = JSON.parse(existingContent) as Record<string, unknown>
    } catch {
      parsed = {}
    }
  }

  const current = parsePeerReviewMetadata(existingContent).submissions
  const normalizedRecord = normalizeSubmissionRecord(record) ?? {
    venue: '',
    submissionDate: '',
    manuscriptId: '',
    editorContact: '',
    roundLabel: '',
  }
  const recordKey = submissionRecordKey(normalizedRecord)
  const submissions = [
    normalizedRecord,
    ...current.filter((entry) => submissionRecordKey(entry) !== recordKey),
  ]

  return JSON.stringify({
    ...parsed,
    peerReview: {
      ...(typeof parsed.peerReview === 'object' && parsed.peerReview ? parsed.peerReview : {}),
      submissions,
    },
  }, null, 2)
}

function updateArxivMetadataContent(existingContent: string | undefined, paper: ArxivLookupResult): string {
  let parsed: Record<string, unknown> = {}
  if (existingContent?.trim()) {
    try {
      parsed = JSON.parse(existingContent) as Record<string, unknown>
    } catch {
      parsed = {}
    }
  }

  return JSON.stringify({
    ...parsed,
    arxiv: paper,
  }, null, 2)
}

function buildArxivPackageMetadata(submission: PeerReviewSubmissionRecord, arxivMetadata: ArxivLookupResult | null): Record<string, unknown> {
  return {
    title: arxivMetadata?.title ?? '',
    authors: arxivMetadata?.authors ?? [],
    abstract: arxivMetadata?.summary ?? '',
    categories: arxivMetadata?.categories ?? [],
    doi: arxivMetadata?.doi ?? '',
    journalRef: arxivMetadata?.journalRef ?? '',
    comments: submission.roundLabel,
    venue: submission.venue,
    manuscriptId: submission.manuscriptId || arxivMetadata?.id || '',
    submissionDate: submission.submissionDate,
    editorContact: submission.editorContact,
  }
}

function submissionRecordKey(record: PeerReviewSubmissionRecord): string {
  return [record.roundLabel, record.venue, record.submissionDate, record.manuscriptId].join('|').toLowerCase()
}

function parseReviewerComments(input: string): ParsedReviewerComment[] {
  const normalized = input.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
  const comments: ParsedReviewerComment[] = []
  let currentReviewer = 'Reviewer'
  let nextNumberByReviewer = new Map<string, number>()

  for (const block of blocks) {
    const headingMatch = block.match(/^(reviewer|referee)\s*#?\s*([A-Za-z0-9.-]+)?\s*:?\s*$/i)
    if (headingMatch) {
      currentReviewer = headingMatch[2] ? `Reviewer ${headingMatch[2]}` : headingMatch[1]
      continue
    }

    const inlineReviewer = block.match(/^(reviewer|referee)\s*#?\s*([A-Za-z0-9.-]+)?\s*[:.-]\s*([\s\S]+)/i)
    const reviewer = inlineReviewer
      ? `${inlineReviewer[1][0].toUpperCase()}${inlineReviewer[1].slice(1).toLowerCase()}${inlineReviewer[2] ? ` ${inlineReviewer[2]}` : ''}`
      : currentReviewer
    const text = (inlineReviewer?.[3] ?? block).replace(/^\s*(comment|major|minor)\s*\d*\s*[:.-]\s*/i, '').trim()
    if (!text) {
      continue
    }

    const nextNumber = nextNumberByReviewer.get(reviewer) ?? 1
    comments.push({ reviewer, number: nextNumber, text })
    nextNumberByReviewer = new Map(nextNumberByReviewer).set(reviewer, nextNumber + 1)
  }

  return comments
}

function buildReviewerCommentsDocument(comments: ParsedReviewerComment[], submission: PeerReviewSubmissionRecord): string {
  return [
    '# Reviewer Comments',
    '',
    ...submissionMetadataLines(submission),
    '',
    ...comments.flatMap((comment) => [
      `## ${comment.reviewer}.${comment.number}`,
      '',
      comment.text,
      '',
    ]),
  ].join('\n').trimEnd() + '\n'
}

function buildPointByPointResponseDocument(comments: ParsedReviewerComment[], submission: PeerReviewSubmissionRecord): string {
  return [
    '# Response to Reviewers',
    '',
    ...submissionMetadataLines(submission),
    '',
    'Thank you for the careful review. We respond point by point below.',
    '',
    ...comments.flatMap((comment) => [
      `## ${comment.reviewer}.${comment.number}`,
      '',
      '**Reviewer comment**',
      '',
      quoteMarkdownBlock(comment.text),
      '',
      '**Response**',
      '',
      'TODO: Add response.',
      '',
      '**Manuscript location**',
      '',
      'TODO: Section, page, paragraph, or line reference.',
      '',
    ]),
  ].join('\n').trimEnd() + '\n'
}

function submissionMetadataLines(submission: PeerReviewSubmissionRecord): string[] {
  const lines = [
    ['Venue', submission.venue],
    ['Submission date', submission.submissionDate],
    ['Manuscript ID', submission.manuscriptId],
    ['Editor contact', submission.editorContact],
    ['Round', submission.roundLabel],
  ].filter(([, value]) => value.trim())

  return lines.length ? lines.map(([label, value]) => `- **${label}:** ${value}`) : ['- **Submission:** Unspecified']
}

function quoteMarkdownBlock(input: string): string {
  return input.split('\n').map((line) => `> ${line}`).join('\n')
}

function slugifyReviewToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'review'
}

function buildReviewRequestEdits(requests: SupervisorReviewRequest[]): Record<string, { supervisorName: string; message: string; expiresDate: string }> {
  return Object.fromEntries(requests.map((request) => [request.id, {
    supervisorName: request.supervisor_name ?? '',
    message: request.message ?? '',
    expiresDate: timestampToDateInput(request.expires_at),
  }]))
}

function createEmptyReviewRequestEdit(): { supervisorName: string; message: string; expiresDate: string } {
  return { supervisorName: '', message: '', expiresDate: '' }
}

function timestampToDateInput(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toISOString().slice(0, 10)
}

function reviewDateInputToTimestamp(input: string): number | null {
  if (!input) return null
  const timestamp = new Date(`${input}T23:59:59.999`).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function buildLineDiff(previousSource: string, currentSource: string): Array<{ kind: 'context' | 'added' | 'removed'; text: string; lineNumber: number | null }> {
  const previousLines = previousSource.split('\n')
  const currentLines = currentSource.split('\n')
  let prefix = 0
  while (prefix < previousLines.length && prefix < currentLines.length && previousLines[prefix] === currentLines[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previousLines.length - prefix
    && suffix < currentLines.length - prefix
    && previousLines[previousLines.length - 1 - suffix] === currentLines[currentLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const beforeContextStart = Math.max(0, prefix - 4)
  const previousChangedEnd = previousLines.length - suffix
  const currentChangedEnd = currentLines.length - suffix
  const afterContextEnd = Math.min(currentLines.length, currentChangedEnd + 4)

  return [
    ...currentLines.slice(beforeContextStart, prefix).map((text, index) => ({ kind: 'context' as const, text, lineNumber: beforeContextStart + index + 1 })),
    ...previousLines.slice(prefix, previousChangedEnd).map((text, index) => ({ kind: 'removed' as const, text, lineNumber: prefix + index + 1 })),
    ...currentLines.slice(prefix, currentChangedEnd).map((text, index) => ({ kind: 'added' as const, text, lineNumber: prefix + index + 1 })),
    ...currentLines.slice(currentChangedEnd, afterContextEnd).map((text, index) => ({ kind: 'context' as const, text, lineNumber: currentChangedEnd + index + 1 })),
  ]
}

function downloadBlobResponse(response: { data: Blob; headers?: any }, fallbackFileName: string): void {
  const dispositionValue = response.headers?.['content-disposition'] ?? response.headers?.['Content-Disposition']
  const disposition = typeof dispositionValue === 'string' ? dispositionValue : undefined
  const fileName = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackFileName
  const url = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

async function readBlobError(error: any, fallback: string): Promise<string> {
  if (error?.response?.data instanceof Blob) {
    try {
      const text = await error.response.data.text()
      const parsed = JSON.parse(text)
      return parsed.error ?? text
    } catch {
      return fallback
    }
  }
  return error?.response?.data?.error ?? error?.message ?? fallback
}

function createUniqueBibtexKey(baseKey: string, usedKeys: Set<string>): string {
  if (!usedKeys.has(baseKey)) {
    return baseKey
  }

  let suffix = 2
  while (usedKeys.has(`${baseKey}-${suffix}`)) {
    suffix += 1
  }

  return `${baseKey}-${suffix}`
}

function rewriteBibtexEntryKey(entry: string, currentKey: string, nextKey: string): string {
  return entry.replace(
    new RegExp(`^(@[A-Za-z]+\\s*\\{\\s*)${escapeRegExp(currentKey)}(\\s*,)`),
    `$1${nextKey}$2`,
  ).trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatBibtexFileContent(content: string): string {
  const { preamble, entries, suffix } = splitBibtexDocument(content)
  if (entries.length === 0) {
    return content
  }

  const formattedEntries = entries.map((entry) => formatBibtexEntry(sanitizeBibtexEntryDates(entry)))
  return [preamble, formattedEntries.join('\n\n'), suffix].filter((part) => part.trim().length > 0).join('\n\n').trimEnd() + '\n'
}

function sortBibtexFileContent(content: string): string {
  const { preamble, entries, suffix } = splitBibtexDocument(content)
  if (entries.length === 0) {
    return content
  }

  const sortedEntries = [...entries].sort((left, right) => {
    const leftKey = parseBibtexEntryHeader(left)?.key ?? left
    const rightKey = parseBibtexEntryHeader(right)?.key ?? right
    return leftKey.localeCompare(rightKey)
  })

  return [preamble, sortedEntries.join('\n\n'), suffix].filter((part) => part.trim().length > 0).join('\n\n').trimEnd() + '\n'
}

function deduplicateBibtexFileContent(content: string): string {
  const { preamble, entries, suffix } = splitBibtexDocument(content)
  if (entries.length < 2) {
    return content
  }

  const seen = new Set<string>()
  const unique: string[] = []
  for (const entry of entries) {
    const key = parseBibtexEntryHeader(entry)?.key
    const dedupeKey = key ? key.toLowerCase() : entry
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    unique.push(entry)
  }

  if (unique.length === entries.length) {
    return content
  }

  return [preamble, unique.join('\n\n'), suffix].filter((part) => part.trim().length > 0).join('\n\n').trimEnd() + '\n'
}

function countBibtexEntries(content: string): number {
  return splitBibtexDocument(content).entries.length
}

function splitBibtexDocument(content: string): { preamble: string; entries: string[]; suffix: string } {
  const matches = [...content.matchAll(/@[A-Za-z]+\s*\{\s*[^,\s]+\s*,[\s\S]*?\n?\}(?=\s*@|\s*$)/g)]
  if (matches.length === 0) {
    return { preamble: content.trim(), entries: [], suffix: '' }
  }

  const entries = matches.map((match) => match[0].trim())
  const firstIndex = matches[0].index ?? 0
  const lastMatch = matches[matches.length - 1]
  const lastIndex = (lastMatch.index ?? 0) + lastMatch[0].length
  return {
    preamble: content.slice(0, firstIndex).trim(),
    entries,
    suffix: content.slice(lastIndex).trim(),
  }
}

function formatBibtexEntry(entry: string): string {
  const trimmed = entry.trim()
  const match = trimmed.match(/^@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*)\}\s*$/)
  if (!match) {
    return trimmed
  }

  const entryType = match[1]
  const key = match[2]
  const fields = parseBibtexFields(match[3])
  if (fields.length === 0) {
    return trimmed
  }

  const orderedFields = sortBibtexFields(sanitizeBibtexDateFields(fields))
  return [
    `@${entryType}{${key},`,
    ...orderedFields.map(({ name, value }) => `  ${name} = ${value},`),
    '}',
  ].join('\n')
}

function sanitizeBibtexEntryDates(entry: string): string {
  return formatBibtexEntry(entry)
}

function sanitizeBibtexDateFields(fields: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return fields
    .map((field) => {
      if (!BIBTEX_DATE_FIELD_NAMES.has(field.name)) {
        return field
      }

      const normalized = normalizeBibtexDateValue(field.name, field.value)
      return normalized ? { ...field, value: normalized } : null
    })
    .filter((field): field is { name: string; value: string } => Boolean(field))
}

const BIBTEX_DATE_FIELD_NAMES = new Set(['date', 'year', 'urldate', 'origdate', 'eventdate'])

function normalizeBibtexDateValue(fieldName: string, value: string): string | null {
  const quote = value.match(/^"([\s\S]*)"$/)
  const braces = value.match(/^\{([\s\S]*)\}$/)
  const raw = (quote?.[1] ?? braces?.[1] ?? value).trim()

  if (!raw) {
    return null
  }

  if (fieldName === 'year') {
    return /^\d{4}$/.test(raw) ? `{${raw}}` : null
  }

  const match = raw.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/)
  if (!match) {
    return value
  }

  const year = match[1]
  const month = match[2]
  const day = match[3]
  if (!month) {
    return `{${year}}`
  }

  const monthNumber = Number(month)
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null
  }

  if (!day) {
    return `{${year}-${String(monthNumber).padStart(2, '0')}}`
  }

  const dayNumber = Number(day)
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) {
    return null
  }

  return `{${year}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}}`
}

function parseBibtexFields(body: string): Array<{ name: string; value: string }> {
  const segments: string[] = []
  let current = ''
  let braceDepth = 0
  let inQuote = false

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === '"' && body[index - 1] !== '\\') {
      inQuote = !inQuote
    } else if (!inQuote && char === '{') {
      braceDepth += 1
    } else if (!inQuote && char === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
    }

    if (!inQuote && braceDepth === 0 && char === ',') {
      if (current.trim()) {
        segments.push(current.trim())
      }
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    segments.push(current.trim())
  }

  return segments
    .map((segment) => {
      const separatorIndex = segment.indexOf('=')
      if (separatorIndex === -1) {
        return null
      }

      return {
        name: segment.slice(0, separatorIndex).trim().toLowerCase(),
        value: segment.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((field): field is { name: string; value: string } => Boolean(field?.name && field.value))
}

function sortBibtexFields(fields: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  const priority = ['author', 'title', 'journal', 'booktitle', 'publisher', 'year', 'doi', 'url', 'abstract']
  return [...fields].sort((left, right) => {
    const leftPriority = priority.indexOf(left.name)
    const rightPriority = priority.indexOf(right.name)
    if (leftPriority !== -1 || rightPriority !== -1) {
      if (leftPriority === -1) return 1
      if (rightPriority === -1) return -1
      return leftPriority - rightPriority
    }
    return left.name.localeCompare(right.name)
  })
}

function computeSingleRangeReplacement(previousSource: string, nextSource: string): {
  startOffset: number
  endOffset: number
  replacementText: string
  excerpt: string
} | null {
  if (previousSource === nextSource) {
    return null
  }

  const previousLength = previousSource.length
  const nextLength = nextSource.length
  let prefix = 0
  const prefixLimit = Math.min(previousLength, nextLength)
  while (prefix < prefixLimit && previousSource.charCodeAt(prefix) === nextSource.charCodeAt(prefix)) {
    prefix += 1
  }

  let suffix = 0
  const previousRemaining = previousLength - prefix
  const nextRemaining = nextLength - prefix
  while (
    suffix < previousRemaining
    && suffix < nextRemaining
    && previousSource.charCodeAt(previousLength - 1 - suffix) === nextSource.charCodeAt(nextLength - 1 - suffix)
  ) {
    suffix += 1
  }

  const startOffset = prefix
  const endOffset = previousLength - suffix
  const replacementText = nextSource.slice(prefix, nextLength - suffix)
  const excerpt = previousSource.slice(startOffset, endOffset).replace(/\s+/g, ' ').trim().slice(0, 160)

  return {
    startOffset,
    endOffset,
    replacementText,
    excerpt,
  }
}

function normalizeAiEditedDocument(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:typst|tex|latex|text)?\s*\n([\s\S]*?)\n```$/i)
  return fenced?.[1] ?? value
}

function normalizeAiFilePath(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\\/g, '/')
}

function computeAiEditSuggestions(input: {
  fileId: string
  previousSource: string
  nextSource: string
}): AiEditSuggestion[] {
  if (input.previousSource === input.nextSource) {
    return []
  }

  const previousLines = splitPreservingLineEndings(input.previousSource)
  const nextLines = splitPreservingLineEndings(input.nextSource)
  const cellCount = previousLines.length * nextLines.length

  if (cellCount > 400_000) {
    const patch = computeSingleRangeReplacement(input.previousSource, input.nextSource)
    return patch ? [aiEditFromOffsets(input.fileId, input.previousSource, patch.startOffset, patch.endOffset, patch.replacementText)] : []
  }

  const previousOffsets = lineStartOffsets(previousLines)
  const nextOffsets = lineStartOffsets(nextLines)
  const dp = Array.from({ length: previousLines.length + 1 }, () => new Uint16Array(nextLines.length + 1))

  for (let i = previousLines.length - 1; i >= 0; i -= 1) {
    for (let j = nextLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = previousLines[i] === nextLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const edits: AiEditSuggestion[] = []
  let i = 0
  let j = 0
  while (i < previousLines.length || j < nextLines.length) {
    if (i < previousLines.length && j < nextLines.length && previousLines[i] === nextLines[j]) {
      i += 1
      j += 1
      continue
    }

    const oldStart = i
    const newStart = j
    while (i < previousLines.length || j < nextLines.length) {
      if (i < previousLines.length && j < nextLines.length && previousLines[i] === nextLines[j]) {
        break
      }
      if (j >= nextLines.length || (i < previousLines.length && dp[i + 1][j] >= dp[i][j + 1])) {
        i += 1
      } else {
        j += 1
      }
    }

    const from = previousOffsets[oldStart] ?? input.previousSource.length
    const to = previousOffsets[i] ?? input.previousSource.length
    const replacementText = input.nextSource.slice(nextOffsets[newStart] ?? input.nextSource.length, nextOffsets[j] ?? input.nextSource.length)
    edits.push(aiEditFromOffsets(input.fileId, input.previousSource, from, to, replacementText))
  }

  return edits.filter((edit) => edit.originalText !== edit.replacementText)
}

function aiEditFromOffsets(fileId: string, source: string, from: number, to: number, replacementText: string): AiEditSuggestion {
  const originalText = source.slice(from, to)
  return {
    id: `ai-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    fileId,
    from,
    to,
    originalText,
    replacementText,
    kind: replacementText.length === 0 ? 'delete' : originalText.length === 0 ? 'insert' : 'replace',
    createdAt: Date.now(),
  }
}

function splitPreservingLineEndings(source: string): string[] {
  if (!source) {
    return []
  }

  return source.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function lineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length
  }
  offsets.push(offset)
  return offsets
}

function resolveAiEditRange(source: string, edit: AiEditSuggestion): { from: number; to: number } {
  const boundedFrom = Math.min(Math.max(0, edit.from), source.length)
  const boundedTo = Math.min(Math.max(boundedFrom, edit.to), source.length)
  if (source.slice(boundedFrom, boundedTo) === edit.originalText) {
    return { from: boundedFrom, to: boundedTo }
  }

  if (edit.originalText) {
    const nearbyStart = Math.max(0, boundedFrom - 500)
    const nearbyEnd = Math.min(source.length, boundedTo + 500)
    const nearbyIndex = source.slice(nearbyStart, nearbyEnd).indexOf(edit.originalText)
    if (nearbyIndex !== -1) {
      const from = nearbyStart + nearbyIndex
      return { from, to: from + edit.originalText.length }
    }

    const globalIndex = source.indexOf(edit.originalText)
    if (globalIndex !== -1) {
      return { from: globalIndex, to: globalIndex + edit.originalText.length }
    }
  }

  return { from: boundedFrom, to: boundedTo }
}

function applyAiEditsToSource(source: string, edits: AiEditSuggestion[]): string {
  let nextSource = source
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    const range = resolveAiEditRange(nextSource, edit)
    nextSource = `${nextSource.slice(0, range.from)}${edit.replacementText}${nextSource.slice(range.to)}`
  }
  return nextSource
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.min(Math.max(0, offset), source.length)
  const lines = source.slice(0, safeOffset).split('\n')
  const line = lines.length
  const column = (lines[lines.length - 1]?.length ?? 0) + 1
  return { line, column }
}

function tinymistJumpLocation(position: TinymistJumpEvent['start'], source: string): { line: number; column: number } | null {
  if (Array.isArray(position) && position.length >= 2) {
    const line = Number(position[0])
    const column = Number(position[1])
    if (Number.isFinite(line) && Number.isFinite(column)) {
      return {
        line: Math.max(1, Math.floor(line) + 1),
        column: Math.max(1, Math.floor(column) + 1),
      }
    }
  }

  if (typeof position === 'number' && Number.isFinite(position)) {
    return offsetToLineColumn(source, position)
  }

  return null
}

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '')
}

function findNearestLatexSyncTexEntry(entries: LatexSyncTexEntry[], position: { page: number; x: number; y: number; pdfX?: number; pdfY?: number }): LatexSyncTexEntry | null {
  const pageEntries = entries.filter((entry) => entry.page === position.page)
  if (pageEntries.length === 0) {
    return null
  }

  const yRange = latexSyncTexPageRange(pageEntries, 'y')
  const xRange = latexSyncTexPageRange(pageEntries, 'x')
  let best: LatexSyncTexEntry | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const entry of pageEntries) {
    const entryY = normalizeRangeValue(entry.y, yRange)
    const entryX = normalizeRangeValue(entry.x + Math.max(0, entry.width ?? 0) / 2, xRange)
    let score: number
    if (position.pdfX !== undefined && position.pdfY !== undefined) {
      // 10 points vertically roughly equals a line height. Give vertical distance more weight to stay on line.
      const pdfYSp = position.pdfY * 65781.76
      const pdfXSp = position.pdfX * 65781.76
      score = Math.abs(entry.y - pdfYSp) * 6 + Math.abs((entry.x + Math.max(0, entry.width ?? 0) / 2) - pdfXSp)
    } else {
      score = Math.abs(entryY - position.y) * 6 + Math.abs(entryX - position.x)
    }
    if (score < bestScore) {
      best = entry
      bestScore = score
    }
  }

  return best
}

function findLatexSyncTexEntryForSource(entries: LatexSyncTexEntry[], filePath: string, line: number, column: number): LatexSyncTexEntry | null {
  const normalizedPath = normalizeProjectPath(filePath)
  const fileEntries = entries.filter((entry) => normalizeProjectPath(entry.filePath) === normalizedPath)
  if (fileEntries.length === 0) {
    return null
  }

  return fileEntries.reduce<LatexSyncTexEntry | null>((best, entry) => {
    if (!best) return entry
    const entryScore = latexSourceDistance(entry, line, column)
    const bestScore = latexSourceDistance(best, line, column)
    return entryScore < bestScore ? entry : best
  }, null)
}

function latexSourceDistance(entry: LatexSyncTexEntry, line: number, column: number): number {
  const lineDistance = Math.abs(entry.line - line)
  const columnDistance = entry.column === null ? 0 : Math.abs(entry.column - column)
  return lineDistance * 1000 + columnDistance
}

// `synctex view` can return multiple PDF boxes for a given source line+column
// (e.g. one per occurrence in a list). Pick the one whose existing cached
// entry is closest to the cursor's column to avoid jumping pages on ambiguous
// queries.
function pickBestForwardBox(
  boxes: SyncTexViewBox[],
  entries: LatexSyncTexEntry[],
  line: number,
  column: number,
): SyncTexViewBox | null {
  if (boxes.length === 0) return null
  if (boxes.length === 1) return boxes[0]

  return boxes.reduce<SyncTexViewBox>((best, current) => {
    const bestNearest = nearestEntryDistance(entries, best, line, column)
    const currentNearest = nearestEntryDistance(entries, current, line, column)
    return currentNearest < bestNearest ? current : best
  }, boxes[0])
}

function nearestEntryDistance(entries: LatexSyncTexEntry[], box: SyncTexViewBox, line: number, column: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    if (entry.page !== box.page) continue
    const dx = entry.x - box.x
    const dy = entry.y - box.y
    const geometricDistance = Math.sqrt(dx * dx + dy * dy)
    const sourceDistance = latexSourceDistance(entry, line, column)
    const combined = geometricDistance + sourceDistance / 1000
    if (combined < best) best = combined
  }
  return best
}

function estimateLatexColumnFromPdfClick(
  entries: LatexSyncTexEntry[],
  target: LatexSyncTexEntry,
  normalizedX: number,
  source: string,
  pdfText?: string,
  pdfTextOffset?: number,
  pdfX?: number,
): number {
  if (target.column !== null) {
    return target.column
  }

  const lineText = source.split(/\r?\n/)[target.line - 1] ?? ''
  const geometryColumn = estimateLatexColumnFromGeometry(entries, target, pdfX !== undefined ? pdfX : normalizedX, lineText, pdfX !== undefined)
  const textColumn = estimateLatexColumnFromPdfText(lineText, geometryColumn, pdfText, pdfTextOffset)
  if (textColumn !== null) {
    return textColumn
  }
  if (geometryColumn !== null) {
    return geometryColumn
  }

  const sameLineEntries = entries
    .filter((entry) => entry.page === target.page && normalizeProjectPath(entry.filePath) === normalizeProjectPath(target.filePath) && entry.line === target.line && entry.column !== null)
    .sort((left, right) => left.x - right.x)
  if (sameLineEntries.length === 0) {
    return 1
  }

  const xRange = latexSyncTexPageRange(entries.filter((entry) => entry.page === target.page), 'x')
  let best = sameLineEntries[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const entry of sameLineEntries) {
    const entryX = normalizeRangeValue(entry.x + Math.max(0, entry.width ?? 0) / 2, xRange)
    const distance = Math.abs(entryX - normalizedX)
    if (distance < bestDistance) {
      best = entry
      bestDistance = distance
    }
  }
  return best.column ?? 1
}

function estimateLatexColumnFromGeometry(entries: LatexSyncTexEntry[], target: LatexSyncTexEntry, normalizedX: number, lineText: string, isAbsolutePoints = false): number | null {
  if (lineText.length > 0) {
    const pageEntries = entries.filter((entry) => entry.page === target.page)
    const xRange = latexSyncTexPageRange(pageEntries, 'x')
    let left: number
    let right: number
    let span: number
    let ratio: number
    if (isAbsolutePoints) {
      const normalizedXSp = normalizedX * 65781.76
      left = target.x
      right = target.x + Math.max(0, target.width ?? 0)
      span = Math.max(1, right - left)
      ratio = Math.min(1, Math.max(0, (normalizedXSp - left) / span))
    } else {
      const targetStart = normalizeRangeValue(target.x, xRange)
      const targetEnd = normalizeRangeValue(target.x + Math.max(0, target.width ?? 0), xRange)
      left = Math.min(targetStart, targetEnd)
      right = Math.max(targetStart, targetEnd)
      span = Math.max(0.01, right - left)
      ratio = Math.min(1, Math.max(0, (normalizedX - left) / span))
    }
    const firstNonWhitespace = Math.max(0, lineText.search(/\S/))
    const searchableLength = Math.max(1, lineText.trimEnd().length - firstNonWhitespace)
    return Math.max(1, firstNonWhitespace + Math.round(ratio * searchableLength) + 1)
  }

  return null
}

function estimateLatexColumnFromPdfText(lineText: string, preferredColumn: number | null, pdfText?: string, pdfTextOffset?: number): number | null {
  if (!lineText || !pdfText || typeof pdfTextOffset !== 'number') {
    return null
  }

  const wordHit = extractWordAroundOffset(pdfText, pdfTextOffset)
  if (!wordHit) {
    return null
  }

  const matches = findAllLineMatches(lineText, wordHit.word)
  if (matches.length === 0) {
    return null
  }

  const preferredIndex = Math.max(0, (preferredColumn ?? 1) - 1)
  const bestMatch = matches.reduce((best, current) => (
    Math.abs(current - preferredIndex) < Math.abs(best - preferredIndex) ? current : best
  ), matches[0])

  return Math.max(1, bestMatch + Math.min(wordHit.offsetInWord, wordHit.word.length) + 1)
}

function extractWordAroundOffset(text: string, offset: number): { word: string; offsetInWord: number } | null {
  const clampedOffset = Math.max(0, Math.min(text.length, offset))
  let start = clampedOffset
  let end = clampedOffset

  while (start > 0 && isLatexSyncTextCharacter(text[start - 1])) {
    start -= 1
  }
  while (end < text.length && isLatexSyncTextCharacter(text[end])) {
    end += 1
  }

  const word = text.slice(start, end).trim()
  if (word.length === 0) {
    return null
  }

  return { word, offsetInWord: Math.max(0, clampedOffset - start) }
}

function findAllLineMatches(lineText: string, needle: string): number[] {
  const matches = findAllLineMatchesExact(lineText, needle)
  if (matches.length > 0) {
    return matches
  }
  return findAllLineMatchesExact(lineText.toLocaleLowerCase(), needle.toLocaleLowerCase())
}

function findAllLineMatchesExact(lineText: string, needle: string): number[] {
  const matches: number[] = []
  let fromIndex = 0
  while (fromIndex <= lineText.length) {
    const index = lineText.indexOf(needle, fromIndex)
    if (index === -1) {
      break
    }
    matches.push(index)
    fromIndex = index + Math.max(1, needle.length)
  }
  return matches
}

function isLatexSyncTextCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}_'-]/u.test(value))
}

function normalizeLatexSyncTexY(entries: LatexSyncTexEntry[], target: LatexSyncTexEntry): number {
  const pageEntries = entries.filter((entry) => entry.page === target.page)
  return normalizeRangeValue(target.y, latexSyncTexPageRange(pageEntries, 'y'))
}

function latexSyncTexPageRange(entries: LatexSyncTexEntry[], key: 'x' | 'y'): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const entry of entries) {
    min = Math.min(min, entry[key])
    max = Math.max(max, entry[key])
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 1 }
}

function normalizeRangeValue(value: number, range: { min: number; max: number }): number {
  if (range.max <= range.min) {
    return 0
  }
  return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)))
}

function isRenderableTypstFile(file: ProjectFile): boolean {
  return file.mimeType !== DRIVE_FOLDER_MIME_TYPE && /\.typ$/i.test(file.name)
}

function isRenderableLatexFile(file: ProjectFile): boolean {
  return file.mimeType !== DRIVE_FOLDER_MIME_TYPE && /\.tex$/i.test(file.name)
}

function isRenderableDocumentFile(file: ProjectFile): boolean {
  return isRenderableTypstFile(file) || isRenderableLatexFile(file)
}

function inferProjectFormatFromFileName(fileName: string): ProjectFormat | null {
  if (/\.typ$/i.test(fileName)) return 'typst'
  if (/\.tex$/i.test(fileName)) return 'latex'
  if (/\.(md|markdown|txt)$/i.test(fileName)) return 'gdoc'
  return null
}

function isEditableTextFile(file: ProjectFile): boolean {
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return false
  }

  if (file.mimeType.startsWith('text/')) {
    return true
  }

  return isProjectTextFileName(file.name)
}

function isAiCollaborationTextFile(file: ProjectFile): boolean {
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return false
  }

  if (file.mimeType.startsWith('text/') && !/\.(aux|log|bbl|blg|toc|lof|lot|out|idx|ind|ilg|fls|fdb_latexmk|synctex)$/i.test(file.name)) {
    return true
  }

  return /\.(typ|txt|md|json|yaml|yml|bib|csv|toml|xml|svg|tex|ltx|latex|cls|sty|bst|bbx|cbx|def|clo|cfg|csl)$/i.test(file.name)
}

function isProjectTextFileName(fileName: string): boolean {
  return /\.(typ|txt|md|json|yaml|yml|bib|csv|toml|xml|svg|tex|ltx|latex|cls|sty|bst|bbx|cbx|def|clo|cfg|csl|log|aux|bbl|blg|toc|lof|lot|out|idx|ind|ilg|fls|fdb_latexmk|synctex)$/i.test(fileName)
}

function firstOpenableProjectFile(files: ProjectFile[]): ProjectFile | null {
  const editableFiles = files.filter(isEditableTextFile)
  return editableFiles.find((f) => /^main\.(tex|typ|md|txt)$/i.test(f.name))
    ?? editableFiles.find((f) => /^main\./i.test(f.name))
    ?? editableFiles[0]
    ?? files.find((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE)
    ?? files[0]
    ?? null
}

function isPdfFile(file: ProjectFile): boolean {
  return file.mimeType !== DRIVE_FOLDER_MIME_TYPE && (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name))
}

function parentDirectoryPath(filePath: string): string | null {
  const segments = filePath.split('/')
  if (segments.length <= 1) {
    return null
  }

  return segments.slice(0, -1).join('/')
}

function joinProjectPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

function applyOptimisticPathUpdate(files: ProjectFile[], target: ProjectFile, nextName: string, nextPath: string): ProjectFile[] {
  if (target.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    return files.map((file) => file.id === target.id ? { ...file, name: nextName, path: nextPath } : file)
  }

  return files.map((file) => {
    if (file.id === target.id) {
      return { ...file, name: nextName, path: nextPath }
    }

    if (!file.path.startsWith(`${target.path}/`)) {
      return file
    }

    return { ...file, path: `${nextPath}${file.path.slice(target.path.length)}` }
  })
}

function collectOptimisticallyRemovedFiles(files: ProjectFile[], target: ProjectFile): ProjectFile[] {
  if (target.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    return [target]
  }

  return files.filter((file) => file.id === target.id || file.path.startsWith(`${target.path}/`))
}

function createOptimisticUploadedFile(file: File, parentPath: string | null, index: number): ProjectFile {
  return {
    id: `optimistic-upload:${file.name}:${file.lastModified}:${index}`,
    projectId: '',
    name: file.name,
    path: joinProjectPath(parentPath, file.name),
    mimeType: file.type || 'application/octet-stream',
    driveFileId: `optimistic:${index}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function createOptimisticInvitation(projectId: string, email: string, role: Exclude<ProjectRole, 'owner'>, invitedByUserId: string, invitedByName: string): ProjectInvitation {
  const now = Date.now()
  return {
    id: `optimistic-invitation:${email}:${now}`,
    projectId,
    projectTitle: '',
    email,
    role,
    status: 'pending',
    invitedByUserId,
    invitedByName,
    respondedByEmail: null,
    createdAt: now,
    updatedAt: now,
  }
}

function fileListFromArray(files: File[]): FileList {
  const dataTransfer = new DataTransfer()
  for (const file of files) {
    dataTransfer.items.add(file)
  }
  return dataTransfer.files
}

function iconClassNameForFile(file: ProjectFile, classNames: Record<string, string>): string {
  if (/\.typ$/i.test(file.name)) return classNames.treeIconTypst
  if (isPdfFile(file)) return classNames.treeIconPdf
  if (file.mimeType.startsWith('image/')) return classNames.treeIconImage
  if (/\.(csv|json|yaml|yml|toml|xml)$/i.test(file.name)) return classNames.treeIconData
  if (/\.(md|txt|bib)$/i.test(file.name)) return classNames.treeIconText
  return classNames.treeIconBinary
}

function fileIconForFile(file: ProjectFile, size = 13): ReactNode {
  if (isEditableTextFile(file) || isPdfFile(file) || /\.(csv|json|yaml|yml|toml|xml)$/i.test(file.name)) {
    return <FileText size={size} strokeWidth={1.9} aria-hidden />
  }

  return <FileIconLucide size={size} strokeWidth={1.9} aria-hidden />
}

function treeDepthStyle(depth: number, basePadding: number, minGuideCount = 0): CSSProperties {
  const indent = 24
  const rowOffset = 6
  const branchX = 5
  const branchLeft = basePadding + rowOffset + Math.max(depth - 1, 0) * indent + branchX
  return {
    '--tree-depth': depth,
    '--tree-indent': `${indent}px`,
    '--tree-guide-count': Math.max(minGuideCount, depth),
    '--tree-row-offset': `${basePadding + rowOffset + depth * indent}px`,
    '--tree-branch-left': `${branchLeft}px`,
  } as CSSProperties
}

function OutlineTreeNode({
  node,
  collapsed,
  onToggle,
  onReveal,
  featureClassName,
}: {
  node: OutlineNode
  collapsed: Set<string>
  onToggle: (path: string) => void
  onReveal: (line: number, filePath?: string) => void
  featureClassName: (kind: OutlineItem['kind']) => string
}) {
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.path)
  const indent = 6 + (node.depth - 1) * 10
  return (
    <>
      <div
        className={[styles.outlineItem, featureClassName(node.kind)].join(' ')}
        style={{ paddingLeft: `${indent}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.outlineToggle}
            onClick={(e) => { e.stopPropagation(); onToggle(node.path) }}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!isCollapsed}
          >
            <ChevronRight
              size={12}
              aria-hidden
              style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 90ms ease' }}
            />
          </button>
        ) : (
          <span className={styles.outlineToggleSpacer} aria-hidden />
        )}
        <span className={[styles.outlineFeatureDot, featureClassName(node.kind)].join(' ')} />
        <button
          type="button"
          className={styles.outlineItemTitleButton}
          onClick={() => onReveal(node.line, node.filePath)}
          title={node.filePath ? `${node.filePath} line ${node.line}` : node.title}
        >
          <span className={styles.outlineTitle}>{node.title}</span>
          {node.filePath ? (
            <span className={styles.outlineMeta}>{node.filePath.split('/').pop()} L{node.line}</span>
          ) : (
            <span className={styles.outlineMeta}>L{node.line}</span>
          )}
        </button>
      </div>
      {hasChildren && !isCollapsed ? node.children.map((child) => (
        <OutlineTreeNode
          key={`outline-node-${child.path}`}
          node={child}
          collapsed={collapsed}
          onToggle={onToggle}
          onReveal={onReveal}
          featureClassName={featureClassName}
        />
      )) : null}
    </>
  )
}

// Build a nested tree from the flat outline list. Each node's `path` is a
// title-chain like "Methods/Sampling" that is stable across line-number
// shifts — used to key persistent UI state (e.g. collapse).
function buildOutlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []
  const counts = new Map<string, number>()

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1] ?? null
    const parentPath = parent ? parent.path : ''
    // Disambiguate siblings sharing a title (e.g. multiple "Figure" floats).
    const baseKey = `${parentPath}/${item.kind}:${item.title}`
    const seen = counts.get(baseKey) ?? 0
    counts.set(baseKey, seen + 1)
    const path = seen === 0 ? baseKey : `${baseKey}#${seen}`

    const node: OutlineNode = { ...item, path, children: [] }
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push(node)
  }

  return roots
}

function parseDocumentOutline(rootPath: string, fileContents: Map<string, string>): OutlineItem[] {
  const sectionDepthByLatexCommand: Record<string, number> = {
    part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5,
  }

  const items: OutlineItem[] = []
  let currentHeadingDepth = 0
  const childDepth = () => (currentHeadingDepth > 0 ? currentHeadingDepth + 1 : 1)
  const visited = new Set<string>()

  function resolveIncludePath(fromPath: string, includePath: string): string {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : ''
    const joined = dir + includePath
    // normalize simple ../ sequences
    const parts = joined.split('/')
    const out: string[] = []
    for (const p of parts) {
      if (p === '..') out.pop()
      else if (p !== '.') out.push(p)
    }
    return out.join('/')
  }

  function parseFile(filePath: string) {
    if (visited.has(filePath)) return
    visited.add(filePath)

    const source = fileContents.get(filePath)
    if (!source) return

    const lines = source.split(/\r?\n/)
    let typstEquationNumberingEnabled = false
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const lineNo = index + 1
      const trimmed = line.trim()

      if (/#(?:set|show)\s+math\.equation\b.*numbering\s*:/i.test(trimmed) && !/numbering\s*:\s*none\b/i.test(trimmed)) {
        typstEquationNumberingEnabled = true
      }

      // Typst include: #include "file.typ"
      const typstInclude = trimmed.match(/^#include\s+"([^"]+)"/)
      if (typstInclude) {
        parseFile(resolveIncludePath(filePath, typstInclude[1]))
        continue
      }

      // LaTeX input/include: \input{file} or \include{file}
      const latexInclude = trimmed.match(/^\\(?:input|include)\{([^}]+)\}/)
      if (latexInclude) {
        let inc = latexInclude[1].trim()
        if (!/\.tex$/i.test(inc)) inc += '.tex'
        parseFile(resolveIncludePath(filePath, inc))
        continue
      }

      const typstHeading = line.match(/^(=+)\s+(.+?)\s*$/)
      if (typstHeading) {
        const depth = typstHeading[1].length
        currentHeadingDepth = depth
        items.push({ id: `${filePath}:${lineNo}-section-${typstHeading[2]}`, depth, title: typstHeading[2], line: lineNo, kind: 'section', filePath })
        continue
      }

      const latexHeading = trimmed.match(/^\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{(.+?)\}/)
      if (latexHeading) {
        const depth = sectionDepthByLatexCommand[latexHeading[1]] ?? 2
        currentHeadingDepth = depth
        items.push({ id: `${filePath}:${lineNo}-section-${latexHeading[2]}`, depth, title: latexHeading[2], line: lineNo, kind: 'section', filePath })
        continue
      }

      if (/^\\begin\{figure\*?\}/.test(trimmed) || /#figure\s*\(/.test(trimmed)) {
        items.push({ id: `${filePath}:${lineNo}-figure`, depth: childDepth(), title: 'Figure', line: lineNo, kind: 'figure', filePath })
        continue
      }

      if (/^\\begin\{table\*?\}/.test(trimmed) || /#table\s*\(/.test(trimmed)) {
        items.push({ id: `${filePath}:${lineNo}-table`, depth: childDepth(), title: 'Table', line: lineNo, kind: 'table', filePath })
        continue
      }

      const isNumberedLatexEquation = /^\\begin\{(equation|align|alignat|gather|multline|eqnarray|flalign)\}/.test(trimmed)
      const isNumberedTypstEquation = /#equation\s*\(/.test(trimmed)
        && (typstEquationNumberingEnabled || /numbering\s*:/.test(trimmed) || /<eq[:\w-]*>/.test(trimmed))

      if (isNumberedLatexEquation || isNumberedTypstEquation) {
        items.push({ id: `${filePath}:${lineNo}-equation`, depth: childDepth(), title: 'Equation / Math', line: lineNo, kind: 'equation', filePath })
        continue
      }

      if (
        /^\\(bibliography|printbibliography)\b/.test(trimmed) ||
        /^\\begin\{thebibliography\}/.test(trimmed) ||
        /#bibliography\s*\(/.test(trimmed)
      ) {
        items.push({ id: `${filePath}:${lineNo}-bibliography`, depth: childDepth(), title: 'Bibliography', line: lineNo, kind: 'bibliography', filePath })
      }
    }
  }

  parseFile(rootPath)
  return items
}

function buildMinimapSegments(source: string, activeLine: number, outlineItems: OutlineItem[]): MinimapSegment[] {
  const totalLines = Math.max(1, source ? source.split(/\r?\n/).length : 1)
  const segmentCount = Math.min(120, totalLines)
  const linesPerSegment = Math.max(1, Math.ceil(totalLines / segmentCount))

  return Array.from({ length: segmentCount }, (_, index) => {
    const startLine = index * linesPerSegment + 1
    const endLine = Math.min(totalLines, startLine + linesPerSegment - 1)
    const segmentItems = outlineItems.filter((item) => item.line >= startLine && item.line <= endLine)
    const featurePriority: OutlineItem['kind'][] = ['figure', 'table', 'equation', 'bibliography', 'section', 'other']
    const dominantItem = featurePriority
      .map((kind) => segmentItems.find((item) => item.kind === kind))
      .find(Boolean) ?? null

    // If no outline item falls within this segment, fall back to the most
    // recent section heading before it so the tooltip still names the
    // enclosing context (e.g. body paragraphs of "Methods").
    const enclosingSection = dominantItem
      ? null
      : [...outlineItems].reverse().find((item) => item.kind === 'section' && item.line < startLine) ?? null

    return {
      index,
      startLine,
      endLine,
      isActive: activeLine >= startLine && activeLine <= endLine,
      // Only color when an actual outline item falls inside this segment;
      // otherwise the body paragraphs between headings would all light up
      // in the section colour (orange) and drown out the real markers.
      featureKind: dominantItem?.kind ?? null,
      // Label can still fall back to the enclosing section so the tooltip
      // names the surrounding context.
      featureLabel: dominantItem?.title ?? enclosingSection?.title ?? null,
    }
  })
}

function scanNomenclatureEntries(files: Array<{ path: string; content: string }>): NomenclatureEntry[] {
  const symbolMap = new Map<string, NomenclatureEntry>()
  const abbreviationMap = new Map<string, NomenclatureEntry>()

  for (const file of files) {
    const lines = file.content.split('\n')
    lines.forEach((line, index) => {
      const lineNumber = index + 1
      const context = line.trim().slice(0, 260)
      for (const abbreviation of extractAbbreviationsFromLine(line)) {
        const existing = abbreviationMap.get(abbreviation.term)
        if (existing) {
          existing.count += 1
          if (!existing.definition && abbreviation.definition) existing.definition = abbreviation.definition
        } else {
          abbreviationMap.set(abbreviation.term, {
            id: `abbreviation:${abbreviation.term}`,
            kind: 'abbreviation',
            term: abbreviation.term,
            definition: abbreviation.definition,
            source: abbreviation.definition ? 'scanned' : 'edited',
            count: 1,
            filePath: file.path,
            line: lineNumber,
            context,
          })
        }
      }

      for (const symbol of extractSymbolsFromLine(line)) {
        if (symbol.length > 24) continue
        const definition = inferSymbolDefinition(line, symbol)
        const existing = symbolMap.get(symbol)
        if (existing) {
          existing.count += 1
          if ((!existing.definition || existing.definition === 'Add definition') && definition) {
            existing.definition = definition
          }
        } else {
          symbolMap.set(symbol, {
            id: `symbol:${symbol}`,
            kind: 'symbol',
            term: symbol,
            definition: definition || 'Add definition',
            source: definition ? 'scanned' : 'edited',
            count: 1,
            filePath: file.path,
            line: lineNumber,
            context,
          })
        }
      }
    })
  }

  return [
    ...[...symbolMap.values()].sort(sortNomenclatureEntries),
    ...[...abbreviationMap.values()].sort(sortNomenclatureEntries),
  ]
}

function extractAbbreviationsFromLine(line: string): Array<{ term: string; definition: string }> {
  const entries: Array<{ term: string; definition: string }> = []
  const fullThenShort = /([A-Z][A-Za-z][A-Za-z0-9/&,\-\s]{2,80}?)\s*\(([A-Z][A-Z0-9-]{1,12})\)/g
  for (const match of line.matchAll(fullThenShort)) {
    const definition = match[1]?.replace(/\s+/g, ' ').trim() ?? ''
    const term = match[2]?.trim() ?? ''
    if (term && definition && !COMMON_ABBREVIATION_EXCLUSIONS.has(term)) {
      entries.push({ term, definition })
    }
  }

  const shortThenFull = /\b([A-Z][A-Z0-9-]{1,12})\s*\(([A-Z][A-Za-z][A-Za-z0-9/&,\-\s]{2,80}?)\)/g
  for (const match of line.matchAll(shortThenFull)) {
    const term = match[1]?.trim() ?? ''
    const definition = match[2]?.replace(/\s+/g, ' ').trim() ?? ''
    if (term && definition && !COMMON_ABBREVIATION_EXCLUSIONS.has(term)) {
      entries.push({ term, definition })
    }
  }

  return entries
}

function extractSymbolsFromLine(line: string): string[] {
  const symbols = new Set<string>()
  const mathFragments = [
    ...line.matchAll(/\$([^$]{1,240})\$/g),
    ...line.matchAll(/\\\(([^)]{1,240})\\\)/g),
    ...line.matchAll(/\\\[([^\]]{1,240})\\\]/g),
  ].map((match) => match[1] ?? '')

  for (const fragment of mathFragments) {
    for (const command of fragment.matchAll(/\\([a-zA-Z]+)\b/g)) {
      const name = command[1] ?? ''
      if (GREEK_SYMBOL_COMMANDS.has(name)) symbols.add(`\\${name}`)
    }
    for (const identifier of fragment.matchAll(/\b([A-Za-z][A-Za-z0-9_]{0,2})(?:\s*[_^]\s*\{?[A-Za-z0-9]+\}?)?\b/g)) {
      const symbol = identifier[0]?.trim()
      const base = identifier[1] ?? ''
      if (symbol && !MATH_WORD_EXCLUSIONS.has(base.toLowerCase())) symbols.add(symbol)
    }
    for (const greek of fragment.matchAll(/[\u0370-\u03ff]+/g)) {
      if (greek[0]) symbols.add(greek[0])
    }
  }

  for (const match of line.matchAll(/\bwhere\s+([A-Za-z][A-Za-z0-9_]{0,3}|\\[a-zA-Z]+)\s+(?:is|denotes|represents|indicates)\b/gi)) {
    if (match[1]) symbols.add(match[1])
  }

  return [...symbols]
}

function inferSymbolDefinition(line: string, symbol: string): string {
  const escaped = escapeRegExp(symbol)
  const patterns = [
    new RegExp(`\\bwhere\\s+${escaped}\\s+(?:is|denotes|represents|indicates)\\s+([^.;,]+)`, 'i'),
    new RegExp(`${escaped}\\s+(?:is|denotes|represents|indicates)\\s+([^.;,]+)`, 'i'),
    new RegExp(`${escaped}\\s*[:=]\\s*([^.;,]+)`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = line.match(pattern)
    const definition = match?.[1]?.replace(/\s+/g, ' ').trim()
    if (definition && definition.length > 1 && definition.length < 140) {
      return definition
    }
  }
  return ''
}

function sortNomenclatureEntries(left: NomenclatureEntry, right: NomenclatureEntry): number {
  if (left.definition === 'Add definition' && right.definition !== 'Add definition') return -1
  if (left.definition !== 'Add definition' && right.definition === 'Add definition') return 1
  return left.term.localeCompare(right.term)
}

function formatNomenclatureTypst(entries: NomenclatureEntry[], title: string, termLabel: string): string {
  const rows = entries
    .filter((entry) => entry.definition.trim() && entry.definition.trim() !== 'Add definition')
    .map((entry) => `- \`${entry.term.replace(/`/g, '\\`')}\`: ${entry.definition.trim()}`)
    .join('\n')
  return `= ${title}\n\n${rows || `No ${termLabel.toLowerCase()} entries saved yet.`}\n`
}

function reviseNomenclatureDefinitionInSource(source: string, entry: NomenclatureEntry, nextDefinition: string): string | null {
  const lines = source.split('\n')
  const index = entry.line - 1
  if (index < 0 || index >= lines.length) return null
  const originalLine = lines[index]
  const revisedLine = entry.kind === 'abbreviation'
    ? reviseAbbreviationDefinitionLine(originalLine, entry.term, entry.definition, nextDefinition)
    : reviseSymbolDefinitionLine(originalLine, entry.term, nextDefinition)
  if (!revisedLine || revisedLine === originalLine) return null
  lines[index] = revisedLine
  return lines.join('\n')
}

function reviseAbbreviationDefinitionLine(line: string, term: string, previousDefinition: string, nextDefinition: string): string | null {
  const escapedTerm = escapeRegExp(term)
  const escapedPrevious = previousDefinition && previousDefinition !== 'Add definition' ? escapeRegExp(previousDefinition) : ''
  if (escapedPrevious) {
    const fullThenShort = new RegExp(`${escapedPrevious}\\s*\\(${escapedTerm}\\)`)
    if (fullThenShort.test(line)) return line.replace(fullThenShort, `${nextDefinition} (${term})`)

    const shortThenFull = new RegExp(`\\b${escapedTerm}\\s*\\(${escapedPrevious}\\)`)
    if (shortThenFull.test(line)) return line.replace(shortThenFull, `${term} (${nextDefinition})`)
  }

  const fallbackFullThenShort = new RegExp(`([A-Z][A-Za-z][A-Za-z0-9/&,\\-\\s]{2,80}?)\\s*\\(${escapedTerm}\\)`)
  if (fallbackFullThenShort.test(line)) return line.replace(fallbackFullThenShort, `${nextDefinition} (${term})`)

  const fallbackShortThenFull = new RegExp(`\\b${escapedTerm}\\s*\\(([A-Z][A-Za-z][A-Za-z0-9/&,\\-\\s]{2,80}?)\\)`)
  if (fallbackShortThenFull.test(line)) return line.replace(fallbackShortThenFull, `${term} (${nextDefinition})`)

  return null
}

function reviseSymbolDefinitionLine(line: string, term: string, nextDefinition: string): string | null {
  const escapedTerm = escapeRegExp(term)
  const patterns = [
    new RegExp(`(\\bwhere\\s+${escapedTerm}\\s+(?:is|denotes|represents|indicates)\\s+)([^.;,]+)`, 'i'),
    new RegExp(`(${escapedTerm}\\s+(?:is|denotes|represents|indicates)\\s+)([^.;,]+)`, 'i'),
    new RegExp(`(${escapedTerm}\\s*[:=]\\s*)([^.;,]+)`, 'i'),
  ]
  for (const pattern of patterns) {
    if (pattern.test(line)) {
      return line.replace(pattern, `$1${nextDefinition}`)
    }
  }
  return null
}

const COMMON_ABBREVIATION_EXCLUSIONS = new Set(['PDF', 'URL', 'DOI', 'ISBN', 'HTTP', 'HTTPS'])
const MATH_WORD_EXCLUSIONS = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'min', 'max', 'lim', 'for', 'and', 'the', 'where'])
const GREEK_SYMBOL_COMMANDS = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
  'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau',
  'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi',
  'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
])

function sortComments(comments: ProjectComment[]): ProjectComment[] {
  return [...comments].map((comment) => ({
    ...comment,
    replies: [...comment.replies].sort((left, right) => left.createdAt - right.createdAt),
  })).sort((left, right) => {
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine
    }

    if (left.startColumn !== right.startColumn) {
      return left.startColumn - right.startColumn
    }

    return left.createdAt - right.createdAt
  })
}

function commentStatusLabel(status: ProjectComment['status']) {
  if (status === 'resolved') {
    return 'Resolved'
  }

  if (status === 'deleted') {
    return 'Deleted'
  }

  return 'Open'
}

function commentStatusClassName(status: ProjectComment['status']) {
  if (status === 'resolved') {
    return styles.commentStatusResolved
  }

  if (status === 'deleted') {
    return styles.commentStatusDeleted
  }

  return styles.commentStatusOpen
}

function normalizeCommentExcerpt(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function sourceContainsCommentExcerpt(source: string, normalizedExcerpt: string) {
  if (!normalizedExcerpt) {
    return false
  }

  return normalizeCommentExcerpt(source).includes(normalizedExcerpt)
}

function formatCommentRange(startLine: number, startColumn: number, endLine: number, endColumn: number) {
  return `${startLine}:${startColumn} - ${endLine}:${endColumn}`
}

function formatCommentAnchor(comment: ProjectComment) {
  if (comment.pdfAnnotation) {
    return `PDF page ${comment.pdfAnnotation.page} · handwritten note`
  }

  return formatCommentRange(comment.startLine, comment.startColumn, comment.endLine, comment.endColumn)
}

function evaluateTemplateCompliance({
  template,
  activeSource,
  allSources,
  livePageCount,
  configuredPageLimit,
}: {
  template: ProjectDetail['activeTemplate']
  activeSource: string
  allSources: string[]
  livePageCount: number
  configuredPageLimit: number | null
}): Array<{ level: 'warning' | 'error'; message: string }> {
  if (!template) {
    return []
  }

  const issues: Array<{ level: 'warning' | 'error'; message: string }> = []
  const combinedSource = [activeSource, ...allSources].join('\n')
  const headings = [...combinedSource.matchAll(/^=+\s+(.+)$/gm)].map((match) => match[1].trim())
  const requiredSections: string[] = Array.isArray(template.requiredSections) ? template.requiredSections : []

  for (const requiredSection of requiredSections) {
    if (!headings.some((heading) => heading.toLowerCase().includes(requiredSection.toLowerCase()))) {
      issues.push({ level: 'warning', message: `Missing required section for ${template.title}: ${requiredSection}.` })
    }
  }

  if (requiredSections.length > 1) {
    const order = requiredSections
      .map((section) => headings.findIndex((heading) => heading.toLowerCase().includes(section.toLowerCase())))
      .filter((index) => index >= 0)
    if (order.length > 1 && order.some((index, i) => i > 0 && index < order[i - 1])) {
      issues.push({ level: 'warning', message: `${template.title} sections appear out of the expected order.` })
    }
  }

  if (template.citationStyle === 'ieee' || template.citationStyle === 'numeric') {
    if (!/\[[0-9,\-\s]+\]/.test(combinedSource)) {
      issues.push({ level: 'warning', message: `${template.title} expects numbered citations like [1].` })
    }
  } else if (template.citationStyle === 'apa' || template.citationStyle === 'author-year') {
    if (!/\[[A-Z][A-Za-z]+,?\s+\d{4}\]/.test(combinedSource) && !/@[A-Za-z]/.test(combinedSource)) {
      issues.push({ level: 'warning', message: `${template.title} expects author-year citations or cite keys wired into the bibliography.` })
    }
  }

  if (template.styleProfileId?.includes('ieee') || template.styleProfileId?.includes('acm') || template.styleProfileId?.includes('cvpr') || template.styleProfileId?.includes('neurips') || template.styleProfileId?.includes('icml')) {
    if (!/#set text\(size:\s*10pt\)/.test(combinedSource)) {
      issues.push({ level: 'warning', message: `${template.title} usually uses a 10pt text size.` })
    }
    if (!/#set page\(margin:\s*1in\)/.test(combinedSource)) {
      issues.push({ level: 'warning', message: `${template.title} expects 1-inch page margins in the current scaffold.` })
    }
  }

  if (template.styleProfileId?.includes('thesis') || template.category.toLowerCase().includes('thesis')) {
    if (!/#include\s+"frontmatter\//.test(combinedSource)) {
      issues.push({ level: 'warning', message: `${template.title} expects front matter files and declaration pages.` })
    }
  }

  const effectivePageLimit = configuredPageLimit ?? template.pageLimit
  if (effectivePageLimit && livePageCount > effectivePageLimit) {
    issues.push({ level: 'error', message: `Current preview is ${livePageCount} pages, exceeding the ${effectivePageLimit}-page limit.` })
  }

  return issues
}

function formatCommentTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function normalizeShortcutBindings(input: Partial<ShortcutBindings>): ShortcutBindings {
  return {
    compile: normalizeShortcutBindingValue(input.compile, DEFAULT_SHORTCUT_BINDINGS.compile),
    save: normalizeShortcutBindingValue(input.save, DEFAULT_SHORTCUT_BINDINGS.save),
    search: normalizeShortcutBindingValue(input.search, DEFAULT_SHORTCUT_BINDINGS.search),
    projectSearch: normalizeShortcutBindingValue(input.projectSearch, DEFAULT_SHORTCUT_BINDINGS.projectSearch),
    toggleNavigation: normalizeShortcutBindingValue(input.toggleNavigation, DEFAULT_SHORTCUT_BINDINGS.toggleNavigation),
    quickExport: normalizeShortcutBindingValue(input.quickExport, DEFAULT_SHORTCUT_BINDINGS.quickExport),
    previousSection: normalizeShortcutBindingValue(input.previousSection, DEFAULT_SHORTCUT_BINDINGS.previousSection),
    nextSection: normalizeShortcutBindingValue(input.nextSection, DEFAULT_SHORTCUT_BINDINGS.nextSection),
    toggleFold: normalizeShortcutBindingValue(input.toggleFold, DEFAULT_SHORTCUT_BINDINGS.toggleFold),
    togglePreview: normalizeShortcutBindingValue(input.togglePreview, DEFAULT_SHORTCUT_BINDINGS.togglePreview),
    focusEditor: normalizeShortcutBindingValue(input.focusEditor, DEFAULT_SHORTCUT_BINDINGS.focusEditor),
    insertCite: normalizeShortcutBindingValue(input.insertCite, DEFAULT_SHORTCUT_BINDINGS.insertCite),
  }
}

function normalizeShortcutBindingValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}
