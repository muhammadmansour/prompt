# WathbahGRC Admin — Muraji Integration Points
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Every call site where code touches Muraji, Gemini, or File Search.

## Muraji API (Separate HTTP Service)

Muraji is a **separate HTTP API** at `https://muraji-api.wathbah.dev`, called directly from browser JS (not proxied through this Node server).

| Caller | File | Lines | Method | Path | Purpose |
|--------|------|-------|--------|------|---------|
| Workbench | `admin.js` | 8159 | — | Base URL constant `MURAJI_API` | |
| Load frameworks | `admin.js` | 8355 | GET | `/api/libraries` | List all framework libraries |
| Load library detail | `admin.js` | 8401 | GET | `/api/libraries` | Fetch single library |
| Save requirement | `admin.js` | 9667–9681 | PATCH | `/api/libraries/:id/controls` | Write questions/evidence/notes/audit_log |
| Scope toggle persist | `admin.js` | 8973–8986 | PATCH | `/api/libraries/:id/controls` | Immediate persist of scope change |
| Bulk AI save | `admin.js` | 10050–10063 | PATCH | `/api/libraries/:id/controls` | Per-node save after bulk generation |
| Legacy analyzer | `app.js` | 1136–1145 | PATCH | `/api/libraries/:id/controls` | Write AI results from legacy UI |
| Prompt CRUD | `prompts.js` | 6,46 | GET/PUT | `/api/prompts` | Manage prompt templates on Muraji |
| Admin prompts | `admin.js` | 3197 | — | `/api/prompts` | Prompt management in admin SPA |

## Gemini API (Server-Side)

All Gemini calls go through `server.js`. No browser-to-Gemini calls.

| Function | Lines | Input | Output | Async | Timeout |
|----------|-------|-------|--------|-------|---------|
| `callGeminiAPIForSingle` | 1148–1262 | `{ requirement, userPrompt, apiKey, contextFiles }` | `{ typical_evidence[], questions[], suggestions[] }` | async | None |
| `callGeminiAPIForMultiple` | 1265–1304 | `requirements[]` + same | `{ results: [{ requirement, analysis, success }] }` | async | 3 parallel |
| `callGeminiForChunk` | 1338–1417 | `chunkRequirements, orgContext, contextFiles, apiKey` | `controls[]` | async | None |
| `generateControlsBatch` | 1419–1542 | Requirements + org context | `{ controls, progress }` | async | Sequential chunks |
| `convertQuestionToControl` | 1545–1616 | Single question + context | `control` object | async | None |
| File Search CRUD | 1623–1735 | Store/doc operations | Store/doc metadata | async | None |
| `pollOperation` | 1738–1751 | Operation name | Completed operation | async | 120s max, 3s poll |
| Chat session create | 2752–2835 | Cache config + chat params | `sessionId, cachedContent` | async | Cache TTL 3600s |
| Chat send message | 2976 | `message` | `{ reply }` | async | None |
| Org context chat | 3513–3523 | `message, storeIds, systemInstruction` | `message, sources` | async | None |
| Policy extraction | 4023–4032 | `contents, config, tools: [fileSearch]` | Extracted library JSON | async | None |
| Policy/collection chat | 4503–4517 | Same as org chat | `message, sources` | async | None |

## "Start AI Analysis" in This Project

The workbench "Generate with AI" button calls `POST /api/analyze` on this Node server — `admin.js:9534–9537`. The server then calls `callGeminiAPIForSingle` — `server.js:1948`. The response includes generated questions and typical evidence in `data`, plus `meta` with model name and template version — `server.js:1954–1960`.
