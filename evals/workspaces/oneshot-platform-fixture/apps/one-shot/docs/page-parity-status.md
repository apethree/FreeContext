# One-shot Page Parity Status

Last updated: 2026-02-16

## Completed in this migration pass

- Auth shell and Clerk gate (`/auth`, `/sso-callback`)
- Sidebar + topbar shell parity baseline
- Home page upgraded with project/run status summaries and local assistant composer
- Skills page upgraded with source filters, install toggles, and detail panel
- Create Project page migrated to CapZero-style setup flow with local draft persistence
- Project Workspace migrated as default project route with:
  - left node/event panel
  - center React Flow DAG canvas
  - right details/spec/staged panel
  - local workspace chat and run actions
- Templates page migrated (`/home/templates`)
- Settings page parity expanded for all sidebar sections with local-safe placeholders

## Deferred to next migration pass

- Agents page route and feature parity
- Feedback / bug report flows
- Legal / disclaimer flows
- Backend-managed create/session flows (`assistantAgent*`, streaming chat)
- Runtime-backed cloud sync, billing, and provider OAuth integrations
- Real execution engine parity (Temporal-backed run lifecycle + live telemetry streaming)

## Route coverage

- `/home`
- `/home/skills`
- `/home/templates`
- `/home/create`
- `/home/project/:projectId/:runId?`
- `/home/settings/:section?`
