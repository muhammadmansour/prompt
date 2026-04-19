# WathbahGRC Admin — RBAC and Folders
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Folder-based multi-tenancy and permission model.

## RBAC

Not present in this project. See `05-frontend-navigation/admin-only-surfaces.md`. The only auth check is "has a valid session token" — `server.js:1879–1907`.

## Folders

- Folders are a WathbahGRC concept (CISO Assistant's multi-tenancy primitive)
- Proxied here: `GET /api/grc/folders` → `${GRC_API_URL}/api/folders/` — `server.js:2230–2233`
- Used in the Audit Log page: compliance assessment cards display `ca.folder` — `admin.js:10202–10212`
- **Not enforced:** This app does not filter data by folder. All frameworks, assessments, and entities are visible regardless of folder membership.

## Domains / Perimeters

- `perimeter` appears in compliance assessment data from GRC — `admin.js:10202`
- No local perimeter model or enforcement
- No domain concept beyond what GRC provides

## Multi-Tenancy

Not implemented. This app operates as a single-tenant tool. All data in SQLite is shared across all users. Org contexts provide logical separation but no access control.
