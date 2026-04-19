# WathbahGRC Admin — Prompt Template Management
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Named, versioned, editable prompt templates.

## Status: PRESENT — full CRUD

### Concept

There are two classes of prompts:

1. **Local Prompts** — stored in `local_prompts` SQLite table. These are the system instructions used by the app's AI features. Seeded from `prompts/*.txt` files on startup, then editable via the UI.

2. **API Prompts** — stored on the external Muraji API (`https://muraji-api.wathbahs.com/api/prompts`). These are managed centrally and used by the main WathbahGRC product.

### UI Route
- Legacy: `/prompts.html` → `prompts.js`
- Modern SPA: `/prompts` route in `admin.html`
- Shows both local and API prompts in a card-based list with search
- Each card shows name, content preview, version (API only), timestamps, edit/delete buttons

### Backend Endpoints

**Local prompts:**
- `GET /api/local-prompts` — list all (`server.js:2934`)
- `GET /api/local-prompts/:id` — get one (`server.js:2948`)
- `PUT /api/local-prompts/:id` — update name and/or content (`server.js:2966`)

**API prompts (proxied to Muraji):**
- `GET/POST/PUT/DELETE https://muraji-api.wathbahs.com/api/prompts` — called directly from frontend

### Storage

- **DB table:** `local_prompts` with columns: `id`, `key` (unique), `name`, `content`, `created_at`, `updated_at`
- **Not YAML, not code** — stored as plain text in the DB
- **5 seeded prompts** with keys: `chat_auditor`, `controls_generator`, `policy_extractor`, `framework_extractor`, `ref_controls_extractor`

### Versioning

**Not present.** There is no version field on local prompts, no version history, no diff tracking. API prompts have a `version` field but it appears to be a simple integer that's not automatically incremented.

### Organization-Level Scoping

**Not present.** All prompts are global — there's no per-organization prompt customization.

### Permission Check
- Auth guard only (any logged-in user can edit any prompt, including system-critical ones)
