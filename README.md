# DrawFlare Worker

A Cloudflare Workers adaptation of the DrawFlare drawing workspace. It uses SvelteKit, the official `@excalidraw/excalidraw` editor, Cloudflare D1 for metadata/history, R2 for large scene payloads, and an MCP endpoint.

## Implemented in this Worker version

- DrawFlare-inspired dashboard with search, sorting, selection, bulk actions, import/export, favorites, Trash, and collections.
- Official Excalidraw editor with title editing, debounced autosave, revision conflict checks, history restore, and a Durable Objects WebSocket room per drawing for live scene synchronization/presence.
- Drawing share links and collection share links with view/edit permissions, optional expiry, copy, and revoke.
- Workspace backup export/import. Imports merge as new copies and do not overwrite existing drawings.
- Live theme switching, expanded dark palette coverage, styled select controls, and shared accessible confirmation dialogs instead of browser `confirm()` prompts.
- Individual accounts, first-admin setup, registration controls, roles, account activation, admin-created users, and temporary-password reset.
- Password reset by email through Resend when configured.
- Per-user drawing and collection ownership when individual accounts are enabled.
- Scoped MCP API keys managed from Profile, plus the legacy global MCP bearer token.
- MCP JSON-RPC endpoint at `/mcp` with drawing and collection tools.
- Large scene payloads are stored in R2 when configured; smaller scenes stay in D1.

The application uses the `/api/drawings` API. Legacy `/api/whiteboards` handlers and the existing D1 table name remain as compatibility details; they are not part of the product UI.

## Local development

```sh
bun install
bun run db:local
bun run dev -- --host 0.0.0.0
```

Copy `.env.example` to `.dev.vars` and replace the placeholder secrets. Wrangler reads `.dev.vars` for local Worker bindings; `.env.example` is the single committed template. Do not commit `.dev.vars`. For individual accounts, configure `AUTH_SECRET` and apply all D1 migrations. The first registered account becomes the administrator and claims existing unassigned drawings and collections. If `APP_PASSWORD` is also configured, the legacy shared-password login remains available. Without `AUTH_SECRET` and `APP_PASSWORD`, authentication is disabled for local development.

Password-reset email requires the Worker secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Without those, account creation and sign-in work, but self-service email reset is unavailable.

Wrangler uses a local D1 database when running locally. Apply all migrations after resetting the local database. Vite chooses an available development port; app code does not hardcode one. Vite-only local development uses `BroadcastChannel` for same-browser-tab sync; cross-device WebSocket collaboration requires the Worker/Durable Object runtime.

## Cloudflare deployment

1. Create a D1 database and an R2 bucket named `drawflare-files` (or update `wrangler.toml`).
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml` with the real D1 database ID.
3. Apply migrations: `bun x wrangler d1 migrations apply drawflare-db --remote`.
4. Set production secrets using Wrangler. Configure DRAWFLARE_GITHUB_REPO as owner/repository in Worker vars to enable update checks:
   ```sh
   bun x wrangler secret put AUTH_SECRET
   bun x wrangler secret put APP_PASSWORD
   bun x wrangler secret put MCP_AUTH_TOKEN
   bun x wrangler secret put RESEND_API_KEY
   bun x wrangler secret put RESEND_FROM_EMAIL
   ```
   `APP_PASSWORD` is optional when using individual accounts. `AUTH_SECRET` is required for account sessions.
5. Build and deploy with Wrangler: `bun run build && bun run wrangler deploy`. The deployment uses `worker.ts` as the entrypoint and exports `CollaborationRoom`; `wrangler.build.toml` is reserved for the SvelteKit adapter output.
6. The `COLLABORATION_ROOMS` Durable Object binding and `v1` SQLite-class migration are declared in `wrangler.toml`. First deployment creates the Durable Object class; keep the migration tag stable for later deployments.

Never deploy with the placeholder D1 ID. Keep R2 private; the Worker accesses the bucket through the `FILES` binding. These changes have not been deployed to Cloudflare.

## MCP

Endpoint: `POST /mcp`.

- Use `Authorization: Bearer <MCP_AUTH_TOKEN>` for the global workspace token.
- Individual users can create scoped `edash_...` keys in Profile. Scopes restrict access to drawing read/write and collection read/write operations.
- When workspace authentication is enabled, anonymous MCP requests are rejected.
- Tools: `list_drawings`, `search_drawings`, `get_drawing`, `save_drawing`, `list_collections`, `create_collection`, `rename_collection`, and `delete_collection`.
- When updating an existing drawing, provide `expectedRevision` to prevent stale writes.

## Remaining parity gaps

This is a staged Cloudflare adaptation, not yet full upstream feature parity. The largest remaining gaps are live cursors and collaborator identity/selection, OpenID Connect, shared-with-me/invitation workflows, complete upstream settings and preferences, scheduled backups, and some advanced editor interactions. Share links are not real-time collaboration.

No Cloudflare production deployment was performed as part of this local implementation.
