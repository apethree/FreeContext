# FreeContext

> A host-agnostic TypeScript code intelligence engine that indexes your codebase into searchable, symbol-centric records — exposable to any AI agent via MCP.

---

## What it does

FreeContext parses TypeScript and JavaScript codebases using tree-sitter, extracts a structured symbol index (functions, classes, interfaces, call graphs), and makes that index queryable by name, file, semantic meaning, or caller/callee relationship.

The index is designed to be served as an **MCP (Model Context Protocol) server**, giving AI agents like Claude Code and Codex structured, low-hallucination access to your codebase without raw file dumps.

---

## Quickstart

```bash
# Install
npm install -g free-context
# or use npx: npx free-context <command>

# Index your project
free-context index ./my-project

# Search symbols
free-context search "AuthService"

# List symbols in a file
free-context search --file src/auth/service.ts

# Serve as MCP server (Phase 4)
free-context serve --port 3100
```

---

## Installation (from source)

```bash
git clone https://github.com/apethree/FreeContext.git
cd FreeContext
npm install
npm run build
```

---

## Current Phase

**Phase 1 — Core + Parser + Storage + CLI**

The engine can parse TypeScript/JavaScript, index to in-memory storage, and search by name or file. See [PROGRESS.md](./PROGRESS.md) for what is done and what is next.

---

## Supported languages

| Language       | Extensions          | Status |
|---------------|---------------------|--------|
| TypeScript    | `.ts`               | ✅ Phase 1 |
| TypeScript JSX | `.tsx`             | ✅ Phase 1 |
| JavaScript    | `.js`               | ✅ Phase 1 |
| JavaScript JSX | `.jsx`             | ✅ Phase 1 |

---

## Architecture overview

See [docs/architecture/overview.md](./docs/architecture/overview.md) for the full system design.

```
FileProvider → Parser → Indexer → IndexStorage
                                       ↓
                                  SearchService
                                       ↓
                           CodeIntelEngine (public façade)
                                       ↓
                              CLI   /   MCP Server
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/architecture/overview.md](./docs/architecture/overview.md) | System design and data flow |
| [docs/architecture/data-model.md](./docs/architecture/data-model.md) | `CodeSymbolRow`, `EdgeRow` schema |
| [docs/adr/](./docs/adr/) | Architecture decision records |
| [docs/how-to/index-a-project.md](./docs/how-to/index-a-project.md) | Step-by-step indexing guide |
| [docs/reference/cli.md](./docs/reference/cli.md) | CLI reference |
| [docs/reference/config.md](./docs/reference/config.md) | Config schema |
| [docs/roadmap.md](./docs/roadmap.md) | Phase roadmap |
| [PLAN.md](./PLAN.md) | Detailed implementation plan |
| [PROGRESS.md](./PROGRESS.md) | Phase-by-phase progress tracker |

---

## Contributing

Read [AGENTS.md](./AGENTS.md) for how to work with this repo using AI agents. Before opening a PR, run:

```bash
npm run typecheck
npm run test
npm run build
```

---

## License

MIT
