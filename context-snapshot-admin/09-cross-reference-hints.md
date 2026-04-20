# WathbahGRC Admin — Cross-Reference Hints
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Questions that can only be answered by looking at the sibling WathbahGRC project.

## Questions for the WathbahGRC Snapshot

1. **Does WathbahGRC have its own question/evidence management UI?** This admin app manages questions and typical evidences via the Workbench, writing to Muraji. Does the main GRC product also display or edit these, or does it only consume them read-only during assessments?

2. **How does WathbahGRC render the `audit_log` entries sent by this admin app?** The workbench PATCHes `audit_log` arrays to Muraji (`admin.js:9678`). Where do these appear in the main GRC product? Is there a unified audit viewer?

3. **Does WathbahGRC own the `RequirementNode` model, or does Muraji?** This admin app reads requirement nodes from the Muraji API (`/api/libraries`), not from the GRC API. But GRC has `/api/requirement-nodes/`. Are these the same data, or two separate stores?

4. **What is the GRC IAM role model?** This admin app has no RBAC — it relies on GRC for authentication. Does GRC define roles (Admin, Analyst, Reviewer, etc.) that could be surfaced here for the Authority Matrix feature?

5. **Does WathbahGRC have any approval workflow?** This admin app has only a minimal policy-approve flow. Does the main product have task assignment, approval routing, or a state machine for requirement assessments, risk acceptance, or evidence sign-off?

6. **Where is the `muraji-ai` service account provisioned?** This admin app uses `'muraji-ai'` as a string label for AI-authored content (`admin.js:8175`). Is there a matching user record in WathbahGRC IAM? If not, how are AI writes attributed in the GRC audit log?

7. **Does WathbahGRC have policy versioning?** This admin app processes policy *documents* (PDFs) but has no `PolicyVersion` or `PolicyAmendment` model. Does the main GRC product track policy versions, amendments, or approval history?

8. **Does WathbahGRC consume `included_in_ai_scope` flags?** This admin app sets scope flags on questions and evidence. Does the main GRC product read these flags for any purpose (e.g., filtering what appears in assessment forms, controlling AI prompts)?

9. **Is framework YAML ingestion done in GRC or in Muraji?** This admin app reads framework data from Muraji's `/api/libraries` endpoint. Where are framework YAMLs originally uploaded and parsed — in the GRC Django app, or in the Muraji service?

10. **Does WathbahGRC have cost/telemetry for AI runs?** This admin app tracks nothing about AI cost. Does the main product log token usage, run costs, or model metadata from Muraji AI calls?
