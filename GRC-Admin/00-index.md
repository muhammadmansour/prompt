# WathbahGRC Admin — Context Snapshot Index
**Project:** WathbahGRC Admin (framework-selector-app)
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope:** Full reconnaissance of the WathbahGRC Admin codebase — architecture, data, AI pipelines, frontend, security, integrations, and gaps.

---

## How to Read This Snapshot

This directory contains a structured analysis of the WathbahGRC Admin codebase, produced by a read-only reconnaissance pass. It is intended for the product team to plan v4 without reading the code.

**Key conventions:**
- "Implemented" = code exists and runs
- "Stub" = code exists but is incomplete or non-functional
- "Planned" = route/table/field exists but no logic behind it
- ⚠ = attention needed (security issue, ambiguity, or gap)
- All file paths are repo-relative

---

## Directory Structure

### `01-architecture/` — How the System Is Built

| File | What It Covers |
|---|---|
| [stack-and-runtime.md](01-architecture/stack-and-runtime.md) | Node.js, vanilla JS, SQLite, Gemini SDK. No framework, no ORM, no build tool |
| [repo-layout.md](01-architecture/repo-layout.md) | Flat structure: single `server.js` (4,880 lines), SPA `admin.html` + legacy pages |
| [deployment-and-envs.md](01-architecture/deployment-and-envs.md) | Nginx reverse proxy on `wathbahs.com`, 2 env vars, no Docker, no CI |
| [external-dependencies.md](01-architecture/external-dependencies.md) | 2 npm packages: `@google/genai`, `better-sqlite3` |

### `02-data-model/` — What Data Exists and Where

| File | What It Covers |
|---|---|
| [core-entities.md](02-data-model/core-entities.md) | 10 local SQLite tables for sessions, prompts, org contexts, caches |
| [requirement-node-and-children.md](02-data-model/requirement-node-and-children.md) | Requirement nodes live in GRC; Admin caches and augments with AI analysis |
| [policies-and-risks.md](02-data-model/policies-and-risks.md) | Policy ingestion workflow tables; risks proxied from GRC |
| [legislative-and-regulatory.md](02-data-model/legislative-and-regulatory.md) | No local legislative data — frameworks come from GRC |
| [authority-and-roles.md](02-data-model/authority-and-roles.md) | No local RBAC — auth delegated to GRC IAM |
| [erd-text.md](02-data-model/erd-text.md) | Text-based entity relationship diagram |

### `03-ai-pipeline/` — How AI Is Integrated

| File | What It Covers |
|---|---|
| [muraji-integration-points.md](03-ai-pipeline/muraji-integration-points.md) | Frontend calls Muraji for libraries and prompts; unauthenticated |
| [prompt-assembly.md](03-ai-pipeline/prompt-assembly.md) | 6 prompt templates, DB-managed, with org context injection |
| [ai-scope-and-filtering.md](03-ai-pipeline/ai-scope-and-filtering.md) | No content filtering, no PII detection, no output validation |
| [cost-and-telemetry.md](03-ai-pipeline/cost-and-telemetry.md) | No cost tracking, no telemetry, no usage dashboards |
| [ai-output-writeback.md](03-ai-pipeline/ai-output-writeback.md) | AI output → local SQLite → user review → export to GRC/Muraji |

### `04-admin-surfaces/` — What Admins Can Do

| File | What It Covers |
|---|---|
| [question-management.md](04-admin-surfaces/question-management.md) | AI-generated questions, reviewed in modal, pushed to Muraji |
| [typical-evidence-management.md](04-admin-surfaces/typical-evidence-management.md) | AI-generated evidence, same modal flow as questions |
| [admin-notes-or-equivalent.md](04-admin-surfaces/admin-notes-or-equivalent.md) | No notes feature; org contexts serve a similar role |
| [prompt-template-management.md](04-admin-surfaces/prompt-template-management.md) | Dual management: local DB + Muraji API for prompt CRUD |
| [bulk-and-framework-level-jobs.md](04-admin-surfaces/bulk-and-framework-level-jobs.md) | Batch controls generation with chunking; policy extraction |

### `05-frontend-navigation/` — How Users Navigate

| File | What It Covers |
|---|---|
| [routes-and-pages.md](05-frontend-navigation/routes-and-pages.md) | ~10 SPA routes + 4 legacy standalone pages |
| [arabic-rtl-support.md](05-frontend-navigation/arabic-rtl-support.md) | English-only, LTR-only UI. Arabic only in data layer |
| [admin-only-surfaces.md](05-frontend-navigation/admin-only-surfaces.md) | Entire app is admin-only; no RBAC within it |

### `06-audit-rbac-security/` — How Security Works (or Doesn't)

| File | What It Covers |
|---|---|
| [audit-log-usage.md](06-audit-rbac-security/audit-log-usage.md) | No audit logs; console.log only |
| [service-accounts.md](06-audit-rbac-security/service-accounts.md) | No service accounts; AI writes use human user's token |
| [rbac-and-folders.md](06-audit-rbac-security/rbac-and-folders.md) | No local RBAC; folder model proxied from GRC |
| [approval-routing.md](06-audit-rbac-security/approval-routing.md) | Minimal approval: policy ingestion approve/reject only |

### `07-integration-boundaries/` — Where This App Ends and Others Begin

| File | What It Covers |
|---|---|
| [cross-app-api-calls.md](07-integration-boundaries/cross-app-api-calls.md) | 3 external APIs: GRC (auth+data), Muraji (libraries+prompts), Gemini (AI) |
| [external-data-sources.md](07-integration-boundaries/external-data-sources.md) | GRC entities cached 30min; Muraji fetched fresh; uploads one-time |
| [file-storage.md](07-integration-boundaries/file-storage.md) | Local disk + Gemini File Search Stores; no S3/blob |

### Top-Level Files

| File | What It Covers |
|---|---|
| [08-gaps-and-open-questions.md](08-gaps-and-open-questions.md) | 15 gaps (security, data, architecture, features) + 8 open questions |
| [09-cross-reference-hints.md](09-cross-reference-hints.md) | What lives in companion projects; data flow diagram; v4 checklist |

---

## One-Paragraph Summary

WathbahGRC Admin is a **lightweight Node.js tool** that sits between the WathbahGRC (CISO Assistant) API and Google's Gemini AI. It lets GRC administrators generate compliance content (controls, evidence, questions, policies) using AI, review it locally in a vanilla-JS SPA, and export approved results back to the GRC platform. It has no framework, no ORM, no tests, no CI, no RBAC, no audit logging, and a single 4,880-line `server.js`. For v4, the biggest decisions are: whether to keep it as a lightweight tool or invest in proper architecture (framework, tests, RBAC, multi-tenancy), and how to formalize the relationship with the Muraji API.
