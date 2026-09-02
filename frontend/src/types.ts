export type AcademicRole = 'student' | 'phd_student' | 'postdoc' | 'researcher' | 'faculty' | 'staff' | 'other'

export interface WorkspaceTheme {
  presetId: string
  uiFontFamily: string
  uiFontSize: number
  editorFontFamily: string
  editorFontSize: number
}

export interface DomainPlanRule {
  id: string
  domain: string
  plan: SubscriptionPlan
  status: 'active' | 'inactive'
  limitsOverride: Partial<PlanLimits> | null
  validFrom: number | null
  validUntil: number | null
  createdAt: number
  updatedAt: number
}

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  driveRootFolderId: string | null
  geminiApiKey: string | null
  aiApiKeys: {
    anthropic: boolean
    openai: boolean
  }
  isAdmin: boolean
  disabledAt: number | null
  academicRole: AcademicRole | string | null
  department: string | null
  institutionName: string | null
  orcidId: string | null
  orcidName: string | null
  orcidLinkedAt: number | null
  selectedTheme: WorkspaceTheme | null
}

export type ProjectRole = 'owner' | 'manager' | 'editor' | 'viewer'
export type ExportFormat = 'docx' | 'latex' | 'html' | 'pdf'
export type ExportDestination = 'download' | 'drive'
export type ProjectFormat = 'typst' | 'latex' | 'gdoc'
export type SubscriptionPlan = 'free' | 'student_freemium' | 'personal' | 'team' | 'business' | 'institution' | 'research_enterprise'
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired'

export interface PlanLimits {
  activeProjects: number | null
  collaboratorsPerProject: number | null
  fileStoragePerProjectMb: number | null
  totalStorageMb: number | null
  compileTimeoutSeconds: number | null
  autoCompileDebounceMs: number
  compilesPerDay: number | null
  revisionHistoryDays: number | null
  exportFormats: ExportFormat[]
  bibliographySearchesPerDay: number | null
  customFonts: boolean
  typstPackagePins: number | null
  sharingPresets: boolean
  sharingPresetsCount: number | null
  teamWorkspaces: boolean
  teamWorkspaceCount: number | null
  teamMembers: number | null
  trackChanges: boolean
  writingGoals: boolean
  publicProjectPublishing: boolean
  managerRole: boolean
  auditLogExportDays: number | null
  adminConsole: boolean
  prioritySupport: boolean
}

export interface BillingStatus {
  plan: SubscriptionPlan
  status: SubscriptionStatus
  limits: PlanLimits
  usage: {
    activeProjects: number
    totalStorageBytes: number
    compilesToday: number
    bibliographySearchesToday: number
  }
  verifiedDomains: Array<{
    email: string
    domain: string
    domainType: string
    verifiedAt: number
  }>
  requiresVerification: boolean
  eligiblePlans: SubscriptionPlan[]
}

export type ProjectTemplateId = string

export interface TypstPackageCatalogEntry {
  packageId: string
  title: string
  description: string
  latestVersion: string
  keywords: string[]
}

export interface ProjectPackagePin {
  packageId: string
  version: string
}

export interface ProjectWritingSnippet {
  id: string
  name: string
  description: string
  content: string
}

export interface ProjectWritingGoals {
  targetWords: number | null
  dailyWords: number | null
  deadline: string | null
}

export interface ProjectAiSettings {
  model: string
  systemInstructions: string | null
}

export interface ProjectEcosystemSettings {
  packagePins: ProjectPackagePin[]
  writingSnippets: ProjectWritingSnippet[]
  writingGoals: ProjectWritingGoals
  aiSettings?: ProjectAiSettings
}

export interface ProjectFontAsset {
  fileId: string
  name: string
  path: string
  mimeType: string
  createdAt: number
  updatedAt: number
}

export interface ReusableAsset {
  id: string
  name: string
  path: string
  mimeType: string
}

export interface ProjectMetadataFile {
  path: string
  description: string
  content: string
}

