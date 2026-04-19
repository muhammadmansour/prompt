# WathbahGRC Admin — Deployment and Environments
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Environment configuration, hosting, and feature flags.

## Environment Variables

Loaded from `.env` at repo root via a custom parser (not `dotenv`) — `server.js:13–29`.

| Env var | Default | Purpose |
|---------|---------|---------|
| `GEMINI_API_KEY` | (none) | Google Gemini API key — `server.js:31` |
| `GRC_API_URL` | `https://grc.wathbah.dev` | Main WathbahGRC backend — `server.js:34` |

Only two env vars are read from `process.env` in the codebase. `.env` is gitignored — `.gitignore:1–4`.

## Known Hosts / Environments

| URL | Where referenced | Role |
|-----|------------------|------|
| `https://grc.wathbah.dev` | `server.js:34` (default) | WathbahGRC API (dev) |
| `https://muraji-api.wathbah.dev` | `admin.js:26`, `app.js:6`, `prompts.js:6` | Muraji library/prompt API (hardcoded in browser JS) |
| `prompt.wathbahs.com` | `nginx/prompt.wathbahs.com` | Production nginx vhost for this app |
| `muraji-api.wathbahs.com` | `nginx.conf` (~line 716) | Production Muraji nginx proxy |

No `.dev` vs `.com` env toggle found — browser code hardcodes `.dev` URLs; nginx config references `.com` domains. This suggests dev and production use different domain suffixes but there is no code-level switch.

## Hosting

- Node.js process on port `5555` — `server.js:8,4945`
- Nginx reverse-proxies to `127.0.0.1:8888` — `nginx/prompt.wathbahs.com:37,57` (port mismatch with default 5555; likely overridden at deploy time)
- No Docker, no Kubernetes, no GCP App Engine / Cloud Run references in the repo
- No CI/CD configuration files (.github/workflows, Jenkinsfile, cloudbuild.yaml)

## Feature Flags

None. No `FEATURE_*` env vars, no LaunchDarkly, no toggle system. All features are always-on.
