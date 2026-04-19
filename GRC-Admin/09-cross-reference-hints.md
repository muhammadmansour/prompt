# WathbahGRC Admin — Cross-Reference Hints
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Pointers to the companion WathbahGRC (CISO Assistant) project for context that lives elsewhere.

---

## Companion Project: WathbahGRC (CISO Assistant)

This Admin project **depends on** the WathbahGRC (CISO Assistant) API for:

| This Project Needs | Look In WathbahGRC For |
|---|---|
| User authentication (login, token validation) | IAM module: `/api/iam/login/`, `/api/iam/current-user/` |
| Framework definitions, requirement nodes | Frameworks module: `/api/frameworks/`, `/api/requirement-nodes/` |
| Compliance assessment CRUD | Assessment module: `/api/compliance-assessments/`, `/api/requirement-assessments/` |
| Applied controls CRUD | Controls module: `/api/applied-controls/` |
| Risk scenarios, threats, evidences | Risk module: `/api/risk-scenarios/`, `/api/threats/`, `/api/evidences/` |
| Reference controls catalog | Library module: `/api/reference-controls/` |
| Library upload (YAML ingestion) | Library upload endpoint: `/api/libraries/` (multipart) |
| Folder/domain/perimeter structure | Folder module: `/api/folders/` |

## Companion Project: Muraji API

This Admin project's **frontend** directly calls Muraji for:

| This Project Needs | Look In Muraji API For |
|---|---|
| Library listing with controls | `GET /api/libraries` |
| Patching controls with questions/evidence | `PATCH /api/libraries/:id/controls` |
| Prompt template CRUD | `GET/POST/PUT/DELETE /api/prompts` |

## What This Project Owns (Not in Companions)

These features are **local to this Admin project** and have no counterpart in WathbahGRC or Muraji:

| Feature | Storage |
|---|---|
| Chat-based audit sessions | `sessions` + `messages` tables in SQLite |
| Organization context profiles | `org_contexts` table + `org_context_chain` |
| Controls Studio sessions | `cs_sessions` table |
| Policy ingestion workflow | `policy_collections` + `policy_files` + `policy_generation_history` |
| Local prompt management | `local_prompts` table (seeded from `prompts/*.txt`) |
| GRC entity cache | `ciso_entity_cache` table (30-min TTL) |
| Gemini File Search Store management | Via REST API to Google; metadata in `policy_files` |

## Data Flow Direction

```
┌─────────────────────┐
│  WathbahGRC (CISO)  │◀──── reads + writes ────┐
│  (Django backend)   │                          │
└─────────────────────┘                          │
                                                 │
┌─────────────────────┐     ┌──────────────────────────────┐
│    Muraji API       │◀────│  WathbahGRC Admin (this app) │
│  (Express backend?) │     │  Node.js + SQLite            │
└─────────────────────┘     └──────────┬───────────────────┘
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │  Google Gemini API   │
                            │  (AI generation)     │
                            └──────────────────────┘
```

## Cross-Reference Checklist for v4 Planning

When planning v4, the following changes in this project may require changes in companions:

- [ ] **Adding RBAC** → Requires role data from WathbahGRC IAM
- [ ] **Adding service account** → Requires creating a service user in WathbahGRC
- [ ] **Merging Muraji** → Requires understanding Muraji's data model and migrating endpoints
- [ ] **Adding audit logging** → Should align with WathbahGRC's existing audit log format
- [ ] **Multi-tenant scoping** → Requires understanding WathbahGRC's folder/domain model
- [ ] **Arabic UI** → Check if WathbahGRC already has Arabic locale files to share