export interface EcosystemValidationIssue {
  code: string
  level: 'error' | 'warning'
  message: string
  filePath: string | null
  line: number | null
  column: number | null
}

export interface BibliographyFileSummary {
  fileId: string
  path: string
  entryCount: number
}

export interface CitationRecord {
  key: string
  entryType: string
  title: string
  authors: string[]
  year: string | null
  filePath: string
  line: number | null
  abstract: string | null
  doi: string | null
  url: string | null
}

export interface ReferenceTarget {
  label: string
  kind: 'heading' | 'figure' | 'table' | 'equation' | 'generic'
  title: string
  filePath: string
  line: number
}

export interface WritingSectionStat {
  title: string
  filePath: string
  line: number
  words: number
  readingTimeMinutes: number
}

export interface ProjectWritingStats {
  totalWords: number
  characterCount: number
  readingTimeMinutes: number
  sectionCount: number
  citationCount: number
  referenceCount: number
  sections: WritingSectionStat[]
}

export interface ProseSuggestion {
  id: string
  kind: 'spelling' | 'grammar' | 'style'
  message: string
  filePath: string
  line: number
  excerpt: string
}

export interface ProjectEcosystemState {
  settings: ProjectEcosystemSettings
  packageCatalog: TypstPackageCatalogEntry[]
  projectFonts: ProjectFontAsset[]
  reusableAssets: ReusableAsset[]
  metadataFiles: ProjectMetadataFile[]
  bibliographyFiles: BibliographyFileSummary[]
  cslFiles: Array<{ fileId: string; path: string }>
  citations: CitationRecord[]
  referenceTargets: ReferenceTarget[]
  writingStats: ProjectWritingStats
  proseSuggestions: ProseSuggestion[]
  validationIssues: EcosystemValidationIssue[]
}

export interface ProjectCompileSettings {
  autoCompile: boolean
  compileDebounceMs: number
  defaultExportFormat: ExportFormat
  defaultExportDestination: ExportDestination
  pageLimit: number | null
}

export interface ProjectSummary {
  id: string
  title: string
  role: ProjectRole
  ownerUserId: string
  ownerName: string
  mainFileId: string | null
  compileSettings: ProjectCompileSettings
  fileCount: number
  publishedAt: number | null
  teamId: string | null
  teamName: string | null
  createdAt: number
  updatedAt: number
}

export interface ProjectState {
  isStarred: boolean
  isPinned: boolean
  archivedAt: number | null
  trashedAt: number | null
  lastOpenedAt: number | null
  templateId: ProjectTemplateId | null
}

export interface ProjectFile {
  id: string
  projectId: string
  name: string
  path: string
  mimeType: string
  driveFileId: string
  createdAt: number
  updatedAt: number
}

export interface ProjectFileWorkflow {
  fileId: string
  projectId: string
  lockedByUserId: string | null
  lockedByName: string | null
  lockedAt: number | null
  reviewOwnerUserId: string | null
  reviewOwnerName: string | null
  reviewAssignedAt: number | null
  trashedAt: number | null
  trashedOriginalPath: string | null
}

export interface ProjectMember {
  userId: string
  email: string
  name: string
  avatarUrl: string | null
  role: ProjectRole
  createdAt: number
}

export type ProjectInvitationStatus = 'pending' | 'accepted' | 'rejected' | 'revoked'

export interface ProjectInvitation {
  id: string
  projectId: string
  projectTitle: string
  email: string
  role: Exclude<ProjectRole, 'owner'>
  status: ProjectInvitationStatus
  invitedByUserId: string
  invitedByName: string
  respondedByEmail: string | null
  createdAt: number
  updatedAt: number
}

