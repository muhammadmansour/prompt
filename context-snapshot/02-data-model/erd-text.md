# WathbahGRC Admin — ERD (Text)
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Plain-text ER diagram of local SQLite tables and their key external references.

```mermaid
erDiagram
    sessions {
        TEXT id PK
        TEXT context
        TEXT system_prompt
        TEXT cached_content_name
        TEXT created_at
    }
    messages {
        INTEGER id PK
        TEXT session_id FK
        TEXT role
        TEXT text
        TEXT created_at
    }
    sessions ||--o{ messages : has

    local_prompts {
        TEXT id PK
        TEXT key UK
        TEXT name
        TEXT content
        TEXT created_at
        TEXT updated_at
    }

    org_contexts {
        TEXT id PK
        TEXT name_en
        TEXT name_ar
        TEXT regulatory_mandates
        TEXT policies
        TEXT risk_scenarios
        TEXT controls
        TEXT objective_framework_map
        TEXT store_id
        INTEGER is_active
    }

    org_context_chain {
        INTEGER id PK
        TEXT org_context_id FK
        TEXT objective_uuid
        TEXT framework_uuid
        TEXT requirement_uuid
        TEXT compliance_assessment_uuid
        TEXT requirement_assessment_uuid
        TEXT risk_scenario_uuid
        TEXT applied_control_uuid
    }
    org_contexts ||--o{ org_context_chain : resolves

    cs_sessions {
        TEXT id PK
        TEXT name
        TEXT status
        INTEGER step
        TEXT requirements
        TEXT controls
        TEXT org_context
        TEXT exported_control_ids
    }

    policy_collections {
        TEXT id PK
        TEXT name
        TEXT store_id
        TEXT status
        TEXT config
        TEXT extraction_result
        TEXT policy_uuid
    }
    policy_files {
        TEXT id PK
        TEXT collection_id FK
        TEXT name
        TEXT local_path
        TEXT gemini_file_uri
    }
    policy_generation_history {
        TEXT id PK
        TEXT collection_id FK
        TEXT generation_type
        TEXT status
        TEXT extraction_data
        TEXT policy_uuid
    }
    policy_collections ||--o{ policy_files : contains
    policy_collections ||--o{ policy_generation_history : tracks

    ciso_entity_cache {
        TEXT id
        TEXT entity_type
        TEXT data
        TEXT fetched_at
    }
```

## External References (not in local DB)

The following UUIDs in `org_context_chain` and `ciso_entity_cache` reference entities in the **main WathbahGRC** PostgreSQL database:

- `framework_uuid` → WathbahGRC `Framework`
- `requirement_uuid` → WathbahGRC `RequirementNode`
- `compliance_assessment_uuid` → WathbahGRC `ComplianceAssessment`
- `requirement_assessment_uuid` → WathbahGRC `RequirementAssessment`
- `risk_scenario_uuid` → WathbahGRC `RiskScenario`
- `applied_control_uuid` → WathbahGRC `AppliedControl`
- `objective_uuid` → WathbahGRC `OrganisationObjective`

## Muraji API Objects (not in local DB)

Questions, typical evidences, and admin notes on requirement nodes are stored as JSON properties within Muraji library documents, not in local SQLite tables. See `02-data-model/requirement-node-and-children.md`.
