# WathbahGRC Admin — Approval Routing
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Approval workflows, routing logic, and task engines.

## Approval Workflows

### Policy Ingestion Approval

The only approval workflow in the project:

1. **Extract:** `POST /api/policy-collections/:id/extract` → status becomes `'generating'` then `'generated'`
2. **Review:** User views extracted policies/framework in the UI, can edit names/descriptions
3. **Approve:** `POST /api/policy-collections/:id/approve` → pushes to GRC → status becomes `'approved'` or `'approved_with_errors'`

**Routing logic:** None — any authenticated user can approve. No multi-level approval, no approval delegation, no rejection workflow.

### Controls Export

Similar two-step flow but without formal approval status:
1. Generate controls (stored in `cs_sessions.controls`)
2. Export to GRC (button click, no approval gate)

### Evidence Sign-Off / Risk Acceptance

**Not present.** No evidence sign-off, risk acceptance approval, or policy change approval workflows exist in this project.

## Task/Approval Engine

**None.** No state machine library, no FSM, no workflow engine. Status transitions are simple string assignments in SQL UPDATE statements.
