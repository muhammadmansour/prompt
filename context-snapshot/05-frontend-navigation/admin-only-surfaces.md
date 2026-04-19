# WathbahGRC Admin — Admin-Only Surfaces
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Pages gated to specific roles and how gating is enforced.

## Role-Based Gating

**None.** This entire app is an admin tool — all pages are accessible to any authenticated user. There are no role checks, no permission guards, and no admin vs. non-admin distinction.

## Authentication

- Login via WathbahGRC IAM: `POST ${GRC_API_URL}/api/iam/login/` — `server.js:1797–1835`
- Session token stored in memory (`authSessions` Map) — `server.js:40–45`
- Cookie-based auth: `wathba_token` — `server.js:81–90`
- Auth guard: rejects unauthenticated API requests with 401, redirects HTML requests to `/login.html` — `server.js:1879–1907`

## Public Paths (no auth required)

- `/login.html`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/check`
- Static assets: fonts, favicon, `login.css`
- **`/api/policy-collections*`** — explicitly marked public — `server.js:66–78`

## Enforcement

Server-side only (token check in the HTTP handler). No client-side route guards — the SPA simply won't load data if the token is invalid.

## Implication for v4

If the Authority Matrix or other v4 features need role-based access (e.g., only System Admins can edit the matrix), the entire RBAC layer must be built from scratch — both the role model and the enforcement middleware.
