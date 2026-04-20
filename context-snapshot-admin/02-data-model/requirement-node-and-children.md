# WathbahGRC Admin — Requirement Node and Children
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** How questions, typical evidences, admin notes, and their metadata are stored and managed. This is the most critical file for v4 Req #01.

## Storage Model

Requirement nodes are **not stored in local SQLite**. They live as JSON objects inside framework library documents on the Muraji API (`https://muraji-api.wathbah.dev/api/libraries`). This app reads them via HTTP, mutates them in browser memory, and writes them back via PATCH.

## Questions

- **Structure:** Object keyed by question URN (e.g. `urn:requirement:question:1`), stored as a property `questions` on the requirement node JSON
- **Migration function:** `migrateQuestionItem(qUrn, q, idx)` — `admin.js:8205–8219`
- **Fields per question:**
  - `item_type`: `'question'` (canonical type)
  - `type`: `'question'` (new) or `'unique_choice'` (legacy)
  - `content_ar`: Arabic text (primary)
  - `content_en`: English text
  - `text`: Legacy field (mirrors `content_ar`)
  - `included_in_ai_scope`: Boolean
  - `excluded`: Boolean (inverse of above, for legacy compat)
  - `provenance`: `'manual'` or `'ai_generated'`
  - `generation_metadata`: Object or null (see below)
  - `created_at`, `created_by`, `updated_at`, `updated_by`: Audit fields
  - `display_order`: Integer
  - `choices`: Array of `{ urn, value }` (Yes/No/Partial)

## Typical Evidences

- **Structure:** Array stored as `typical_evidence_items` on the node; legacy fallback is `typical_evidence` (newline-delimited string)
- **Migration:** `migrateEvidenceFromText(text)` — `admin.js:8222–8243`; `migrateEvidenceItem(it, idx)` — `admin.js:8271–8284`
- **Fields per evidence item:**
  - `item_type`: `'typical_evidence'`
  - `title`: Optional title string
  - `description` / `content_ar`: Arabic content
  - `content_en`: English content
  - `excluded`: Boolean
  - `included_in_ai_scope`: Boolean
  - `provenance`: `'manual'` or `'ai_generated'`
  - `generation_metadata`: Object or null
  - `created_at`, `created_by`, `updated_at`, `updated_by`
  - `display_order`: Integer

## Admin Notes

- **Structure:** Array stored as `admin_notes` on the node — `admin.js:8877,8913–8927`
- **Migration:** `migrateNoteItem(note, idx)` — `admin.js:8245–8261`
- **Fields per note:**
  - `item_type`: `'admin_note'`
  - `subtype`: One of `'note'`, `'auditor_comment'`, `'internal_guidance'`, `'historical_finding'`, `'other'` — defined in `NOTE_SUBTYPES` — `admin.js:8167–8173`
  - `subtype_label`: Free-form label when subtype is `'other'` (max 60 chars)
  - `content_ar`: Arabic text (required)
  - `content_en`: English text (optional for notes)
  - `included_in_ai_scope`: Boolean (default: `false` for notes)
  - `provenance`: Always `'manual'` (notes are never AI-generated)
  - `generation_metadata`: Always null
  - `created_at`, `created_by`, `updated_at`, `updated_by`
  - `display_order`: Integer

## AI Scope Flag

Every item (question, evidence, note) carries `included_in_ai_scope` (boolean).
- **Defaults:** question → `true`, evidence → `true`, admin_note → `false` — `admin.js:8716,8828,8922`
- **Toggle:** Inline toggle buttons in the workbench UI, persisted immediately via PATCH — `admin.js:8993–9024,8968–8990`
- **Audit:** Each toggle logged via `wbLogAudit('toggle_scope', ...)` — `admin.js:9000,9010,9022`
- **Legacy:** `[EXCLUDED]` text prefix in `typical_evidence` string — `admin.js:8296–8301`

## Provenance Tracking

- `provenance` field: `'manual'` (human-created) or `'ai_generated'` (AI-created) — `admin.js:8212,8717,9578`
- Visual badge rendered by `provenanceBadge(prov)` — `admin.js:8310`
- AI writes use `WB_AI_SERVICE_ACCOUNT = 'muraji-ai'` as created_by/updated_by — `admin.js:8175,8183–8186`

## Generation Metadata

Stored on each AI-generated item as `generation_metadata` object:
- `prompt_template`: e.g. `'requirement-analyzer'`
- `prompt_template_version`: File mtime from server, or local_prompts record id
- `steering_prompt`: Admin-provided custom instructions (or null)
- `triggered_by`: Username of the admin who initiated generation
- `generated_at`: ISO timestamp
- `model`: e.g. `'gemini-2.5-pro'`

Example: `admin.js:9549–9555`

Not stored: token count, cost, run ID, AI confidence score.

## Bilingual Fields

| Field | `_ar` | `_en` | Notes |
|-------|-------|-------|-------|
| Question content | `content_ar` (required) | `content_en` (required) | |
| Evidence content | `content_ar` (required) | `content_en` (required) | |
| Admin note content | `content_ar` (required) | `content_en` (optional) | |
| Org context name | `name_ar` | `name_en` | On org_contexts table |

Node-level fields (`name`, `description`, `ref_id`) are single-language as received from Muraji and do not have `_ar`/`_en` siblings in this app.

## Unified Items View

`getOrderedItems(node)` — `admin.js:8286–8294` — merges questions, evidence, and notes into a single array sorted by `display_order`. However, storage remains in three separate structures (object + array + array), not a unified `items[]` array.
