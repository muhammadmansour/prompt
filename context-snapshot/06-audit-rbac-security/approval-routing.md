# WathbahGRC Admin — Approval Routing
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Approval workflows, routing logic, and task/state machines.

## Policy Ingestion Approval

The only approval-like workflow in this project:

- **Status flow:** `'empty'` → `'processing'` → `'generated'` → `'approved'` / `'approved_with_errors'`
- **Approve endpoint:** `POST /api/policy-collections/:id/approve` — `server.js:4205–4376`
- **What it does:** Validates extraction result → uploads to GRC as stored library → updates status
- **No routing logic:** Any authenticated user can approve. No escalation, delegation, or multi-step approval.
- **No authority lookup:** No decision type → role mapping. No RACI check.

## Controls Studio Export

- "Export to GRC" pushes applied controls — `server.js:2330–2551`
- No approval step — direct write using the logged-in user's GRC token

## Workbench Save

- Direct save, no approval step — `admin.js:9652–9694`

## Task / Approval Engine

Not present. No state machine library, no FSM, no task queue, no approval table, no status enum with role-based transitions.

## Implication for v4

The Authority Matrix and Impact Criteria features will need a complete approval routing engine:
- Decision type → RACI chain resolution
- Impact level → decision type mapping
- Task creation and assignment
- Status transitions with role-based permissions
- Assignment transparency ("why you were assigned")

None of this infrastructure exists today.
