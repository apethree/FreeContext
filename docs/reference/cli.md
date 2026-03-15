# CLI Reference

```
free-context <command> [options]
```

---

## Commands

### `index`

Parse and index a codebase into the symbol store.

```bash
free-context index [path] [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `path` | `.` | Root directory to index |
| `--repo-id <id>` | random UUID | Stable identifier for this project |
| `--storage <type>` | `memory` | `memory` or `lancedb` (Phase 2) |
| `--embed` | off | Enable embeddings (Phase 2) |

---

### `search`

Search indexed symbols by name or file.

```bash
free-context search <query> [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `query` | required | Text to search for |
| `--path <path>` | `.` | Root to index before searching |
| `--limit <n>` | `20` | Max results |

Output format:
```
function      greet                          src/utils.ts:12
class         AuthService                    src/auth/service.ts:1
```

---

### `serve` *(Phase 4)*

Start the MCP server.

```bash
free-context serve [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | `3100` | Port for SSE server |
| `--root <path>` | `.` | Project root to index |
| `--storage <type>` | `memory` | `memory` or `lancedb` |

---

### `who-calls` *(Phase 3)*

```bash
free-context who-calls <symbolName>
```

---

### `recently-changed` *(Phase 3)*

```bash
free-context recently-changed [--since <ref>]
```
