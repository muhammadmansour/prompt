# WathbahGRC Admin — AI Output Writeback
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Where AI output lands in the database and how authorship is recorded.

## Requirement Analysis Output

### Flow

1. AI returns `{ questions[], typical_evidence[], suggestions[] }` from Gemini — `server.js:1222–1252`
2. Server responds to client with `{ success: true, data, meta }` — `server.js:1960`
3. **Client** (browser) writes items to in-memory node objects — `admin.js:9559–9616`
4. Client PATCHes to **Muraji API** (`/api/libraries/:id/controls`) — `admin.js:9667–9681`
5. Audit log entries are included in the PATCH body — `admin.js:9664,9678`

### Destination Fields

AI-generated items are merged into the requirement node's:
- `questions` (object keyed by URN) — `admin.js:9569–9588`
- `typical_evidence_items` (array) + `typical_evidence` (legacy text) — `admin.js:9601–9614`

Each item gets: `provenance: 'ai_generated'`, `included_in_ai_scope: true`, `excluded: false`, `generation_metadata`, and `makeAiAuditFields()` timestamps.

### No Pending/Review State

AI output is written directly to the canonical item fields. There is no intermediate "pending" state, no draft/review workflow, and no diff view for human approval before items become live. The admin must manually review and then click "Save Changes" to persist.

## Controls Studio Output

- Generated controls stored in `cs_sessions.controls` (JSON) — `server.js:3078–3088`
- Export to GRC via `/api/grc/applied-controls` — `server.js:2330–2551`
- Author: logged-in user's GRC token (not a service account)

## Policy Extraction Output

- `policy_collections.extraction_result` (JSON) — `server.js:4156–4158`
- `policy_generation_history` row created — `server.js:4170–4178`
- On approval: pushed to GRC as stored library — `server.js:4300–4309`
- Author: logged-in user's GRC token

## Authorship Attribution

### Workbench (Questions/Evidence)

- `WB_AI_SERVICE_ACCOUNT = 'muraji-ai'` — `admin.js:8175`
- `makeAiAuditFields()` sets `created_by` and `updated_by` to `'muraji-ai'` — `admin.js:8183–8186`
- Human edits use `wbAdminUser` (fetched from `/api/auth/me`) — `admin.js:8148–8157,8177–8180`
- `wbLogAudit` entries include `actor: WB_AI_SERVICE_ACCOUNT` and `triggered_by: wbAdminUser` — `admin.js:9397`

### Other Surfaces

- Controls Studio and Policy Ingestion use the logged-in user's GRC token for writes, not a service account
- No `ai_confidence_score` field anywhere
- `policy_generation_history.confidence_score` exists but is a simple integer (0–100), not per-item — `server.js:205`

## Fields Named ai_*

- No `ai_status`, `ai_analysis_data`, or `ai_confidence_score` fields on any SQLite table or requirement node object
- `generation_metadata` on items is the closest: stores model, template, steering, timestamp — `admin.js:9549–9555`
