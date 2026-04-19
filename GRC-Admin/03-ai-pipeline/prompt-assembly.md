# WathbahGRC Admin — Prompt Assembly
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** How prompts are assembled for each AI operation.

## Prompt Templates

6 templates stored in `prompts/` directory, seeded into `local_prompts` SQLite table on startup. The **DB copy is the source of truth** — admin users can edit prompts via the UI and changes take effect immediately.

| Key | File | Used For |
|---|---|---|
| `chat_auditor` | `prompts/chat-auditor.txt` | Audit chat sessions (system instruction) |
| `controls_generator` | `prompts/controls-generator.txt` | Controls Studio generation |
| `policy_extractor` | `prompts/policy-extractor.txt` | Full policy extraction (framework + controls) |
| `framework_extractor` | `prompts/framework-extractor.txt` | Framework-only extraction |
| `ref_controls_extractor` | `prompts/reference-controls-extractor.txt` | Controls-only extraction |
| (file only) | `prompts/requirement-analyzer.txt` | Single-requirement analysis (Audit Studio legacy) |

## Assembly: Requirement Analysis (`callGeminiAPIForSingle`)

Template: `prompts/requirement-analyzer.txt` (loaded from file, **not** from DB)

Placeholders replaced via string `.replace()`:
- `{{REQUIREMENT}}` → `JSON.stringify(requirement, null, 2)`
- `{{USER_PROMPT}}` → user-typed notes or `'No additional context provided.'`
- `{{CONTEXT_FILES}}` → formatted file contents (truncated to 8000 chars each)

**No template engine.** Plain string replacement (`server.js:1161–1164`).

## Assembly: Audit Chat Session

Template: `getChatAuditorPrompt()` → reads from `local_prompts` DB

The system instruction is built incrementally (`server.js:2634–2683`):
1. Base prompt from DB
2. `+ SESSION CONTEXT: Selected Requirements` — grouped by framework, with ref_ids and descriptions
3. `+ SESSION CONTEXT: Reference Files` — file names and store info
4. `+ SESSION CONTEXT: Uploaded Context Files` — full file content (truncated to 8000 chars each)
5. `+ SESSION CONTEXT: User's Initial Query`

This assembled string becomes the `systemInstruction` for the Gemini SDK chat session.

## Assembly: Controls Generation

Template: `getControlsGeneratorPrompt()` → reads from `local_prompts` DB

Placeholders:
- `{{ORG_CONTEXT}}` → `buildOrgProfileText(orgContext)` — formats org profile as structured text (`server.js:1310–1332`)
- `{{REFERENCE_FILES}}` → formatted file contents
- `{{REQUIREMENTS}}` → numbered list with ref_id, framework, name, description, depth

## Assembly: Policy Extraction

Template: `getPolicyExtractorPrompt()` / `getFrameworkExtractorPrompt()` / `getRefControlsExtractorPrompt()`

The template is used as `systemInstruction`. A separate `userPrompt` is built with:
- Task description based on generation type
- Document names
- Exact URN values to use (`urn`, `locale`, `ref_id`, `name`, `provider`, `copyright`, `org-slug`, `lib-slug`)
- Configuration parameters

File Search grounding is attached so Gemini can read the uploaded documents directly.

## Admin-Overridable Prompt Fragments

Yes — all 5 DB-stored prompts are editable via the Prompts management UI. The `prompts.html` / `prompts.js` page and the SPA both allow editing local prompts and API prompts. Changes to local prompts take effect on the next AI call (no restart needed).

There is no concept of "steering prompt" or per-session prompt override beyond the user's typed query.
