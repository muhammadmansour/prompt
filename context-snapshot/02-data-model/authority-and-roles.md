# WathbahGRC Admin — Authority and Roles
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** RBAC, authority matrix, approval chains, and decision types.

## No RBAC in This Project

- **No Role table** in local SQLite — confirmed by reviewing all `CREATE TABLE` blocks in `server.js:101–243`
- **No permission checks** beyond "has a valid session token" — auth guard at `server.js:1879–1907` checks token existence only
- **`messages.role`** is the chat role (`'user'`/`'ai'`), not an authorization role — `server.js:113`
- Users authenticate via WathbahGRC IAM (`/api/iam/login/`); the app stores a local session token mapped to the GRC token — `server.js:1797–1835`

## No Authority Matrix

- No `decision_type` enum, registry, or table
- No RACI matrix data structure
- No approval chain configuration
- Searched for `authority`, `matrix`, `RACI`, `decision_type`, `approval_chain` across all `.js` files: only matches are in `GRC-Admin/` documentation noting their absence

## How "Who Approves What" Works Today

### Policy Ingestion Approval

The only approval-like flow in the codebase:
- Policy collections have a `status` field: `'empty'` → `'processing'` → `'generated'` → `'approved'`
- "Approve" action: `POST /api/policy-collections/:id/approve` — `server.js:4205–4376`
- Approval pushes the extracted library to GRC via `stored-libraries/upload/`
- **No multi-role approval**: any authenticated user can approve
- **No routing logic**: no escalation, no delegation, no authority lookup

### Workbench Save

- Any authenticated user can save changes to requirement nodes (questions, evidence, notes)
- No approval step between edit and persist

## Implication for v4

The Authority Matrix feature (v4 scope) — decision type registry, role registry, RACI grid, scoped variants, versioning, preview mode, assignment transparency — is entirely new. There are no existing data structures to migrate or extend.
