# WathbahGRC Admin — Service Accounts
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** How service accounts are created, authenticated, and attributed.

## Status: NOT PRESENT

There are no service accounts in this project:

- No `service_account` table or config
- No API key authentication for machine-to-machine calls
- No special user identity for AI-generated writes
- No `muraji-ai@...` or `system@...` username

## How AI Writes Are Attributed

All writes to the GRC API (controls export, library upload, compliance assessment creation) use the **logged-in user's GRC token** (`reqToken`). This means:
- AI-generated controls appear in GRC audit logs as created by the human user who clicked "Export"
- Auto-created compliance assessments (`server.js:539–564`) are attributed to the user who triggered chain resolution
- There is no way to distinguish human-initiated vs AI-initiated changes in GRC's audit trail

## Muraji API Calls

Frontend calls to `https://muraji-api.wathbahs.com/api/libraries/:id/controls` (writing questions and evidence) send **no authentication token** (`app.js:1141`). The Muraji API endpoint appears to be unauthenticated.
