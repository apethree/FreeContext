# FreeContext — Claude Code Instructions

Read [AGENTS.md](./AGENTS.md) first. It is the single source of truth.

## Additional Claude-specific notes

- Use `Bash` for build/test runs; use dedicated tools (Read, Edit, Grep, Glob) for file operations
- Before modifying a file, read it first
- Keep responses concise — output code changes and short explanations, not essays
- Run `npm run typecheck && npm run test` before considering any phase "done"
- Reference code by `file:line` format in explanations
