# WathbahGRC Admin — RBAC and Folders
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** Folder-based multi-tenancy and role-based access control.

## RBAC

**Not present in this project.** All authenticated users have equal access to all features. See `authority-and-roles.md` for details.

## Folder-Based Multi-Tenancy

This project **proxies** CISO Assistant's folder system but does not enforce it:

- `GET /api/grc/folders` (`server.js:2206`) — proxies to GRC's `/api/folders/`
- Controls export accepts a `folder` parameter (`server.js:2270, 2310`) — passed to GRC when creating applied controls
- The `folder` field determines which GRC domain/perimeter the controls land in

However, this project has **no local folder concept**. Org contexts, sessions, and policy collections are not scoped to folders. All users see all data.

## Domain / Perimeter

Not modelled locally. The chain resolution engine references GRC's folder system indirectly through the entities it fetches, but doesn't enforce any access boundaries.
