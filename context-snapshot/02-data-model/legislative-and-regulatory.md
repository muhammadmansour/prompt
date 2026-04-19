# WathbahGRC Admin — Legislative and Regulatory
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Any data structures for legislative updates, regulatory feeds, and impact classification.

## Not Present in This Project

There are **no** tables, models, or API endpoints for:
- Legislative updates or amendments
- Regulatory source feeds (Um Al-Qura, SAMA, NCA, SDAIA, MCIT)
- Impact classification (major / partial / new addition)
- Amendment tracking or versioning

**How confirmed:**
- Searched `server.js` `CREATE TABLE` blocks (lines 101–243): no table with `legislative`, `regulatory`, `amendment`, `impact`, or `classification` in the name
- Searched all `.js` files for `legislative`, `amendment`, `impact_level`, `regulatory_feed`, `uma_al_qura`, `sama`, `nca`: no matches in application code
- Only match: `org_contexts.regulatory_mandates` stores a JSON array of mandate *strings* (e.g. "NCA ECC", "SAMA Cyber") — `server.js:138,294,790` — this is a static profile field, not a feed/tracking system

## Closest Existing Structures

- **`regulatory_mandates`** on `org_contexts`: JSON array of string labels — used for context in AI prompts, not for tracking regulatory changes
- **Policy ingestion pipeline**: Processes policy *documents* but has no concept of legislative source, amendment type, or impact level

## Implication for v4

v4 Req #02 (legislative-impact classification) will need to build the entire legislative/regulatory data model from scratch. This includes: source registry, feed ingestion, amendment entity, impact level taxonomy, and the AI classification + human override workflow. None of this exists in either the local SQLite schema or the Muraji API integration.
