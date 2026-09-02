# Contributing to typstr

Thank you for your interest in contributing to typstr! This document provides guidelines and instructions for contributing to the codebase.

---

## Code of Conduct

Please review and adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) in all project interactions.

---

## Getting Started

### Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org/) (v20+) & `npm`

### Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ARLEONTR/typstr.git
   cd typstr
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Run the full stack with Docker Compose:**
   ```bash
   # Build LaTeX base image once
   docker build -f backend/Dockerfile.texbase -t typstr-backend-texbase:latest backend

   # Start dev containers (hot-reloading enabled)
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```

4. **Access the application:**
   - Frontend: `http://localhost:8989`
   - Backend API: `http://localhost:3000`

---

## Repository Architecture

- `frontend/`: React 19 SPA (Vite + TypeScript), CodeMirror editor, Typst & BusyTeX WASM integrations.
- `backend/`: Express + TypeScript API server, Yjs/Hocuspocus collaboration server, CLI compilation worker.
- `caddy/` & `nginx/`: Reverse proxy, TLS edge, and static asset serving configurations.
- `templates/`: Default starter document templates.

---

## Development Workflow

### Frontend
```bash
cd frontend
npm install
npm run dev        # Vite dev server on port 8989
npm run build      # TypeScript validation & Vite build
```

### Backend
```bash
cd backend
npm install
npm run dev        # Watch mode with tsx
npm run build      # tsup build
```

---

## Submitting Pull Requests

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes and ensure there are no TypeScript or linting errors:
   ```bash
   cd frontend && npm run build
   cd ../backend && npm run build
   ```
3. Commit with clear, descriptive commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add export to markdown`
   - `fix: correct SVG preview viewport clipping`
   - `docs: update self-hosting guide`
4. Push to your fork and submit a Pull Request to `main`.

---

## License

By contributing to typstr, you agree that your contributions will be licensed under the project's [GNU AGPLv3 License](LICENSE).
