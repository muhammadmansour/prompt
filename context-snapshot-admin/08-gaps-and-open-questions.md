# WathbahGRC Admin — Gaps and Open Questions
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Every place where information was unclear, absent, or required guessing.

## Data Model

- **cs_sessions schema mismatch:** `server.js:638–643` queries `org_context_id` and `grc_export_result` columns on `cs_sessions`, but neither column appears in the `CREATE TABLE` (lines 152–166) or any `ALTER TABLE` migration. Either there's a migration outside this file, or these queries would error on a fresh DB. Looked at: all `pragma('table_info(cs_sessions)')` blocks — only `exported_control_ids` is migrated. **Who can confirm:** Run `PRAGMA table_info(cs_sessions)` on a live `sessions.db`.

- **Muraji data model unknown:** Questions, evidence, and notes are stored as JSON properties on library documents in Muraji. The exact Muraji schema (MongoDB collections, indexes, constraints) is not visible from this repo. Looked at: all `admin.js` and `app.js` Muraji PATCH calls. **Who can confirm:** Muraji API team or the Muraji codebase.

- **audit_log field on PATCH:** The workbench sends `audit_log` entries in the PATCH body to Muraji (`admin.js:9678,8983,10060`). Whether Muraji persists these or discards them is unknown. Looked at: no Muraji server code in this repo. **Who can confirm:** Muraji API team.

## Authentication / Identity

- **wbAdminUser source:** Fetched from `/api/auth/me` at page load (`admin.js:8148–8157`). Falls back to `'admin'` string. Whether this is the GRC username, email, or display name depends on the GRC IAM response format. Looked at: `server.js` `/api/auth/me` handler — proxies to GRC, returns whatever GRC returns.

- **Muraji API auth:** Browser calls to `muraji-api.wathbah.dev` include no `Authorization` header (`app.js:1136–1145`). Is Muraji truly open/unauthenticated, or is there network-level auth (VPN, IP allowlist)? Looked at: all `fetch` calls to Muraji in browser JS — none include auth headers.

## Deployment

- **Port mismatch:** `server.js` defaults to port `5555`, but `nginx/prompt.wathbahs.com` proxies to `127.0.0.1:8888`. Is `PORT` overridden at deploy time, or is the nginx config stale? Looked at: no `PORT` env var in code, no Dockerfile, no systemd unit file.

- **Domain discrepancy:** Browser JS hardcodes `muraji-api.wathbah.dev`; nginx config references `muraji-api.wathbahs.com`. Are these different environments, or is one stale? Looked at: no env-based URL switching in browser code.

- **No CI/CD config:** No `.github/workflows`, `Jenkinsfile`, `cloudbuild.yaml`, or equivalent. Deployment process is unknown. Looked at: repo root and all top-level directories.

## AI Pipeline

- **`{{CONTEXT_FILES}}` placeholder unused:** `requirement-analyzer.txt` template does not contain `{{CONTEXT_FILES}}`, but `callGeminiAPIForSingle` replaces it (`server.js:1164`). The replacement is a no-op. Is this intentional or a template bug? Looked at: the template file content via the seed loading path.

- **No token/cost instrumentation:** Gemini responses include `usageMetadata` with token counts. This data is never extracted or logged. Was this a deliberate decision or an oversight? Looked at: all response-parsing code in `server.js`.

- **Batch endpoint missing `meta`:** `callGeminiAPIForMultiple` returns `{ success: true, data: result }` without the `meta` field (model, template version) that single-request responses include (`server.js:1938` vs `1960`). Callers that expect `meta` on batch results would get `undefined`.

## Frontend

- **Duplicate prompt editors:** Both `prompts.html` (standalone) and `/prompts` (SPA page) exist. Are they kept in sync, or is one deprecated? Looked at: both files — they appear functionally similar but are independent codebases.

- **`policy-collections` is public:** `isPublicPath` includes `/api/policy-collections` (`server.js:66–78`). This means unauthenticated users can access policy collection APIs. Is this intentional? Looked at: the `isPublicPath` function — no comment explaining why.

## Scope / Completeness

- **Legacy vs. Workbench:** The legacy UI (`index.html` + `app.js`) and the admin SPA workbench (`admin.html` + `admin.js`) both manage questions/evidence on the same Muraji data. Are they intended to coexist long-term, or is the legacy UI being phased out?

- **Merge Optimizer "analysis" is simulated:** `admin.js:5862–5947` runs a progress loop with heuristics, not a real AI analysis. The "analysis results" are computed client-side. Is this a prototype or the intended behavior?
