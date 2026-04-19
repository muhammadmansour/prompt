# WathbahGRC Admin — Legislative and Regulatory
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Models for legislative updates, regulatory sources, amendment tracking.

## Status: NOT PRESENT

There is **no model, table, endpoint, or code** in this project that tracks:

- Legislative updates
- Regulatory source feeds
- Regulation amendments
- Impact classification (major / partial / new addition)
- Um Al-Qura, SAMA, NCA, SDAIA, MCIT ingestion pipelines

### How I confirmed:

Searched across all project files for: `legislative`, `regulatory_update`, `amendment`, `um_al_qura`, `sama`, `nca`, `sdaia`, `mcit`, `regulation_feed`, `impact_classification`, `regulatory_source`. Zero matches.

The only regulatory-adjacent concept is `org_contexts.regulatory_mandates` — a JSON array of free-text strings listing which regulations apply to an organization (e.g., "NCA ECC", "SAMA CSF"). This is a static configuration, not a live feed.

**v4 Req #02 will need to build this from scratch** in either this project or WathbahGRC.
