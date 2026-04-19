# WathbahGRC Admin — Admin Notes or Equivalent
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Free-form admin content attached to requirement nodes.

## Present in This Project — Workbench

### UI Route

`/workbench` → requirement detail → "Admin Notes" section — `admin.html:787–799`

### Features

- Subtype taxonomy: Note, Auditor Comment, Internal Guidance, Historical Finding, Other — `admin.js:8167–8173`
- Custom subtype label for "Other" (max 60 chars) — `admin.js:9075,9119–9122`
- Arabic content required, English optional — `admin.js:9087,9113`
- AI scope default: OFF — `admin.js:8922`
- Provenance always `'manual'` — notes are never AI-generated — `admin.js:8923`
- No "Re-generate" button on notes section (unlike questions/evidence) — `admin.html:787–799`

### CRUD

- Add: `addNoteRow()` — `admin.js:8911–8931`
- Edit: `editNote(idx)` — `admin.js:8934–8949`
- Delete: `deleteNote(idx)` — `admin.js:8951–8963`
- Render: `renderNotesList()` — `admin.js:8875–8908`

### Backend

Stored as `admin_notes` array on the requirement node JSON, persisted via PATCH to Muraji API — `admin.js:9662,9677`.
