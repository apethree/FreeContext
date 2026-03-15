# FreeContext — Agent Instructions

> This is the single source of truth for AI agent behavior in this repo.
> Codex, Gemini, Cursor, and any other LLM agent should read this file.
> Do not duplicate these instructions elsewhere.

---

## Start here

Before taking any action, read these three files in order:

1. **[README.md](./README.md)** — What FreeContext is and how it works
2. **[PROGRESS.md](./PROGRESS.md)** — Current phase, what is done, what is next
3. **[PLAN.md](./PLAN.md)** — Full implementation plan with interfaces, data model, and phase details

---

## Repo facts

- Language: TypeScript, ESM-only, Node 20+
- Build: `tsup` + `tsc --emitDeclarationOnly`
- Test: `vitest`
- No React, no browser, no cloud services
- Source: `src/` — see PLAN.md for module layout
- Docs: `docs/` — architecture, ADRs, how-to, reference

---

## Implementation rules

- Default to the phase listed as current in `PROGRESS.md`
- Do not start a later phase until the current phase verification steps pass
- Keep interfaces in `src/types/index.ts` — do not scatter type definitions
- Tests live in `src/__tests__/` — one file per module
- Every new module needs at least 3 tests
- Do not add dependencies not listed in PLAN.md without noting the reason in an ADR

---

## Validation before marking a phase done

```bash
npm run build
npm run typecheck
npm run test
```

All three must pass. Note the result in PROGRESS.md.

---

## Docs rule

Every feature you implement should produce:

1. One update to `docs/architecture/` or `docs/reference/` describing what it is
2. One entry in `PROGRESS.md` noting what was done
3. An ADR in `docs/adr/` if a non-obvious decision was made

Use short, clear prose. No marketing language.

---

## What NOT to do

- Do not touch `docs/` without also updating `PROGRESS.md`
- Do not add a dependency without updating `package.json` and noting it in PLAN.md
- Do not create files outside `src/` and `docs/` without strong reason
- Do not add React, browser globals, or cloud SDK imports
- Do not make the CLI require network access
