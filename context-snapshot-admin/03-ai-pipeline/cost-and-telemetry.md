# WathbahGRC Admin — Cost and Telemetry
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Token counting, cost tracking, rate limiting, and budget guardrails.

## Token Counting

Not implemented. No code reads `usageMetadata` from Gemini API responses. The response parsing extracts only `candidates[0].content.parts[0].text` — `server.js:1195–1196`.

## Cost Tracking

Not implemented. No dollar cost calculation, no per-run cost logging, no per-framework or per-client cost aggregation.

## Rate Limiting

- **`CONCURRENCY_LIMIT = 3`** for parallel single-requirement calls in batch mode — `server.js:1268`
- **`CHUNK_SIZE = 15`** for controls generation batch splits — `server.js:1336`
- **No HTTP-level rate limiting** on incoming requests (no middleware, no token bucket)
- **No per-user or per-org quota** system

## Budget Guardrails

None. No max-cost-per-run, no daily spend cap, no warning thresholds.

## maxOutputTokens Settings

| Context | Value | Location |
|---------|-------|----------|
| Requirement analysis | 4096 | `server.js:1176` |
| Controls generation | 8192–65536 (scaled by chunk size) | `server.js:1369–1378` |
| Question-to-control | 4096 | `server.js:1588` |
| Chat | 8192 | `server.js:2798` |
| Policy extraction | 65536 | `server.js:4030` |

## Gemini Pricing Assumptions

No pricing constants, cost tables, or pricing model references in the codebase.

## RAG / Sampling / Cost Reduction

- Context files truncated to ~8000 chars each — `server.js:1150–1158`
- Request body max 150MB — `server.js:1120–1125`
- No top-N sampling, no embedding-based retrieval, no prompt compression
- File Search (Gemini) handles RAG internally for chat features (stores created via `/api/collections`)
