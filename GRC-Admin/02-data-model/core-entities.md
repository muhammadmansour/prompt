# WathbahGRC Admin — Core Entities
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Local SQLite tables in this project and their structure.

## Important Context

This project does NOT own the canonical GRC data model. The main GRC entities (`Framework`, `RequirementNode`, `Assessment`, `RequirementAssessment`, `ReferenceControl`, `AppliedControl`, `Evidence`, `Task`, `Folder`, `User`, `Role`) live in **WathbahGRC** (CISO Assistant, Django/PostgreSQL). This Admin app has its own SQLite database for session/workflow state and caches GRC entities locally.

## Local SQLite Tables (`sessions.db`)

### `sessions` — Chat/audit session state
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| context | TEXT | JSON blob: `{requirements, fileResources, collections, query, contextFiles, orgContext}` |
| system_prompt | TEXT | Full assembled system instruction sent to Gemini |
| cached_content_name | TEXT | Gemini cached content resource name (TTL 1h) |
| created_at | TEXT | ISO timestamp |

### `messages` — Chat history
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| session_id | TEXT FK | References `sessions.id` |
| role | TEXT | `'user'` or `'ai'` |
| text | TEXT | Message content |
| created_at | TEXT | ISO timestamp |

### `local_prompts` — Prompt template storage
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | e.g. `'local-chat-auditor'` |
| key | TEXT UNIQUE | e.g. `'chat_auditor'`, `'controls_generator'`, `'policy_extractor'`, `'framework_extractor'`, `'ref_controls_extractor'` |
| name | TEXT | Display name |
| content | TEXT | Full prompt template text |
| created_at / updated_at | TEXT | ISO timestamps |

### `org_contexts` — Organization profiles
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name_en / name_ar | TEXT | Bilingual name |
| sector / sector_custom | TEXT | Industry vertical |
| size | TEXT | `'small'`, `'medium'`, `'large'`, `'enterprise'` |
| compliance_maturity | INTEGER | 1–5 scale |
| regulatory_mandates | TEXT | JSON array of strings |
| governance_structure | TEXT | Free text |
| data_classification | TEXT | Free text |
| geographic_scope | TEXT | Free text |
| it_infrastructure | TEXT | Free text |
| strategic_objectives | TEXT | JSON array of UUIDs (references GRC organisation-objectives) |
| obligatory_frameworks | TEXT | JSON array of UUIDs (references GRC frameworks) |
| policies | TEXT | JSON array |
| tracking_metrics | TEXT | JSON array |
| risk_scenarios | TEXT | JSON array of UUIDs (references GRC risk-scenarios) |
| controls | TEXT | JSON array of UUIDs (references GRC applied-controls) |
| objective_framework_map | TEXT | JSON object `{objectiveUUID: [frameworkUUID, ...]}` |
| notes | TEXT | Free text |
| store_id | TEXT | Gemini File Search Store ID for org-level documents |
| is_active | INTEGER | Boolean (0/1) |
| created_at / updated_at | TEXT | |

### `cs_sessions` — Controls Studio wizard sessions
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name / status / step | TEXT/TEXT/INTEGER | Workflow state |
| requirements | TEXT | JSON array of selected requirements |
| collections / selected_files / session_files | TEXT | JSON arrays of file references |
| org_context | TEXT | JSON blob of org profile snapshot |
| controls | TEXT | JSON array of generated controls |
| framework | TEXT | Framework identifier |
| exported_control_ids | TEXT | JSON array of GRC UUIDs after export |
| created_at / updated_at | TEXT | |

### `policy_collections` — Policy ingestion collections
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | e.g. `'pc-<uuid>'` |
| name / description | TEXT | User-given name |
| store_id | TEXT | Gemini File Search Store ID |
| status | TEXT | `'empty'`, `'ready'`, `'generating'`, `'generated'`, `'approved'` |
| config | TEXT | JSON: generation settings |
| extraction_result | TEXT | JSON: full AI extraction output |
| policy_uuid | TEXT | GRC policy UUID after approval |
| created_at / updated_at | TEXT | |

### `policy_files` — Files in policy collections (local tracking)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| collection_id | TEXT FK | References `policy_collections.id` |
| name / mime_type / size / local_path | Various | File metadata |
| store_doc_name | TEXT | Gemini document resource name |
| gemini_file_name / gemini_file_uri | TEXT | Gemini File API references |
| created_at | TEXT | |

### `policy_generation_history` — Extraction run history
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | e.g. `'gh-<uuid>'` |
| collection_id | TEXT FK | |
| generation_type | TEXT | `'framework'`, `'controls'`, `'both'` |
| status | TEXT | `'generated'`, `'failed'`, `'approved'`, `'approved_with_errors'` |
| config / summary | TEXT | JSON blobs |
| library_urn | TEXT | URN after approval |
| controls_count / nodes_count / confidence_score | INTEGER | Metrics |
| generation_time | TEXT | e.g. `'12.3s'` |
| source_file_count | INTEGER | |
| error_message | TEXT | |
| extraction_data | TEXT | Full JSON extraction result |
| policy_uuid | TEXT | GRC policy UUID |
| created_at | TEXT | |

### `ciso_entity_cache` — Local cache of GRC entities
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | GRC entity UUID |
| entity_type | TEXT | `'objective'`, `'framework'`, `'requirement'`, `'compliance_assessment'`, `'requirement_assessment'`, `'risk_scenario'`, `'applied_control'` |
| name / ref_id / status | TEXT | Cached fields |
| data | TEXT | Full JSON blob of the entity |
| fetched_at | TEXT | Cache timestamp — TTL is 30 minutes (`server.js:415`) |

### `org_context_chain` — Resolved GRC relationship chain
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| org_context_id | TEXT FK | References `org_contexts.id` |
| objective_uuid / framework_uuid / requirement_uuid / compliance_assessment_uuid / requirement_assessment_uuid / risk_scenario_uuid / applied_control_uuid | TEXT | GRC entity UUIDs — each row is one path through the chain |
| resolved_at | TEXT | |

## Soft-Delete Behavior

None. All deletes are hard deletes (`DELETE FROM ...`). No `deleted_at` or `is_deleted` fields.

## JSON Fields

Extensively used. Most "relation" fields store JSON arrays of UUIDs or JSON objects rather than using foreign keys to normalized tables.