export interface ProjectComment {
  id: string
  projectId: string
  fileId: string
  authorUserId: string | null
  authorName: string
  authorEmail: string
  authorAvatarUrl: string | null
  content: string
  excerpt: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  status: 'open' | 'resolved' | 'deleted'
  resolvedAt: number | null
  resolvedByUserId: string | null
  resolvedByName: string | null
  createdAt: number
  updatedAt: number
  assigneeUserId: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  reviewRequestId: string | null
  projectTitle?: string
  filePath?: string
  pdfAnnotation: ProjectCommentPdfAnnotation | null
  replies: ProjectCommentReply[]
}

export interface ProjectCommentPdfAnnotation {
  kind: 'ink'
  page: number
  color: string
  bounds: ProjectCommentPdfRect
  strokes: ProjectCommentPdfStroke[]
}

export interface ProjectCommentPdfRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ProjectCommentPdfStroke {
  points: ProjectCommentPdfPoint[]
}

export interface ProjectCommentPdfPoint {
  x: number
  y: number
}

export interface ProjectCommentReply {
  id: string
  commentId: string
  projectId: string
  fileId: string
  authorUserId: string | null
  authorName: string
  authorEmail: string
  authorAvatarUrl: string | null
  content: string
  createdAt: number
  updatedAt: number
}

export interface ProjectNotification {
  id: string
  recipientUserId: string
  projectId: string
  projectTitle: string
  fileId: string
  filePath: string
  commentId: string
  actorUserId: string
  actorName: string
  type: 'mention'
  excerpt: string
  createdAt: number
  readAt: number | null
}

export interface ProjectChatMessage {
  id: string
  projectId: string
  authorUserId: string
  authorName: string
  authorAvatarUrl: string | null
  content: string
  createdAt: number
  updatedAt: number
}

export type ProjectReviewSuggestionKind = 'insert' | 'delete' | 'replace'
export type ProjectReviewSuggestionStatus = 'open' | 'accepted' | 'rejected'

export interface ProjectReviewSuggestion {
  id: string
  projectId: string
  fileId: string
  authorUserId: string
  authorName: string
  authorAvatarUrl: string | null
  kind: ProjectReviewSuggestionKind
  status: ProjectReviewSuggestionStatus
  excerpt: string
  replacementText: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  createdAt: number
  updatedAt: number
  decidedAt: number | null
  decidedByUserId: string | null
  decidedByName: string | null
}

export interface AiEditSuggestion {
  id: string
  fileId: string
  from: number
  to: number
  originalText: string
  replacementText: string
  kind: ProjectReviewSuggestionKind
  createdAt: number
}

export interface AiCollaborationProjectFile {
  fileId: string
  path: string
  mimeType: string
  content: string
}

export interface AiCollaborationEditedFile {
  fileId?: string
  path: string
  content: string
}

export interface AiCollaborationResponse {
  success: boolean
  content?: string
  files?: AiCollaborationEditedFile[]
}

export interface ProjectTemplate {
  id: ProjectTemplateId
  title: string
  description: string
  previewSnippet: string
  kind: 'built-in' | 'community'
  category: string
  tags: string[]
  styleProfileId: string | null
  citationStyle: string | null
  pageLimit: number | null
  requiredSections: string[]
  voteCount: number
  currentUserVote: -1 | 0 | 1
  authorName: string | null
  publishedAt: number | null
}

export interface ProjectActivityEvent {
  id: string
  projectId: string
  actorUserId: string | null
  actorName: string | null
  type: string
  summary: string
  metadata: string | null
  createdAt: number
}

export type ProjectRevisionReason = 'manual-save' | 'collaboration-checkpoint' | 'restore' | 'pre-restore'

export interface ProjectRevision {
  id: string
  projectId: string
  fileId: string
  filePath: string
  label: string
  reason: ProjectRevisionReason
  source: string
  actorUserId: string | null
  actorName: string | null
  createdAt: number
}

