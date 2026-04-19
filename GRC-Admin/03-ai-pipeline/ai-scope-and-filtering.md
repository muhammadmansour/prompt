# WathbahGRC Admin — AI Scope and Filtering
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Mechanisms that control which items flow into the AI prompt.

## Status: NO FILTERING MECHANISM

There is **no field, flag, tag, or status** that controls whether individual questions, evidence items, or other data points are included in or excluded from the AI prompt.

### What IS included:

- **Audit Studio:** All selected requirements (user multi-selects from the framework tree), all selected File Search collections/files, all uploaded context files, and the user's typed query. The user's selection IS the scope — there's no secondary filter.

- **Controls Studio:** All requirements passed to the session, plus the org context profile. No per-requirement inclusion toggle.

- **Policy Extraction:** All active files in the collection's Gemini File Search Store. Optionally filtered by `selectedFileIds` in the request body (`server.js:3889–3894`), but this is a per-extraction-run choice, not a persistent flag on the files.

### What COULD exist but doesn't:

- No `include_in_prompt` boolean on questions or evidence
- No `hidden_from_ai` flag on any entity
- No "AI scope" concept at the requirement level
- No tagging system that controls prompt inclusion
- No collection membership that determines AI visibility

⚠ For v4, if requirements can have hundreds of questions/evidences, a scoping mechanism will be essential to control prompt size and cost.
