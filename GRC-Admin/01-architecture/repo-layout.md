# WathbahGRC Admin — Repo Layout
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Top-level folder structure and purpose of each directory/file.

## Tree (depth 2)

```
prompt/
├── collection-uploads/       # Local copies of files uploaded to Gemini File Search Stores (gitignored)
├── nginx/
│   └── prompt.wathbahs.com   # Nginx reverse-proxy config for production
├── node_modules/             # npm dependencies (gitignored)
├── policy-uploads/           # Local copies of policy documents (gitignored)
├── prompts/
│   ├── chat-auditor.txt          # System prompt: audit chat sessions
│   ├── controls-generator.txt    # System prompt: applied controls generation
│   ├── framework-extractor.txt   # System prompt: framework-only policy extraction
│   ├── policy-extractor.txt      # System prompt: full library policy extraction
│   ├── reference-controls-extractor.txt  # System prompt: controls-only extraction
│   └── requirement-analyzer.txt  # System prompt: single-requirement analysis
├── .env                      # GEMINI_API_KEY (gitignored)
├── .gitignore
├── admin.css                 # SPA styles (~158KB)
├── admin.html                # Main SPA shell (~57KB) — serves all routes
├── admin.js                  # SPA JavaScript (~419KB)
├── app.js                    # Audit Studio frontend (legacy standalone page)
├── chat.html                 # Chat page HTML
├── chat.js                   # Chat page JavaScript
├── ciso_erd_chain_design.pdf # Design document for the chain resolution ERD
├── index.html                # Legacy requirement selector page
├── login.css / login.html / login.js  # Login page
├── nginx.conf                # Full nginx config (includes multiple sites)
├── package.json / package-lock.json
├── prompts.html / prompts.js # Prompt management page (legacy standalone)
├── server.js                 # THE ENTIRE BACKEND (~4906 lines, ~212KB)
├── sessions.db               # SQLite database (gitignored)
├── styles.css                # Shared styles
└── wathba.db                 # Empty placeholder (gitignored)
```

## Key observations

- **No folder contains `muraji` or `llm` or `openai` in its name.** All AI integration is inside `server.js` and the `prompts/` directory.
- **The `prompts/` folder** contains 6 `.txt` files used as system-instruction templates. These are seeded into the `local_prompts` SQLite table on startup (`server.js:993–1060`) and the DB copy becomes the source of truth.
- **No GRC framework YAML libraries exist in this repo.** Those belong to WathbahGRC (CISO Assistant). This app generates YAML libraries dynamically via AI extraction and pushes them to the GRC API.
- **`admin.html` + `admin.js` + `admin.css`** together form a ~635KB single-page application that handles all modern routes (dashboard, controls studio, policy ingestion, org contexts, etc.).
- **`app.js`, `index.html`, `prompts.html`, `prompts.js`, `chat.html`, `chat.js`** are legacy standalone pages that predate the SPA consolidation.
