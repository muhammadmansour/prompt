# WathbahGRC Admin — Repo Layout
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Top-level directory tree with descriptions.

## Tree (depth 3)

```
prompt/
├── GRC-Admin/                          # Markdown architecture/product docs for v4 planning
│   ├── 00-index.md
│   ├── 01-architecture/                # Stack, deployment, dependencies docs
│   ├── 02-data-model/                  # Entity definitions, ERD notes
│   ├── 03-ai-pipeline/                 # AI flow, Muraji, prompt assembly docs
│   ├── 04-admin-surfaces/             # Question/evidence/prompt management docs
│   ├── 05-frontend-navigation/        # Routes, RTL, admin surfaces docs
│   ├── 06-audit-rbac-security/        # Audit log, RBAC, approvals docs
│   ├── 07-integration-boundaries/     # Cross-app APIs, storage docs
│   ├── 08-gaps-and-open-questions.md
│   └── 09-cross-reference-hints.md
├── nginx/                              # Example vhost config
│   └── prompt.wathbahs.com            # Proxies to 127.0.0.1:8888
├── prompts/                            # LLM prompt template text files
│   ├── chat-auditor.txt
│   ├── controls-generator.txt
│   ├── framework-extractor.txt
│   ├── policy-extractor.txt
│   ├── reference-controls-extractor.txt
│   └── requirement-analyzer.txt
├── admin.html                          # Main SPA shell (admin UI)
├── admin.js                            # All admin frontend logic (~10500 lines)
├── admin.css                           # All admin styles (~6500 lines)
├── index.html                          # Legacy requirement analysis UI
├── app.js                              # Legacy frontend JS
├── styles.css                          # Legacy/shared styles
├── login.html                          # Login page
├── chat.html / chat.js / chat.css      # Chat interface (auditor assistant)
├── prompts.html / prompts.js           # Prompt template editor (standalone page)
├── server.js                           # Backend: HTTP server, DB, all API routes (~5000 lines)
├── package.json                        # 2 deps: @google/genai, better-sqlite3
├── nginx.conf                          # Multi-site nginx config (production topology)
├── .env                                # (gitignored) GEMINI_API_KEY, GRC_API_URL
└── ciso_erd_chain_design.pdf           # ER diagram reference document
```

## Folders with AI/prompt-related names

| Folder | Relevance |
|--------|-----------|
| `prompts/` | Contains `.txt` LLM prompt templates with `{{PLACEHOLDER}}` syntax |
| `GRC-Admin/03-ai-pipeline/` | Documentation about AI integration (not code) |

No folders named `muraji`, `llm`, `openai`, `gemini`, or `filesearch` exist. All Gemini/File Search code is inline in `server.js`.

## No framework YAML libraries folder

Framework YAML ingestion belongs to the main WathbahGRC project, not this admin app. This app reads frameworks via the Muraji HTTP API (`https://muraji-api.wathbah.dev/api/libraries`).
