# WathbahGRC Admin — Policies and Risks
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Policy and Risk models, their relationships, and governance features.

## Policy Model

There is **no `Policy` model** in this project's local database. However, this project has a substantial **policy ingestion pipeline** that:

1. Accepts uploaded policy documents into `policy_collections` with associated `policy_files`
2. Extracts them via AI into CISO Assistant library format (framework + requirement_nodes + reference_controls)
3. Pushes the extracted library to WathbahGRC via `POST /api/stored-libraries/upload/` (`server.js:4238–4260`)
4. The reference controls become `AppliedControl` entries in GRC's Governance → Policies

The local tables (`policy_collections`, `policy_files`, `policy_generation_history`) track the extraction workflow, not the policies themselves. After approval, the policy lives in WathbahGRC.

### PolicyVersion / PolicyAmendment

**Not present.** `policy_generation_history` tracks extraction runs, but there's no concept of versioning a policy document after it's pushed to GRC. The `version` field in extracted libraries is always `1`.

## Risk Model

There is **no `Risk` model** in this project's local database. Risk scenarios are referenced by UUID in `org_contexts.risk_scenarios` (JSON array of GRC UUIDs). The chain resolution engine fetches risk scenario details from the GRC API (`/api/risk-scenarios/:uuid/`) and caches them in `ciso_entity_cache` (`server.js:591–597`).

Risk fields available from cached GRC data include `name`, `ref_id`, `status`, plus the full JSON blob. Inherent/residual scores, appetite, and heatmap coordinates are not explicitly handled by this project — they pass through as opaque JSON.

## Many-to-Many Relationships

- **Policy ↔ Risk:** Not modelled here. The chain resolution engine (`server.js:598–632`) builds a `riskToControls` mapping (risk → applied_controls) from the GRC API's `risk_scenario.applied_controls` field, then a reverse `controlToRisks` mapping. This is used to produce chain rows linking requirements → controls → risks.
- **Policy ↔ RequirementNode:** Handled via `reference_controls` URN arrays in the extracted library's requirement_nodes. After GRC import, CISO Assistant manages this relationship.
- **Risk ↔ Control:** Mapped during chain resolution via the GRC API's `applied_controls` field on risk scenarios.

## CISO Assistant Governance → Policies

This project treats GRC `applied-controls` as "policies" in one specific proxy endpoint (`/api/grc/policies` at `server.js:2115` fetches `applied-controls`). This conflation suggests that in the current CISO Assistant deployment, policies and applied controls share the same model.
