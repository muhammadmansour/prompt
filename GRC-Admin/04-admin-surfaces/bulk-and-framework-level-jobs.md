# WathbahGRC Admin — Bulk and Framework-Level Jobs
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Bulk operations and framework-wide generation jobs.

## Controls Studio: Batch Controls Generation

### How it works
1. User selects requirements (can be from multiple frameworks) and an org context
2. `POST /api/controls/generate` is called with all requirements
3. Server splits requirements into chunks of `CHUNK_SIZE = 15` (`server.js:1336`)
4. Each chunk is sent to Gemini sequentially (not concurrently between chunks)
5. Within each chunk, Gemini processes all 15 requirements in a single API call
6. Results are post-processed: deduplicated by name, linked requirements merged
7. Final controls returned to frontend for review

### Dispatch: Synchronous within HTTP request. No background job.
### Tracking: `cs_sessions` table stores the session state, including generated controls
### Resume: Not supported — if the request fails mid-batch, the user must re-run
### Rate limit: `CHUNK_SIZE = 15` requirements per Gemini call. No inter-chunk delay.
### Job cap: None — no limit on concurrent generation requests

## Policy Extraction: Generate for Collection

### How it works
1. `POST /api/policy-collections/:id/extract` triggered by user
2. All active files in the collection's Gemini File Search Store are included
3. Single Gemini `generateContent` call with File Search grounding
4. Response parsed into CISO Assistant library format
5. Stored in `policy_collections.extraction_result` and `policy_generation_history`

### Dispatch: Synchronous within HTTP request
### Tracking: `policy_generation_history` table records each run with metrics
### Resume: Not supported
### History: Yes — `GET /api/policy-collections/:id/history` returns all past runs

## Requirement Analysis: Batch Analysis

### How it works
1. `POST /api/analyze` with `requirements` array
2. Processed in batches of `CONCURRENCY_LIMIT = 3` parallel Gemini calls (`server.js:1268`)
3. Individual failures don't abort the batch — they return empty analysis with `success: false`

### Dispatch: Synchronous within HTTP request
### Tracking: None — no persistent record of the run

## Chain Resolution: Resolve Organization Context

### How it works
1. `POST /api/chain/resolve/:orgContextId`
2. Fetches objectives, frameworks, requirement nodes, compliance assessments, requirement assessments, risk scenarios, and applied controls from GRC API
3. Caches entities locally in `ciso_entity_cache`
4. Builds denormalized chain rows in `org_context_chain`

### Dispatch: Synchronous within HTTP request
### Auto-create: If no compliance assessment exists for a framework, one is automatically created via GRC API (`server.js:537–564`)
