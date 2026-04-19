# WathbahGRC Admin — AI Output Writeback
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Where AI output lands in the database and how it's reviewed.

## Writeback Paths

### 1. Requirement Analysis (Audit Studio Legacy)

- AI output: `{typical_evidence, questions, suggestions}`
- **Displayed** in a modal for user review and editing (`app.js:574–833`)
- **Written** to Muraji API via `PATCH /api/libraries/:libraryId/controls` on "Confirm" (`app.js:1060–1172`)
- **NOT stored** in the local Admin database at all

### 2. Audit Chat Sessions

- AI output: Chat message text
- **Stored** in `messages` table with `role = 'ai'` (`server.js:2918–2919`)
- **No structured extraction** — the chat output is free-form markdown text
- No `ai_confidence_score`, `ai_analysis_data`, or `ai_status` fields

### 3. Controls Studio

- AI output: Array of control objects with `{name, name_ar, description, description_ar, category, csf_function, priority, effort, relevance_score, evidence_examples, for_requirements}`
- **Stored** in `cs_sessions.controls` as a JSON array (`server.js:3063–3077`)
- After user review → **Exported** to GRC via `POST /api/grc/applied-controls` (`server.js:2267–2488`)
- Export results stored in `cs_sessions.exported_control_ids`

### 4. Policy Extraction

- AI output: Full CISO Assistant library JSON (framework + requirement_nodes + reference_controls)
- **Stored** in `policy_collections.extraction_result` as JSON (`server.js:4095`)
- **Also stored** in `policy_generation_history.extraction_data` (`server.js:4107–4115`)
- After user review → **Pushed** to GRC via `POST /api/stored-libraries/upload/` (`server.js:4238–4260`)
- Approval metadata stored: `result.approved`, `result.approvedAt`, `result.libraryUrn`

## "Pending" / Human Review State

- **Policy extraction:** Yes — status transitions from `'generating'` → `'generated'` (awaiting review) → `'approved'` (`server.js:3869, 4095, 4296`). The user can view, edit extracted policies, then explicitly approve.
- **Controls Studio:** Partial — controls are generated and displayed, user can edit/delete/add, then explicitly "Export to GRC". But there's no formal status field on the session tracking this.
- **Requirement analysis:** No — output is shown in a modal; confirming writes immediately. No pending state.
- **Chat:** No — AI responses are stored immediately upon receipt.

## Author Attribution

- **Policy extraction writes to GRC:** Uses the logged-in user's GRC token (`reqToken`), so the GRC audit log attributes the library upload to that user.
- **Controls export to GRC:** Same — uses the user's GRC token.
- **Requirement analysis writes to Muraji:** No auth header sent — effectively anonymous.
- **No service account identity** like `muraji-ai@wathbagrc.system` exists in this project.

## AI Confidence Score

Present **only for policy extraction**: `policy_generation_history.confidence_score` — computed as the average of per-node annotation confidence values, multiplied by 100 (`server.js:3999–4015`). Not present for any other AI operation.
