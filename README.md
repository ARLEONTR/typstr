# Typstr

[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Typst](https://img.shields.io/badge/Typst-Supported-239DAD.svg)](https://typst.app/)

**Typstr** is an open-source, browser-based collaborative technical writing workspace for **Typst**, **LaTeX**, and markdown documents. It brings together real-time collaborative editing, instant WASM and server-side compilation, live preview synchronization, academic reference workflows, enterprise LDAP / Active Directory authentication, and revision recovery.

---

## Key Features

- **Dual-Engine Technical Writing:** Full support for both [Typst](https://typst.app) and [LaTeX](https://www.latex-project.org/) documents with syntax highlighting, autocomplete, code folding, and symbol palettes.
- **Fast Live Preview:** 
  - **Typst WASM & TinyMist**: In-browser instant compilation and backend streaming preview.
  - **BusyTeX & Server LaTeX**: Zero-latency client-side WebAssembly TeX preview and robust server-side PDF generation.
  - **Bidirectional SyncTeX**: Jump between source code and PDF preview with a single click.
- **Real-Time Collaboration (Yjs + Hocuspocus):** Multiplayer editing with live presence, user color tags, follow mode, and project chat.
- **Enterprise Authentication:**
  - **LDAP / Active Directory:** Native LDAP bind and search support with configurable filters and attribute mapping.
  - **Google OAuth & ORCID:** Seamless sign-in for academic researchers and Google accounts.
  - **Local Auth Bypass:** One-click instant developer login for offline development.
- **Academic Review Workflows:** Inline threaded comments, tracked changes (propose, accept, reject), and presence history.
- **Integrated Bibliography & Citations:** Built-in citation search across **arXiv**, **Semantic Scholar**, **CrossRef**, and **DBLP**, with automatic BibTeX formatting.
- **Revision History & Data Safety:** Automatic version snapshots, pre-restore backup points, and single-click revision restore.
- **Multi-Format Export:** Export projects to **PDF**, **DOCX**, **LaTeX bundle**, **HTML**, or complete **ZIP** archives.
- **AI Writing Assistant (BYOK):** Optional Bring Your Own Key integrations with **OpenAI**, **Anthropic Claude**, and **Google Gemini** (keys are encrypted at rest with AES-256-GCM).
- **Self-Hostable & Configurable Data Directory:** Full Docker Compose setup with persistent local storage or optional Google Drive sync.

---

## Documentation

- [Architecture Overview](docs/architecture.md) — System components, runtime shape, and data flow.
- [API & Database Schema](docs/api.md) — PostgreSQL schema and REST / WebSocket API reference.
- [Features & Capabilities Guide](docs/features.md) — Detailed overview of editor, preview, and collaboration features.
- [Contributing Guide](CONTRIBUTING.md) — Guidelines for setting up development and submitting pull requests.
- [Security Policy](SECURITY.md) — Vulnerability disclosure process and security contact.
- [Terms of Service](docs/terms-of-service.md) & [Privacy Policy](docs/privacy-policy.md) — Hosted platform legal documentation.

---

## Quick Start (Local Development)

### Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org/) (v20+) & `npm`

### 1. Run the Full Stack with Docker Compose

```bash
# 1. Build the LaTeX base image (only needed once)
docker build -f backend/Dockerfile.texbase -t typstr-backend-texbase:latest backend

# 2. Start the dev containers (hot-reloading enabled)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### 2. Access the Application
- **Frontend App:** [http://localhost:8989](http://localhost:8989)
- **Backend API:** [http://localhost:3000](http://localhost:3000)

### Pre-Configured Dev / Test Accounts

The local development stack starts an **OpenLDAP** container pre-seeded with test users:

| User | Username / Email | Password | Role |
| :--- | :--- | :--- | :--- |
| **Alice Smith** | `alice` or `alice@example.com` | `password123` | Researcher / Member |
| **Bob Jones** | `bob` or `bob@example.com` | `password123` | Collaborator / Member |
| **John Doe** | `john.doe` or `admin@example.com` | `admin123` | System Administrator |

*(You can also use the **"Continue with Dev Login"** button on the landing page for instant one-click bypass login).*

---

## Self-Hosted Production Deployment

To run Typstr on your own Linux server or VM with local storage and LDAP:

```bash
# 1. Set required environment variables
export SESSION_SECRET="$(openssl rand -hex 32)"
export COLLABORATION_SECRET="$(openssl rand -hex 32)"
export TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export DOMAIN_NAME="your-domain.com"
export ADMIN_EMAILS="admin@your-domain.com"

# Optional: Set custom data directory (default: /prod-data)
export PROD_DATA_DIR="/var/lib/typstr"

# Optional: Enable LDAP / Active Directory
export LDAP_ENABLED="true"
export LDAP_URL="ldap://ldap.your-organization.com:389"
export LDAP_BIND_DN="cn=admin,dc=your-organization,dc=com"
export LDAP_BIND_PASSWORD="your-ldap-bind-password"
export LDAP_SEARCH_BASE="dc=your-organization,dc=com"
export LDAP_SEARCH_FILTER="(|(mail={{username}})(uid={{username}})(sAMAccountName={{username}}))"

# 2. Build the LaTeX base image
docker build -f backend/Dockerfile.texbase -t typstr-backend-texbase:latest backend

# 3. Start the production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### Configurable Storage & Data Directories

All persistent application data is consolidated under a configurable root (`PROD_DATA_DIR`, default `/prod-data`):
- `${PROD_DATA_DIR}/postgres` — PostgreSQL 16 database files
- `${PROD_DATA_DIR}/redis` — Redis 7 append-only file and session store
- `${PROD_DATA_DIR}/.local-storage` — User documents, uploaded assets, and project files
- `${PROD_DATA_DIR}/.local-storage/typst-cache` — Compilation package cache
- `${PROD_DATA_DIR}/backups` — Automated database and project revision backups
- `${PROD_DATA_DIR}/caddy/data` — Automatic Let's Encrypt TLS certificates

---

## Contributing

We welcome contributions from the community! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for full instructions on setting up your environment, running tests, and opening pull requests.

---

## License

Typstr is licensed under the [GNU Affero General Public License v3.0 (AGPLv3)](LICENSE).
