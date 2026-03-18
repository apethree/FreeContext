# One Shot Observability V1 (No PostHog)

## Goal

Build enough observability to debug:

- repeated/redundant API and websocket calls,
- reconnect/recovery loops,
- renderer over-triggered actions (navigation/effect loops),
- sync failures between local runtime and cloud gateway.

This v1 is local-first logging (file-based), no external analytics vendor.

## Data Flow

- Renderer emits structured events via `window.appShell.logEvent(...)`.
- Electron main process writes all events to `electron-log` file.
- Pipeline gateway service emits transport/chat events to the same logger.
- Cloud worker logs structured request/queue lifecycle events via `console.log(JSON)`.

## Event Shape

Common event fields:

- `domain` (ex: `ui.navigation`, `gateway.remote`, `chat.pipeline`)
- `action` (ex: `route_change`, `request.chat.append`, `send`)
- `status` (`start|success|error|retry|skip|close`)
- `phase` (optional sub-step)
- `correlationId` (optional request/flow id)
- `fingerprint` (dedupe identity)
- `duplicateCount` (same fingerprint within dedupe window)
- `durationMs` (where applicable)
- `data` (redacted metadata only)

## Secret Safety

Main-process observability redacts sensitive keys recursively:

- `token`, `authorization`, `password`, `secret`, `apiKey`, `refreshToken`, `accessToken`.

Never log raw JWTs/provider tokens in `data`.

## Investigation Workflow

1. Reproduce with dev build and keep logs open.
2. Filter by domain:
   - renderer behavior: `ui.navigation`, `ui.menu`, `agent.session`
   - transport behavior: `gateway.remote`
   - chat behavior: `chat.pipeline`
   - backend behavior: `http.request.*`, `queue.batch.*`
3. Look for duplicate spikes:
   - same `fingerprint` with fast-increasing `duplicateCount` indicates loops/redundant effects.
4. Check latency and failure points:
   - compare `status=start` to `status=success/error` using `durationMs`.
5. Patch one flow at a time, rerun, and compare duplicate/failure counts.

## Success Criteria

- Single navigation action should produce one `ui.navigation.route_change`.
- One chat send should produce one `chat.pipeline.send start` and one terminal status event.
- `gateway.remote.request.*` events should not repeat unexpectedly for the same user action.
- WS closes should include an explicit close event and reason path.
- Cloud worker should show request and queue batch lifecycle markers per traffic burst.

## Immediate Optimization Backlog

1. Add correlation IDs in renderer for user actions (`chat-send`, `oauth-start`) and propagate to gateway methods.
2. Add a small in-app log viewer for filtered domains (dev-only).
3. Add lightweight counters snapshot endpoint (`obs:stats`) for duplicate hotspots.
4. Add automated e2e assertions for duplicate ceilings:
   - max 1 `route_change` per route transition,
   - max 1 `request.session.upsert` per send click,
   - no repeated reconnect loops within 5 seconds.
