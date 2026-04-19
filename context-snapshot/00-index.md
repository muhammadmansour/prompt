# WathbahGRC Admin — Context Snapshot Index
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Master index for the v4 planning context snapshot of the WathbahGRC Admin project.

## What This Project Is

**WathbahGRC Admin** (codenamed "Prompt Tool" / PROMPT-V2) is a companion admin app for the main WathbahGRC product. It is a single-page application built with vanilla HTML/CSS/JS and a Node.js backend backed by SQLite. It is used by GRC Admins to: manage AI-generated questions and typical evidences on framework requirement nodes (via the Workbench), run AI analysis using Google Gemini, manage prompt templates, process policy documents, generate applied controls, and view audit assessment data. It communicates with the main WathbahGRC Django API via HTTP proxy and with the Muraji library/prompt API directly from the browser.

**What it is NOT:** It is not the end-user GRC product. It does not manage assessments, evidence uploads, task assignments, or compliance workflows directly. It does not have RBAC, approval routing, legislative tracking, or a policy governance model.

## File Index

| File | Description |
|------|-------------|
| `01-architecture/stack-and-runtime.md` | Node.js, SQLite, Gemini SDK, no framework, no task queue |
| `01-architecture/repo-layout.md` | Flat monolith: server.js + admin.js + HTML files + prompts/ |
| `01-architecture/deployment-and-envs.md` | Two env vars, nginx reverse proxy, no CI/CD |
| `01-architecture/external-dependencies.md` | Gemini, WathbahGRC API, Muraji API |
| `02-data-model/core-entities.md` | 11 SQLite tables for sessions, prompts, org contexts, policy ingestion, caching |
| `02-data-model/requirement-node-and-children.md` | Questions/evidence/notes as JSON on Muraji library nodes, with scope flags and provenance |
| `02-data-model/policies-and-risks.md` | Policy document ingestion pipeline; risks as org context JSON; no governance model |
| `02-data-model/legislative-and-regulatory.md` | Not present — no legislative tracking, feeds, or impact classification |
| `02-data-model/authority-and-roles.md` | Not present — no RBAC, no RACI matrix, no decision types |
| `02-data-model/erd-text.md` | Mermaid ER diagram of all 11 local tables |
| `03-ai-pipeline/muraji-integration-points.md` | Every Gemini and Muraji call site with input/output shapes |
| `03-ai-pipeline/prompt-assembly.md` | Template file with {{PLACEHOLDER}} replacement, no template engine |
| `03-ai-pipeline/ai-scope-and-filtering.md` | Scope flags exist on items but are NOT consumed by prompt assembly |
| `03-ai-pipeline/cost-and-telemetry.md` | Nothing — no token counting, no cost tracking, no rate limiting |
| `03-ai-pipeline/ai-output-writeback.md` | AI output written client-side to Muraji; muraji-ai service account string |
| `04-admin-surfaces/question-management.md` | Workbench inline CRUD for questions |
| `04-admin-surfaces/typical-evidence-management.md` | Workbench inline CRUD for evidence |
| `04-admin-surfaces/admin-notes-or-equivalent.md` | Workbench notes with subtype taxonomy |
| `04-admin-surfaces/prompt-template-management.md` | Two systems: local SQLite + Muraji API; no versioning |
| `04-admin-surfaces/bulk-and-framework-level-jobs.md` | Browser-based sequential bulk generation with in-memory job tracker |
| `05-frontend-navigation/routes-and-pages.md` | 11 SPA routes, 4 standalone HTML pages |
| `05-frontend-navigation/arabic-rtl-support.md` | Per-element RTL for Arabic content; no i18n, no locale toggle |
| `05-frontend-navigation/admin-only-surfaces.md` | No role gating — all pages open to any authenticated user |
| `06-audit-rbac-security/audit-log-usage.md` | Browser-memory audit log flushed to Muraji on save; GRC audit proxied |
| `06-audit-rbac-security/service-accounts.md` | muraji-ai is a string constant, not a real account |
| `06-audit-rbac-security/rbac-and-folders.md` | No local RBAC; folders proxied from GRC but not enforced |
| `06-audit-rbac-security/approval-routing.md` | Minimal policy-approve flow; no general approval engine |
| `07-integration-boundaries/wathbagrc-to-admin-api.md` | 20+ GRC proxy routes; browser-direct Muraji calls; no shared DB |
| `07-integration-boundaries/external-sources-and-feeds.md` | Not present — no feeds, scrapers, or scheduled ingestion |
| `07-integration-boundaries/file-storage-and-collections.md` | Local disk + Gemini File Search stores; no cloud storage |
| `08-gaps-and-open-questions.md` | 12 unresolved questions about schema, auth, deployment, and AI pipeline |
| `09-cross-reference-hints.md` | 10 questions that require the WathbahGRC sibling snapshot |

## Top 5 Surprises

1. **AI scope flags are decorative.** `included_in_ai_scope` exists on every question/evidence/note, but the prompt assembly (`callGeminiAPIForSingle`) only sends the requirement-level text (name, description) — it never reads or filters by item-level scope flags. The flags affect only the status dashboard calculations and the legacy `[EXCLUDED]` text prefix.

2. **No server-side persistence for questions/evidence.** All question, evidence, and admin note data lives in Muraji (external API). This app reads it, edits it in browser memory, and PATCHes it back. Local SQLite has zero tables for these. If Muraji is down, the workbench is dead.

3. **The audit log is ephemeral until save.** `wbAuditLog` is a browser-memory array. If the user closes the tab before saving, all audit entries are lost. They only reach Muraji when the admin clicks "Save Changes" (or on scope toggle, which auto-persists).

4. **There is no RBAC at all.** Not "limited RBAC" — literally zero role checks. Any user who can log in via WathbahGRC IAM can do everything: edit any framework's questions, approve policy ingestions, manage prompts, run AI generation. The authority matrix feature starts from absolute zero.

5. **Muraji API calls from the browser have no authentication.** PATCH requests to `muraji-api.wathbah.dev/api/libraries/:id/controls` include no `Authorization` header. Either Muraji is open by design, or network-level controls (VPN/IP allowlist) are assumed. This is a security concern for v4.

## Top 5 Unknowns That Block v4 Planning

1. **What is Muraji's data model?** Questions, evidence, notes, and audit logs are PATCHed to Muraji, but this repo has no visibility into how Muraji stores them (MongoDB schema, indexes, constraints, access control). v4 features that depend on querying this data (e.g., "show all AI-generated items across all frameworks") may hit Muraji API limitations.

2. **Does WathbahGRC have roles that this app could consume?** v4's Authority Matrix needs a role registry. If GRC IAM already defines roles (Admin, Analyst, Reviewer, etc.), the matrix could reference them. If not, roles must be created from scratch — and the question of synchronization arises.

3. **Who owns the requirement node canonical data?** Both the GRC API (`/api/requirement-nodes/`) and Muraji API (`/api/libraries`) serve requirement data. Which is the source of truth? If GRC owns the schema and Muraji is a cache, v4 schema changes (adding authority-matrix fields) must happen in GRC. If Muraji is independent, changes happen there.

4. **Is there a real `muraji-ai` user in GRC IAM?** AI writes are labeled `created_by: 'muraji-ai'` but this is a browser-side string. For v4's audit trail requirements (service account attribution), a real IAM user may be needed. Does one exist?

5. **How are environments promoted?** No CI/CD, no Docker, no deployment scripts. How does code get from development to production? Understanding this is critical for v4's phased rollout (preview mode, feature flags, migration strategy).
