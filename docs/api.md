# Typstr API and Database Schema

This document provides a reference for the PostgreSQL database schema and REST / WebSocket API endpoints in Typstr.

---

## 1. Database Schema

The database schema is initialized and maintained directly in code by PostgreSQL query definitions on backend startup (`backend/src/db.ts`).

### Core Tables
- **`users`**: User identity accounts (Google OAuth and ORCID profile data, email, name, avatar, refresh tokens, encrypted user AI API keys, disabled status, timestamps).
- **`teams` / `team_members`**: Team workspaces, organization identifiers, and membership mappings (`admin`, `member`).
- **`projects`**: Project definitions (owner ID, optional team ID, title, root storage folder ID, main entry file, compile settings, bibliography/ecosystem preferences, timestamps).
- **`project_members`**: Project role-based access control (`owner`, `manager`, `editor`, `viewer`).
- **`project_files`**: Project directory tree and file records (path, name, MIME type, storage ID, cached Yjs CRDT binary snapshot, content hash, timestamps).
- **`project_file_workflow`**: Document workflow locks, review ownership assignments, and soft-delete/trash states.
- **`project_preferences`**: User-specific project states (starred, pinned, archive, last-opened).

### Collaboration & Review Tables
- **`project_comments` / `project_comment_replies`**: Inline code/text range comments and threaded discussions.
- **`project_notifications`**: In-app notifications for mentions, comments, share invites, and review assignments.
- **`project_chat_messages`**: Real-time project chat messages.
- **`project_review_suggestions`**: Tracked change proposals (insertions, deletions, replacements) with accept/reject flows.
- **`project_activity_events`**: Immutable audit logs of file edits, compiles, shares, and settings changes.
- **`project_revisions`**: File-level revision snapshots created on manual saves and collaboration checkpoints.

### Sharing & Operations Tables
- **`project_invitations`**: Email invitations with cryptographically signed tokens.
- **`project_share_links`**: Public or restricted share URLs with designated default access roles.
- **`project_access_requests`**: Requests from users asking for project access permissions.
- **`background_jobs`**: Job status tracking for asynchronous compilation, export, and cleanup workers.
- **`feedback`**: In-app user feedback reports and diagnostic entries.

---

## 2. API Endpoints

All authenticated routes require a valid session cookie. State-changing requests (`POST`, `PUT`, `DELETE`, `PATCH`) are validated via CSRF tokens.

### Health & Diagnostics
- `GET /api/health` — Stack health check (DB, Redis, storage).
- `GET /api/health/ready` — Kubernetes / container readiness probe.
- `GET /api/admin/diagnostics` — System metrics and health indicators (Admin only).
- `POST /api/admin/backup` — Trigger manual database backup (Admin only).

### Authentication (`/api/auth`)
- `GET /api/auth/providers` — List enabled authentication providers (`google`, `orcid`, `ldap`, `localDev`).
- `GET /api/auth/me` — Current authenticated user profile.
- `POST /api/auth/ldap/login` — Sign in with enterprise LDAP / Active Directory credentials (`{ username, password }`).
- `GET /api/auth/google` — Initiate Google OAuth login flow.
- `GET /api/auth/google/callback` — Google OAuth callback handler.
- `GET /api/auth/orcid` — Initiate ORCID OAuth flow.
- `GET /api/auth/orcid/callback` — ORCID OAuth callback handler.
- `POST /api/auth/logout` — Invalidate session and log out.
- `POST /api/auth/local-dev-login` — Local development auth bypass (development mode only).

### Projects (`/api/projects`)
- `GET /api/projects` — List user's active, shared, and team projects.
- `POST /api/projects` — Create a new project (blank or from template).
- `GET /api/projects/:id` — Get project metadata, member list, and settings.
- `PATCH /api/projects/:id` — Update project title, main file, or compile settings.
- `DELETE /api/projects/:id` — Move project to trash or delete permanently.
- `POST /api/projects/:id/duplicate` — Clone project with all files.
- `POST /api/projects/import-zip` — Upload and extract a `.zip` archive into a new project.

### File Tree & Content (`/api/projects/:id/files`)
- `GET /api/projects/:id/files` — Get project file directory tree.
- `POST /api/projects/:id/files` — Create a new file or directory.
- `GET /api/projects/:id/files/*` — Read raw file contents.
- `PUT /api/projects/:id/files/*` — Save file contents.
- `DELETE /api/projects/:id/files/*` — Delete or trash a file.
- `POST /api/projects/:id/files/upload` — Upload multipart file or asset.
- `GET /api/projects/:id/files/*/revisions` — List revision history for a file.
- `POST /api/projects/:id/files/*/restore-revision` — Restore a specific revision snapshot.

### Compilation & Preview (`/api/compile`, `/api/export`)
- `POST /api/compile/typst` — Server-side compilation of Typst project to PDF/SVG.
- `POST /api/compile/latex` — Server-side compilation of LaTeX document.
- `POST /api/export` — Export project to specified format (`pdf`, `docx`, `latex`, `html`, `zip`).
- `GET /api/export/job/:jobId` — Poll status of async export job.
- `GET /api/export/download/:jobId` — Download finished export artifact.

### Real-Time Collaboration (`/ws`)
- **WebSocket Endpoint**: `ws://<host>/ws`
- Uses Hocuspocus / Yjs protocol for document rooms: `project:<projectId>:file:<fileId>`.
- Presence awareness broadcasts active user cursors, selections, and online status.

### AI Assistance (`/api/ai`)
- `GET /api/ai/models` — List available models for configured provider API keys.
- `POST /api/ai/chat` — Send prompt to LLM (OpenAI / Anthropic / Google Gemini) with project context.
- `POST /api/ai/key` — Save encrypted user API key (AES-256-GCM).
- `DELETE /api/ai/key` — Remove stored API key.
