# WathbahGRC Admin — Audit Log Usage
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Audit logging, retention, and custom audit tables.

## Django `auditlog` Package

**Not applicable.** This project is Node.js, not Django. There is no `auditlog` package or equivalent.

## Custom Audit Tables

**Not present.** No audit log table exists in the SQLite database. No request logging middleware. No change tracking on any table.

## What IS Logged

- `console.log()` and `console.error()` statements throughout `server.js` log:
  - API requests (path, method, key parameters)
  - Gemini API call results (response lengths, success/failure)
  - GRC API proxy calls and their results
  - Session creation/deletion
  - Controls export results
  - Chain resolution progress

These are **stdout logs only** — not persisted, not structured, not searchable. They would only survive in whatever process manager captures stdout (e.g., PM2 logs, journalctl).

## Service Account Identity

No reference to `muraji-ai@wathbagrc.system` or any service account identity was found. The app operates under the logged-in user's GRC token for all API calls.

## Retention

No retention policy. The SQLite database grows unbounded. `sessions` and `messages` are only deleted manually (via UI delete button or API call). `ciso_entity_cache` has a 30-minute TTL per entry but old entries are not pruned — they're overwritten on next fetch.
