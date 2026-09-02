export type AcademicRole = 'student' | 'phd_student' | 'postdoc' | 'researcher' | 'faculty' | 'staff' | 'other'

export interface WorkspaceTheme {
  presetId: string
  uiFontFamily: string
  uiFontSize: number
  editorFontFamily: string
  editorFontSize: number
}

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  driveRootFolderId: string | null
  aiApiKeys: {
    gemini: boolean
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

export interface UserRecord extends AuthenticatedUser {
  googleId: string
  refreshToken: string | null
  orcidAccessToken: string | null
  orcidRefreshToken: string | null
  geminiApiKey: string | null
  anthropicApiKey: string | null
  openaiApiKey: string | null
  driveRootFolderId: string | null
  createdAt: number
  updatedAt: number
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
  aiChatHistoryDays: number | null
  aiRequestsPerDay: number | null
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
  createdAt: number
  updatedAt: number
  fileCount: number
  publishedAt: number | null
  teamId: string | null
  teamName: string | null
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
  sizeBytes?: number
  lastContentHash?: string | null
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

export interface ProjectTemplate {
  id: ProjectTemplateId
  title: string
  description: string
  previewSnippet?: string
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

export interface ErrorEvent {
  id: string
  scope: string
  message: string
  code: string | null
  details: string | null
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

export interface AdminUserRecord {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  driveRootFolderId: string | null
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

export interface ProjectDetail extends ProjectSummary {
  state: ProjectState
  files: ProjectFile[]
  trashedFiles: ProjectFile[]
  fileWorkflows: ProjectFileWorkflow[]
  members: ProjectMember[]
  invitations: ProjectInvitation[]
  collaborationTokens?: Record<string, string>
}

export interface ProjectDashboardData {
  activeProjects: Array<ProjectSummary & { state: ProjectState }>
  archivedProjects: Array<ProjectSummary & { state: ProjectState }>
  trashedProjects: Array<ProjectSummary & { state: ProjectState }>
  templates: ProjectTemplate[]
  nextCursor: string | null
}

export interface CollaborationTokenPayload {
  userId: string
  projectId: string
  fileId: string
  exp: number
}

export interface InvitationProofTokenPayload {
  invitationId: string
  invitedEmail: string
  exp: number
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

export interface RetentionReport {
  revisionsDeleted: number
  activityEventsDeleted: number
  completedJobsDeleted: number
  errorEventsDeleted: number
  ranAt: number
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

export interface LanguageDiagnosticsResponse {
  diagnostics: CompileDiagnostic[]
  statuses: LanguageToolServerStatus[]
}

export interface TypstPreviewSessionResponse {
  sessionId: string
  proxyPath: string
  engine: 'tinymist' | 'fallback'
  ready: boolean
  detail: string | null
  statuses: LanguageToolServerStatus[]
}

export type CompilePreviewFormat = 'svg' | 'pdf'

export interface CompileRequest {
  source: string
  projectId?: string
  fileId?: string
  activeFileId?: string
  activeSource?: string
  documentFormat?: 'typst' | 'latex'
  latexEngine?: 'pdflatex' | 'xelatex' | 'lualatex'
  format?: CompilePreviewFormat
  previewSessionId?: string
  svgPageIndex?: number
  svgWindowSize?: number
}

export interface ExportRequest {
  source: string
  format: ExportFormat
  documentFormat?: 'typst' | 'latex'
  projectId?: string
  fileId?: string
  saveToDrive?: boolean
}
