# WathbahGRC Admin — External Sources and Feeds
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** RSS feeds, web scrapers, and external data source integrations.

## Not Present in This Project

There are no:
- RSS feed readers or parsers
- Web scrapers
- Scheduled jobs pulling from external sources
- API clients for Um Al-Qura, SAMA, NCA, SDAIA, or MCIT
- Regulatory feed ingestion pipelines
- News or update monitoring services

**How confirmed:**
- Searched all `.js` files for: `rss`, `feed`, `scrape`, `cron`, `schedule`, `uma_al_qura`, `sama`, `nca`, `sdaia`, `mcit` — no matches
- No `node-cron`, `agenda`, `bull`, or scheduler library in `package.json`
- `org_contexts.regulatory_mandates` stores static string labels, not live feed data — `server.js:138`

## Implication for v4

v4 Req #02 (legislative impact tracking) will need external source integration built from scratch — feed ingestion, parsing, change detection, and notification pipeline.
