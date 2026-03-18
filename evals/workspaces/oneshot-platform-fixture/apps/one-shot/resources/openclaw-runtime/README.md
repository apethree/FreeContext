Place packaged OpenClaw runtime binaries here for production packaging.

- macOS/Linux: `openclaw`
- Windows: `openclaw.exe`

Packaging commands (`npm run package|make|publish`) run `scripts/prepare-openclaw-runtime.mjs`
which requires either:

1. Existing binary in this directory, or
2. `ONESHOT_OPENCLAW_RUNTIME_BIN` env var pointing to the runtime binary to copy in.

Update workflow:

1. Build/download the new OpenClaw runtime binary for each target OS.
2. Run packaging with `ONESHOT_OPENCLAW_RUNTIME_BIN` set to that binary path.
3. Build installer/update artifacts (`npm run make` or `npm run publish`).
4. Install/update the app and confirm local runtime starts from bundled path (launcher label includes `packaged:`).

Notes:

- One Shot only launches its bundled runtime (`resources/openclaw-runtime`), not a global `openclaw` binary.
- Shipping a new app update with refreshed `resources/openclaw-runtime` upgrades runtime for users automatically.
