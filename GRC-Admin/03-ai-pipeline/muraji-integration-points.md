# WathbahGRC Admin — Muraji / Gemini Integration Points
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Every call site where code touches Gemini, and the Muraji API relationship.

## Clarification: "Muraji" in This Project

"Muraji AI" in this project is **not a separate service**. It refers to direct Gemini API calls made from `server.js`. The `@google/genai` SDK and raw REST calls to `generativelanguage.googleapis.com` are used in-process. There is no separate Muraji microservice consumed by this backend.

However, there IS an external **Muraji API** at `https://muraji-api.wathbahs.com` used by the **frontend only** for library/prompt CRUD operations.

## Server-Side Gemini Call Sites (server.js)

| # | Function | Line | Purpose | Input | Output | Sync/Async | Timeout |
|---|---|---|---|---|---|---|---|
| 1 | `callGeminiAPIForSingle()` | 1148 | Analyze one requirement | Requirement JSON + user prompt + context files | `{typical_evidence, questions, suggestions}` | Async (awaited in request) | None explicit |
| 2 | `callGeminiAPIForMultiple()` | 1265 | Batch analyze N requirements | Array of requirements | `{results: [{requirement, analysis}]}` | Async, 3 concurrent | None |
| 3 | `callGeminiForChunk()` | 1338 | Generate controls for ≤15 requirements | Requirements + org context + ref files | `{controls: [...]}` | Async | None |
| 4 | `generateControlsBatch()` | 1419 | Orchestrate chunked control generation | All requirements | Deduplicated controls | Async | None |
| 5 | `convertQuestionToControl()` | 1545 | Turn audit question into applied control | Question text + requirement + org context | Single control object | Async | None |
| 6 | Chat session `sendMessage()` | 2913 | Multi-turn audit chat | User message | AI reply text | Async | None |
| 7 | Policy extraction `generateContent()` | 3960 | Extract library from policy docs | User prompt + File Search grounding | Full CISO Assistant library JSON | Async | None |
| 8 | Policy chat `sendMessage()` | 4454 | Chat with policy documents | User message + File Search | AI text + grounding sources | Async | None |
| 9 | Org context chat `sendMessage()` | 3460 | Chat with org documents | User message + File Search | AI text + grounding sources | Async | None |
| 10 | `genai.caches.create()` | 2689 | Create cached content for session | System prompt + seed history | Cache resource name | Async | None |

## Server-Side Gemini File Search Store Operations

| Function | Line | Purpose |
|---|---|---|
| `createFileSearchStore()` | 1622 | Create a new store |
| `listFileSearchStores()` | 1637 | List all stores |
| `deleteFileSearchStore()` | 1647 | Delete a store |
| `uploadFileToStore()` | 1662 | Resumable upload of file to store |
| `listStoreDocuments()` | 1714 | List documents in a store |
| `deleteDocument()` | 1725 | Delete a document |
| `pollOperation()` | 1738 | Poll long-running operation |

## Frontend-Side Muraji API Calls

| File | Line | URL | Method | Purpose |
|---|---|---|---|---|
| `app.js` | 6 | `https://muraji-api.wathbahs.com/api/libraries` | GET | Fetch framework libraries for requirement selection |
| `app.js` | 1136 | `https://muraji-api.wathbahs.com/api/libraries/:id/controls` | PATCH | Write back questions + typical evidence |
| `prompts.js` | 6 | `https://muraji-api.wathbahs.com/api/prompts` | CRUD | Manage prompt templates on the Muraji API |

## "Start AI Analysis" Wiring

In the Audit Studio flow: User selects requirements → clicks "Start Audit" → frontend navigates to `/chat.html` → `chat.js` creates session via `POST /api/chat/sessions` (which builds system prompt + creates Gemini cache + initializes SDK chat) → sends first message via `POST /api/chat` → Gemini responds.

For the legacy flow (non-chat): `POST /api/analyze` calls `callGeminiAPIForMultiple()`.

## Retry Policy

**None.** Failed Gemini calls propagate the error to the client. No retries, no exponential backoff, no circuit breaker.
