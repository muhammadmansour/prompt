# WathbahGRC Admin — Policies and Risks
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Policy and Risk data structures in this project.

## Policies

### Policy Collections (local)

This app has a **policy ingestion pipeline** — not a canonical Policy model, but a document-processing workflow:

- `policy_collections` table: Stores policy document groupings with extraction state — `server.js:168–178`
- `policy_files` table: Individual uploaded files within a collection — `server.js:180–190`
- `policy_generation_history` table: Tracks extraction/generation runs — `server.js:194–210`
- `policy_uuid` field on collections/history: Links to a GRC policy entity after approval — `server.js:259–265`

**Workflow:** Upload PDFs → extract via Gemini → generate framework library → approve → push to GRC as stored library.

### No Policy/PolicyVersion/PolicyAmendment Model

There is no `Policy`, `PolicyVersion`, or `PolicyAmendment` table in local SQLite. The concept of a "policy" here is a document collection being processed, not a versioned governance artifact. Canonical policies live in the main WathbahGRC backend, proxied at `/api/grc/policies` — `server.js:2139–2154`.

## Risks

### Org Context Risk Scenarios (local JSON)

- `org_contexts.risk_scenarios` TEXT column stores a JSON array — `server.js:302`
- Parsed via `orgContextToJSON` — `server.js:799`
- UI for risk scenarios in org context editor — `admin.js:1355–1460`

### GRC Risk Scenarios (proxied)

- `/api/grc/risk-scenarios` proxies to WathbahGRC's risk API — `server.js` (~line 2198–2228)
- `org_context_chain.risk_scenario_uuid` links risks in the entity chain — `server.js:235–236`
- `ciso_entity_cache` with `entity_type = 'risk_scenario'` caches risk data — `server.js:404`

### No Local Risk Fields

No inherent/residual risk scores, appetite, heatmap coordinates, or risk matrix calculations in this codebase. Risk modeling belongs to the main WathbahGRC product.

## Cross-Links

- **Policy ↔ RequirementNode:** No direct link in this app. Policy collections can generate framework libraries containing requirement nodes, but there's no M2M table.
- **Risk ↔ Control:** Linked via `org_context_chain` (risk_scenario_uuid ↔ applied_control_uuid) — `server.js:227–242`
- **CISO Assistant Governance → Policies:** Proxied but not locally modeled. This app processes policy *documents*, not policy *governance records*.
