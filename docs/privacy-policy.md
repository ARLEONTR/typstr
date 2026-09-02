# Privacy Policy

*Last updated: September 2, 2026*

This Privacy Policy explains how **Typstr** ("we", "us", or "our") collects, uses, stores, and protects personal data when you use the open-source Typstr software and the official hosted service at `typs.tr` (the "Service").

The Service is operated by **ARLEON BİLGİ İLETİŞİM SİBER GÜVENLİK YAZILIM TEKNOLOJİLERİ ARGE VE TİCARET LİMİTED ŞİRKETİ**.

For questions about this Privacy Policy or data handling practices, please contact `typstr@arleon.com.tr`.

---

## 1. Scope & Self-Hosted Deployments

- **Official Hosted Instance (`typs.tr`):** This policy describes how we handle data collected on the public hosted instance at `typs.tr`.
- **Self-Hosted Instances:** When you run or host your own independent instance of Typstr, data collected by your instance is stored entirely on your infrastructure and is not transmitted to us. Self-hosted administrators manage their own security and privacy policies.

---

## 2. Information We Collect

When you use the hosted Service, we may collect the following categories of information:

### 2.1 Account Information
When you sign in via third-party authentication providers (such as Google OAuth or ORCID):
- **Google Account Data:** Name, email address, profile photo URL, and unique Google account identifier.
- **ORCID Account Data:** Name, public ORCID identifier, and authorized OAuth tokens.

### 2.2 User Content & Files
- **Documents and Assets:** Typst files, LaTeX source files, images, figures, datasets, bibliography `.bib` files, and custom templates you create or upload.
- **Collaboration Data:** Inline comments, tracked changes, presence state, and chat messages.
- **Revisions:** Checkpoints and version history snapshots saved during project editing.

### 2.3 Bring Your Own Key (BYOK) AI Credentials
- If you choose to enable AI assistant features using your personal API keys (OpenAI, Anthropic, Google Gemini), your keys are encrypted at rest using industry-standard **AES-256-GCM** encryption before storage.

### 2.4 Technical & Usage Data
- HTTP server logs, IP addresses, browser user agent strings, compile status events, and diagnostic error reports used to maintain reliability and security.

---

## 3. How We Use Information

We process collected information strictly for the following purposes:

1. **Authentication & Access Control:** To authenticate your identity and enforce role-based project permissions (Owner, Manager, Editor, Viewer).
2. **Editor & Collaboration Delivery:** To broadcast real-time document edits, synchronize cursor presence, and render document previews.
3. **Compilation & Export:** To execute document compilation (`typst`, `latex`, `pandoc`) and generate requested export artifacts (PDF, DOCX, HTML, ZIP).
4. **Cloud Storage Sync (Optional):** If enabled, to read and write files to your authorized Google Drive folder.
5. **AI Assistant Requests:** To proxy user-initiated AI queries to the selected model provider using your configured API keys.
6. **Security & Diagnostics:** To prevent denial-of-service, protect against malicious exploitation, and investigate runtime faults.

We **do not** sell, rent, or monetize your personal data or document content.

---

## 4. Third-Party Integrations & Disclosures

We share information only with service providers necessary to operate the hosted application:

- **Google OAuth & Google Drive:** Used for authentication and optional cloud storage sync. Typstr's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.
- **ORCID:** Used for academic researcher authentication and profile link verification.
- **AI Model Providers (OpenAI, Anthropic, Google):** When you submit prompts to AI writing features, prompts are sent to the respective provider using your personal API key. We do not use your private document content to train foundational AI models.
- **Collaborators:** Users you explicitly invite to your projects will have access to view or edit the files, comments, and history within that project.

---

## 5. Data Security

We implement technical and operational safeguards to protect your information:

- **Encryption in Transit:** All traffic to `typs.tr` is encrypted using TLS / HTTPS.
- **Encryption at Rest:** Sensitive credentials (including AI API keys and OAuth refresh tokens) are encrypted at rest with AES-256-GCM.
- **CSRF & Session Security:** State-changing requests require cryptographically validated CSRF tokens, and session cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` attributes in production.
- **Container Isolation:** Compilation and export jobs execute in isolated environments with resource constraints.

---

## 6. Data Retention & User Rights

- **Project Deletion:** You can delete files and projects at any time through the workspace interface. Deleted items moved to trash are permanently purged after the configured retention window (default 30 days).
- **Account Deletion:** You can request the complete deletion of your account and associated database records by contacting `typstr@arleon.com.tr`.
- **Export Rights:** You can export all project files and source trees at any time via the ZIP export tool.

---

## 7. Contact Us

For questions about this Privacy Policy, data access requests, or security disclosures:

- **Company:** ARLEON BİLGİ İLETİŞİM SİBER GÜVENLİK YAZILIM TEKNOLOJİLERİ ARGE VE TİCARET LİMİTED ŞİRKETİ
- **Email:** `typstr@arleon.com.tr`
- **Website:** [https://www.arleon.com.tr](https://www.arleon.com.tr)
- **Repository:** [https://github.com/ARLEONTR/typstr](https://github.com/ARLEONTR/typstr)
