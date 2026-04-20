# WathbahGRC Admin — External Dependencies
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** All third-party services this codebase talks to.

## Services

### Google Gemini (Generative Language API)

- **SDK:** `@google/genai` — `server.js:5`
- **REST:** Direct `fetch` to `generativelanguage.googleapis.com` — `server.js:9–11`
- **Uses:** Content generation (`generateContent`), File Search stores (create/upload/list/delete), cached content, chat
- **Credentials:** `GEMINI_API_KEY` env var — `server.js:31`; also accepted per-request via `x-api-key` header — `server.js:1922`
- **Wired in:** `server.js` lines 1148–1751 (generation), 2676–2994 (chat), 3461–3551 (org chat), 3967–4032 (policy extraction), 4484–4518 (policy chat), 4561–4794 (file collections)

### WathbahGRC / CISO Assistant API

- **Base URL:** `GRC_API_URL` env var (default `https://grc.wathbah.dev`) — `server.js:34`
- **Auth:** User's GRC IAM token forwarded via `grcFetch` helper — `server.js:57–63`
- **Uses:** Frameworks, assessments, requirement nodes, applied controls, policies, risks, folders, audit logs
- **Wired in:** `server.js` lines 2052–4334 (proxy routes)

### Muraji API

- **Base URL:** `https://muraji-api.wathbah.dev` (hardcoded in browser JS)
- **Auth:** No API key observed; requests use `Content-Type: application/json` only
- **Uses:** Library CRUD, prompt CRUD, controls PATCH (questions/evidence/notes)
- **Wired in:** `admin.js:8159` (workbench), `app.js:6,1136–1145` (requirement analyzer), `prompts.js:6` (prompt editor)

### Google Fonts (CDN)

- **Font:** Cairo — loaded in all HTML files (e.g. `admin.html:7–9`)
- **No credentials**

### vis-network (CDN)

- **Library:** vis-network for chain graph visualization — `admin.html:1271`
- **No credentials**

## Not Present

No references to: OpenAI, Anthropic, AWS SDK, `@google-cloud/storage`, Mailgun, SendGrid, or any auth provider besides WathbahGRC IAM.
