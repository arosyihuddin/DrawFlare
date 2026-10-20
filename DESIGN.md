# Design System

DrawFlare is the product identity for this application. The UI is implemented in this repository using SvelteKit and Cloudflare Workers.

## Product UI principles

- The product is **DrawFlare**, not a separate “Whiteboards” app.
- Use the same overall visual language on dashboard, editor chrome, sign-in, settings, profile, and administration pages.
- Keep the dotted paper background, ink-colored outlines, crisp offset shadows, indigo primary actions, and Excalifont headings consistent.
- Prefer compact, clear utility UI over marketing-page layouts.
- The official Excalidraw canvas and its native tools remain owned by `@excalidraw/excalidraw`; don't globally override its toolbar/canvas styling.

## Design tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ui-bg` | `#f3f4f6` | App background |
| `--ui-surface` | `#ffffff` | Cards, forms, dialogs |
| `--ui-surface-muted` | `#f8fafc` | Secondary panels |
| `--ui-ink` | `#1e293b` | Primary text, strong borders |
| `--ui-text-muted` | `#64748b` | Metadata and supporting text |
| `--ui-border-soft` | `#e2e8f0` | Nested UI borders |
| `--ui-accent` | `#4f46e5` | Primary actions and active state |
| `--ui-danger` | `#e11d48` | Destructive actions |
| `--ui-focus` | `#6366f1` | Focus indicators |

The background uses a low-contrast repeating dot pattern. Use a 2px ink outline and a crisp 2–3px offset shadow on primary cards/actions. Keep nested form controls visually quieter.

## Typography

- Use Excalifont for short display headings and the DrawFlare wordmark.
- Use the system sans-serif stack for body copy, forms, metadata, and controls.
- Keep line lengths readable and avoid applying display fonts to long text.

## Dashboard and shared application shell

- Do not add a horizontal top navbar. The desktop layout is a framed, fixed-height sidebar on the left and a scrollable main workspace on the right, matching the upstream `Layout` + `Sidebar` composition.
- The sidebar starts with the official DrawFlare logo/wordmark and Beta label; the scrollable navigation groups All drawings, Favorites, Unorganized, and Collections. The account trigger stays at the bottom and opens a compact menu for Trash, Profile, Administration, Settings, and Sign out.
- Secondary workspace pages reuse the same `WorkspaceSidebar` component, including the collection list and account menu.
- The main dashboard heading is followed by one toolbar with search, sort, and the primary New Drawing action. Drawings use a responsive card grid, not a table/list of rows.
- The mobile layout collapses the sidebar to a compact horizontal navigation row.
- The main area offers drawing creation, search, sorting, and a responsive card grid.
- Collection and favorite state must reflect persisted API state, not just visual toggles.
- Trash actions distinguish restore from permanent deletion.
- Cards expose title, last-updated metadata, sharing, and favorite actions.
- Empty, loading, and error states must remain clear and actionable.

## Editor

- Keep the Excalidraw canvas full-screen.
- Use a compact floating top bar for back navigation, drawing title, and version history.
- Keep autosave/conflict status visible but unobtrusive.
- History restoration must be explicit and revision-checked.
- Do not claim real-time collaboration until a persistent collaboration backend is implemented.

## Settings, profile, and administration

- Use the same sidebar, page heading, card borders, shadows, and focus styles.
- Settings must clearly distinguish browser-local preferences from server-synced account settings.
- Profile and administration must accurately describe the current shared-password auth model; do not fabricate individual users, roles, OIDC, or email-reset capabilities.
- Diagnostics may report whether bindings and secrets are configured, but must never reveal secret values.

## Accessibility and responsive behavior

- All icon-only buttons need accessible labels.
- Preserve keyboard operation, visible focus, semantic controls, and sufficient contrast.
- At narrow widths, collapse side navigation into a horizontally scrollable row.
- Dialogs and panels must fit within the viewport and allow internal scrolling.
- Do not use color alone to communicate status or permission.

## Feature honesty

Some features are not yet available in this DrawFlare implementation, including individual accounts, OIDC, real-time collaboration, collection sharing, scheduled backups, and full admin user management. Do not show controls that imply those capabilities work until their server-side behavior is implemented.
