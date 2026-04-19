# WathbahGRC Admin — File Storage
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** How files are stored, served, and managed.

## Local File Storage

### `policy-uploads/` Directory

- **Purpose:** Temporary storage for uploaded policy documents before they are sent to Gemini File Search
- **Managed by:** `server.js` multipart parser (`server.js:3285–3380`)
- **Lifecycle:** Files are written on upload, then uploaded to Gemini File Search Store, and remain on disk indefinitely
- **Cleanup:** No automatic cleanup. Files accumulate. `.gitignore` excludes this directory
- **Access:** Not served directly by the app — no static file serving for this directory

### `collection-uploads/` Directory

- **Purpose:** Referenced in `.gitignore` but no code path writes to this directory in the current codebase
- **Status:** Likely a legacy/planned feature

### `prompts/*.txt` Directory

- **Purpose:** Seed prompt templates loaded at startup into `local_prompts` table
- **6 files:** `requirement-analyzer.txt`, `chat-auditor.txt`, `controls-generator.txt`, `policy-ingestion-extractor.txt`, `policy-chat-auditor.txt`, `controls-from-question.txt`
- **Lifecycle:** Read once at startup. After that, prompts are managed via DB and admin UI

## Remote File Storage

### Google Gemini File Search Stores (Corpora)

- **Purpose:** Upload documents for AI-grounded retrieval (RAG) in chat sessions
- **API:** REST calls to `generativelanguage.googleapis.com/v1beta/corpora` (`server.js:1622–1751`)
- **Operations:** Create store, upload document, list stores, list documents, delete store, delete document
- **Lifecycle:** Managed manually via the File Collections UI. No automatic expiration

## No Other File Storage

- No S3, Azure Blob, GCS, or MinIO
- No CDN
- No file versioning
- No virus scanning
- No file size limits enforced by the app (Nginx limits to 50MB via `client_max_body_size`)
