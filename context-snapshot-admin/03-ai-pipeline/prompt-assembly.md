# WathbahGRC Admin — Prompt Assembly
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** How LLM prompts are built for requirement-level AI runs.

## Requirement Analysis Prompt

### Template Source

- File: `prompts/requirement-analyzer.txt` — loaded at server startup into `promptTemplate` variable — `server.js:938–946`
- **Not** stored in `local_prompts` SQLite table (unlike other templates)
- Contains placeholders: `{{REQUIREMENT}}`, `{{USER_PROMPT}}`, `{{CONTEXT_FILES}}`

### Assembly (server.js:1161–1164)

```
fullPrompt = promptTemplate
  .replace('{{REQUIREMENT}}', JSON.stringify(requirement, null, 2))
  .replace('{{USER_PROMPT}}', userPrompt || 'No additional context provided.')
  .replace('{{CONTEXT_FILES}}', contextFilesText)
```

### Fields in the Prompt

The `requirement` object sent from the workbench includes — `admin.js:9508–9516`:
- `ref_id`: Requirement reference ID
- `name`: Requirement name
- `description`: Requirement description text
- `nodeUrn`: Unique identifier
- `framework`: Framework name
- `framework_ref_id`: Framework reference
- `breadcrumb`: Parent section path

The `userPrompt` is the admin's steering instructions (or `'No additional context provided.'`).

Context files (when provided) are truncated to ~8000 chars each — `server.js:1150–1158`.

### What Is NOT in the Prompt

- Existing questions on the node
- Existing typical evidence items
- Admin notes
- AI scope flags
- Other nodes in the same section/framework

## Steering Prompt

- Admin can enter custom steering instructions (max 2000 chars) — `admin.html:718`
- Passed as `userPrompt` to `/api/analyze` — `admin.js:9518–9519`
- Persisted in `generation_metadata.steering_prompt` on generated items — `admin.js:9552`

## Other Prompt Templates

| Key | File | DB seed | Placeholders | Used by |
|-----|------|---------|-------------|---------|
| `chat_auditor` | `prompts/chat-auditor.txt` | `local_prompts` | (none — system instruction) | Chat sessions |
| `controls_generator` | `prompts/controls-generator.txt` | `local_prompts` | `{{ORG_CONTEXT}}`, `{{REFERENCE_FILES}}`, `{{REQUIREMENTS}}` | Controls Studio |
| `policy_extractor` | `prompts/policy-extractor.txt` | `local_prompts` | (inline task text) | Policy ingestion |
| `framework_extractor` | `prompts/framework-extractor.txt` | `local_prompts` | (inline task text) | Policy ingestion |
| `ref_controls_extractor` | `prompts/reference-controls-extractor.txt` | `local_prompts` | (inline task text) | Policy ingestion |

Seeding logic: `server.js:993–1060` — inserts from files if key doesn't exist in DB.

## Template Engine

None. All templates use simple `String.replace()` with `{{PLACEHOLDER}}` syntax. No Jinja, Handlebars, or template library.
