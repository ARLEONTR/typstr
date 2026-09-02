import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { Pool, type PoolClient, types as pgTypes } from 'pg'
import type {
  AuthenticatedUser,
  ProjectEcosystemSettings,
  ProjectComment,
  ProjectCommentPdfAnnotation,
  ProjectCommentReply,
  ProjectCompileSettings,
  ProjectDetail,
  ProjectFile,
  ProjectFileWorkflow,
  ProjectInvitation,
  ProjectInvitationStatus,
  ProjectMember,
  ProjectNotification,
  ProjectRole,
  ProjectShareLink,
  ProjectAccessRequest,
  SharingPreset,
  Team,
  TeamMember,
  ProjectState,
  ProjectSummary,
  ProjectTemplateId,
  UserRecord,
} from './types.js'
import { isAdminEmail } from './adminAccess.js'
import { encryptToken, decryptToken } from './services/tokenEncryption.js'
import { normalizeProjectEcosystemSettings } from './services/ecosystem.js'

pgTypes.setTypeParser(20, (value) => Number.parseInt(value, 10))

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const DEFAULT_PROJECT_COMPILE_SETTINGS: ProjectCompileSettings = {
  autoCompile: false,
  compileDebounceMs: 200,
  defaultExportFormat: 'pdf',
  defaultExportDestination: 'download',
  pageLimit: null,
}
const DEFAULT_PROJECT_ECOSYSTEM_SETTINGS: ProjectEcosystemSettings = {
  packagePins: [],
  writingSnippets: [],
  writingGoals: {
    targetWords: null,
    dailyWords: null,
    deadline: null,
  },
}

const DEFAULT_DATABASE_URL = 'postgresql://typstr:typstr@localhost:5432/typstr'

type Queryable = Pool | PoolClient

type UserRow = {
  id: string
  google_id: string
  email: string
  name: string
  avatar_url: string | null
  refresh_token: string | null
  orcid_id: string | null
  orcid_name: string | null
  orcid_access_token: string | null
  orcid_refresh_token: string | null
  orcid_linked_at: number | null
  gemini_api_key: string | null
  anthropic_api_key: string | null
  openai_api_key: string | null
  drive_root_folder_id: string | null
  disabled_at: number | null
  academic_role: string | null
  department: string | null
  institution_name: string | null
  selected_theme_settings: string | null
  created_at: number
  updated_at: number
}

type ProjectRow = {
  id: string
  owner_user_id: string
  owner_name: string
  title: string
  drive_folder_id: string
  main_file_id: string | null
  compile_settings: string | null
  ecosystem_settings: string | null
  published_at: number | null
  team_id: string | null
  team_name: string | null
  created_at: number
  updated_at: number
  role: ProjectRole
  file_count: number
}

type ProjectShareLinkRow = {
  id: string
  project_id: string
  token: string
  role: 'viewer' | 'editor'
  label: string | null
  created_by_user_id: string
  expires_at: number | null
  max_uses: number | null
  use_count: number
  is_active: boolean
  created_at: number
  updated_at: number
}

type ProjectAccessRequestRow = {
  id: string
  project_id: string
  requester_user_id: string
  requester_email: string
  requester_name: string
  message: string | null
  status: 'pending' | 'approved' | 'denied'
  decided_by_user_id: string | null
  decided_at: number | null
  requested_role: 'viewer' | 'editor'
  created_at: number
  updated_at: number
}

type SharingPresetRow = {
  id: string
  owner_user_id: string
  name: string
  entries: string
  created_at: number
  updated_at: number
}

type TeamRow = {
  id: string
  name: string
  owner_user_id: string
  created_at: number
  updated_at: number
}

type TeamMemberRow = {
  team_id: string
  user_id: string
  email: string
  name: string
  avatar_url: string | null
  role: 'owner' | 'member'
  created_at: number
}

type ProjectFileRow = {
  id: string
  project_id: string
  name: string
  path: string
  mime_type: string
  drive_file_id: string
  size_bytes: number | null
  collaboration_state: Buffer | null
  last_content_hash: string | null
  created_at: number
  updated_at: number
}

type ProjectMemberRow = {
  user_id: string
  email: string
  name: string
  avatar_url: string | null
  role: ProjectRole
  created_at: number
}

type ProjectInvitationRow = {
  id: string
  project_id: string
  project_title: string
  email: string
  role: Exclude<ProjectRole, 'owner'>
  status: ProjectInvitationStatus
  invited_by_user_id: string
  invited_by_name: string
  responded_by_email: string | null
  created_at: number
  updated_at: number
}

type ProjectPreferenceRow = {
  project_id: string
  is_starred: boolean
  is_pinned: boolean
  archived_at: number | null
  trashed_at: number | null
  last_opened_at: number | null
  template_id: ProjectTemplateId | null
}

type ProjectFileWorkflowRow = {
  file_id: string
  project_id: string
  locked_by_user_id: string | null
  locked_by_name: string | null
  locked_at: number | null
  review_owner_user_id: string | null
  review_owner_name: string | null
  review_assigned_at: number | null
  trashed_at: number | null
  trashed_original_path: string | null
}

type ProjectCommentRow = {
  id: string
  project_id: string
  file_id: string
  author_user_id: string | null
  author_name: string
  author_email: string
  author_avatar_url: string | null
  anonymous_author_name: string | null
  anonymous_author_email: string | null
  review_request_id: string | null
  content: string
  excerpt: string
  start_line: number
  start_column: number
  end_line: number
  end_column: number
  status: 'open' | 'resolved' | 'deleted'
  resolved_by_user_id: string | null
  resolved_by_name: string | null
  resolved_at: number | null
  pdf_annotation: string | null
  assignee_user_id: string | null
  assignee_name: string | null
  assignee_email: string | null
  created_at: number
  updated_at: number
}

type ProjectCommentReplyRow = {
  id: string
  comment_id: string
  project_id: string
  file_id: string
  author_user_id: string | null
  author_name: string
  author_email: string
  author_avatar_url: string | null
  anonymous_author_name: string | null
  anonymous_author_email: string | null
  content: string
  created_at: number
  updated_at: number
}

type ProjectReviewRequestRow = {
  id: string
  project_id: string
  file_id: string
  requester_user_id: string
  supervisor_email: string
  supervisor_name: string | null
  message: string | null
  token_hash: string
  source_revision_id: string | null
  status: 'open' | 'closed'
  expires_at: number
  created_at: number
  updated_at: number
}

type ProjectNotificationRow = {
  id: string
  recipient_user_id: string
  project_id: string
  project_title: string
  file_id: string
  file_path: string
  comment_id: string
  actor_user_id: string
  actor_name: string
  type: 'mention'
  excerpt: string
  created_at: number
  read_at: number | null
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
})

let initializationPromise: Promise<void> | null = null

pool.on('error', (error) => {
  console.error('Unexpected Postgres pool error', error)
})

export function getDbPool(): Pool {
  return pool
}

