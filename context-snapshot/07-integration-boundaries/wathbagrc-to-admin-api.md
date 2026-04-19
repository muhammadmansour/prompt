# WathbahGRC Admin — WathbahGRC-to-Admin API
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** How the main GRC product and this admin app communicate.

## Communication Pattern

**HTTP proxy.** This admin app's Node server proxies requests to the WathbahGRC Django API using the logged-in user's GRC token. The browser never talks to GRC directly — all GRC calls go through `server.js` routes prefixed `/api/grc/`.

Additionally, the browser talks **directly** to the Muraji API (a separate service) for library/prompt/control CRUD.

## GRC Proxy Helper

`grcFetch(url, opts, token)` — `server.js:57–63` — wraps `fetch` with `Authorization: Token ${token}` header.

## Cross-Boundary Endpoints (server.js → GRC)

| Local Route | Method | GRC Endpoint | Purpose |
|-------------|--------|-------------|---------|
| `/api/auth/login` | POST | `/api/iam/login/` | Authenticate user |
| `/api/auth/me` | GET | `/api/iam/current-user/` | Get current user info |
| `/api/grc/frameworks` | GET | `/api/frameworks/` | List frameworks |
| `/api/grc/frameworks/:id/tree` | GET | `/api/frameworks/:id/tree/` | Framework requirement tree |
| `/api/grc/compliance-assessments` | GET | `/api/compliance-assessments/` | List CAs |
| `/api/grc/compliance-assessments/:id/tree` | GET | `/api/compliance-assessments/:id/tree/` | CA requirement tree |
| `/api/grc/compliance-assessments/:id/requirements-list` | GET | `/api/compliance-assessments/:id/requirements_list/` | Flat requirement list |
| `/api/grc/requirement-nodes` | GET | `/api/requirement-nodes/` | List requirement nodes |
| `/api/grc/requirement-assessments` | GET | `/api/requirement-assessments/` | List RAs |
| `/api/grc/requirement-assessments/:id` | PATCH | `/api/requirement-assessments/:id/` | Update RA |
| `/api/grc/requirement-assessments/:id/audit-log` | GET | `.../audit-log/` | RA audit trail |
| `/api/grc/applied-controls` | POST | `/api/applied-controls/` | Export controls |
| `/api/grc/policies` | GET | `/api/policies/` | List policies |
| `/api/grc/organisation-objectives` | GET/POST | `/api/organisation-objectives/` | Org objectives |
| `/api/grc/metric-instances` | GET | `/api/metric-instances/` | Metrics |
| `/api/grc/risk-scenarios` | GET | `/api/risk-scenarios/` | Risk scenarios |
| `/api/grc/folders` | GET | `/api/folders/` | Folder list |
| `/api/grc/status` | GET | `/api/status/` | GRC platform status |
| `/api/grc/stored-libraries/upload/` | POST | `/api/stored-libraries/upload/` | Push library (policy approve) |
| `/api/grc/reference-controls/` | POST | `/api/reference-controls/` | Push controls (policy approve) |

## Browser → Muraji API (Direct)

| Caller | Method | Muraji Endpoint | Purpose |
|--------|--------|----------------|---------|
| Workbench | GET | `/api/libraries` | Load frameworks |
| Workbench | PATCH | `/api/libraries/:id/controls` | Save questions/evidence/notes |
| Prompts | GET/PUT | `/api/prompts` | Prompt template CRUD |
| Legacy app | PATCH | `/api/libraries/:id/controls` | Save AI analysis results |

## Shared Database?

No. This app uses local SQLite (`sessions.db`). The GRC app uses PostgreSQL (accessed via HTTP API). Muraji uses its own data store (MongoDB per docs). The three systems communicate via REST only.
