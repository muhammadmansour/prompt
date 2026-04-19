# WathbahGRC Admin — Bulk and Framework-Level Jobs
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Framework-level generation jobs and how they're dispatched/tracked.

## Workbench Bulk Generation

### Dispatch

- Status dashboard (`/workbench` → Status tab) allows selecting multiple requirements — `admin.html:665–679`
- Two modes: "Generate (empty only)" or "Re-generate (replace)" — `admin.html:645–648`
- Optional bulk steering prompt (max 2000 chars) — `admin.html:655–658`
- `runBulkGeneration()` — `admin.js:9881–10091`

### Execution

- **Sequential `for` loop** over selected nodes — `admin.js:9940–10069`
- Each node: `fetch('/api/analyze', ...)` → process response → PATCH to Muraji
- No parallelism in bulk (one node at a time)
- Abort flag: `wbBulkAbort` — `admin.js:8165,9941`

### Tracking

- In-browser job tracker: `wbJobs` Map, `createJob()`, `updateJobProgress()`, `completeJob()` — `admin.js:9133–9214`
- Jobs indicator in sidebar: `wb-jobs-indicator` — `admin.html:86–92`
- Progress bar in status view — `admin.html:660–663`
- Results table (per-requirement success/failure with counts) — `admin.html:664`, `admin.js:10081–10084`
- Toast notification on completion — `admin.js:9164–9168`

### Rate Limits / Caps

- No job queue or rate limit on bulk (fires requests sequentially)
- Server-side `CONCURRENCY_LIMIT = 3` only applies to the `/api/analyze` batch endpoint, not workbench bulk — `server.js:1268`
- No max-requirements-per-run cap in the UI or backend

### Background Behavior

- Single-request generation moves to "background" (in-browser) after `WB_FOREGROUND_TIMEOUT = 15000` ms — `admin.js:9216,9523–9531`
- Bulk runs always show as a background job immediately — `admin.js:9918`
- "Background" means the browser continues rendering; the request is still a standard `fetch` — no server-side job queue or worker process

## Other Bulk Operations

### Controls Generation

- `POST /api/controls/generate` — `server.js:1969–2000`
- `generateControlsBatch` processes in chunks of 15 — `server.js:1336,1419–1542`
- Synchronous within the HTTP request (no background worker)

### Policy Extraction

- `POST /api/policy-collections/:id/extract` — `server.js:3911+`
- Processes selected files via Gemini, stores result in `extraction_result`
- History row in `policy_generation_history` — `server.js:4170–4178`
- No resume capability — if the request fails, extraction must be restarted
