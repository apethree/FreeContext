# One Shot Platform

Product repo for hosted + desktop One Shot stack.

## Layout
- `apps/one-shot`: Electron desktop app
- `apps/website`: Astro marketing/docs site (`capzero.com`)
- `apps/one-shot` (web build): static OneShot web app (`oneshot.capzero.com`)
- `apps/gateway`: Node.js hosted gateway/services (Fly.io)

## Notes
- Local OpenClaw runtime is packaged under `apps/one-shot/resources/openclaw-runtime` for production builds.
- One Shot now launches only One Shot-managed runtime candidates (packaged resource paths and app-local bundled dev runtime), never a global `openclaw` binary.

## Multi-Worktree Dev Orchestrator
- Orchestrator home: `apps/one-shot`
- Config template: `apps/one-shot/dev-orchestrator/worktrees.example.json`
- Local machine config (ignored): `apps/one-shot/dev-orchestrator/worktrees.local.json`

Quick start:
```bash
cd apps/one-shot
npm install
npm run dev:worktrees:start
```

Useful commands:
- `npm run dev:worktrees:status`
- `npm run dev:worktrees:status -- --json`
- `npm run dev:worktrees:rescan`
- `npm run dev:worktrees:logs`
- `npm run dev:worktrees:logs:live` (stream only new lines from now)
- `npm run dev:worktrees:enable -- <worktreeKey>`
- `npm run dev:worktrees:disable -- <worktreeKey>`
- `npm run dev:worktrees:profile -- <worktreeKey> <profileName>`
- `npm run dev:worktrees:cleanup`
- `npm run dev:worktrees:restart`
- `npm run dev:worktrees:stop`
- `npm run dev:worktrees:delete`

## Gateway Dev Stack
From the repo root:

```bash
npm --prefix apps/gateway run dev:stack:start
npm --prefix apps/gateway run dev:stack:status
npm --prefix apps/gateway run dev:stack:restart
npm --prefix apps/gateway run dev:stack:stop
```

Logs:
- `npm --prefix apps/gateway run dev:stack:logs:follow`
- `tail -f apps/gateway/.local/stack/logs/gateway-api.log`
- `tail -f apps/gateway/.local/stack/logs/gateway-realtime.log`
- `tail -f apps/gateway/.local/stack/logs/gateway-workers.log`
