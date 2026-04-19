# WathbahGRC Admin — Routes and Pages
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Top-level navigation, SPA routes, and hidden/coming-soon pages.

## SPA Routes (served by `admin.html`)

The server matches these prefixes and serves `admin.html` for all of them (`server.js:4870`):

| Route | Purpose | Notes |
|---|---|---|
| `/` | Redirects to `/dashboard` | |
| `/dashboard` | Main dashboard | Overview of sessions, org contexts, etc. |
| `/audit-sessions` | Audit session list | Lists past chat-based audit sessions |
| `/audit-studio` | Audit Studio | Main workflow: select requirements → chat with AI |
| `/controls-studio` | Controls Studio | Generate applied controls for requirements |
| `/merge-optimizer` | Merge Optimizer | ⚠ Route registered but purpose unclear from code alone |
| `/policy-ingestion` | Policy Ingestion | Upload policy docs → AI extract → push to GRC |
| `/org-contexts` | Organization Contexts | Manage org profiles for contextualized AI |
| `/prompts` | Prompt Templates | Edit local and API prompts |
| `/file-collections` | File Collections | Manage Gemini File Search Stores |

## Legacy Standalone Pages

| File | URL | Purpose |
|---|---|---|
| `index.html` | `/index.html` | Legacy requirement selector (Audit Studio v1) |
| `chat.html` + `chat.js` | `/chat.html` | Chat page for audit sessions |
| `prompts.html` + `prompts.js` | `/prompts.html` | Legacy prompt management |
| `login.html` + `login.js` + `login.css` | `/login.html` | Login page (still active, not SPA) |

## Top-Level Navigation (Sidebar)

Based on the SPA route structure, the sidebar likely includes:
- Dashboard
- Audit Studio / Audit Sessions
- Controls Studio
- Policy Ingestion
- Organization Contexts
- File Collections
- Prompts
- Merge Optimizer

⚠ Arabic sidebar labels cannot be confirmed without reading the full `admin.html` (57KB). The frontend code in `chat.js` and `app.js` contains no Arabic UI text.

## Hidden / Coming Soon

- **Merge Optimizer** — Route is registered but no dedicated backend endpoint found. This may be a frontend-only feature or a planned placeholder.
- No `<!-- coming soon -->` or disabled menu items found in `app.js` or `chat.js`. The full `admin.html` (57KB) was not fully parsed.
