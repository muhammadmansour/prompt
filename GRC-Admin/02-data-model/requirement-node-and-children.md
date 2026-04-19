# WathbahGRC Admin — Requirement Nodes and Children
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** How questions, typical evidences, admin notes, and AI metadata are stored for requirements. CRITICAL for v4 Req #01.

## Where Requirement Nodes Live

Requirement nodes are **not stored locally** in this project's SQLite database. They live in WathbahGRC (CISO Assistant) and are accessed via:
1. **Muraji API** (`https://muraji-api.wathbahs.com/api/libraries`) — returns framework libraries with embedded `requirement_nodes` arrays (used by `app.js:6`)
2. **GRC API proxy** (`/api/grc/requirement-nodes/`, `/api/grc/frameworks/:id/tree/`) — used by the SPA for Controls Studio and chain resolution
3. **`ciso_entity_cache`** table — caches requirement data fetched from GRC for chain resolution (`server.js:362–371`)

## Questions Attached to Requirements

### Current storage: **PATCH to Muraji API**

When AI analysis generates questions for a requirement, they are formatted as a URN-keyed object and sent to `https://muraji-api.wathbahs.com/api/libraries/:libraryId/controls` via PATCH (`app.js:1097–1131`).

The question structure written back:
```json
{
  "urn:...:question:1": {
    "type": "unique_choice",
    "text": "The assessment question text?",
    "choices": [
      { "urn": "...:question:1:choice:1", "value": "Yes" },
      { "urn": "...:question:1:choice:2", "value": "No" },
      { "urn": "...:question:1:choice:3", "value": "Partial" }
    ]
  }
}
```

Questions are **not stored locally** in the Admin app's database. They are written directly to the Muraji API and presumably stored in MongoDB on that side.

### Generation: via AI prompt (`prompts/requirement-analyzer.txt`)

The prompt requests exactly 5 questions, each with `{question, purpose}` fields. The frontend displays them and allows inline editing before confirming.

## Typical Evidences Attached to Requirements

### Current storage: **String field on Muraji API**

Typical evidences are formatted as a bullet-point string and sent as `typical_requirements` (note: misnomer) to the same PATCH endpoint (`app.js:1088–1096`):

```
- Evidence title: Description
- Evidence title 2: Description 2
```

This is a **plain text string**, not a structured array, when written to the API. The frontend generates them as structured `{title, description}` objects from AI, but flattens them on save.

## Admin Notes / Internal Comments

**Not present in this project.** Searched for `admin_note`, `internal_comment`, `auditor_comment`, `historical_finding`, `admin_notes` across all files — no matches. There is a `notes` field on `org_contexts` but that's organization-level, not requirement-level.

## Per-Item AI Scope / "Included in Prompt" Flag

**Not present.** There is no boolean or status field that controls whether a question or evidence item flows into the AI prompt. All items on a selected requirement are included unconditionally.

## Provenance Tracking (AI vs Human)

**Not present.** There is no field distinguishing AI-generated items from human-authored items. When AI generates questions/evidence and the user confirms, they are written identically to manually-created items. No `source` or `created_by` metadata.

## Generation Metadata

**Partially present, only for policy extraction:**

- `policy_generation_history` table stores: `confidence_score`, `generation_time`, `source_file_count`, `extraction_data`, `generation_type` (`server.js:194–210`)
- For requirement analysis (Audit Studio), **no metadata is stored at all**. The AI output is displayed in a modal, optionally edited, then PATCHed to Muraji. No record of the run, model used, token count, or prompt version is kept.
- For Controls Studio sessions: generated controls are stored in `cs_sessions.controls` as JSON, but without model name, token count, or run ID.

## Bilingual Fields

### In this project's local DB:
- `org_contexts`: `name_en` / `name_ar` — bilingual pair. No other table has bilingual fields.

### In AI-generated output:
- Controls generator prompt (`prompts/controls-generator.txt`) requests both `name` and `name_ar`, `description` and `description_ar` for each control.
- Policy extractor does not generate Arabic content — `locale` field determines language.

### Missing:
- Questions have no Arabic translations
- Typical evidences have no Arabic translations
- Admin notes don't exist at all
