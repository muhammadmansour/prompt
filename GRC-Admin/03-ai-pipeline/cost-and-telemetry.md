# WathbahGRC Admin — Cost and Telemetry
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Token counting, cost tracking, rate limiting, and optimization strategies.

## Token Counting

**Not present.** No code reads `usageMetadata`, `promptTokenCount`, or `candidatesTokenCount` from Gemini responses. The token counts are available in the API response but are never extracted or logged.

## Cost Tracking

**Not present.** No cost-per-run, cost-per-framework, or cost-per-client tracking. No Gemini pricing assumptions in comments or constants.

## Rate Limiting

**Not present.** No rate limiting on the server side. The only concurrency control is `CONCURRENCY_LIMIT = 3` for batch requirement analysis (`server.js:1268`) and `CHUNK_SIZE = 15` for controls generation (`server.js:1336`). These are throughput limits, not cost guards.

## Budget Guardrails

**Not present.** No maximum spend, no daily/monthly budget cap, no per-organization quota.

## RAG / Sampling / Top-N Strategies

**Gemini File Search** is the only RAG mechanism. When collections are selected for an audit session or policy extraction, the store names are passed as `fileSearch.fileSearchStoreNames` in the Gemini tools configuration. Gemini handles retrieval internally.

For context files uploaded directly (not via File Search), content is truncated to **8,000 characters per file** (`server.js:1154`, `server.js:2672`). This is the only cost-reduction measure.

## Output Token Scaling

Controls generation scales `maxOutputTokens` based on requirement count: `Math.min(65536, Math.max(8192, chunkRequirements.length * 1500))` (`server.js:1370`). Other endpoints use fixed values (4096 for analysis, 8192 for chat, 65536 for policy extraction).

## Gemini Cached Content

Audit chat sessions create a Gemini cached content resource with 1-hour TTL (`server.js:2689–2703`). This reduces input token costs for multi-turn conversations by caching the system instruction and seed history. If cache creation fails, the system falls back to sending the full system instruction on every turn.

## What's Missing for v4

- No per-org or per-user usage tracking
- No way to attribute costs to specific frameworks or clients
- No dashboard or reporting on AI usage
- No alerts for unusual consumption patterns