export interface CommentSelectionAnchor {
  excerpt: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface ProjectDetail extends ProjectSummary {
  state: ProjectState
  files: ProjectFile[]
  trashedFiles: ProjectFile[]
  fileWorkflows: ProjectFileWorkflow[]
  members: ProjectMember[]
  invitations: ProjectInvitation[]
  activeTemplate: ProjectTemplate | null
  collaborationTokens?: Record<string, string>
}

export interface ProjectDashboardData {
  activeProjects: Array<ProjectSummary & { state: ProjectState }>
  archivedProjects: Array<ProjectSummary & { state: ProjectState }>
  trashedProjects: Array<ProjectSummary & { state: ProjectState }>
  templates: ProjectTemplate[]
  nextCursor: string | null
}

export interface ProjectShareLink {
  id: string
  projectId: string
  token: string
  role: 'viewer' | 'editor'
  label: string | null
  createdByUserId: string
  expiresAt: number | null
  maxUses: number | null
  useCount: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface ProjectAccessRequest {
  id: string
  projectId: string
  requesterUserId: string
  requesterEmail: string
  requesterName: string
  message: string | null
  status: 'pending' | 'approved' | 'denied'
  decidedByUserId: string | null
  decidedAt: number | null
  requestedRole: 'viewer' | 'editor'
  createdAt: number
  updatedAt: number
}

export interface SharingPreset {
  id: string
  ownerUserId: string
  name: string
  entries: Array<{ email: string; role: string }>
  createdAt: number
  updatedAt: number
}

export interface Team {
  id: string
  name: string
  ownerUserId: string
  members?: TeamMember[]
  createdAt: number
  updatedAt: number
}

export interface TeamMember {
  teamId: string
  userId: string
  email: string
  name: string
  avatarUrl: string | null
  role: 'owner' | 'member'
  createdAt: number
}

export interface AdminSystemCounts {
  users: number
  subscriptions: number
  activeSubscriptions: number
  projects: number
  teams: number
  files: number
  publishedProjects: number
  activeShareLinks: number
  pendingInvitations: number
  pendingAccessRequests: number
  errorsLast24h: number
}

export interface AdminActivityRecord {
  id: string
  projectId: string
  projectTitle: string
  actorName: string | null
  type: string
  summary: string
  createdAt: number
}

export interface HealthCheckItem {
  name: string
  status: 'ok' | 'degraded' | 'error'
  detail: string
  checkedAt: number
}

export interface HealthCheckReport {
  status: 'ok' | 'degraded' | 'error'
  service: string
  checkedAt: number
  checks: HealthCheckItem[]
}

export type BackgroundJobType = 'save-file' | 'generate-pdf-snapshot' | 'compile-project' | 'export-document' | 'invite-sync' | 'drive-permission-sync' | 'retention'
export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface BackgroundJobRecord {
  id: string
  type: BackgroundJobType
  status: BackgroundJobStatus
  attempts: number
  maxAttempts: number
  payload: string
  result: string | null
  errorMessage: string | null
  runAfter: number
  lockedAt: number | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ErrorEvent {
  id: string
  scope: string
  message: string
  code: string | null
  details: string | null
  createdAt: number
}

export interface AdminDiagnostics {
  checkedAt: number
  queue: {
    queued: number
    running: number
    failed: number
    completedLast24h: number
  }
  recentErrors: ErrorEvent[]
  recentJobs: BackgroundJobRecord[]
  health: HealthCheckReport
}

export interface AdminUserRecord {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  driveRootFolderId: string | null
  geminiApiKey: string | null
  isAdmin: boolean
  disabledAt: number | null
  subscriptionPlan: SubscriptionPlan | null
  subscriptionStatus: SubscriptionStatus | null
  projectCount: number
  teamCount: number
  createdAt: number
  updatedAt: number
}

export interface AdminSubscriptionRecord {
  id: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  teamId: string | null
  teamName: string | null
  plan: SubscriptionPlan
  status: SubscriptionStatus
  periodStart: number | null
  periodEnd: number | null
  renewalMode: string
  paymentProvider: string | null
  providerCustomerId: string | null
  providerReference: string | null
  transactionCount: number
  paidTransactionCount: number
  createdAt: number
  updatedAt: number
}

export interface AdminProjectRecord {
  id: string
  title: string
  ownerUserId: string
  ownerName: string
  ownerEmail: string
  teamId: string | null
  teamName: string | null
  mainFileId: string | null
  fileCount: number
  memberCount: number
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface AdminTeamRecord {
  id: string
  name: string
  ownerUserId: string
  ownerName: string
  ownerEmail: string
  memberCount: number
  projectCount: number
  createdAt: number
  updatedAt: number
}

export interface AdminOverview {
  checkedAt: number
  counts: AdminSystemCounts
  diagnostics: AdminDiagnostics
  recentActivity: AdminActivityRecord[]
}

export type AdminAccessRecordKind = 'project-member' | 'project-invitation' | 'share-link' | 'access-request' | 'team-member'

export interface AdminAccessRecord {
  id: string
  kind: AdminAccessRecordKind
  label: string
  projectId: string | null
  projectTitle: string | null
  teamId: string | null
  teamName: string | null
  subjectUserId: string | null
  subjectName: string | null
  subjectEmail: string | null
  role: string | null
  status: string | null
  invitedByName: string | null
  createdAt: number
  updatedAt: number
}

export interface AdminContainerLogService {
  service: string
  label: string
}

export interface AdminContainerLogServicesResponse {
  dockerAccessible: boolean
  services: AdminContainerLogService[]
}

export interface AdminContainerLogsResponse {
  service: string
  tail: number
  logs: string
  checkedAt: number
}

export interface CompileDiagnostic {
  level: 'error' | 'warning'
  message: string
  filePath: string | null
  line: number | null
  column: number | null
  raw: string
}

export interface LanguageToolServerStatus {
  name: 'tinymist' | 'texlab'
  available: boolean
  running: boolean
  executable: string
  detail: string | null
}

export interface LanguageToolDiagnosticsTimings {
  totalMs: number
  ensureStartedMs: number
  workspaceSyncMs: number
  lspUpdateMs: number
  waitForDiagnosticsMs: number
  cacheHit: boolean
  incremental: boolean
}

export interface LanguageDiagnosticsResponse {
  diagnostics: CompileDiagnostic[]
  statuses: LanguageToolServerStatus[]
  timings?: LanguageToolDiagnosticsTimings
}

export interface LanguageDiagnosticsSessionResponse {
  statuses: LanguageToolServerStatus[]
  warmed: boolean
  timings?: LanguageToolDiagnosticsTimings
}

export interface TypstPreviewSessionResponse {
  sessionId: string
  proxyPath: string
  entryAbsPath: string | null
  workspaceDir: string | null
  engine: 'tinymist' | 'fallback'
  ready: boolean
  detail: string | null
  statuses: LanguageToolServerStatus[]
  compileDiagnostics?: CompileDiagnostic[]
}

export type CompilePreviewFormat = 'svg' | 'pdf'

export type LatexSyncTexEntry = {
  filePath: string
  line: number
  column: number | null
  page: number
  x: number
  y: number
  width: number | null
  height: number | null
}

export type CompileResponse =
  | {
      format: 'svg'
      pages: string[]
      pageCount: number
      pageOffset: number
      diagnostics?: CompileDiagnostic[]
      notice?: string
    }
  | {
      format: 'pdf'
      pdfBase64: string
      pageCount?: number
      diagnostics?: CompileDiagnostic[]
      notice?: string
      log?: string
      syncTex?: LatexSyncTexEntry[]
      syncTexToken?: string
      syncTexEntryPath?: string
    }

export type SyncTexEditResponse = {
  filePath: string
  line: number
  column: number | null
}

export type SyncTexViewBox = {
  page: number
  x: number
  y: number
  width: number
  height: number
  h: number | null
  v: number | null
}

export type SyncTexViewResponse = {
  boxes: SyncTexViewBox[]
}
