# One Shot Desktop App

Electron desktop client for CapZero.

## Architecture

```
apps/one-shot/
  src/
    main.ts              Electron main process
    preload.ts           Context bridge + IPC
    renderer.tsx         Renderer entry point
    App.tsx              App shell
    features/            Product feature modules
    components/ui/       Shared UI primitives
```

## Runtime Rules

- Keep renderer logic in React feature modules.
- Do not import `electron` directly in renderer files.
- Add native capabilities in `src/main.ts` and expose minimal APIs in `src/preload.ts`.
- Access native APIs from renderer via `window.appShell` only.

## Commands

```bash
npm start
npm run dev:web
npm run build:web
npm run preview:web
npm run lint
npm run typecheck
npm run make
npm run package
```

## Validation

- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
