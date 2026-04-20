# WathbahGRC Admin — Service Accounts
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** How service accounts are created, authenticated, and used.

## muraji-ai Service Account

- **Definition:** `const WB_AI_SERVICE_ACCOUNT = 'muraji-ai'` — `admin.js:8175`
- **Usage:** Set as `created_by` / `updated_by` on AI-generated items via `makeAiAuditFields()` — `admin.js:8183–8186`
- **Audit:** Used as `actor` in `wbLogAudit` entries for AI operations — `admin.js:9397,9566,9994`
- **Nature:** A **string constant**, not a real user account. Not provisioned in any auth system. Not authenticated. Cannot log in.
- **Triggering admin:** Captured separately as `triggered_by: wbAdminUser` in audit entries — `admin.js:8193,9553`

## admin@wathba-grc

- Appears as a display string in the Merge Optimizer success panel — `admin.js:5656`
- Cosmetic label, not a functional account

## No Server-Side Service Account

- No service account table in SQLite
- No machine-to-machine auth tokens
- No API key-based service identity
- All server-to-GRC calls use the logged-in user's GRC token via `grcFetch` — `server.js:57–63`
- Gemini calls use `GEMINI_API_KEY` — not tied to a user identity

## Implication for v4

If v4 needs proper service account attribution (e.g., AI writes visible as a distinct user in GRC audit logs), a service account would need to be:
1. Provisioned in WathbahGRC IAM
2. Given its own GRC token
3. Used for server-to-GRC writes during AI operations (instead of the triggering user's token)
