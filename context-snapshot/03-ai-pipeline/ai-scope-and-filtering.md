# WathbahGRC Admin — AI Scope and Filtering
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Mechanisms that decide which items flow into AI prompts and which don't.

## Client-Side Scope Flags (Workbench)

Every question, evidence item, and admin note carries an `included_in_ai_scope` boolean — `admin.js:8208–8211,8236,8253,8277`.

- **Toggle UI:** Inline eye icon buttons per row — `admin.js:8677,8789,8888`
- **Default values:** Questions=ON, Evidence=ON, Admin Notes=OFF — `admin.js:8716,8828,8922`
- **Persistence:** Toggle immediately PATCHed to Muraji API via `persistScopeToggle()` — `admin.js:8968–8990`
- **Audit:** Toggle logged to `wbAuditLog` — `admin.js:9000,9010,9022`

## Server-Side Filtering: None

The `/api/analyze` endpoint receives the `requirement` object and `prompt` string — `server.js:1920`. It passes them directly to Gemini without filtering based on any scope flag. The prompt template (`requirement-analyzer.txt`) receives the requirement description, not individual questions or evidence items.

**Key gap:** The AI scope flags exist on items, but they are **not consumed** by the prompt assembly. The current prompt sends only the requirement-level text (name, description, ref_id), not the per-item data. So `included_in_ai_scope` currently affects only the workbench status dashboard (Full/Partial/Empty calculations at `admin.js:9704–9706`) and the legacy `[EXCLUDED]` text prefix (`admin.js:8296–8301`).

## Policy Extraction Filtering

For policy extraction, file selection acts as the scope filter — `server.js:3951–3956`. Only files with IDs in `selectedFileIds` are included in the extraction prompt. This is a per-run selection, not a persistent scope flag.

## Future Consideration

For v4, if the AI prompt should include/exclude individual questions or evidence based on scope flags, the prompt assembly in `callGeminiAPIForSingle` would need to receive and filter the item-level data, not just the requirement summary.
