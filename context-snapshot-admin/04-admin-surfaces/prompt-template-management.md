# WathbahGRC Admin — Prompt Template Management
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** How prompt templates are stored, versioned, and edited.

## Two Template Systems

### 1. Local SQLite (`local_prompts` table)

- **Table:** `local_prompts` with `id`, `key`, `name`, `content`, `created_at`, `updated_at` — `server.js:121–127`
- **Seeded keys:** `chat_auditor`, `controls_generator`, `policy_extractor`, `framework_extractor`, `ref_controls_extractor` — `server.js:993–1057`
- **Seed source:** `.txt` files in `prompts/` directory — `server.js:937–991`
- **API:** `GET /api/local-prompts`, `GET /api/local-prompts/:id`, `PUT /api/local-prompts/:id` — `server.js:2997–3053`
- **UI:** "Prompts" page in admin SPA (`/prompts`) — `admin.html:113–116`; also standalone `prompts.html` + `prompts.js`
- **Versioning:** None. Single row per key, overwritten on edit. `updated_at` is the only version signal.
- **Permission:** Any authenticated user can edit

### 2. Muraji API Prompts

- **Endpoint:** `https://muraji-api.wathbah.dev/api/prompts` — `prompts.js:6`, `admin.js:3197`
- **CRUD:** Browser fetches directly from Muraji (not proxied through Node server)
- **Purpose:** Organization-level prompts stored on the library platform

### 3. File-Only Template

- `prompts/requirement-analyzer.txt` is loaded from disk at server startup — `server.js:938–946`
- **Not** seeded into `local_prompts` — only used server-side for `/api/analyze`
- Not editable via any UI (requires file system access)

## Named / Versioned / Organization-Level?

- **Named:** Yes — each template has a `key` and `name`
- **Versioned:** No — no version history, no rollback, no diff
- **Organization-level:** Partially — Muraji prompts may be org-scoped (cannot confirm from this codebase alone); local prompts are global to this app instance
- **Stored in DB:** Yes (local_prompts), also on Muraji API, also as files on disk
- **Who can edit:** Any logged-in user (no permission check on PUT endpoint)
