# WathbahGRC Admin — Core Entities
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** All SQLite tables and their schemas in this project.

## Important Context

Canonical GRC entities (Framework, RequirementNode, Assessment, AppliedControl, Evidence, User, Role, Folder) live in the **main WathbahGRC** Django/PostgreSQL backend. This admin app only has **local SQLite tables** for workflow, caching, and session state. GRC entities appear here only as cached JSON blobs or UUID references.

## Local SQLite Tables (server.js:101–243)

### sessions
Chat sessions for the auditor assistant.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| context | TEXT | JSON blob, default `'{}'` |
| system_prompt | TEXT | Default `''` |
| cached_content_name | TEXT | Gemini cached content reference |
| created_at | TEXT | ISO timestamp |

### messages
Chat messages within sessions.
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Autoincrement |
| session_id | TEXT FK→sessions | |
| role | TEXT | `'user'` or `'ai'` (chat role, not RBAC) |
| text | TEXT | Message content |
| created_at | TEXT | |

### local_prompts
LLM prompt templates stored in DB, editable via admin UI.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| key | TEXT UNIQUE | e.g. `'chat_auditor'`, `'controls_generator'` |
| name | TEXT | Display name |
| content | TEXT | Full prompt template text |
| created_at | TEXT | |
| updated_at | TEXT | |

### org_contexts
Organization context profiles used for AI generation.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name_en / name_ar | TEXT | Bilingual org name |
| sector, sector_custom, size | TEXT | Classification |
| compliance_maturity | INTEGER | 1–5 scale |
| regulatory_mandates | TEXT | JSON array of strings |
| governance_structure | TEXT | |
| data_classification | TEXT | |
| geographic_scope | TEXT | |
| it_infrastructure | TEXT | |
| strategic_objectives | TEXT | JSON array |
| obligatory_frameworks | TEXT | JSON array |
| notes | TEXT | |
| is_active | INTEGER | Soft-enable flag |
| store_id | TEXT | Gemini File Search store reference |
| policies | TEXT | JSON (added by migration, server.js:300) |
| tracking_metrics | TEXT | JSON (migration, server.js:296) |
| risk_scenarios | TEXT | JSON (migration, server.js:302) |
| controls | TEXT | JSON (migration, server.js:304) |
| objective_framework_map | TEXT | JSON (migration, server.js:306) |
| created_at / updated_at | TEXT | |

### cs_sessions
Controls Studio sessions (multi-step wizard state).
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| name | TEXT | |
| status | TEXT | `'draft'` default |
| step | INTEGER | Wizard step counter |
| requirements | TEXT | JSON array |
| collections | TEXT | JSON array |
| selected_files / session_files | TEXT | JSON arrays |
| org_context | TEXT | JSON or null |
| controls | TEXT | JSON array of generated controls |
| framework | TEXT | |
| exported_control_ids | TEXT | JSON array (migration, server.js:281–286) |
| created_at / updated_at | TEXT | |

### policy_collections
Policy document collections for ingestion.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| name | TEXT | |
| description | TEXT | |
| store_id | TEXT | Gemini File Search store |
| status | TEXT | `'empty'`, `'processing'`, `'approved'`, etc. |
| config | TEXT | JSON generation config |
| extraction_result | TEXT | JSON (full extracted library) |
| policy_uuid | TEXT | (migration, server.js:259–265) |
| created_at / updated_at | TEXT | |

### policy_files
Files uploaded to policy collections.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| collection_id | TEXT FK→policy_collections | |
| name | TEXT | Original filename |
| mime_type | TEXT | |
| size | INTEGER | Bytes |
| local_path | TEXT | Disk path |
| store_doc_name | TEXT | Gemini store doc name |
| gemini_file_name / gemini_file_uri | TEXT | (migrations, server.js:268–278) |
| created_at | TEXT | |

### policy_generation_history
Audit trail of policy extraction/generation runs.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| collection_id | TEXT FK | |
| generation_type | TEXT | `'both'` default |
| status | TEXT | `'generated'` default |
| config | TEXT | JSON |
| summary | TEXT | JSON |
| library_urn / controls_count / nodes_count / confidence_score | various | |
| generation_time | TEXT | |
| source_file_count | INTEGER | |
| error_message | TEXT | |
| extraction_data | TEXT | JSON (migration) |
| policy_uuid | TEXT | (migration) |
| created_at | TEXT | |

### ciso_entity_cache
Cached GRC entities fetched from the remote WathbahGRC API.
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | Entity UUID |
| entity_type | TEXT | e.g. `'framework'`, `'requirement'`, `'risk_scenario'` |
| name / ref_id / status | TEXT | Summary fields |
| data | TEXT | Full entity JSON blob |
| fetched_at | TEXT | Auto-set to `datetime('now')` |
| | | UNIQUE(id, entity_type) |

### org_context_chain
Links between GRC entities resolved for an org context.
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Autoincrement |
| org_context_id | TEXT FK→org_contexts | |
| objective_uuid | TEXT | |
| framework_uuid | TEXT | |
| requirement_uuid | TEXT | |
| compliance_assessment_uuid | TEXT | |
| requirement_assessment_uuid | TEXT | |
| risk_scenario_uuid | TEXT | |
| applied_control_uuid | TEXT | |
| resolved_at | TEXT | |

## Soft Delete

No table uses soft-delete. `org_contexts.is_active` is the closest (disables, does not delete).

## No Local Tables For

Framework, RequirementNode, Assessment, RequirementAssessment, ReferenceControl, AppliedControl, Evidence, Task, Folder, Domain, User, Role — all live in the remote WathbahGRC backend.
