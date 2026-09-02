# Typstr Features & Capabilities Guide

Typstr is a modern open-source collaborative technical writing workspace designed for researchers, academics, students, and engineering teams.

---

## 1. Document Authoring & Dual-Engine Editing

- **First-Class Typst Editing:** Full syntax highlighting, autocomplete, function parameter hints, symbol palettes, and code folding for Typst markup.
- **LaTeX Compatibility:** Full support for LaTeX documents, packages, and references, powered by a dual web/server compilation pipeline.
- **CodeMirror 6 Editor:** High-performance extensible code editor supporting minimap, breadcrumbs, search & replace, and custom keybindings.
- **Side-by-Side Live Preview:** Responsive split-pane layout with instant document rendering and zoom controls.
- **Bidirectional SyncTeX Navigation:** Click source code to jump to preview page, or click preview to jump directly to the matching line in source.
- **Project Structure Management:** Multi-file directory tree supporting folder nesting, asset uploads (PNG, JPG, SVG, PDF), file renaming, and drag-and-drop file organization.

---

## 2. Compilation & Preview Engines

- **Client-Side Typst WASM:** Zero-latency in-browser compilation using official WebAssembly builds for immediate feedback on every keystroke.
- **TinyMist Language Server:** Backend language server integration delivering precise document diagnostics, symbol navigation, and SVG streaming preview.
- **BusyTeX WebAssembly Engine:** Client-side TeX engine providing fast in-browser preview for standard LaTeX packages.
- **Robust Server-Side Compiler:** Scalable background worker pool executing native `typst`, `tinymist`, and TeX engines for complex multi-file projects.
- **Structured Error Diagnostics:** Clear compile log panel surfacing actionable warnings, syntax errors, and jump-to-error links.

---

## 3. Real-Time Collaboration & Presence

- **CRDT Collaboration (Yjs + Hocuspocus):** Conflict-free real-time collaborative editing over WebSocket connections.
- **Collaborator Awareness:** Live multiplayer cursors, user color tags, and active presence indicators.
- **Follow Mode:** Jump to or follow a collaborator's viewport in real time.
- **Project Chat & Activity Log:** Built-in project discussion panel and timeline of changes.
- **Granular Role-Based Permissions:**
  - **Owner:** Full project administration and deletion rights.
  - **Manager:** Manage project files, settings, and collaborator access.
  - **Editor:** Read and write document files and comment threads.
  - **Viewer:** Read-only access to files and compiled previews.

---

## 4. Academic Review & Research Workflows

- **Inline Comments:** Anchor comments to specific lines or text ranges with threaded replies, resolve, and reopen actions.
- **Tracked Changes & Review Mode:** Propose insertions, deletions, and modifications with accept/reject review flows.
- **Citation & Reference Search:** Integrated lookup across academic databases:
  - **arXiv** search and one-click citation insertion.
  - **Semantic Scholar** paper search.
  - **CrossRef** DOI lookup and BibTeX import.
  - **DBLP** computer science bibliography search.
- **Bibliography Management:** Built-in `.bib` file editor and auto-citation generator.
- **Academic Writing Tools:** Live word counter, section stats, reading time estimation, and page limit trackers.

---

## 5. Revision History & Data Safety

- **Automated Checkpoints:** Version snapshots created automatically during manual saves and key collaboration intervals.
- **Safe Rollback & Restore:** Restore previous revisions with automatic pre-restore backup points to prevent accidental data loss.
- **Trash & Recovery:** Soft-delete file recovery with configurable retention schedules.
- **Full ZIP Export & Import:** Export entire project source trees or import `.zip` archives with a single click.

---

## 6. Multi-Format Document Export

Export your work to diverse presentation and archival formats:
- **PDF:** High-resolution printable document export.
- **DOCX:** Microsoft Word format conversion via Pandoc integration.
- **LaTeX:** Standalone compilable TeX source bundle.
- **HTML:** Clean standalone web document output.
- **Project ZIP:** Complete source archive with all assets and bibliography files.

---

## 7. Multi-Provider AI Writing Assistant (BYOK)

- **Bring Your Own Key (BYOK):** Connect your personal API key for:
  - **Google Gemini**
  - **Anthropic Claude**
  - **OpenAI (ChatGPT / GPT-4)**
- **In-Editor Chat:** Interactive contextual AI chat assistant with project awareness.
- **Apply to Document:** Apply suggested AI improvements directly into the active document buffer via CRDT.
- **Encrypted Storage:** API keys are encrypted at rest with AES-256-GCM.

---

## 8. Self-Hosting & Administration

- **Docker Compose Stack:** One-command deployment for local development and self-hosted server environments.
- **Storage Independence:** Run completely on local disk storage or configure optional Google Drive sync.
- **Admin Diagnostics Panel:** Monitor system performance, active compile workers, error logs, and database health.
- **Configurable Retention:** Customizable policies for revisions, activity logs, and background job records.
