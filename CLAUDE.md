# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RDM System v2** — a Research Data Management platform for KSTU (Kyrgyz State Technical University). It allows researchers to deposit, publish, and manage datasets following FAIR principles (Findable, Accessible, Interoperable, Reusable).

## Running the Server

```bash
cd backend
npm start          # production
npm run dev        # development with --watch (auto-restart on file changes)
```

The server runs on port 3000 (or `PORT` env var):
- Public site: `http://localhost:3000`
- Admin panel: `http://localhost:3000/admin`
- REST API: `http://localhost:3000/api`
- OAI-PMH: `http://localhost:3000/oai`

Default credentials: `admin@kstu.kg` / `admin123`, `researcher@kstu.kg` / `pass123`

## Architecture

### Backend (`backend/`)

Pure Node.js HTTP server — **no Express or other web framework**. Uses only `better-sqlite3` as a dependency.

- **`server.js`** — entry point; custom regex-based router, rate limiter (20 req/min for login, 120 for others), static file serving for `public/` and `admin/` directories, uploads serving from `backend/data/uploads/`
- **`db.js`** — all database logic; initializes SQLite schema, runs migrations by trying `ALTER TABLE ADD COLUMN` (catches errors if column exists), seeds default data on empty DB. Exports plain functions (no ORM).
- **`auth.js`** — `auth(req, requireRole)` checks Bearer token against sessions table OR API key hash; admins bypass role checks
- **`utils.js`** — `sha256`, `genToken`, `calcFAIR`, `fairHints`, MIME map, CORS headers, `sendJSON`, `readBody` (JSON), `readRawBody` (binary, 100MB max)
- **`routes/api.js`** — public + authenticated researcher endpoints
- **`routes/admin.js`** — admin-only endpoints under `/admin/api/`
- **`routes/oai.js`** — OAI-PMH 2.0 protocol endpoint at `/oai` (Dublin Core metadata)

### Database (`backend/data/rdm.db`)

SQLite with WAL mode, foreign keys enabled. Tables: `users`, `datasets`, `sessions`, `logs`, `dmp`, `api_keys`, plus FTS5 virtual table `datasets_fts` (full-text search on title/description/keywords) maintained by triggers.

Dataset `status` lifecycle: `draft` → `published` (via `/api/my/datasets/:id/publish`) → `draft` (unpublish). Deletion only allowed in `draft` status.

FAIR scores are computed server-side by `calcFAIR()` in `utils.js` on every create/update — never stored manually.

### Frontend (`public/`)

Vanilla JS ES modules — **no build step, no bundler**. Served directly as static files.

- **`js/app.js`** — entry point; imports all modules and exposes functions to `window` for HTML `onclick` attributes
- **`js/state.js`** — single shared state object (`currentUser`, `allDatasets`, `filtered`, `page`) and `API` base URL (empty string = same origin)
- **`js/api.js`** — fetch wrapper functions against `/api/*`
- **`js/auth.js`** — login/register/logout modals, session management (`sessionStorage` key `rdm-pub-token`)
- **`js/catalog.js`** — dataset listing, filtering, pagination, detail modal
- **`js/profile.js`** — personal dashboard: my datasets, DMP editor, API keys, publish/unpublish/delete
- **`js/ui.js`** — theme toggle, toast notifications, scroll effects, FAIR score animation
- **`js/i18n.js`** — three-language support (RU/KY/EN) via `data-i18n` attributes

### Admin Panel (`admin/`)

Separate SPA at `/admin` with its own `index.html` and `style.css`. Uses `/admin/api/*` endpoints. Admin sessions use access token (8h) + refresh token (7d) pattern.

## Key Conventions

- Routes are registered by calling `route(method, regexPattern, handler)`. Pattern is anchored (`^...$`). Capture groups in the pattern are passed as `p` array to handler.
- All API handlers follow `(req, res, query, p)` signature where `query` is parsed URL search params as a plain object.
- `sendJSON` always sets CORS headers. All responses are JSON except downloads, exports (CSV/BibTeX/XML), and OAI-PMH (XML).
- Passwords are SHA-256 hashed (no salt) — this is intentional for the academic prototype scope.
- File uploads are stored in `backend/data/uploads/` as `{datasetId}{ext}` and served at `/uploads/`.
- The `datasets` table is extended by migrations; new columns are added in `datasetNewCols` array in `db.js`.
- Multilingual fields: `titleKy`, `titleRu`, `descriptionKy`, `descriptionRu` on datasets.
