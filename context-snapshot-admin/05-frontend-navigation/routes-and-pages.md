# WathbahGRC Admin — Routes and Pages
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Top-level SPA routes, sidebar nav, and any hidden/gated routes.

## SPA Route Registry (admin.js:53–65)

| Route | Display Name | Sidebar Section |
|-------|-------------|-----------------|
| `/dashboard` | Dashboard | (top-level) |
| `/audit-sessions` | Audit Sessions | AI MANAGEMENT |
| `/audit-studio` | Audit Studio | AI MANAGEMENT |
| `/controls-studio` | Applied Controls Studio | AI TOOLS |
| `/merge-optimizer` | Control Merge Optimizer | AI TOOLS |
| `/policy-ingestion` | Organization Policy Ingestion | AI TOOLS |
| `/org-contexts` | Organization Contexts | AI TOOLS |
| `/workbench` | Workbench (labeled "Frameworks" in sidebar) | WORKBENCH |
| `/audit-log` | Audit Log (labeled "Assessments" in sidebar) | AUDIT LOG |
| `/prompts` | Prompts | CONFIGURATION |
| `/file-collections` | File Collections | CONFIGURATION |

## Sidebar Navigation (admin.html:28–121)

Section groups and their items (all English labels, no Arabic):
- **Dashboard** — standalone
- **AI MANAGEMENT** — Audit Sessions, Audit Studio
- **AI TOOLS** — Controls Studio, Merge Optimizer, Policy Ingestion, Org Contexts
- **WORKBENCH** — Frameworks (with jobs indicator badge)
- **AUDIT LOG** — Assessments
- **CONFIGURATION** — Prompts, File Collections
- **Footer** — Sign Out

## Server SPA Prefixes (server.js:1890,4933)

Both `SPA_PREFIXES` arrays include: `/`, `/dashboard`, `/audit-sessions`, `/audit-studio`, `/controls-studio`, `/merge-optimizer`, `/policy-ingestion`, `/org-contexts`, `/prompts`, `/file-collections`, `/workbench`, `/audit-log`

## Other HTML Pages (outside SPA)

| Page | Purpose |
|------|---------|
| `login.html` | Login form |
| `index.html` | Legacy requirement analyzer UI |
| `chat.html` | Auditor chat assistant |
| `prompts.html` | Standalone prompt editor (duplicate of SPA prompts page) |

## Hidden / Coming Soon / Feature-Flagged

None found. All routes in `PAGE_NAMES` are active with no gating, no "coming soon" placeholders, and no feature flags.