export async function initializeDatabase(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          google_id TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          avatar_url TEXT,
          refresh_token TEXT,
          orcid_id TEXT,
          orcid_name TEXT,
          orcid_access_token TEXT,
          orcid_refresh_token TEXT,
          orcid_linked_at BIGINT,
          gemini_api_key TEXT,
          anthropic_api_key TEXT,
          openai_api_key TEXT,
          drive_root_folder_id TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          message TEXT NOT NULL,
          parent_feedback_id TEXT REFERENCES feedback(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open',
          admin_response TEXT,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS team_members (
          team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
          created_at BIGINT NOT NULL,
          PRIMARY KEY (team_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          drive_folder_id TEXT NOT NULL,
          main_file_id TEXT,
          compile_settings TEXT,
          ecosystem_settings TEXT,
          published_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_activity_events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          actor_name TEXT,
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          metadata TEXT,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS error_events (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          message TEXT NOT NULL,
          code TEXT,
          details TEXT,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS background_jobs (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          payload TEXT NOT NULL,
          result TEXT,
          error_message TEXT,
          run_after BIGINT NOT NULL,
          locked_at BIGINT,
          completed_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_members (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'editor', 'viewer')),
          created_at BIGINT NOT NULL,
          PRIMARY KEY (project_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS project_files (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          drive_file_id TEXT NOT NULL,
          size_bytes BIGINT NOT NULL DEFAULT 0,
          collaboration_state BYTEA,
          last_content_hash TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE(project_id, path)
        );

        CREATE TABLE IF NOT EXISTS project_invitations (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
          status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'revoked')),
          invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          responded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE(project_id, email)
        );

        CREATE TABLE IF NOT EXISTS project_comments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
          author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          anonymous_author_name TEXT,
          anonymous_author_email TEXT,
          review_request_id TEXT,
          content TEXT NOT NULL,
          excerpt TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          start_column INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          end_column INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'deleted')),
          resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          resolved_at BIGINT,
          pdf_annotation TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_comment_replies (
          id TEXT PRIMARY KEY,
          comment_id TEXT NOT NULL REFERENCES project_comments(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
          author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          anonymous_author_name TEXT,
          anonymous_author_email TEXT,
          content TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_notifications (
          id TEXT PRIMARY KEY,
          recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
          comment_id TEXT NOT NULL REFERENCES project_comments(id) ON DELETE CASCADE,
          actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('mention')),
          excerpt TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          read_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS project_review_requests (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
          requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          supervisor_email TEXT NOT NULL,
          supervisor_name TEXT,
          message TEXT,
          token_hash TEXT NOT NULL UNIQUE,
          source_revision_id TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
          expires_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_preferences (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          is_starred BOOLEAN NOT NULL DEFAULT FALSE,
          is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
          archived_at BIGINT,
          trashed_at BIGINT,
          last_opened_at BIGINT,
          template_id TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_template_publications (
          id TEXT PRIMARY KEY,
          author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          tags TEXT NOT NULL,
          preview_snippet TEXT NOT NULL,
          main_file_path TEXT NOT NULL,
          files_json TEXT NOT NULL,
          style_profile_id TEXT,
          citation_style TEXT,
          page_limit INTEGER,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_template_votes (
          template_id TEXT NOT NULL REFERENCES project_template_publications(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          vote SMALLINT NOT NULL CHECK(vote IN (-1, 1)),
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (template_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS project_file_workflow (
          file_id TEXT PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          locked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          locked_at BIGINT,
          review_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          review_assigned_at BIGINT,
          trashed_at BIGINT,
          trashed_original_path TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_chat_messages (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_review_suggestions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
          author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('insert', 'delete', 'replace')),
          status TEXT NOT NULL CHECK(status IN ('open', 'accepted', 'rejected')),
          excerpt TEXT NOT NULL,
          replacement_text TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          start_column INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          end_column INTEGER NOT NULL,
          decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          decided_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_share_links (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK(role IN ('viewer', 'editor')),
          label TEXT,
          created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at BIGINT,
          max_uses INTEGER,
          use_count INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_access_requests (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requester_email TEXT NOT NULL,
          requester_name TEXT NOT NULL,
          message TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
          decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          decided_at BIGINT,
          requested_role TEXT NOT NULL DEFAULT 'viewer' CHECK(requested_role IN ('editor', 'viewer')),
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE(project_id, requester_user_id)
        );

        CREATE TABLE IF NOT EXISTS sharing_presets (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          entries TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS verified_emails (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          domain TEXT NOT NULL,
          domain_type TEXT NOT NULL DEFAULT 'organization',
          verified_at BIGINT,
          status TEXT NOT NULL DEFAULT 'verified',
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, email),
          UNIQUE(email)
        );

        CREATE TABLE IF NOT EXISTS email_verification_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          consumed_at BIGINT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS domain_plan_rules (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL UNIQUE,
          plan TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          limits_override TEXT,
          valid_from BIGINT,
          valid_until BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plan_limits (
          plan TEXT PRIMARY KEY,
          limits_json TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
          plan TEXT NOT NULL,
          status TEXT NOT NULL,
          period_start BIGINT,
          period_end BIGINT,
          renewal_mode TEXT NOT NULL DEFAULT 'manual',
          payment_provider TEXT,
          provider_customer_id TEXT,
          provider_reference TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          CHECK(user_id IS NOT NULL OR team_id IS NOT NULL)
        );

        CREATE TABLE IF NOT EXISTS payment_transactions (
          id TEXT PRIMARY KEY,
          subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
          provider TEXT NOT NULL,
          order_id TEXT NOT NULL UNIQUE,
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          raw_request TEXT,
          raw_response TEXT,
          paid_at BIGINT,
          refunded_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
        ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK(role IN ('owner', 'manager', 'editor', 'viewer'));

        ALTER TABLE project_invitations DROP CONSTRAINT IF EXISTS project_invitations_role_check;
        ALTER TABLE project_invitations ADD CONSTRAINT project_invitations_role_check CHECK(role IN ('manager', 'editor', 'viewer'));
        ALTER TABLE project_invitations ADD COLUMN IF NOT EXISTS responded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

        ALTER TABLE projects ADD COLUMN IF NOT EXISTS main_file_id TEXT;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS compile_settings TEXT;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS ecosystem_settings TEXT;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS published_at BIGINT;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
        ALTER TABLE project_files ADD COLUMN IF NOT EXISTS collaboration_state BYTEA;
        ALTER TABLE project_files ADD COLUMN IF NOT EXISTS last_content_hash TEXT;
        ALTER TABLE project_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS resolved_by_user_id TEXT;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS resolved_at BIGINT;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS pdf_annotation TEXT;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS anonymous_author_name TEXT;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS anonymous_author_email TEXT;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS review_request_id TEXT;
        ALTER TABLE project_comments ALTER COLUMN author_user_id DROP NOT NULL;
        UPDATE project_comments SET status = 'open' WHERE status NOT IN ('open', 'resolved', 'deleted');
        ALTER TABLE project_comments DROP CONSTRAINT IF EXISTS project_comments_status_check;
        ALTER TABLE project_comments ADD CONSTRAINT project_comments_status_check CHECK(status IN ('open', 'resolved', 'deleted'));
        ALTER TABLE project_comment_replies ADD COLUMN IF NOT EXISTS anonymous_author_name TEXT;
        ALTER TABLE project_comment_replies ADD COLUMN IF NOT EXISTS anonymous_author_email TEXT;
        ALTER TABLE project_comment_replies ALTER COLUMN author_user_id DROP NOT NULL;

        ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
        ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_response TEXT;
        ALTER TABLE feedback ADD COLUMN IF NOT EXISTS parent_feedback_id TEXT REFERENCES feedback(id) ON DELETE CASCADE;

        -- Truncate existing rows that exceed new length limits
        UPDATE projects SET title = left(title, 255) WHERE length(title) > 255;
        UPDATE teams SET name = left(name, 255) WHERE length(name) > 255;
        UPDATE project_files SET name = left(name, 255) WHERE length(name) > 255;
        UPDATE project_files SET path = left(path, 1000) WHERE length(path) > 1000;
        UPDATE project_comments SET content = left(content, 5000) WHERE length(content) > 5000;
        UPDATE project_comments SET excerpt = left(excerpt, 10000) WHERE length(excerpt) > 10000;
        UPDATE project_comment_replies SET content = left(content, 5000) WHERE length(content) > 5000;
        UPDATE project_chat_messages SET content = left(content, 5000) WHERE length(content) > 5000;
        UPDATE project_review_suggestions SET excerpt = left(excerpt, 10000) WHERE length(excerpt) > 10000;
        UPDATE project_review_suggestions SET replacement_text = left(replacement_text, 50000) WHERE length(replacement_text) > 50000;
        UPDATE project_share_links SET label = left(label, 100) WHERE label IS NOT NULL AND length(label) > 100;
        UPDATE project_access_requests SET message = left(message, 1000) WHERE message IS NOT NULL AND length(message) > 1000;
        UPDATE sharing_presets SET name = left(name, 255) WHERE length(name) > 255;
        UPDATE project_invitations SET email = left(email, 254) WHERE length(email) > 254;

        -- Length constraints on user-supplied text fields
        DO $$ BEGIN
          ALTER TABLE projects ADD CONSTRAINT projects_title_length CHECK(length(title) <= 255);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE teams ADD CONSTRAINT teams_name_length CHECK(length(name) <= 255);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_files ADD CONSTRAINT project_files_name_length CHECK(length(name) <= 255);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_files ADD CONSTRAINT project_files_path_length CHECK(length(path) <= 1000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_template_publications ADD CONSTRAINT project_template_publications_title_length CHECK(length(title) <= 255);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_template_publications ADD CONSTRAINT project_template_publications_description_length CHECK(length(description) <= 1000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_comments ADD CONSTRAINT project_comments_content_length CHECK(length(content) <= 5000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_comments ADD CONSTRAINT project_comments_excerpt_length CHECK(length(excerpt) <= 10000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_comment_replies ADD CONSTRAINT project_comment_replies_content_length CHECK(length(content) <= 5000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_chat_messages ADD CONSTRAINT project_chat_messages_content_length CHECK(length(content) <= 5000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_review_suggestions ADD CONSTRAINT project_review_suggestions_excerpt_length CHECK(length(excerpt) <= 10000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_review_suggestions ADD CONSTRAINT project_review_suggestions_replacement_length CHECK(length(replacement_text) <= 50000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_share_links ADD CONSTRAINT project_share_links_label_length CHECK(length(label) <= 100);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_access_requests ADD CONSTRAINT project_access_requests_message_length CHECK(length(message) <= 1000);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE sharing_presets ADD CONSTRAINT sharing_presets_name_length CHECK(length(name) <= 255);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          ALTER TABLE project_invitations ADD CONSTRAINT project_invitations_email_length CHECK(length(email) <= 254);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_comments_file_id ON project_comments(file_id);
        CREATE INDEX IF NOT EXISTS idx_project_notifications_recipient_user_id ON project_notifications(recipient_user_id);
        CREATE INDEX IF NOT EXISTS idx_project_review_requests_token_hash ON project_review_requests(token_hash);
        CREATE INDEX IF NOT EXISTS idx_project_review_requests_project_id ON project_review_requests(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_preferences_project_id ON project_preferences(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_file_workflow_project_id ON project_file_workflow(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_chat_messages_project_id ON project_chat_messages(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_review_suggestions_file_id ON project_review_suggestions(file_id);
        CREATE INDEX IF NOT EXISTS idx_project_share_links_project_id ON project_share_links(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_share_links_token ON project_share_links(token);
        CREATE INDEX IF NOT EXISTS idx_project_access_requests_project_id ON project_access_requests(project_id);
        CREATE INDEX IF NOT EXISTS idx_sharing_presets_owner ON sharing_presets(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_verified_emails_user_id ON verified_emails(user_id);
        CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user_email ON email_verification_codes(user_id, email);
        CREATE INDEX IF NOT EXISTS idx_domain_plan_rules_domain ON domain_plan_rules(domain);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_team_id ON subscriptions(team_id);
        CREATE INDEX IF NOT EXISTS idx_payment_transactions_subscription_id ON payment_transactions(subscription_id);
        CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON projects(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects(team_id);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at BIGINT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS orcid_id TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS orcid_name TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS orcid_access_token TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS orcid_refresh_token TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS orcid_linked_at BIGINT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_orcid_id ON users(orcid_id) WHERE orcid_id IS NOT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS openai_api_key TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS academic_role TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS institution_name TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_theme_settings TEXT;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS resolved_by_name TEXT;

        CREATE TABLE IF NOT EXISTS ai_chat_messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          file_id TEXT REFERENCES project_files(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'ai')),
          content TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user_id ON ai_chat_messages(user_id);
        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_file_id ON ai_chat_messages(file_id);
        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_project_id ON ai_chat_messages(project_id);
        CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_created_at ON ai_chat_messages(created_at);
      `)
    })()
  }

  await initializationPromise
}

export async function upsertUserFromGoogleProfile(input: {
  googleId: string
  email: string
  name: string
  avatarUrl: string | null
  refreshToken: string | null
}): Promise<AuthenticatedUser> {
  const now = Date.now()
  const encryptedToken = input.refreshToken ? encryptToken(input.refreshToken) : null
  const existing = await queryOne<UserRow>(pool, `
    SELECT *
    FROM users
    WHERE google_id = $1 OR LOWER(email) = LOWER($2)
    LIMIT 1
  `, [input.googleId, input.email])

  if (existing) {
    await pool.query(`
      UPDATE users
      SET google_id = $1,
          email = $2,
          name = $3,
          avatar_url = $4,
          refresh_token = COALESCE($5, refresh_token),
          updated_at = $6
      WHERE id = $7
    `, [
      input.googleId,
      input.email,
      input.name,
      input.avatarUrl,
      encryptedToken,
      now,
      existing.id,
    ])

    return sanitizeUser((await findUserById(existing.id))!)
  }

  const id = randomUUID()
  await pool.query(`
    INSERT INTO users (id, google_id, email, name, avatar_url, refresh_token, drive_root_folder_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
  `, [id, input.googleId, input.email, input.name, input.avatarUrl, encryptedToken, now, now])

  return sanitizeUser((await findUserById(id))!)
}

export async function getUserRefreshToken(userId: string): Promise<string | null> {
  const row = await queryOne<{ refresh_token: string | null }>(pool, 'SELECT refresh_token FROM users WHERE id = $1', [userId])
  if (!row || !row.refresh_token) {
    return null
  }
  return decryptToken(row.refresh_token)
}

export async function linkUserOrcid(input: {
  userId: string
  orcidId: string
  orcidName: string | null
  accessToken: string
  refreshToken: string | null
}): Promise<AuthenticatedUser> {
  const now = Date.now()
  await pool.query(`
    UPDATE users
    SET orcid_id = $1,
        orcid_name = $2,
        orcid_access_token = $3,
        orcid_refresh_token = $4,
        orcid_linked_at = $5,
        updated_at = $5
    WHERE id = $6
  `, [
    input.orcidId,
    input.orcidName,
    encryptToken(input.accessToken),
    input.refreshToken ? encryptToken(input.refreshToken) : null,
    now,
    input.userId,
  ])

  return sanitizeUser((await findUserById(input.userId))!)
}

export async function unlinkUserOrcid(userId: string): Promise<AuthenticatedUser> {
  await pool.query(`
    UPDATE users
    SET orcid_id = NULL,
        orcid_name = NULL,
        orcid_access_token = NULL,
        orcid_refresh_token = NULL,
        orcid_linked_at = NULL,
        updated_at = $1
    WHERE id = $2
  `, [Date.now(), userId])

  return sanitizeUser((await findUserById(userId))!)
}

export async function getUserAiApiKey(userId: string, provider: 'gemini' | 'anthropic' | 'openai'): Promise<string | null> {
  const column = provider === 'anthropic' ? 'anthropic_api_key' : provider === 'openai' ? 'openai_api_key' : 'gemini_api_key'
  const row = await queryOne<{ api_key: string | null }>(pool, `SELECT ${column} AS api_key FROM users WHERE id = $1`, [userId])
  if (!row?.api_key) {
    return null
  }
  return decryptToken(row.api_key)
}

export async function updateUserAiApiKey(userId: string, provider: 'gemini' | 'anthropic' | 'openai', apiKey: string | null): Promise<void> {
  const column = provider === 'anthropic' ? 'anthropic_api_key' : provider === 'openai' ? 'openai_api_key' : 'gemini_api_key'
  const encrypted = apiKey?.trim() ? encryptToken(apiKey.trim()) : null
  await pool.query(`UPDATE users SET ${column} = $1, updated_at = $2 WHERE id = $3`, [encrypted, Date.now(), userId])
}

export interface AiChatMessage {
  id: string
  userId: string
  projectId: string
  fileId: string | null
  provider: string
  role: 'user' | 'ai'
  content: string
  createdAt: number
}

export async function saveAiMessage(msg: Omit<AiChatMessage, 'id' | 'createdAt'>): Promise<AiChatMessage> {
  const id = randomUUID()
  const createdAt = Date.now()
  await pool.query(
    `INSERT INTO ai_chat_messages (id, user_id, project_id, file_id, provider, role, content, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, msg.userId, msg.projectId, msg.fileId ?? null, msg.provider, msg.role, msg.content, createdAt],
  )
  return { id, ...msg, createdAt }
}

export async function getAiMessages(opts: {
  userId: string
  projectId?: string
  fileId?: string
  provider?: string
  sinceTimestamp?: number
  limit?: number
}): Promise<AiChatMessage[]> {
  const conditions: string[] = ['user_id = $1']
  const values: unknown[] = [opts.userId]
  let idx = 2
  if (opts.projectId) { conditions.push(`project_id = $${idx++}`); values.push(opts.projectId) }
  if (opts.fileId) { conditions.push(`file_id = $${idx++}`); values.push(opts.fileId) }
  if (opts.provider) { conditions.push(`provider = $${idx++}`); values.push(opts.provider) }
  if (opts.sinceTimestamp) { conditions.push(`created_at >= $${idx++}`); values.push(opts.sinceTimestamp) }
  const limit = opts.limit ?? 200
  const rows = await queryRows<{
    id: string; user_id: string; project_id: string; file_id: string | null
    provider: string; role: string; content: string; created_at: number
  }>(pool, `SELECT * FROM ai_chat_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT ${limit}`, values)
  return rows.map(r => ({
    id: r.id, userId: r.user_id, projectId: r.project_id, fileId: r.file_id,
    provider: r.provider, role: r.role as 'user' | 'ai', content: r.content, createdAt: r.created_at,
  }))
}

export async function deleteAiMessagesByUser(userId: string): Promise<void> {
  await pool.query('DELETE FROM ai_chat_messages WHERE user_id = $1', [userId])
}

export async function deleteAiMessagesByProject(projectId: string): Promise<void> {
  await pool.query('DELETE FROM ai_chat_messages WHERE project_id = $1', [projectId])
}

export async function deleteAiMessagesByFile(fileId: string): Promise<void> {
  await pool.query('DELETE FROM ai_chat_messages WHERE file_id = $1', [fileId])
}

export async function upsertLocalDevUser(input: {
  email: string
  name: string
}): Promise<AuthenticatedUser> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const name = input.name.trim() || normalizedEmail
  const googleId = `local-dev:${normalizedEmail}`
  const now = Date.now()
  const existing = await queryOne<UserRow>(pool, `
    SELECT *
    FROM users
    WHERE google_id = $1 OR LOWER(email) = LOWER($2)
    LIMIT 1
  `, [googleId, normalizedEmail])

  if (existing) {
    await pool.query(`
      UPDATE users
      SET google_id = $1,
          email = $2,
          name = $3,
          avatar_url = NULL,
          updated_at = $4
      WHERE id = $5
    `, [googleId, normalizedEmail, name, now, existing.id])

    return sanitizeUser((await findUserById(existing.id))!)
  }

  const id = randomUUID()
  await pool.query(`
    INSERT INTO users (id, google_id, email, name, avatar_url, refresh_token, drive_root_folder_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6)
  `, [id, googleId, normalizedEmail, name, now, now])

  return sanitizeUser((await findUserById(id))!)
}

export async function upsertLdapUser(input: {
  ldapId: string
  email: string
  name: string
  avatarUrl?: string | null
}): Promise<AuthenticatedUser> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const name = input.name.trim() || normalizedEmail
  const googleId = `ldap:${input.ldapId}`
  const now = Date.now()
  const existing = await queryOne<UserRow>(pool, `
    SELECT *
    FROM users
    WHERE google_id = $1 OR LOWER(email) = LOWER($2)
    LIMIT 1
  `, [googleId, normalizedEmail])

  if (existing) {
    await pool.query(`
      UPDATE users
      SET google_id = $1,
          email = $2,
          name = $3,
          avatar_url = COALESCE($4, avatar_url),
          updated_at = $5
      WHERE id = $6
    `, [googleId, normalizedEmail, name, input.avatarUrl ?? null, now, existing.id])

    return sanitizeUser((await findUserById(existing.id))!)
  }

  const id = randomUUID()
  await pool.query(`
    INSERT INTO users (id, google_id, email, name, avatar_url, refresh_token, drive_root_folder_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7)
  `, [id, googleId, normalizedEmail, name, input.avatarUrl ?? null, now, now])

  return sanitizeUser((await findUserById(id))!)
}

export async function disableUserByGoogleId(googleId: string): Promise<void> {
  await pool.query('UPDATE users SET disabled_at = $1, updated_at = $2 WHERE google_id = $3', [Date.now(), Date.now(), googleId])
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRow>(pool, 'SELECT * FROM users WHERE id = $1', [id])
  return row ? rowToUser(row) : null
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRow>(pool, 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email])
  return row ? rowToUser(row) : null
}

export async function updateUserDriveRootFolder(userId: string, driveRootFolderId: string): Promise<void> {
  await pool.query('UPDATE users SET drive_root_folder_id = $1, updated_at = $2 WHERE id = $3', [driveRootFolderId, Date.now(), userId])
}

export async function clearUserGoogleTokens(userId: string): Promise<void> {
  await pool.query('UPDATE users SET refresh_token = NULL, drive_root_folder_id = NULL, updated_at = $1 WHERE id = $2', [Date.now(), userId])
}

export async function clearUserStoredCredentials(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET refresh_token = NULL,
         drive_root_folder_id = NULL,
         orcid_id = NULL,
         orcid_name = NULL,
         orcid_access_token = NULL,
         orcid_refresh_token = NULL,
         orcid_linked_at = NULL,
         gemini_api_key = NULL,
         anthropic_api_key = NULL,
         openai_api_key = NULL,
         updated_at = $1
     WHERE id = $2`,
    [Date.now(), userId],
  )
  await pool.query('DELETE FROM ai_chat_messages WHERE user_id = $1', [userId])
}

export async function listProjectsForUser(userId: string): Promise<ProjectSummary[]> {
  const rows = await queryRows<ProjectRow>(pool, `
    SELECT p.*, pm.role, owner.name AS owner_name, t.name AS team_name,
           (SELECT count(*) FROM project_files pf WHERE pf.project_id = p.id AND pf.mime_type != $2) AS file_count
    FROM projects p
    INNER JOIN project_members pm ON pm.project_id = p.id
    INNER JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE pm.user_id = $1
    ORDER BY p.updated_at DESC
  `, [userId, DRIVE_FOLDER_MIME_TYPE])

  return rows.map(rowToProjectSummary)
}

export async function createProject(input: {
  ownerUserId: string
  title: string
  driveFolderId: string
  teamId?: string | null
}): Promise<ProjectSummary> {
  const id = randomUUID()
  const now = Date.now()

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO projects (id, owner_user_id, team_id, title, drive_folder_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, input.ownerUserId, input.teamId ?? null, input.title, input.driveFolderId, now, now])

    await client.query(`
      INSERT INTO project_members (project_id, user_id, role, created_at)
      VALUES ($1, $2, 'owner', $3)
    `, [id, input.ownerUserId, now])
  })

  return (await getProjectSummaryForUser(id, input.ownerUserId))!
}

export async function getProjectSummaryForUser(projectId: string, userId: string): Promise<ProjectSummary | null> {
  const row = await queryOne<ProjectRow>(pool, `
    SELECT p.*, pm.role, owner.name AS owner_name, t.name AS team_name,
           (SELECT count(*) FROM project_files pf WHERE pf.project_id = p.id AND pf.mime_type != $3) AS file_count
    FROM projects p
    INNER JOIN project_members pm ON pm.project_id = p.id
    INNER JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.id = $1 AND pm.user_id = $2
  `, [projectId, userId, DRIVE_FOLDER_MIME_TYPE])

  return row ? rowToProjectSummary(row) : null
}

export async function getProjectDetailForUser(projectId: string, userId: string): Promise<ProjectDetail | null> {
  const project = await getProjectSummaryForUser(projectId, userId)
  if (!project) {
    return null
  }

  const role = await getProjectRole(projectId, userId)
  const [files, state, fileWorkflows, members, invitations] = await Promise.all([
    listProjectFiles(projectId),
    getProjectState(projectId),
    listProjectFileWorkflows(projectId),
    listProjectMembers(projectId),
    role === 'owner' ? listProjectInvitations(projectId) : Promise.resolve([]),
  ])
  const workflowMap = new Map(fileWorkflows.map((workflow) => [workflow.fileId, workflow] as const))

  return {
    ...project,
    files,
    trashedFiles: files.filter((file) => Boolean(workflowMap.get(file.id)?.trashedAt)),
    fileWorkflows,
    state,
    members,
    invitations,
  }
}

export async function getProjectById(projectId: string): Promise<(ProjectSummary & { driveFolderId: string }) | null> {
  const row = await queryOne<ProjectRow>(pool, `
    SELECT p.*, 'owner'::text AS role, owner.name AS owner_name, t.name AS team_name,
           COALESCE(SUM(CASE WHEN pf.mime_type != $2 THEN 1 ELSE 0 END), 0) AS file_count
    FROM projects p
    INNER JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN project_files pf ON pf.project_id = p.id
    WHERE p.id = $1
    GROUP BY p.id, owner.name, t.name
  `, [projectId, DRIVE_FOLDER_MIME_TYPE])

  if (!row) {
    return null
  }

  return {
    ...rowToProjectSummary(row),
    driveFolderId: row.drive_folder_id,
  }
}

export async function getProjectByDriveFolderId(ownerUserId: string, driveFolderId: string): Promise<(ProjectSummary & { driveFolderId: string }) | null> {
  const row = await queryOne<ProjectRow>(pool, `
    SELECT p.*, 'owner'::text AS role, owner.name AS owner_name, t.name AS team_name,
           COALESCE(SUM(CASE WHEN pf.mime_type != $3 THEN 1 ELSE 0 END), 0) AS file_count
    FROM projects p
    INNER JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN project_files pf ON pf.project_id = p.id
    WHERE p.owner_user_id = $1 AND p.drive_folder_id = $2
    GROUP BY p.id, owner.name, t.name
  `, [ownerUserId, driveFolderId, DRIVE_FOLDER_MIME_TYPE])

  if (!row) {
    return null
  }

  return {
    ...rowToProjectSummary(row),
    driveFolderId: row.drive_folder_id,
  }
}

export async function updateProjectTitle(projectId: string, title: string): Promise<void> {
  await pool.query('UPDATE projects SET title = $1, updated_at = $2 WHERE id = $3', [title, Date.now(), projectId])
}

export async function updateProjectDriveFolderId(projectId: string, driveFolderId: string): Promise<void> {
  await pool.query('UPDATE projects SET drive_folder_id = $1, updated_at = $2 WHERE id = $3', [driveFolderId, Date.now(), projectId])
}

export async function setProjectMainFile(projectId: string, mainFileId: string | null): Promise<void> {
  await pool.query('UPDATE projects SET main_file_id = $1, updated_at = $2 WHERE id = $3', [mainFileId, Date.now(), projectId])
}

export async function updateProjectCompileSettings(projectId: string, compileSettings: ProjectCompileSettings): Promise<void> {
  await pool.query('UPDATE projects SET compile_settings = $1, updated_at = $2 WHERE id = $3', [
    JSON.stringify(normalizeProjectCompileSettings(compileSettings)),
    Date.now(),
    projectId,
  ])
}

export async function getProjectEcosystemSettings(projectId: string): Promise<ProjectEcosystemSettings> {
  const row = await queryOne<{ ecosystem_settings: string | null }>(pool, 'SELECT ecosystem_settings FROM projects WHERE id = $1', [projectId])
  return parseProjectEcosystemSettings(row?.ecosystem_settings ?? null)
}

export async function updateProjectEcosystemSettings(projectId: string, ecosystemSettings: ProjectEcosystemSettings): Promise<void> {
  await pool.query('UPDATE projects SET ecosystem_settings = $1, updated_at = $2 WHERE id = $3', [
    JSON.stringify(normalizeProjectEcosystemSettings(ecosystemSettings)),
    Date.now(),
    projectId,
  ])
}

export async function deleteProject(projectId: string): Promise<void> {
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId])
}

export async function addProjectMember(projectId: string, userId: string, role: Exclude<ProjectRole, 'owner'>): Promise<void> {
  await pool.query(`
    INSERT INTO project_members (project_id, user_id, role, created_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT(project_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `, [projectId, userId, role, Date.now()])
}

export async function updateProjectMemberRole(projectId: string, userId: string, role: Exclude<ProjectRole, 'owner'>): Promise<void> {
  await pool.query(
    'UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3 AND role != $4',
    [role, projectId, userId, 'owner'],
  )
}

export async function revokeProjectMember(projectId: string, userId: string): Promise<void> {
  await pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND role != $3', [projectId, userId, 'owner'])
}

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await queryRows<ProjectMemberRow>(pool, `
    SELECT u.id AS user_id, u.email, u.name, u.avatar_url, pm.role, pm.created_at
    FROM project_members pm
    INNER JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = $1
    ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.name ASC
  `, [projectId])

  return rows.map(rowToProjectMember)
}

export async function listProjectInvitations(projectId: string): Promise<ProjectInvitation[]> {
  const rows = await queryRows<ProjectInvitationRow>(pool, `
    SELECT pi.id, pi.project_id, p.title AS project_title, pi.email, pi.role, pi.status,
           pi.invited_by_user_id, u.name AS invited_by_name, responder.email AS responded_by_email, pi.created_at, pi.updated_at
    FROM project_invitations pi
    INNER JOIN projects p ON p.id = pi.project_id
    INNER JOIN users u ON u.id = pi.invited_by_user_id
    LEFT JOIN users responder ON responder.id = pi.responded_by_user_id
    WHERE pi.project_id = $1
    ORDER BY CASE pi.status WHEN 'pending' THEN 0 ELSE 1 END, pi.updated_at DESC
  `, [projectId])

  return rows.map(rowToProjectInvitation)
}

export async function listPendingInvitationsForUser(email: string): Promise<ProjectInvitation[]> {
  const rows = await queryRows<ProjectInvitationRow>(pool, `
    SELECT pi.id, pi.project_id, p.title AS project_title, pi.email, pi.role, pi.status,
           pi.invited_by_user_id, u.name AS invited_by_name, responder.email AS responded_by_email, pi.created_at, pi.updated_at
    FROM project_invitations pi
    INNER JOIN projects p ON p.id = pi.project_id
    INNER JOIN users u ON u.id = pi.invited_by_user_id
    LEFT JOIN users responder ON responder.id = pi.responded_by_user_id
    WHERE LOWER(pi.email) = LOWER($1) AND pi.status = 'pending'
    ORDER BY pi.updated_at DESC
  `, [email])

  return rows.map(rowToProjectInvitation)
}

export async function getProjectInvitationById(invitationId: string): Promise<ProjectInvitation | null> {
  const row = await queryOne<ProjectInvitationRow>(pool, `
    SELECT pi.id, pi.project_id, p.title AS project_title, pi.email, pi.role, pi.status,
           pi.invited_by_user_id, u.name AS invited_by_name, responder.email AS responded_by_email, pi.created_at, pi.updated_at
    FROM project_invitations pi
    INNER JOIN projects p ON p.id = pi.project_id
    INNER JOIN users u ON u.id = pi.invited_by_user_id
    LEFT JOIN users responder ON responder.id = pi.responded_by_user_id
    WHERE pi.id = $1
  `, [invitationId])

  return row ? rowToProjectInvitation(row) : null
}

export async function getPendingProjectInvitationById(invitationId: string): Promise<ProjectInvitation | null> {
  const invitation = await getProjectInvitationById(invitationId)
  return invitation && invitation.status === 'pending' ? invitation : null
}

export async function createOrUpdateProjectInvitation(input: {
  projectId: string
  email: string
  role: Exclude<ProjectRole, 'owner'>
  invitedByUserId: string
}): Promise<ProjectInvitation> {
  const now = Date.now()
  const existing = await queryOne<{ id: string }>(pool, `
    SELECT id
    FROM project_invitations
    WHERE project_id = $1 AND LOWER(email) = LOWER($2)
  `, [input.projectId, input.email])

  if (existing) {
    await pool.query(`
      UPDATE project_invitations
      SET role = $1, status = 'pending', invited_by_user_id = $2, responded_by_user_id = NULL, updated_at = $3
      WHERE id = $4
    `, [input.role, input.invitedByUserId, now, existing.id])

    return (await getProjectInvitationById(existing.id))!
  }

  const id = randomUUID()
  await pool.query(`
    INSERT INTO project_invitations (id, project_id, email, role, status, invited_by_user_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
  `, [id, input.projectId, input.email.toLowerCase(), input.role, input.invitedByUserId, now, now])

  return (await getProjectInvitationById(id))!
}

export async function respondToProjectInvitation(input: {
  invitationId: string
  email: string
  userId: string
  action: 'accept' | 'reject'
  allowEmailMismatch?: boolean
}): Promise<ProjectInvitation | null> {
  const invitation = await getProjectInvitationById(input.invitationId)
  if (!invitation || invitation.status !== 'pending') {
    return null
  }

  if (!input.allowEmailMismatch && invitation.email.toLowerCase() !== input.email.toLowerCase()) {
    return null
  }

  const nextStatus: ProjectInvitationStatus = input.action === 'accept' ? 'accepted' : 'rejected'
  const now = Date.now()

  await withTransaction(async (client) => {
    await client.query('UPDATE project_invitations SET status = $1, responded_by_user_id = $2, updated_at = $3 WHERE id = $4', [nextStatus, input.userId, now, input.invitationId])
    if (nextStatus === 'accepted') {
      await client.query(`
        INSERT INTO project_members (project_id, user_id, role, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(project_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `, [invitation.projectId, input.userId, invitation.role, now])
    }
  })

  return getProjectInvitationById(input.invitationId)
}

export async function revokeProjectInvitation(invitationId: string): Promise<ProjectInvitation | null> {
  const invitation = await getProjectInvitationById(invitationId)
  if (!invitation) {
    return null
  }

  await pool.query(`
    UPDATE project_invitations
    SET status = 'revoked', updated_at = $1
    WHERE id = $2
  `, [Date.now(), invitationId])

  return getProjectInvitationById(invitationId)
}

function hashReviewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createProjectReviewRequest(input: {
  projectId: string
  fileId: string
  requesterUserId: string
  supervisorEmail: string
  supervisorName?: string | null
  message?: string | null
  sourceRevisionId?: string | null
  expiresAt: number
}): Promise<ProjectReviewRequestRow & { token: string; requester_name: string }> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const requester = await findUserById(input.requesterUserId)
  const row = await queryOne<ProjectReviewRequestRow & { requester_name: string }>(pool, `
    INSERT INTO project_review_requests (
      id, project_id, file_id, requester_user_id, supervisor_email, supervisor_name,
      message, token_hash, source_revision_id, status, expires_at, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11, $12)
    RETURNING *, $13::text AS requester_name
  `, [
    randomUUID(),
    input.projectId,
    input.fileId,
    input.requesterUserId,
    input.supervisorEmail.toLowerCase(),
    input.supervisorName ?? null,
    input.message ?? null,
    hashReviewToken(token),
    input.sourceRevisionId ?? null,
    input.expiresAt,
    now,
    now,
    requester?.name ?? 'A Typstr user',
  ])

  if (!row) throw new Error('Failed to create review request')
  return { ...row, token }
}

export async function getProjectReviewRequestByToken(token: string): Promise<(ProjectReviewRequestRow & {
  project_title: string
  file_path: string
  file_drive_file_id: string
  owner_user_id: string
  requester_name: string
  requester_email: string
}) | null> {
  return queryOne(pool, `
    SELECT prr.*, p.title AS project_title, pf.path AS file_path, pf.drive_file_id AS file_drive_file_id, p.owner_user_id,
           requester.name AS requester_name, requester.email AS requester_email
    FROM project_review_requests prr
    INNER JOIN projects p ON p.id = prr.project_id
    INNER JOIN project_files pf ON pf.id = prr.file_id
    INNER JOIN users requester ON requester.id = prr.requester_user_id
    WHERE prr.token_hash = $1 AND prr.status = 'open' AND prr.expires_at > $2
    LIMIT 1
  `, [hashReviewToken(token), Date.now()])
}

export async function listProjectReviewRequests(projectId: string): Promise<Array<ProjectReviewRequestRow & {
  file_path: string
  open_comments: number
  resolved_comments: number
}>> {
  return queryRows(pool, `
    SELECT prr.*, pf.path AS file_path,
           COUNT(pc.id) FILTER (WHERE pc.status = 'open')::int AS open_comments,
           COUNT(pc.id) FILTER (WHERE pc.status = 'resolved')::int AS resolved_comments
    FROM project_review_requests prr
    INNER JOIN project_files pf ON pf.id = prr.file_id
    LEFT JOIN project_comments pc ON pc.review_request_id = prr.id
    WHERE prr.project_id = $1
    GROUP BY prr.id, pf.path
    ORDER BY prr.created_at DESC
  `, [projectId])
}

export async function updateProjectReviewRequest(input: {
  id: string
  projectId: string
  supervisorName?: string | null
  message?: string | null
  expiresAt?: number
}): Promise<ProjectReviewRequestRow | null> {
  const updates: string[] = []
  const values: unknown[] = []

  if (input.supervisorName !== undefined) {
    values.push(input.supervisorName)
    updates.push(`supervisor_name = $${values.length}`)
  }
  if (input.message !== undefined) {
    values.push(input.message)
    updates.push(`message = $${values.length}`)
  }
  if (input.expiresAt !== undefined) {
    values.push(input.expiresAt)
    updates.push(`expires_at = $${values.length}`)
  }

  if (updates.length === 0) {
    return queryOne(pool, `SELECT * FROM project_review_requests WHERE id = $1 AND project_id = $2 LIMIT 1`, [input.id, input.projectId])
  }

  values.push(Date.now(), input.id, input.projectId)
  return queryOne(pool, `
    UPDATE project_review_requests
    SET ${updates.join(', ')}, updated_at = $${values.length - 2}
    WHERE id = $${values.length - 1} AND project_id = $${values.length}
    RETURNING *
  `, values)
}

export async function revokeProjectReviewRequest(id: string, projectId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE project_review_requests SET status = 'closed', updated_at = $1 WHERE id = $2 AND project_id = $3 AND status = 'open'`,
    [Date.now(), id, projectId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function listProjectComments(fileId: string): Promise<ProjectComment[]> {
  const [rows, replies] = await Promise.all([
    queryRows<ProjectCommentRow>(pool, `
      SELECT pc.*, COALESCE(u.name, pc.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pc.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url,
             resolver.name AS resolved_by_name,
             assignee.name AS assignee_name, assignee.email AS assignee_email
      FROM project_comments pc
      LEFT JOIN users u ON u.id = pc.author_user_id
      LEFT JOIN users resolver ON resolver.id = pc.resolved_by_user_id
      LEFT JOIN users assignee ON assignee.id = pc.assignee_user_id
      WHERE pc.file_id = $1
      ORDER BY pc.start_line ASC, pc.start_column ASC, pc.created_at ASC
    `, [fileId]),
    queryRows<ProjectCommentReplyRow>(pool, `
      SELECT pcr.*, COALESCE(u.name, pcr.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pcr.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url
      FROM project_comment_replies pcr
      LEFT JOIN users u ON u.id = pcr.author_user_id
      WHERE pcr.file_id = $1
      ORDER BY pcr.created_at ASC
    `, [fileId]),
  ])

  const repliesByCommentId = new Map<string, ProjectCommentReply[]>()
  for (const reply of replies) {
    const bucket = repliesByCommentId.get(reply.comment_id) ?? []
    bucket.push(rowToProjectCommentReply(reply))
    repliesByCommentId.set(reply.comment_id, bucket)
  }

  return rows.map((row) => rowToProjectComment(row, repliesByCommentId.get(row.id) ?? []))
}

export async function createProjectComment(input: {
  projectId: string
  fileId: string
  authorUserId: string | null
  anonymousAuthorName?: string | null
  anonymousAuthorEmail?: string | null
  reviewRequestId?: string | null
  content: string
  excerpt: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  pdfAnnotation?: ProjectCommentPdfAnnotation | null
  assigneeUserId?: string | null
}): Promise<ProjectComment> {
  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO project_comments (
      id, project_id, file_id, author_user_id, anonymous_author_name, anonymous_author_email, review_request_id, content, excerpt,
      start_line, start_column, end_line, end_column,
      status, resolved_by_user_id, resolved_at, pdf_annotation, assignee_user_id, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'open', NULL, NULL, $14, $15, $16, $17)
  `, [
    id,
    input.projectId,
    input.fileId,
    input.authorUserId,
    input.anonymousAuthorName ?? null,
    input.anonymousAuthorEmail ?? null,
    input.reviewRequestId ?? null,
    input.content,
    input.excerpt,
    input.startLine,
    input.startColumn,
    input.endLine,
    input.endColumn,
    input.pdfAnnotation ? JSON.stringify(input.pdfAnnotation) : null,
    input.assigneeUserId ?? null,
    now,
    now,
  ])

  await touchProject(input.projectId, now)
  return (await getProjectCommentById(id))!
}

export async function getProjectCommentById(commentId: string): Promise<ProjectComment | null> {
  const row = await queryOne<ProjectCommentRow>(pool, `
    SELECT pc.*, COALESCE(u.name, pc.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pc.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url,
           resolver.name AS resolved_by_name,
           assignee.name AS assignee_name, assignee.email AS assignee_email
    FROM project_comments pc
    LEFT JOIN users u ON u.id = pc.author_user_id
    LEFT JOIN users resolver ON resolver.id = pc.resolved_by_user_id
    LEFT JOIN users assignee ON assignee.id = pc.assignee_user_id
    WHERE pc.id = $1
  `, [commentId])

  if (!row) {
    return null
  }

  const replies = await queryRows<ProjectCommentReplyRow>(pool, `
    SELECT pcr.*, COALESCE(u.name, pcr.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pcr.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url
    FROM project_comment_replies pcr
    LEFT JOIN users u ON u.id = pcr.author_user_id
    WHERE pcr.comment_id = $1
    ORDER BY pcr.created_at ASC
  `, [commentId])

  return rowToProjectComment(row, replies.map(rowToProjectCommentReply))
}

export async function createProjectCommentReply(input: {
  commentId: string
  projectId: string
  fileId: string
  authorUserId: string | null
  anonymousAuthorName?: string | null
  anonymousAuthorEmail?: string | null
  content: string
}): Promise<ProjectComment> {
  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO project_comment_replies (
      id, comment_id, project_id, file_id, author_user_id, anonymous_author_name, anonymous_author_email, content, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [id, input.commentId, input.projectId, input.fileId, input.authorUserId, input.anonymousAuthorName ?? null, input.anonymousAuthorEmail ?? null, input.content, now, now])

  await touchProject(input.projectId, now)
  return (await getProjectCommentById(input.commentId))!
}

export async function updateProjectCommentStatus(input: {
  commentId: string
  projectId: string
  status: 'open' | 'resolved' | 'deleted'
  updatedByUserId: string
}): Promise<ProjectComment | null> {
  const now = Date.now()
  const isResolved = input.status === 'resolved'

  await pool.query(`
    UPDATE project_comments
    SET status = $1,
        resolved_by_user_id = $2,
        resolved_at = $3,
        updated_at = $4
    WHERE id = $5 AND project_id = $6
  `, [
    input.status,
    isResolved ? input.updatedByUserId : null,
    isResolved ? now : null,
    now,
    input.commentId,
    input.projectId,
  ])

  await touchProject(input.projectId, now)
  return getProjectCommentById(input.commentId)
}

export async function deleteProjectComment(commentId: string, projectId: string): Promise<void> {
  const now = Date.now()
  await pool.query('DELETE FROM project_comments WHERE id = $1 AND project_id = $2', [commentId, projectId])
  await touchProject(projectId, now)
}

export async function createProjectNotifications(input: {
  recipientUserIds: string[]
  projectId: string
  fileId: string
  commentId: string
  actorUserId: string
  type: 'mention'
  excerpt: string
}): Promise<void> {
  const recipientUserIds = [...new Set(input.recipientUserIds)].filter(Boolean)
  if (recipientUserIds.length === 0) {
    return
  }

  const now = Date.now()
  await withTransaction(async (client) => {
    for (const recipientUserId of recipientUserIds) {
      await client.query(`
        INSERT INTO project_notifications (
          id, recipient_user_id, project_id, file_id, comment_id, actor_user_id, type, excerpt, created_at, read_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
      `, [randomUUID(), recipientUserId, input.projectId, input.fileId, input.commentId, input.actorUserId, input.type, input.excerpt, now])
    }
  })
}

export async function listNotificationsForUser(userId: string): Promise<ProjectNotification[]> {
  const rows = await queryRows<ProjectNotificationRow>(pool, `
    SELECT pn.*, p.title AS project_title, pf.path AS file_path, actor.name AS actor_name
    FROM project_notifications pn
    INNER JOIN projects p ON p.id = pn.project_id
    INNER JOIN project_files pf ON pf.id = pn.file_id
    INNER JOIN users actor ON actor.id = pn.actor_user_id
    WHERE pn.recipient_user_id = $1
    ORDER BY COALESCE(pn.read_at, 0) ASC, pn.created_at DESC
    LIMIT 100
  `, [userId])

  return rows.map(rowToProjectNotification)
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<ProjectNotification | null> {
  await pool.query(`
    UPDATE project_notifications
    SET read_at = COALESCE(read_at, $1)
    WHERE id = $2 AND recipient_user_id = $3
  `, [Date.now(), notificationId, userId])

  const row = await queryOne<ProjectNotificationRow>(pool, `
    SELECT pn.*, p.title AS project_title, pf.path AS file_path, actor.name AS actor_name
    FROM project_notifications pn
    INNER JOIN projects p ON p.id = pn.project_id
    INNER JOIN project_files pf ON pf.id = pn.file_id
    INNER JOIN users actor ON actor.id = pn.actor_user_id
    WHERE pn.id = $1 AND pn.recipient_user_id = $2
  `, [notificationId, userId])

  return row ? rowToProjectNotification(row) : null
}

export async function getProjectRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const row = await queryOne<{ role: ProjectRole }>(pool, 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId])
  return row?.role ?? null
}

export async function canAccessProject(projectId: string, userId: string, minimumRole: ProjectRole): Promise<boolean> {
  const role = await getProjectRole(projectId, userId)
  if (!role) {
    return false
  }

  return roleRank(role) >= roleRank(minimumRole)
}

export async function createProjectFile(input: {
  projectId: string
  name: string
  path: string
  mimeType: string
  driveFileId: string
  sizeBytes?: number
}): Promise<ProjectFile> {
  const id = randomUUID()
  const now = Date.now()

  const result = await pool.query<ProjectFileRow>(`
    INSERT INTO project_files (id, project_id, name, path, mime_type, drive_file_id, size_bytes, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (project_id, path) DO UPDATE
    SET name = EXCLUDED.name,
        mime_type = EXCLUDED.mime_type,
        drive_file_id = EXCLUDED.drive_file_id,
        size_bytes = EXCLUDED.size_bytes,
        updated_at = EXCLUDED.updated_at
    RETURNING *
  `, [id, input.projectId, input.name, input.path, input.mimeType, input.driveFileId, input.sizeBytes ?? 0, now, now])

  await touchProject(input.projectId, now)
  return rowToProjectFile(result.rows[0]!)
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const rows = await queryRows<ProjectFileRow>(pool, 'SELECT * FROM project_files WHERE project_id = $1 ORDER BY path ASC', [projectId])
  return rows.map(rowToProjectFile)
}

export interface SearchableFileRow {
  fileId: string
  filePath: string
  mimeType: string
  projectId: string
  projectTitle: string
  collaborationState: Uint8Array
}

export async function getSearchableFilesForUser(userId: string, limit = 500): Promise<SearchableFileRow[]> {
  const rows = await queryRows<{
    file_id: string
    file_path: string
    mime_type: string
    project_id: string
    project_title: string
    collaboration_state: Buffer
  }>(pool, `
    SELECT pf.id AS file_id, pf.path AS file_path, pf.mime_type, p.id AS project_id, p.title AS project_title, pf.collaboration_state
    FROM project_files pf
    JOIN projects p ON p.id = pf.project_id
    JOIN project_members pm ON pm.project_id = p.id
    LEFT JOIN project_preferences pp ON pp.project_id = p.id
    WHERE pm.user_id = $1
      AND pf.collaboration_state IS NOT NULL
      AND (pp.trashed_at IS NULL OR pp.project_id IS NULL)
    ORDER BY p.updated_at DESC
    LIMIT $2
  `, [userId, limit])

  return rows.map(row => ({
    fileId: row.file_id,
    filePath: row.file_path,
    mimeType: row.mime_type,
    projectId: row.project_id,
    projectTitle: row.project_title,
    collaborationState: new Uint8Array(row.collaboration_state),
  }))
}

export async function getProjectFileByPath(projectId: string, targetPath: string): Promise<ProjectFile | null> {
  const row = await queryOne<ProjectFileRow>(pool, 'SELECT * FROM project_files WHERE project_id = $1 AND path = $2', [projectId, targetPath])
  return row ? rowToProjectFile(row) : null
}

export async function getProjectFileById(fileId: string): Promise<ProjectFile | null> {
  const row = await queryOne<ProjectFileRow>(pool, 'SELECT * FROM project_files WHERE id = $1', [fileId])
  return row ? rowToProjectFile(row) : null
}

export async function getProjectFileByDriveFileId(projectId: string, driveFileId: string): Promise<ProjectFile | null> {
  const row = await queryOne<ProjectFileRow>(pool, 'SELECT * FROM project_files WHERE project_id = $1 AND drive_file_id = $2', [projectId, driveFileId])
  return row ? rowToProjectFile(row) : null
}

export async function getProjectFileByStorageId(storageId: string): Promise<(ProjectFile & { ownerUserId: string; projectDriveFolderId: string; collaborationState: Uint8Array | null }) | null> {
  const row = await queryOne<ProjectFileRow & { owner_user_id: string; drive_folder_id: string }>(pool, `
    SELECT pf.*, p.owner_user_id, p.drive_folder_id
    FROM project_files pf
    INNER JOIN projects p ON p.id = pf.project_id
    WHERE pf.drive_file_id = $1
    LIMIT 1
  `, [storageId])

  if (!row) {
    return null
  }

  return {
    ...rowToProjectFile(row),
    ownerUserId: row.owner_user_id,
    projectDriveFolderId: row.drive_folder_id,
    collaborationState: row.collaboration_state ? new Uint8Array(row.collaboration_state) : null,
  }
}

export async function getProjectFileForUser(fileId: string, userId: string): Promise<(ProjectFile & { role: ProjectRole; ownerUserId: string }) | null> {
  const row = await queryOne<ProjectFileRow & { role: ProjectRole; owner_user_id: string }>(pool, `
    SELECT pf.*, pm.role, p.owner_user_id
    FROM project_files pf
    INNER JOIN projects p ON p.id = pf.project_id
    INNER JOIN project_members pm ON pm.project_id = p.id
    WHERE pf.id = $1 AND pm.user_id = $2
  `, [fileId, userId])

  if (!row) {
    return null
  }

  return {
    ...rowToProjectFile(row),
    role: row.role,
    ownerUserId: row.owner_user_id,
  }
}

export async function getProjectFileStorage(fileId: string): Promise<{ file: ProjectFile; ownerUserId: string; collaborationState: Uint8Array | null } | null> {
  const row = await queryOne<ProjectFileRow & { owner_user_id: string }>(pool, `
    SELECT pf.*, p.owner_user_id
    FROM project_files pf
    INNER JOIN projects p ON p.id = pf.project_id
    WHERE pf.id = $1
  `, [fileId])

  if (!row) {
    return null
  }

  return {
    file: rowToProjectFile(row),
    ownerUserId: row.owner_user_id,
    collaborationState: row.collaboration_state ? new Uint8Array(row.collaboration_state) : null,
  }
}

export async function updateProjectFileCollaborationState(fileId: string, state: Uint8Array | null): Promise<void> {
  await pool.query('UPDATE project_files SET collaboration_state = $1 WHERE id = $2', [state ? Buffer.from(state) : null, fileId])
}

export async function renameProjectFile(fileId: string, name: string, nextPath: string): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file) {
    return
  }

  const now = Date.now()
  await pool.query('UPDATE project_files SET name = $1, path = $2, updated_at = $3 WHERE id = $4', [name, nextPath, now, fileId])
  await touchProject(file.projectId, now)
}

export async function updateProjectFileMetadata(fileId: string, input: { name: string; path: string; mimeType: string }): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file) {
    return
  }

  const now = Date.now()
  await pool.query(
    'UPDATE project_files SET name = $1, path = $2, mime_type = $3, updated_at = $4 WHERE id = $5',
    [input.name, input.path, input.mimeType, now, fileId],
  )
  await touchProject(file.projectId, now)
}

export async function moveProjectFile(fileId: string, input: { name?: string; nextPath: string }): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file) {
    return
  }

  const now = Date.now()
  const nextName = input.name ?? file.name

  await withTransaction(async (client) => {
    await client.query('UPDATE project_files SET name = $1, path = $2, updated_at = $3 WHERE id = $4', [nextName, input.nextPath, now, fileId])

    const descendants = await queryRows<{ id: string; path: string }>(client, `
      SELECT id, path
      FROM project_files
      WHERE project_id = $1 AND path LIKE $2 ESCAPE '\\' AND id != $3
      ORDER BY path ASC
    `, [file.projectId, `${escapeLikeValue(file.path)}/%`, fileId])

    for (const descendant of descendants) {
      const suffix = descendant.path.slice(file.path.length)
      await client.query('UPDATE project_files SET path = $1, updated_at = $2 WHERE id = $3', [`${input.nextPath}${suffix}`, now, descendant.id])
    }

    await touchProject(file.projectId, now, client)
  })
}

export async function deleteProjectFile(fileId: string): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file) {
    return
  }

  await pool.query('DELETE FROM project_files WHERE id = $1', [fileId])
  await touchProject(file.projectId, Date.now())
}

export async function deleteProjectFileTree(fileId: string): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file) {
    return
  }

  const now = Date.now()
  await pool.query(`
    DELETE FROM project_files
    WHERE project_id = $1 AND (id = $2 OR path LIKE $3 ESCAPE '\\')
  `, [file.projectId, fileId, `${escapeLikeValue(file.path)}/%`])
  await touchProject(file.projectId, now)
}

export async function countProjectFilesInTree(projectId: string, filePath: string): Promise<number> {
  const row = await queryOne<{ count: number }>(pool, `
    SELECT COUNT(*) AS count
    FROM project_files
    WHERE project_id = $1
      AND mime_type != $2
      AND (path = $3 OR path LIKE $4 ESCAPE '\\')
  `, [projectId, DRIVE_FOLDER_MIME_TYPE, filePath, `${escapeLikeValue(filePath)}/%`])

  return Number(row?.count ?? 0)
}

export async function countProjectFiles(projectId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(pool, `
    SELECT COUNT(*) AS count
    FROM project_files
    WHERE project_id = $1 AND mime_type != $2
  `, [projectId, DRIVE_FOLDER_MIME_TYPE])

  return Number(row?.count ?? 0)
}

export async function touchProjectFile(fileId: string): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file) {
    return
  }

  const now = Date.now()
  await pool.query('UPDATE project_files SET updated_at = $1 WHERE id = $2', [now, fileId])
  await touchProject(file.projectId, now)
}

export function sanitizeUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    driveRootFolderId: user.driveRootFolderId,
    aiApiKeys: {
      gemini: Boolean(user.geminiApiKey),
      anthropic: Boolean(user.anthropicApiKey),
      openai: Boolean(user.openaiApiKey),
    },
    isAdmin: isAdminEmail(user.email),
    disabledAt: user.disabledAt,
    academicRole: user.academicRole,
    department: user.department,
    institutionName: user.institutionName,
    orcidId: user.orcidId,
    orcidName: user.orcidName,
    orcidLinkedAt: user.orcidLinkedAt,
    selectedTheme: user.selectedTheme,
  }
}

async function touchProject(projectId: string, timestamp: number, queryable: Queryable = pool): Promise<void> {
  await queryable.query('UPDATE projects SET updated_at = $1 WHERE id = $2', [timestamp, projectId])
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function queryOne<T>(queryable: Queryable, text: string, values: unknown[] = []): Promise<T | null> {
  const result = await queryable.query(text, values)
  return (result.rows[0] as T | undefined) ?? null
}

async function queryRows<T>(queryable: Queryable, text: string, values: unknown[] = []): Promise<T[]> {
  const result = await queryable.query(text, values)
  return result.rows as T[]
}

function rowToUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    googleId: row.google_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    refreshToken: row.refresh_token,
    orcidId: row.orcid_id,
    orcidName: row.orcid_name,
    orcidAccessToken: row.orcid_access_token,
    orcidRefreshToken: row.orcid_refresh_token,
    orcidLinkedAt: row.orcid_linked_at,
    geminiApiKey: row.gemini_api_key,
    anthropicApiKey: row.anthropic_api_key,
    openaiApiKey: row.openai_api_key,
    aiApiKeys: {
      gemini: Boolean(row.gemini_api_key),
      anthropic: Boolean(row.anthropic_api_key),
      openai: Boolean(row.openai_api_key),
    },
    driveRootFolderId: row.drive_root_folder_id,
    disabledAt: row.disabled_at,
    academicRole: row.academic_role,
    department: row.department,
    institutionName: row.institution_name,
    selectedTheme: parseUserTheme(row.selected_theme_settings),
    isAdmin: isAdminEmail(row.email),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseUserTheme(raw: string | null): UserRecord['selectedTheme'] {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as UserRecord['selectedTheme']
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function rowToProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    mainFileId: row.main_file_id,
    compileSettings: parseProjectCompileSettings(row.compile_settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileCount: Number(row.file_count ?? 0),
    publishedAt: row.published_at ?? null,
    teamId: row.team_id ?? null,
    teamName: row.team_name ?? null,
  }
}

function parseProjectCompileSettings(raw: string | null): ProjectCompileSettings {
  if (!raw) {
    return { ...DEFAULT_PROJECT_COMPILE_SETTINGS }
  }

  try {
    return normalizeProjectCompileSettings(JSON.parse(raw) as Partial<ProjectCompileSettings>)
  } catch {
    return { ...DEFAULT_PROJECT_COMPILE_SETTINGS }
  }
}

function parseProjectEcosystemSettings(raw: string | null): ProjectEcosystemSettings {
  if (!raw) {
    return normalizeProjectEcosystemSettings(DEFAULT_PROJECT_ECOSYSTEM_SETTINGS)
  }

  try {
    return normalizeProjectEcosystemSettings(JSON.parse(raw) as Partial<ProjectEcosystemSettings>)
  } catch {
    return normalizeProjectEcosystemSettings(DEFAULT_PROJECT_ECOSYSTEM_SETTINGS)
  }
}

function normalizeProjectCompileSettings(input: Partial<ProjectCompileSettings>): ProjectCompileSettings {
  return {
    autoCompile: typeof input.autoCompile === 'boolean' ? input.autoCompile : DEFAULT_PROJECT_COMPILE_SETTINGS.autoCompile,
    compileDebounceMs: typeof input.compileDebounceMs === 'number' && Number.isFinite(input.compileDebounceMs)
      ? Math.min(1500, Math.max(200, Math.round(input.compileDebounceMs)))
      : DEFAULT_PROJECT_COMPILE_SETTINGS.compileDebounceMs,
    defaultExportFormat: isExportFormat(input.defaultExportFormat)
      ? input.defaultExportFormat
      : DEFAULT_PROJECT_COMPILE_SETTINGS.defaultExportFormat,
    defaultExportDestination: input.defaultExportDestination === 'drive' || input.defaultExportDestination === 'download'
      ? input.defaultExportDestination
      : DEFAULT_PROJECT_COMPILE_SETTINGS.defaultExportDestination,
    pageLimit: typeof input.pageLimit === 'number' && Number.isFinite(input.pageLimit) && input.pageLimit > 0
      ? Math.min(10000, Math.max(1, Math.round(input.pageLimit)))
      : null,
  }
}

function isExportFormat(value: unknown): value is ProjectCompileSettings['defaultExportFormat'] {
  return value === 'pdf' || value === 'docx' || value === 'latex' || value === 'html'
}

function rowToProjectFile(row: ProjectFileRow): ProjectFile {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    path: row.path,
    mimeType: row.mime_type,
    driveFileId: row.drive_file_id,
    sizeBytes: row.size_bytes ?? 0,
    lastContentHash: row.last_content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToProjectMember(row: ProjectMemberRow): ProjectMember {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    createdAt: row.created_at,
  }
}

function rowToProjectInvitation(row: ProjectInvitationRow): ProjectInvitation {
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invited_by_user_id,
    invitedByName: row.invited_by_name,
    respondedByEmail: row.responded_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToProjectState(row: ProjectPreferenceRow): ProjectState {
  return {
    isStarred: row.is_starred,
    isPinned: row.is_pinned,
    archivedAt: row.archived_at,
    trashedAt: row.trashed_at,
    lastOpenedAt: row.last_opened_at,
    templateId: row.template_id,
  }
}

function rowToProjectFileWorkflow(row: ProjectFileWorkflowRow): ProjectFileWorkflow {
  return {
    fileId: row.file_id,
    projectId: row.project_id,
    lockedByUserId: row.locked_by_user_id,
    lockedByName: row.locked_by_name,
    lockedAt: row.locked_at,
    reviewOwnerUserId: row.review_owner_user_id,
    reviewOwnerName: row.review_owner_name,
    reviewAssignedAt: row.review_assigned_at,
    trashedAt: row.trashed_at,
    trashedOriginalPath: row.trashed_original_path,
  }
}

async function getProjectState(projectId: string): Promise<ProjectState> {
  const row = await queryOne<ProjectPreferenceRow>(pool, `
    SELECT project_id, is_starred, is_pinned, archived_at, trashed_at, last_opened_at, template_id
    FROM project_preferences
    WHERE project_id = $1
  `, [projectId])

  return row ? rowToProjectState(row) : defaultProjectState()
}

async function listProjectFileWorkflows(projectId: string): Promise<ProjectFileWorkflow[]> {
  const rows = await queryRows<ProjectFileWorkflowRow>(pool, `
    SELECT pfw.file_id, pfw.project_id,
           pfw.locked_by_user_id, locked_user.name AS locked_by_name, pfw.locked_at,
           pfw.review_owner_user_id, review_user.name AS review_owner_name, pfw.review_assigned_at,
           pfw.trashed_at, pfw.trashed_original_path
    FROM project_file_workflow pfw
    LEFT JOIN users locked_user ON locked_user.id = pfw.locked_by_user_id
    LEFT JOIN users review_user ON review_user.id = pfw.review_owner_user_id
    WHERE pfw.project_id = $1
    ORDER BY pfw.updated_at DESC
  `, [projectId])

  return rows.map(rowToProjectFileWorkflow)
}

function defaultProjectState(): ProjectState {
  return {
    isStarred: false,
    isPinned: false,
    archivedAt: null,
    trashedAt: null,
    lastOpenedAt: null,
    templateId: null,
  }
}

function rowToProjectCommentReply(row: ProjectCommentReplyRow): ProjectCommentReply {
  return {
    id: row.id,
    commentId: row.comment_id,
    projectId: row.project_id,
    fileId: row.file_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorEmail: row.author_email,
    authorAvatarUrl: row.author_avatar_url,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToProjectComment(row: ProjectCommentRow, replies: ProjectCommentReply[]): ProjectComment {
  return {
    id: row.id,
    projectId: row.project_id,
    fileId: row.file_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorEmail: row.author_email,
    authorAvatarUrl: row.author_avatar_url,
    content: row.content,
    excerpt: row.excerpt,
    startLine: row.start_line,
    startColumn: row.start_column,
    endLine: row.end_line,
    endColumn: row.end_column,
    status: row.status,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedByName: row.resolved_by_name,
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    reviewRequestId: row.review_request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pdfAnnotation: parseProjectCommentPdfAnnotation(row.pdf_annotation),
    replies,
  }
}

export async function assignProjectComment(commentId: string, assigneeUserId: string | null): Promise<void> {
  await pool.query(
    `UPDATE project_comments SET assignee_user_id = $1, updated_at = $2 WHERE id = $3`,
    [assigneeUserId, Date.now(), commentId]
  )
}

export async function listCommentsAssignedToUser(userId: string): Promise<ProjectComment[]> {
  const rows = await queryRows<ProjectCommentRow>(pool, `
    SELECT pc.*, COALESCE(u.name, pc.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pc.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url,
           resolver.name AS resolved_by_name,
           assignee.name AS assignee_name, assignee.email AS assignee_email
    FROM project_comments pc
    LEFT JOIN users u ON u.id = pc.author_user_id
    LEFT JOIN users resolver ON resolver.id = pc.resolved_by_user_id
    LEFT JOIN users assignee ON assignee.id = pc.assignee_user_id
    WHERE pc.assignee_user_id = $1 AND pc.status = 'open'
    ORDER BY pc.created_at DESC
  `, [userId])
  return rows.map((row) => rowToProjectComment(row, []))
}

export async function listCommentsInvolvingUser(userId: string): Promise<ProjectComment[]> {
  type Row = ProjectCommentRow & { project_title: string; file_path: string }
  type ReplyRow = ProjectCommentReplyRow & { comment_project_id: string; comment_file_id: string }

  const [rows, replyRows] = await Promise.all([
    queryRows<Row>(pool, `
      SELECT pc.*,
             COALESCE(u.name, pc.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pc.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url,
             resolver.name AS resolved_by_name,
             assignee.name AS assignee_name, assignee.email AS assignee_email,
             p.title AS project_title, pf.path AS file_path
      FROM project_comments pc
      LEFT JOIN users u ON u.id = pc.author_user_id
      LEFT JOIN users resolver ON resolver.id = pc.resolved_by_user_id
      LEFT JOIN users assignee ON assignee.id = pc.assignee_user_id
      INNER JOIN projects p ON p.id = pc.project_id
      INNER JOIN project_files pf ON pf.id = pc.file_id
      INNER JOIN project_members pm ON pm.project_id = pc.project_id AND pm.user_id = $1
      WHERE pc.status != 'deleted'
        AND (
          pc.author_user_id = $1
          OR pc.assignee_user_id = $1
          OR EXISTS (
            SELECT 1 FROM project_comment_replies pcr
            WHERE pcr.comment_id = pc.id AND pcr.author_user_id = $1
          )
        )
      ORDER BY pc.updated_at DESC
      LIMIT 200
    `, [userId]),
    queryRows<ReplyRow>(pool, `
      SELECT pcr.*,
             COALESCE(u.name, pcr.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pcr.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url,
             pc.project_id AS comment_project_id, pc.file_id AS comment_file_id
      FROM project_comment_replies pcr
      LEFT JOIN users u ON u.id = pcr.author_user_id
      INNER JOIN project_comments pc ON pc.id = pcr.comment_id
      INNER JOIN project_members pm ON pm.project_id = pc.project_id AND pm.user_id = $1
      WHERE pc.status != 'deleted'
        AND (
          pc.author_user_id = $1
          OR pc.assignee_user_id = $1
          OR pcr.author_user_id = $1
        )
      ORDER BY pcr.created_at ASC
    `, [userId]),
  ])

  const repliesByCommentId = new Map<string, ProjectCommentReply[]>()
  for (const r of replyRows) {
    const bucket = repliesByCommentId.get(r.comment_id) ?? []
    bucket.push(rowToProjectCommentReply(r))
    repliesByCommentId.set(r.comment_id, bucket)
  }

  return rows.map((row) => ({
    ...rowToProjectComment(row, repliesByCommentId.get(row.id) ?? []),
    projectTitle: row.project_title,
    filePath: row.file_path,
  }))
}

export async function listProjectCommentsInvolvingUser(projectId: string, userId: string): Promise<ProjectComment[]> {
  type Row = ProjectCommentRow & { file_path: string }

  const [rows, replyRows] = await Promise.all([
    queryRows<Row>(pool, `
      SELECT pc.*,
             COALESCE(u.name, pc.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pc.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url,
             resolver.name AS resolved_by_name,
             assignee.name AS assignee_name, assignee.email AS assignee_email,
             pf.path AS file_path
      FROM project_comments pc
      LEFT JOIN users u ON u.id = pc.author_user_id
      LEFT JOIN users resolver ON resolver.id = pc.resolved_by_user_id
      LEFT JOIN users assignee ON assignee.id = pc.assignee_user_id
      INNER JOIN project_files pf ON pf.id = pc.file_id
      WHERE pc.project_id = $1 AND pc.status != 'deleted'
      ORDER BY pc.updated_at DESC
    `, [projectId]),
    queryRows<ProjectCommentReplyRow>(pool, `
      SELECT pcr.*, COALESCE(u.name, pcr.anonymous_author_name, 'Anonymous reviewer') AS author_name, COALESCE(u.email, pcr.anonymous_author_email, '') AS author_email, u.avatar_url AS author_avatar_url
      FROM project_comment_replies pcr
      LEFT JOIN users u ON u.id = pcr.author_user_id
      WHERE pcr.project_id = $1
      ORDER BY pcr.created_at ASC
    `, [projectId]),
  ])

  const repliesByCommentId = new Map<string, ProjectCommentReply[]>()
  for (const r of replyRows) {
    const bucket = repliesByCommentId.get(r.comment_id) ?? []
    bucket.push(rowToProjectCommentReply(r))
    repliesByCommentId.set(r.comment_id, bucket)
  }

  return rows.map((row) => ({
    ...rowToProjectComment(row, repliesByCommentId.get(row.id) ?? []),
    filePath: row.file_path,
  }))
}

function parseProjectCommentPdfAnnotation(value: string | null): ProjectCommentPdfAnnotation | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    if (!parsed || parsed.kind !== 'ink' || !Number.isInteger(parsed.page) || parsed.page < 1) {
      return null
    }

    return parsed as ProjectCommentPdfAnnotation
  } catch {
    return null
  }
}

function rowToProjectNotification(row: ProjectNotificationRow): ProjectNotification {
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    fileId: row.file_id,
    filePath: row.file_path,
    commentId: row.comment_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    type: row.type,
    excerpt: row.excerpt,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

function roleRank(role: ProjectRole): number {
  switch (role) {
    case 'owner':
      return 4
    case 'manager':
      return 3
    case 'editor':
      return 2
    case 'viewer':
      return 1
  }
}

// ─── Share Links ────────────────────────────────────────────────────────────

function rowToShareLink(row: ProjectShareLinkRow): ProjectShareLink {
  return {
    id: row.id,
    projectId: row.project_id,
    token: row.token,
    role: row.role,
    label: row.label,
    createdByUserId: row.created_by_user_id,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createShareLink(input: {
  projectId: string
  role: 'viewer' | 'editor'
  label?: string
  expiresAt?: number
  maxUses?: number
  createdByUserId: string
}): Promise<ProjectShareLink> {
  const id = randomUUID()
  const token = randomBytes(24).toString('base64url')
  const now = Date.now()

  await pool.query(`
    INSERT INTO project_share_links (id, project_id, token, role, label, created_by_user_id, expires_at, max_uses, use_count, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, TRUE, $9, $10)
  `, [id, input.projectId, token, input.role, input.label ?? null, input.createdByUserId, input.expiresAt ?? null, input.maxUses ?? null, now, now])

  return (await getShareLinkById(id))!
}

async function getShareLinkById(linkId: string): Promise<ProjectShareLink | null> {
  const row = await queryOne<ProjectShareLinkRow>(pool, 'SELECT * FROM project_share_links WHERE id = $1', [linkId])
  return row ? rowToShareLink(row) : null
}

export async function listShareLinks(projectId: string): Promise<ProjectShareLink[]> {
  const rows = await queryRows<ProjectShareLinkRow>(pool, `
    SELECT * FROM project_share_links
    WHERE project_id = $1
    ORDER BY created_at DESC
  `, [projectId])
  return rows.map(rowToShareLink)
}

export async function getShareLinkByToken(token: string): Promise<ProjectShareLink | null> {
  const row = await queryOne<ProjectShareLinkRow>(pool, 'SELECT * FROM project_share_links WHERE token = $1', [token])
  return row ? rowToShareLink(row) : null
}

export async function revokeShareLink(linkId: string, projectId: string): Promise<void> {
  await pool.query(`
    UPDATE project_share_links SET is_active = FALSE, updated_at = $1
    WHERE id = $2 AND project_id = $3
  `, [Date.now(), linkId, projectId])
}

export async function incrementShareLinkUse(linkId: string): Promise<void> {
  await pool.query(`
    UPDATE project_share_links SET use_count = use_count + 1, updated_at = $1 WHERE id = $2
  `, [Date.now(), linkId])
}

// ─── Access Requests ─────────────────────────────────────────────────────────

function rowToAccessRequest(row: ProjectAccessRequestRow): ProjectAccessRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    requesterUserId: row.requester_user_id,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    message: row.message,
    status: row.status,
    decidedByUserId: row.decided_by_user_id,
    decidedAt: row.decided_at,
    requestedRole: row.requested_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createAccessRequest(input: {
  projectId: string
  requesterUserId: string
  requesterEmail: string
  requesterName: string
  message?: string
  requestedRole: 'viewer' | 'editor'
}): Promise<ProjectAccessRequest> {
  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO project_access_requests
      (id, project_id, requester_user_id, requester_email, requester_name, message, status, decided_by_user_id, decided_at, requested_role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', NULL, NULL, $7, $8, $9)
    ON CONFLICT (project_id, requester_user_id) DO UPDATE
      SET message = EXCLUDED.message, status = 'pending', requested_role = EXCLUDED.requested_role, updated_at = EXCLUDED.updated_at
  `, [id, input.projectId, input.requesterUserId, input.requesterEmail, input.requesterName, input.message ?? null, input.requestedRole, now, now])

  return (await getAccessRequest(id)) ?? (await queryOne<ProjectAccessRequestRow>(pool, `
    SELECT * FROM project_access_requests WHERE project_id = $1 AND requester_user_id = $2
  `, [input.projectId, input.requesterUserId]).then((row) => row ? rowToAccessRequest(row) : null))!
}

export async function listAccessRequests(projectId: string): Promise<ProjectAccessRequest[]> {
  const rows = await queryRows<ProjectAccessRequestRow>(pool, `
    SELECT * FROM project_access_requests
    WHERE project_id = $1
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
  `, [projectId])
  return rows.map(rowToAccessRequest)
}

export async function getAccessRequest(requestId: string): Promise<ProjectAccessRequest | null> {
  const row = await queryOne<ProjectAccessRequestRow>(pool, 'SELECT * FROM project_access_requests WHERE id = $1', [requestId])
  return row ? rowToAccessRequest(row) : null
}

export async function decideAccessRequest(requestId: string, projectId: string, decision: 'approved' | 'denied', decidedByUserId: string): Promise<ProjectAccessRequest> {
  const now = Date.now()
  await pool.query(`
    UPDATE project_access_requests
    SET status = $1, decided_by_user_id = $2, decided_at = $3, updated_at = $4
    WHERE id = $5 AND project_id = $6
  `, [decision, decidedByUserId, now, now, requestId, projectId])

  return (await getAccessRequest(requestId))!
}

// ─── Sharing Presets ──────────────────────────────────────────────────────────

function rowToSharingPreset(row: SharingPresetRow): SharingPreset {
  let entries: Array<{ email: string; role: string }> = []
  try {
    entries = JSON.parse(row.entries)
  } catch {
    entries = []
  }
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    entries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createSharingPreset(input: {
  ownerUserId: string
  name: string
  entries: Array<{ email: string; role: string }>
}): Promise<SharingPreset> {
  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO sharing_presets (id, owner_user_id, name, entries, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, input.ownerUserId, input.name, JSON.stringify(input.entries), now, now])

  const row = await queryOne<SharingPresetRow>(pool, 'SELECT * FROM sharing_presets WHERE id = $1', [id])
  return rowToSharingPreset(row!)
}

export async function listSharingPresets(ownerUserId: string): Promise<SharingPreset[]> {
  const rows = await queryRows<SharingPresetRow>(pool, `
    SELECT * FROM sharing_presets WHERE owner_user_id = $1 ORDER BY name ASC
  `, [ownerUserId])
  return rows.map(rowToSharingPreset)
}

export async function deleteSharingPreset(presetId: string, ownerUserId: string): Promise<void> {
  await pool.query('DELETE FROM sharing_presets WHERE id = $1 AND owner_user_id = $2', [presetId, ownerUserId])
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToTeamMember(row: TeamMemberRow): TeamMember {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    createdAt: row.created_at,
  }
}

export async function createTeam(input: { name: string; ownerUserId: string }): Promise<Team> {
  const id = randomUUID()
  const now = Date.now()

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO teams (id, name, owner_user_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, input.name, input.ownerUserId, now, now])

    await client.query(`
      INSERT INTO team_members (team_id, user_id, role, created_at)
      VALUES ($1, $2, 'owner', $3)
    `, [id, input.ownerUserId, now])
  })

  return (await getTeamById(id))!
}

export async function listUserTeams(userId: string): Promise<Team[]> {
  const rows = await queryRows<TeamRow>(pool, `
    SELECT t.* FROM teams t
    INNER JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = $1
    ORDER BY t.name ASC
  `, [userId])
  return rows.map(rowToTeam)
}

export async function getTeamById(teamId: string): Promise<Team | null> {
  const row = await queryOne<TeamRow>(pool, 'SELECT * FROM teams WHERE id = $1', [teamId])
  return row ? rowToTeam(row) : null
}

export async function addTeamMember(teamId: string, userId: string, role: 'owner' | 'member'): Promise<void> {
  await pool.query(`
    INSERT INTO team_members (team_id, user_id, role, created_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `, [teamId, userId, role, Date.now()])
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await pool.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 AND role != $3', [teamId, userId, 'owner'])
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const rows = await queryRows<TeamMemberRow>(pool, `
    SELECT tm.team_id, tm.user_id, u.email, u.name, u.avatar_url, tm.role, tm.created_at
    FROM team_members tm
    INNER JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = $1
    ORDER BY CASE tm.role WHEN 'owner' THEN 0 ELSE 1 END, u.name ASC
  `, [teamId])
  return rows.map(rowToTeamMember)
}

export async function deleteTeam(teamId: string, ownerUserId: string): Promise<void> {
  await pool.query('DELETE FROM teams WHERE id = $1 AND owner_user_id = $2', [teamId, ownerUserId])
}

export async function isUserOnTeam(teamId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(pool, `
    SELECT EXISTS(
      SELECT 1 FROM team_members
      WHERE team_id = $1 AND user_id = $2
    ) AS exists
  `, [teamId, userId])
  return Boolean(row?.exists)
}

export async function updateProjectTeam(projectId: string, teamId: string | null): Promise<void> {
  await pool.query('UPDATE projects SET team_id = $1, updated_at = $2 WHERE id = $3', [teamId, Date.now(), projectId])
}

// ─── Publishing ───────────────────────────────────────────────────────────────

export async function publishProject(projectId: string): Promise<void> {
  await pool.query('UPDATE projects SET published_at = $1, updated_at = $2 WHERE id = $3', [Date.now(), Date.now(), projectId])
}

export async function unpublishProject(projectId: string): Promise<void> {
  await pool.query('UPDATE projects SET published_at = NULL, updated_at = $1 WHERE id = $2', [Date.now(), projectId])
}

export async function getPublishedProject(projectId: string): Promise<ProjectSummary | null> {
  const row = await queryOne<ProjectRow>(pool, `
    SELECT p.*, 'viewer'::text AS role, owner.name AS owner_name, t.name AS team_name,
           COALESCE(SUM(CASE WHEN pf.mime_type != $2 THEN 1 ELSE 0 END), 0) AS file_count
    FROM projects p
    INNER JOIN users owner ON owner.id = p.owner_user_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN project_files pf ON pf.project_id = p.id
    WHERE p.id = $1 AND p.published_at IS NOT NULL
    GROUP BY p.id, owner.name, t.name
  `, [projectId, DRIVE_FOLDER_MIME_TYPE])

  return row ? rowToProjectSummary(row) : null
}

// ─── Ownership Transfer ───────────────────────────────────────────────────────

export async function transferProjectOwnership(projectId: string, fromUserId: string, toUserId: string): Promise<void> {
  const now = Date.now()
  await withTransaction(async (client) => {
    await client.query('UPDATE projects SET owner_user_id = $1, updated_at = $2 WHERE id = $3 AND owner_user_id = $4', [toUserId, now, projectId, fromUserId])
    await client.query(`
      INSERT INTO project_members (project_id, user_id, role, created_at)
      VALUES ($1, $2, 'owner', $3)
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'
    `, [projectId, toUserId, now])
    await client.query(`
      UPDATE project_members SET role = 'editor'
      WHERE project_id = $1 AND user_id = $2 AND role = 'owner'
    `, [projectId, fromUserId])
  })
}

function escapeLikeValue(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1')
}
