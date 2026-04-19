# WathbahGRC Admin — Stack and Runtime
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Languages, frameworks, database, runtime, and async execution model.

## Languages and Runtime

- **Node.js** (no declared version in `package.json`; transitive dep `@google/genai` requires `>=20.0.0`)
- **No Python** — no `.py`, `requirements.txt`, or `pyproject.toml` anywhere in the repo
- **Frontend:** Vanilla HTML/CSS/JS — no React, Vue, Svelte, or framework in npm dependencies

## HTTP Server

- **Raw Node `http.createServer`** — `server.js:1,1781`
- Single-file monolith: all routes, DB setup, Gemini integration, and static file serving in `server.js` (~5000 lines)
- Listen port: `5555` (hardcoded default) — `server.js:8,4945–4946`

## Database

- **SQLite via `better-sqlite3` ^12.6.2** — `server.js:6–7,97–98`
- Database file: `sessions.db` in the app root
- Schema: inline `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` migrations at startup — `server.js:101–306`
- WAL mode: `db.pragma('journal_mode = WAL')` — `server.js:98`
- No PostgreSQL, no MongoDB client in this repo

## ORM / Query Layer

- None. All queries are raw SQL via `better-sqlite3` synchronous API (`db.prepare().run()`, `.get()`, `.all()`)

## Dependencies (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `@google/genai` | ^1.41.0 | Google Gemini SDK (generative AI + File Search) |
| `better-sqlite3` | ^12.6.2 | SQLite3 bindings |

Two production dependencies total. No dev dependencies declared.

## Background / Async Jobs

- **No task queue** — no Celery, Bull, Redis, or worker process
- Server-side AI calls are synchronous `async/await` within the HTTP request
- `CONCURRENCY_LIMIT = 3` for parallel batch calls — `server.js:1268`
- `pollOperation` uses `setTimeout` polling for Gemini long-running ops (max 120s, 3s intervals) — `server.js:1738–1751`
- Client-side (browser) has an in-memory job tracker (`wbJobs` Map) for workbench bulk generation — `admin.js:9133–9214`
- No detached background worker; all "jobs" are in-request or in-browser loops

## Caching

- **`ciso_entity_cache`** SQLite table caches GRC entities fetched from the remote API — `server.js:218–226`
- No Redis, Memcached, or HTTP cache layer
