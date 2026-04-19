# WathbahGRC Admin — Gaps and Open Questions
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Documented gaps, ambiguities, and questions surfaced during the reconnaissance pass.

---

## Security Gaps

### GAP-S1: Public Policy Collections Endpoint
`/api/policy-collections` is explicitly listed in the public paths array (`server.js:77`), meaning anyone can list policy collection metadata without authentication. This is likely unintentional.

### GAP-S2: Unauthenticated Muraji API
The Muraji API (`https://muraji-api.wathbahs.com`) is called from the browser without any authentication token (`app.js:1141`, `prompts.js:6`). If this API holds sensitive GRC data, it is exposed.

### GAP-S3: No RBAC Within the Admin App
All authenticated users have identical permissions. Any GRC user whose token validates gets full admin access — including exporting controls, uploading libraries, and managing prompts. There is no role check.

### GAP-S4: AI Writes Attributed to Human Users
All GRC API writes (controls, assessments, libraries) use the human user's token. There is no service account or AI attribution, making it impossible to distinguish AI-generated changes in GRC audit trails.

### GAP-S5: GEMINI_API_KEY Committed in `.env`
The `.env` file contains a live-looking Gemini API key. While `.env` is in `.gitignore`, the key's format appears real. Confirm it is not committed in any branch history.

---

## Data Model Gaps

### GAP-D1: Entity Cache Not User-Scoped
`ciso_entity_cache` stores GRC entity data with a key of `entity_type` only — no user ID. If two users with different GRC permissions trigger caching, one user's data overwrites the other's. This can cause data leakage or stale data.

### GAP-D2: No Cascade Deletes
The SQLite schema uses no `ON DELETE CASCADE`. Deleting a session does not clean up its messages. Deleting a policy collection does not clean up its files or generation history.

### GAP-D3: Unbounded Growth
No retention policy, no archival, no vacuum schedule. The `messages` table and `policy_generation_history` table will grow indefinitely.

### GAP-D4: JSON Columns Without Validation
Several columns store JSON as TEXT (`cs_sessions.controls`, `cs_sessions.chain_of_thought`, `policy_files.metadata`, `org_context_chain.chain_data`). There is no schema validation on these fields.

---

## Architecture Gaps

### GAP-A1: Monolithic Server File
All backend logic (~4,880 lines) is in a single `server.js` file. This makes it difficult to test, navigate, or maintain.

### GAP-A2: No Test Suite
No test files, no test dependencies (`jest`, `mocha`, `vitest`), no test scripts in `package.json`. Zero test coverage.

### GAP-A3: No Build Pipeline
No bundler, minifier, linter, or CI/CD configuration. Frontend assets are served as-is. `admin.css` is 158KB unminified, `admin.js` is 292KB unminified.

### GAP-A4: No Error Recovery for AI Calls
Gemini API calls have basic try/catch but no retry logic, no circuit breaker, no exponential backoff. A Gemini outage will cause immediate failures for all users.

### GAP-A5: No Rate Limiting
No rate limiting on any endpoint. The Gemini API calls are expensive; a user could trigger hundreds of analysis requests.

### GAP-A6: In-Memory Auth Sessions
`authSessions` is a `Map` in memory. Server restart = all users logged out. No session persistence.

---

## Feature Gaps

### GAP-F1: Merge Optimizer — Unclear Status
Route `/merge-optimizer` is registered in the SPA router but no dedicated backend logic was found. Is this implemented in the 57KB `admin.js`, or is it a placeholder?

### GAP-F2: Legacy / New Page Duplication
Both `prompts.html` (legacy) and `/prompts` (SPA route) exist. Both `index.html` (legacy Audit Studio) and `/audit-studio` (SPA) exist. It's unclear which is canonical.

### GAP-F3: No Offline Support
No service worker, no local storage fallback, no offline queue. The app requires constant network connectivity.

---

## Open Questions for the Product Team

1. **RBAC:** Should the Admin app enforce GRC roles? E.g., should a "read-only auditor" be prevented from exporting controls?
2. **Muraji:** Is the Muraji API the same team? Should it be merged into this project or formalized as a separate service with auth?
3. **Multi-tenancy:** Should sessions, org contexts, and policy collections be scoped to GRC folders/domains?
4. **Merge Optimizer:** What is the intended functionality? Is it actively used?
5. **Legacy pages:** Can `index.html`, `chat.html`, and `prompts.html` be deprecated in favor of the SPA routes?
6. **AI attribution:** Does the GRC team need to distinguish AI-generated controls from human-created ones?
7. **Retention:** What is the expected data volume? Should there be auto-archival for old sessions and messages?
8. **Arabic UI:** Is RTL/Arabic UI a v4 requirement, or is English-only acceptable?
