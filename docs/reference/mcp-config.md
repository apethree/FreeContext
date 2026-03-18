---
title: MCP Config
---

# MCP Config

FreeContext serves MCP over Streamable HTTP at `/mcp`.

## Start the server

```bash
free-context serve . --port 3100
```

Or generate client-specific setup instructions with:

```bash
free-context setup-agent claude-code
free-context setup-agent codex --scout-provider openrouter
```

The server also exposes:

- `/health` — simple JSON health response

## Client setups

FreeContext uses Streamable HTTP, so every client should point to:

```text
http://127.0.0.1:3100/mcp
```

Recommended project rule for any agent:

```text
Use the free-context MCP server for symbol lookup, path search, call graph queries, and codebase summaries before falling back to raw file search.
```

## Claude Code

Add the server:

```bash
claude mcp add --transport http --scope user free-context http://127.0.0.1:3100/mcp
```

Check that Claude Code sees it with:

```bash
claude mcp list
```

Inside Claude Code, `/mcp` shows the connected server and tools.

## Cursor

```json
{
  "mcpServers": {
    "free-context": {
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

Put that JSON in `~/.cursor/mcp.json` for a user-wide setup or `.cursor/mcp.json` in the current project.

## Codex

CLI setup:

```bash
codex mcp add free-context --url http://127.0.0.1:3100/mcp
codex mcp list
```

Manual config:

```toml
[mcp_servers.free-context]
url = "http://127.0.0.1:3100/mcp"
```

Put the TOML block in `~/.codex/config.toml`.

## Gemini CLI

```json
{
  "mcpServers": {
    "free-context": {
      "httpUrl": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

Put that JSON in `~/.gemini/settings.json` for a user-wide setup or `.gemini/settings.json` in the current project.

## OpenCode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "free-context": {
      "type": "remote",
      "url": "http://127.0.0.1:3100/mcp",
      "enabled": true
    }
  }
}
```

Put that JSON in `~/.config/opencode/opencode.json` for a user-wide setup or `opencode.json` in the current project.

## Other MCP clients

If a client supports remote MCP servers over HTTP, use the same endpoint:

```text
http://127.0.0.1:3100/mcp
```

The exposed tools are stable and client-agnostic.

## Recommended MCP stack

Recommended default stack for coding agents:

- `free-context` — local symbol, path, graph, and codebase retrieval
- `context7` — current library/framework docs
- `playwright` — browser automation and UI verification
- `github` — optional PR/issues/repo-hosting workflow
- `web-search` — optional external search if the client lacks a strong built-in web tool

Avoid adding a separate shell-execution MCP when the agent already has native shell/file tools.

## Scout model setup

For cheap scouting and summarization work, generate a scout env template with:

```bash
free-context setup-agent claude-code --scout-provider openrouter
free-context setup-agent codex --scout-provider anthropic
```

The command prints:

- the FreeContext MCP setup for that client
- the recommended MCP stack
- an env template for `PROXY_API` and `PROXY_TOKEN`, or direct provider-specific `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
- `FREE_CONTEXT_SCOUT_PROVIDER`
- `FREE_CONTEXT_SCOUT_MODEL`

## Exposed tools

- `search_code`
- `search_paths`
- `find_symbol`
- `get_symbol`
- `list_file_symbols`
- `who_calls`
- `what_does_this_call`
- `recently_changed_symbols`
- `reindex`
- `codebase_map`

## Inspector

Use explicit transport flags with the current inspector CLI:

```bash
npx @modelcontextprotocol/inspector --transport http --server-url http://127.0.0.1:3100/mcp
```

The positional URL form is not enough for the current inspector binary.

## SDK smoke test

After the server is running, use the built-in one-command smoke check:

```bash
npm run mcp:smoke
```

It connects with the MCP SDK, lists tools, and exercises:
- `search_code`
- `find_symbol`
- `who_calls`
- `search_paths`
- `codebase_map`

Optional alternate server URL:

```bash
MCP_SERVER_URL=http://127.0.0.1:3211/mcp npm run mcp:smoke
```

## Notes

- `free-context serve` runs one incremental index pass before serving requests unless `--no-reindex` is set.
- `.free-context.json` is loaded from the served project root and CLI flags override it.
- Streamable HTTP is used instead of the older server-side SSE transport.
- Some clients support both user-level and project-level MCP config. FreeContext works with either as long as the final server URL points to `/mcp`.
