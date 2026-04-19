# WathbahGRC Admin — Admin-Only Surfaces
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Pages gated to admin users and how gating is enforced.

## Status: THE ENTIRE APP IS ADMIN-ONLY

This project **is** the admin/content-management app. It is designed exclusively for GRC Admins. There is no concept of non-admin users accessing this application.

### Authentication Gating

- **Server-side:** All non-public paths require a valid `wathba_token` cookie or `Authorization: Bearer` header (`server.js:1866–1895`). Unauthenticated requests to HTML pages get a 302 redirect to `/login.html`. API requests get 401.

- **Client-side:** Every JS file starts with a cookie check that redirects to login if no token found (`app.js:2`, `chat.js:6`, `prompts.js:2`).

### Role-Based Gating

**Not present.** There is no role check beyond "is the user authenticated?" All authenticated users (whether they're a GRC Admin or a regular Compliance Officer in the CISO Assistant system) get full access to all Admin features.

### Public Paths

These paths are accessible without authentication (`server.js:67–79`):
- `/login.html`, `/login.css`, `/login.js`
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/check`
- Font and favicon files
- `/api/policy-collections` (explicitly marked as public — `server.js:77`)

⚠ `/api/policy-collections` being public is likely a security oversight — it exposes policy collection metadata without authentication.
