# One Shot Runtime and Hosted-Phase Architecture

Last updated: 2026-02-26

## Scope

This doc covers One Shot desktop architecture changes for:

- bundled OpenClaw runtime ownership,
- build/package/update pipeline for runtime artifacts,
- hosted-phase diagnostics and local runtime start validation,
- unified cloud-sync architecture for credentials.

## Runtime Ownership Model

One Shot is now the runtime owner for local gateway execution.

- Runtime launch path is resolved in `LocalOpenclawManager` from One Shot-managed locations only.
- Global `openclaw` fallback is intentionally removed.
- Runtime binary name is platform-specific:
  - `openclaw` on macOS/Linux
  - `openclaw.exe` on Windows

Runtime candidate resolution:

1. Packaged app resources:
   - `process.resourcesPath/openclaw-runtime/<binary>`
   - `process.resourcesPath/app.asar.unpacked/openclaw-runtime/<binary>`
2. Dev app root runtime:
   - `apps/one-shot/resources/openclaw-runtime/<binary>`

## Packaging and Update Pipeline

### Forge packaging

`forge.config.ts` includes:

- `packagerConfig.extraResource = ['resources/openclaw-runtime']`
- makers:
  - `MakerZIP({}, ['darwin'])`
  - `MakerRpm`
  - `MakerDeb`
  - `MakerSquirrel`

This ensures runtime files ship in app artifacts and are replaced when users install/update to a newer app build.

### Runtime build scripts

One Shot now has explicit runtime pipeline scripts:

- `prepare:runtime` (`scripts/prepare-openclaw-runtime.mjs`)
  - copies runtime from `ONESHOT_OPENCLAW_RUNTIME_BIN` or uses existing resource binary.
- `check:runtime` (`scripts/verify-openclaw-runtime.mjs`)
  - fails if runtime binary is missing.
  - on non-Windows, also fails if binary is not executable.
- `sync:runtime` (`scripts/sync-openclaw-runtime.mjs`)
  - syncs runtime from OpenClaw repo.
  - prefers compiled binary (`dist/openclaw` / `dist/openclaw.exe`).
  - if only `openclaw.mjs` exists, writes a One Shot runtime shim.
- `update:runtime` (`scripts/update-openclaw-runtime.mjs`)
  - one-command updater for patched OpenClaw branches:
    - sync current branch with upstream `main` (merge by default),
    - build runtime,
    - sync runtime into One Shot resources,
    - verify runtime.
  - repo resolution order:
    - CLI arg path,
    - `OPENCLAW_REPO_ROOT`,
    - auto-detected sibling `../openclaw`,
    - clone via `OPENCLAW_REPO_URL` (if set).
  - upstream sync controls:
    - `OPENCLAW_UPSTREAM_URL` (used when upstream remote is missing)
    - `OPENCLAW_UPSTREAM_REMOTE` (default `upstream`)
    - `OPENCLAW_BASE_BRANCH` (default `main`)
    - `OPENCLAW_UPDATE_MODE` (`merge` default, or `ff-only`)

Packaging commands enforce runtime checks:

- `npm run package`
- `npm run make`
- `npm run publish`

Each runs: `prepare:runtime` -> `check:runtime` -> forge command.

### CI runtime gate

Workflow: `.github/workflows/one-shot-runtime-check.yml`

- runs on One Shot changes in PR/push,
- installs deps,
- runs `npm run check:runtime`.

This prevents releases/builds that omit runtime binaries.

## Hosted-Phase Runtime Diagnostics

The Hosted Phase Test page now includes runtime preflight diagnostics before local start.

New runtime-check IPC path:

- main: `pipeline:check-openclaw-runtime`
- preload/renderer API: `pipelineCheckOpenclawRuntime`

Preflight returns:

- expected runtime paths,
- found runtime paths,
- resolved runtime launch candidates,
- `hasRuntime` + summary detail.

Hosted-phase behavior:

- Preflight runs on page load and on active-user set.
- `Start Local OpenClaw` now runs preflight first.
- If runtime is missing, start is skipped and actionable diagnostics are shown/logged.
- UI includes:
  - runtime badge (`found`/`missing`)
  - Runtime Preflight detail
  - Expected/Found Runtime Paths
  - Runtime Candidates
  - explicit `Check Runtime` action button.

## Operational Notes

- For local development against OpenClaw PR branches, use `npm run sync:runtime <openclaw-repo-root>` to pin runtime source.
- For a latest-upstream refresh with patch carry-forward, run:
  - `npm run update:runtime -- [openclaw-repo-root]`
- For distributable app builds, prefer real compiled runtime binaries and feed via `ONESHOT_OPENCLAW_RUNTIME_BIN`.
- App update to newer One Shot artifacts is the mechanism for shipping newer runtime resources to users.

## Unified Sync Architecture (Credentials)

One Shot now uses a main-process `SyncManager` as the single sync engine for credential state.

### Problem this solves

Previously, credential sync behavior was split across:

- ad-hoc retry logic in `main.ts`,
- renderer-side retry/state machine in `useUserSettings.ts`,
- direct push/pull/delete calls from UI paths.

This caused drift between OAuth flows, settings flows, and hosted-phase diagnostics.

### Current model

All cloud-sync writes route through `SyncManager`:

1. Local mutation occurs (settings token update, OAuth credential stored).
2. Main process queues outbox op:
   - identity scoped: `tenantId + userId`
   - entity scoped: `entityType + entityKey` (latest-wins dedup)
3. Outbox persists in `electron-store` under `sync.outbox`.
4. Flush runs:
   - immediately on enqueue (best-effort),
   - on authenticated WS connect (`onAuthenticated`),
   - on background timer with backoff + jitter.
5. Successful ops are removed; failed ops remain with incremented attempt metadata.

### Pull model

On authenticated connect, `SyncManager.onConnected()` runs:

- `flush()` first (local pending changes win),
- then `pullAll()` for registered entity handlers.

Pull handlers receive `pendingKeys` and skip cloud overwrite for keys with pending local outbox ops.

### Credential entity mapping

Canonical provider mapping:

- cloud: `openai` <-> proxy key: `openai` <-> openclaw: `openai`
- cloud: `anthropic` <-> proxy key: `claude` <-> openclaw: `anthropic`
- cloud: `gemini` <-> proxy key: `gemini` <-> openclaw: `gemini`

### Why two local stores still exist

There are intentionally two local representations:

- One Shot user settings (`oneshot.user.<id>.settings`)
  - UI-facing settings and connected-account state (`proxyTokens`).
- OpenClaw auth store (`auth-profiles.json`)
  - runtime-facing credential format required by local OpenClaw.

`SyncManager` materializes cloud credential state into both stores so UI and runtime stay consistent.

### Identity scoping

Sync identity is always tenant-scoped:

- tenant = `orgId` when in org context, otherwise `userId` for personal context,
- plus `userId` for per-user isolation inside a tenant.

All queued operations and pull/flush behavior are bound to this active identity.
