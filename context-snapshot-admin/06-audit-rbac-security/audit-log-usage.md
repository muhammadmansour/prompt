# WathbahGRC Admin — Audit Log Usage
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Audit logging systems and their coverage.

## No Django auditlog

This is a Node.js app — no Django, no `auditlog` package.

## Workbench In-Memory Audit (admin.js)

- `wbAuditLog` array in browser memory — `admin.js:8188`
- `wbLogAudit(action, details)` appends entries — `admin.js:8189–8203`
- **Entry fields:** timestamp, actor, triggered_by, action, requirement_urn, item_type, item_id, summary, before (snapshot), count
- **Actions logged:** `create_item`, `edit_item`, `delete_item`, `toggle_scope`, `ai_wipe_replace`, `ai_generate`
- **Flush:** Entries are spliced from the array and sent as `audit_log` in PATCH body on save — `admin.js:9664,9678`, toggle persist — `admin.js:8971,8983`, bulk — `admin.js:10049,10060`
- **Retention:** No retention policy — entries are consumed on save. If save fails, they're restored to the array — `admin.js:8988,9689`

## GRC Audit Log (proxied)

- `GET /api/grc/requirement-assessments/:id/audit-log` proxies to WathbahGRC — `server.js:2283–2299`
- Displayed in the Audit Log page — `admin.js:10415–10429`

## Policy Generation History

- `policy_generation_history` table acts as an audit trail for extraction/generation runs — `server.js:194–210`
- Fields include: status, config, summary, generation_time, error_message, source_file_count

## No Custom Audit Tables

No dedicated `audit_log`, `change_log`, or `event_log` SQLite table in this app. The workbench audit data is transient (browser memory) until flushed to Muraji.

## Service Account Identity

AI writes are attributed to `'muraji-ai'` (`WB_AI_SERVICE_ACCOUNT`) — `admin.js:8175`. No `muraji-ai@wathbagrc.system` email-style identity.

## AUDITLOG_RETENTION_DAYS

Not applicable — no Django auditlog. No retention configuration for any audit data in this app.
