# WathbahGRC Admin — File Storage and Collections
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** File upload, storage, and Gemini File Search collections.

## Local File Storage

### Policy Uploads

- Directory: `policy-uploads/` — `server.js:924–926`
- Stored as: `policy-uploads/{collectionId}/{uuid}-{filename}` — `server.js:3609–3622`
- Tracked in: `policy_files` table with `local_path` — `server.js:180–190`
- Upload handler: `POST /api/policy-collections/:id/files` — `server.js:3571+`

### Collection Uploads (File Search)

- Directory: `collection-uploads/` — `server.js:928–930`
- Stored as: `collection-uploads/{uuid}-{filename}` — `server.js:4658–4676`
- Upload handler: `POST /api/collections/:storeId/documents` — `server.js:4630+`

## Gemini File Search Stores

- Create store: `POST /api/collections` → Gemini `fileSearchStores.create` — `server.js:4561–4590`
- List stores: `GET /api/collections` — `server.js:4591–4607`
- Delete store: `DELETE /api/collections/:storeId` — `server.js:4608–4628`
- Upload document: saves locally + uploads to Gemini store — `server.js:4630–4715`
- List documents: `GET /api/collections/:storeId/documents` — `server.js:4716–4745`
- Delete document: `DELETE /api/collections/:storeId/documents/:docId` — `server.js:4746–4793`

## File Search in AI Features

- Chat sessions can include File Search tools: `tools: [{ fileSearch: { fileSearchStoreNames } }]` — `server.js:2808–2809`
- Policy extraction uses File Search for RAG over uploaded PDFs — `server.js:4027–4028`
- Org context chat uses File Search grounding — `server.js:3474–3480`
- Grounding metadata (source chunks) extracted from responses — `server.js:3526–3532,4522–4528`

## Constraints

- **Max request body:** 150MB — `server.js:1120–1125`
- **File extension allowlist:** None for uploads. `mimeType` passed through from the client.
- **Virus scanning:** None
- **No GCS or S3:** All files stored on local disk. No cloud storage SDK in dependencies.

## "Collection" Concept

Two separate collection concepts:
1. **Policy collections** (`policy_collections` table): Groupings of policy documents for extraction workflows
2. **File Search collections** (Gemini stores): Groupings of documents for RAG/chat — managed via `/api/collections` endpoints, backed by `org_contexts.store_id` or standalone
