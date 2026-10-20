# Architecture

## Overview

This repository adapts DrawFlare to Cloudflare Workers. SvelteKit owns routing, UI, APIs, and persistence. The official `@excalidraw/excalidraw` React editor is mounted through a Svelte bridge.

- **Runtime/build:** Bun, Vite, SvelteKit.
- **UI:** Svelte 5; official Excalidraw React editor.
- **Hosting:** Cloudflare Workers via `@sveltejs/adapter-cloudflare`.
- **Metadata/history:** Cloudflare D1 through `DB`.
- **Large scenes:** Cloudflare R2 through `FILES`.
- **Realtime:** one Cloudflare Durable Object room per drawing, exported through `worker.ts` and bound as `COLLABORATION_ROOMS`.
- **Authentication:** signed session cookie using `AUTH_SECRET`; optional legacy shared password `APP_PASSWORD`; individual D1 accounts.
- **Password reset:** optional Resend integration via `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
- **MCP:** JSON-RPC endpoint at `/mcp`, supporting a global bearer token and scoped per-user API keys.

## Repository map

```text
src/
  lib/
    ExcalidrawEditor.svelte      React bridge and Excalidraw menu extension
    confirm.ts                  Shared promise-based confirmation dialog API
    server/CollaborationRoom.ts  WebSocket scene relay and room presence
    DrawingPreview.svelte        Lazy drawing previews for the dashboard
    WorkspaceSidebar.svelte      Shared sidebar for settings/profile/admin
    server/
      auth.ts                    Session signing and PBKDF2 password hashing
      scenes.ts                  D1/R2 scene storage helpers
  routes/
    +page.svelte                 Dashboard, collections, bulk actions, sharing
    editor/+page.svelte          Excalidraw editor, autosave, history, live scene sync
    collection-share/[token]/    Public view/edit collection link
    share/[token]/               Public drawing share link
    login/                       Shared password and individual account sign-in
    register/                    First-admin setup and optional self-registration
    forgot-password/             Resend-backed password recovery
    reset-password/[token]/      One-time password reset
    settings/                    Editor preferences and workspace backup/restore
    profile/                     Account security and scoped MCP API keys
    admin/                       User management, registration control, diagnostics
    api/
      auth/                      Login, registration, password reset/change, session
      admin/users/               User CRUD, roles, activation, temporary passwords
      admin/settings/            Registration settings
      profile/api-keys/          Scoped MCP API key lifecycle
      backup/                    Workspace backup import/export
      collections/               Collection CRUD and share-link management
      collection-share/[token]/  Public collection read/edit API
      drawings/                  Product-facing drawing API aliases and history
      share/[token]/             Public drawing share API
      whiteboards/               Legacy handler paths retained for compatibility
    mcp/+server.ts               MCP tool implementation and API-key scope checks
migrations/
  0001_init.sql                  Initial drawing/share schema
  0002_add_revision.sql          Revision checks
  0003_dashboard_features.sql    Collections, favorites, Trash, history
  0004_collection_shares.sql     Revocable, expiring collection links
  0005_user_accounts.sql         Users, registration setting, reset tokens
  0006_api_keys.sql              Scoped per-user MCP API keys
```

## Request and data flows

### Dashboard and ownership

- `GET /api/drawings` supports search, sort, collection filtering, favorites, and Trash.
- `POST /api/drawings` creates a drawing, optionally inside an owned collection.
- `PATCH /api/drawings/:id` updates title, collection, favorite flag, or Trash state.
- `DELETE /api/drawings/:id` permanently deletes a drawing.
- `/api/collections` creates/lists collections; `/api/collections/:id` renames/deletes them.
- Individual sessions are scoped by `owner_id`. Legacy shared-password sessions retain workspace-wide access.
- First-account setup promotes the first account to administrator and assigns existing unowned content to that account.

### Editor, storage, and history

1. `/editor?id=<id>` loads an existing drawing; `/editor` creates one.
2. `ExcalidrawEditor.svelte` dynamically imports React and the official editor.
3. Changes are debounced and sent to `PUT /api/drawings/:id` with `expectedRevision`.
4. A revision mismatch returns HTTP 409 and prevents silent stale writes.
5. Small scenes are stored in D1; large scenes are stored in R2. History snapshots are taken at five-minute intervals only when the serialized scene is at most 450 KB.

### Sharing

Drawing and collection share links use random bearer tokens, view/edit permissions, optional expiry, and revocation. Public link routes bypass workspace login only for the resource covered by the token. Shared-link access and real-time room access are separate: the realtime endpoint requires access to the drawing API resource. The Durable Object currently relays scene snapshots and connection counts; live cursors, named collaborator identity, and per-user selections are not implemented yet.

### Authentication and user administration

- `AUTH_SECRET` signs seven-day HttpOnly session cookies.
- `APP_PASSWORD` remains an optional backward-compatible workspace-wide login.
- Individual passwords use PBKDF2-HMAC-SHA256 with per-user random salts.
- The first registered account becomes the administrator. Later registration is controlled by an admin setting.
- Admins can create/deactivate users, change roles, issue temporary passwords, and delete users (owned content is transferred to the acting administrator).
- Email password reset requires the Resend Worker secrets; tokens are hashed in D1 and expire after 30 minutes.
- Deactivated users are rejected on subsequent requests by checking the account record when validating the session.

### MCP and API keys

- `/mcp` supports drawing read/write and collection read/write tools.
- A global `MCP_AUTH_TOKEN` provides workspace-wide access.
- Individual `edash_...` keys are stored as hashes, scoped by permission, revocable, and restricted to the key owner’s drawings/collections.
- The full token is only returned once when the key is created.
- Drawing writes should include `expectedRevision` to avoid overwriting newer scenes.

### Backup and restore

- `GET /api/backup` exports workspace collections and drawing scenes as `drawflare-backup` version 1 JSON.
- `POST /api/backup` validates and merges backup items as new copies, preserving the current workspace. Import limits are 500 collections, 5,000 drawings, and 50 MB.
- This is a manual backup/restore feature; scheduled backups and complete upstream retention semantics remain unimplemented.

## Architecture boundaries

- Svelte components own page layout, dialogs, forms, and navigation.
- `ExcalidrawEditor.svelte` owns the React/Excalidraw boundary.
- API handlers own validation, authorization, and persistence.
- `src/lib/server/auth.ts` owns session and password primitives.
- `src/lib/server/scenes.ts` owns D1/R2 scene placement.
- D1 migrations define persistent schema evolution.
- `DESIGN.md` defines visual and interaction patterns.

## Safe change guidelines

1. Keep the product UI consistent with DrawFlare and avoid reintroducing a separate “Whiteboards” product section.
2. Never trust client-only visibility for authorization; filter owned resources server-side.
3. Preserve revision checks and never silently overwrite a conflicting scene.
4. Do not claim that sharing implies real-time collaboration.
5. Keep secrets and Cloudflare resource IDs out of source code.
6. Run `bun run check` and `bun run build` after implementation changes.
