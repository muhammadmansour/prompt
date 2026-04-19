# WathbahGRC Admin — Authority and Roles
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Role modelling, RACI matrices, approval chains.

## Authentication

Authentication is **fully delegated to WathbahGRC's IAM**:

1. User submits username + password to `/api/auth/login` (`server.js:1797–1845`)
2. Server forwards to `GRC_API_URL/api/iam/login/` 
3. GRC returns a token; Admin stores it in `authSessions` (in-memory `Map`, not persisted)
4. A local session token is generated and returned to the browser as a cookie (`wathba_token`)

### Session persistence

Sessions are stored **only in memory** (`const authSessions = new Map()` at `server.js:41`). A server restart logs out all users.

## Authorization / RBAC

**Not present in this project.** There is:

- No `User` table
- No `Role` table or enum
- No permission checks on any API endpoint beyond "is the user logged in?"
- No concept of GRC Admin vs. Compliance Officer vs. Auditor roles
- The auth guard (`server.js:1866–1895`) only checks token validity, not role

All authenticated users have identical access to all features including policy ingestion, controls generation, and GRC API proxy endpoints.

## RACI / Authority Matrix

**Not present.** No `RACI`, `authority_matrix`, `approval_chain`, `decision_type`, or similar data structures exist.

## Approval Workflows

**Partial — for policy ingestion only:**

The policy extraction pipeline has a two-step workflow:
1. `extract` — AI generates the library (status: `'generated'`)
2. `approve` — User reviews and pushes to GRC (status: `'approved'`)

This is a **simple status enum**, not a configurable approval chain. There's no concept of who approved, multi-level approval, or routing rules. The endpoint is `POST /api/policy-collections/:id/approve` (`server.js:4143`).

No other workflow in the app has an approval step.
