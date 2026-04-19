# WathbahGRC Admin — Admin Notes or Equivalent
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Any free-form admin content attached to requirements.

## Status: NOT PRESENT

There is no concept of admin notes, internal comments, auditor comments, or historical findings attached to individual requirements in this project.

### How I confirmed:
- Searched for `admin_note`, `internal_comment`, `auditor_comment`, `finding`, `annotation` (as a user-facing concept) across all files
- The only `annotation` field is in AI-extracted requirement nodes — it stores machine-generated extraction metadata (`{"confidence": ..., "source_page": ..., "source_section": ...}`), not human-written notes
- `org_contexts.notes` is organization-level, not requirement-level
- Chat messages (`messages` table) are conversational, not structured notes

### Where this might belong:
This feature likely belongs in **WathbahGRC** (CISO Assistant), where `RequirementAssessment` objects exist and could carry an admin notes field. Or it could be built as a new capability in this Admin app.
