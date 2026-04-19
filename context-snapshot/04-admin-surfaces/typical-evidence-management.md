# WathbahGRC Admin — Typical Evidence Management
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** UI and backend for managing typical evidence items on requirement nodes.

## Present in This Project — Workbench

### UI Route

`/workbench` → requirement detail → "Typical Evidence" section — `admin.html:767–785`

### Frontend

- Render: `renderEvidenceList()` — `admin.js:8778–8811`
- Add: `addEvidenceRow()` — `admin.js:8818–8838`
- Edit: `editEvidence(idx)` — `admin.js:8841–8855`
- Delete: `deleteEvidence(idx)` — `admin.js:8857–8870`
- Legacy migration: `migrateEvidenceFromText(text)` parses newline-delimited strings into structured items — `admin.js:8222–8243`
- Each row: scope toggle, E# badge, title, "evidence" badge, provenance badge, timestamps, edit/delete, Arabic + English (collapsed)

### Backend

Same as questions — evidence items are part of the node JSON, persisted via PATCH to Muraji API. Both `typical_evidence_items` (structured array) and `typical_evidence` (legacy text) are sent — `admin.js:9659–9660,9674–9675`.

### Permission Check

None beyond login.
