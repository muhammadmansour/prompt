# WathbahGRC Admin — ERD (Text)
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Plain-text ER diagram of the local SQLite tables.

```mermaid
erDiagram
    sessions ||--o{ messages : "has many"
    sessions {
        text id PK
        text context
        text system_prompt
        text cached_content_name
        text created_at
    }
    messages {
        int id PK
        text session_id FK
        text role
        text text
        text created_at
    }

    local_prompts {
        text id PK
        text key UK
        text name
        text content
        text created_at
        text updated_at
    }

    org_contexts ||--o{ org_context_chain : "resolves to"
    org_contexts {
        text id PK
        text name_en
        text name_ar
        text sector
        text size
        int compliance_maturity
        text strategic_objectives "JSON array of GRC UUIDs"
        text obligatory_frameworks "JSON array of GRC UUIDs"
        text risk_scenarios "JSON array of GRC UUIDs"
        text controls "JSON array of GRC UUIDs"
        text objective_framework_map "JSON obj"
        text store_id "Gemini File Search Store"
    }

    org_context_chain {
        int id PK
        text org_context_id FK
        text objective_uuid
        text framework_uuid
        text requirement_uuid
        text compliance_assessment_uuid
        text requirement_assessment_uuid
        text risk_scenario_uuid
        text applied_control_uuid
        text resolved_at
    }

    ciso_entity_cache {
        text id PK
        text entity_type
        text name
        text ref_id
        text status
        text data "Full JSON blob"
        text fetched_at
    }

    cs_sessions {
        text id PK
        text name
        text status
        int step
        text requirements "JSON array"
        text controls "JSON array"
        text org_context "JSON blob"
        text exported_control_ids "JSON array"
    }

    policy_collections ||--o{ policy_files : "has many"
    policy_collections ||--o{ policy_generation_history : "has many"
    policy_collections {
        text id PK
        text name
        text store_id "Gemini File Search Store"
        text status
        text config "JSON"
        text extraction_result "JSON"
        text policy_uuid
    }

    policy_files {
        text id PK
        text collection_id FK
        text name
        text gemini_file_name
        text gemini_file_uri
    }

    policy_generation_history {
        text id PK
        text collection_id FK
        text generation_type
        text status
        int confidence_score
        text extraction_data "Full JSON"
        text library_urn
        text policy_uuid
    }
```

## Notes

- Most "relationships" between this app and GRC entities are via UUID strings stored in JSON arrays, not via foreign keys.
- The `org_context_chain` table is a denormalized join table that materializes the full path: Objective → Framework → Requirement → ComplianceAssessment → RequirementAssessment → RiskScenario → AppliedControl.
- The `ciso_entity_cache` table is a local TTL cache (30 min) of GRC API responses, keyed by `(id, entity_type)`.
