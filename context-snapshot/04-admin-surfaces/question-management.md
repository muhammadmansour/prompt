# WathbahGRC Admin — Question Management
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** UI and backend for managing questions on requirement nodes.

## Present in This Project — Workbench

### UI Route

`/workbench` → select framework → navigate tree → open assessable requirement → "Questions" section — `admin.html:747–765`

### Frontend

- Render: `renderQuestionsList()` — `admin.js:8661–8699`
- Add: `addQuestionRow()` opens inline editor, creates item with `provenance: 'manual'` — `admin.js:8701–8731`
- Edit: `editQuestion(qUrn)` opens inline editor — `admin.js:8733–8748`
- Delete: `deleteQuestion(qUrn)` with confirmation — `admin.js:8750–8758`
- Editor: `showItemEditor('question', ...)` — `admin.js:9049–9129`
- Each row shows: scope toggle, Q# badge, "question" type badge, provenance badge, updated_by + timestamp, edit/delete buttons, Arabic content (primary), English (collapsed)

### Backend

No dedicated question API. Questions are part of the requirement node JSON, persisted via:
- `PATCH /api/libraries/:id/controls` to Muraji API — `admin.js:9667–9681`
- Scope toggle persist: `persistScopeToggle()` — `admin.js:8968–8990`

### Permission Check

None beyond login. Any authenticated user can add/edit/delete questions.

## Also Present — Legacy UI

`index.html` + `app.js`: Select requirements → run AI analysis → review in modal → PATCH to Muraji — `app.js:1022–1155`. Simpler flow, no inline editing, no scope toggles.
