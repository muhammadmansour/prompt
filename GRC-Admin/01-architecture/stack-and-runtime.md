# WathbahGRC Admin — Stack and Runtime
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Languages, frameworks, runtime versions, and infrastructure layers.

## Backend

| Layer | Technology | Version / Notes |
|---|---|---|
| Language | Node.js (JavaScript) | No `.nvmrc` or `engines` field — version unspecified |
| HTTP Server | `http` (stdlib) | No Express, Koa, or any framework — raw `http.createServer` (`server.js:1781`) |
| AI SDK | `@google/genai` | ^1.41.0 (`package.json:19`) |
| Database | `better-sqlite3` | ^12.6.2 — SQLite on local disk (`sessions.db`) |
| ORM | None | Raw SQL prepared statements throughout `server.js` |
| Task Queue | None | All AI calls are synchronous within the request handler; no Celery, BullMQ, or equivalent |

## Frontend

| Layer | Technology |
|---|---|
| Framework | None — vanilla HTML + CSS + JS (no React, Vue, Svelte, etc.) |
| Build Tool | None — no bundler, no transpiler. Files served as-is |
| SPA Routing | Client-side hash/path routing in `admin.html` (single HTML file with JS routers) |
| Styling | Plain CSS (`admin.css`, `styles.css`, `login.css`) — no Tailwind, SCSS, or PostCSS |

## Database

- **Engine:** SQLite 3 via `better-sqlite3`
- **File:** `sessions.db` (repo root, gitignored)
- **Journal mode:** WAL (set at `server.js:98`)
- **Migrations:** Inline `ALTER TABLE` blocks with column-existence checks (`server.js:245–306`)
- **No connection pooling** — single process, single connection

## Background / Async Jobs

**None.** Every API request — including multi-requirement AI analysis that calls Gemini up to `CONCURRENCY_LIMIT = 3` times in parallel — runs synchronously inside the HTTP request handler. There is no worker layer, no job queue, and no scheduled tasks.

The only "background" behavior is:
- Gemini operations that return a long-running operation are polled with `pollOperation()` (`server.js:1738–1751`) which sleeps in 3-second intervals up to 120 seconds — blocking the request thread.

## Process Model

Single Node.js process. No clustering, no PM2 config found in the repo. The nginx config (`nginx/prompt.wathbahs.com`) reverse-proxies to `127.0.0.1:8888` (production port differs from the hardcoded `PORT = 5555` in `server.js:8`).
