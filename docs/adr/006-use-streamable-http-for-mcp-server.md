---
title: Use Streamable HTTP for the MCP Server
---

# ADR 006: Use Streamable HTTP for the MCP Server

## Status

Accepted

## Context

The original Phase 4 plan referred to an SSE server transport. The currently published MCP TypeScript SDK exposes Streamable HTTP as the practical server transport through `@modelcontextprotocol/sdk`, and the server-side SSE transport is deprecated.

FreeContext also needs to keep the MCP adapter thin. The server should expose the existing engine methods directly instead of introducing a second orchestration layer or a separate query model just for MCP.

## Decision

FreeContext uses:

- `@modelcontextprotocol/sdk`
- `McpServer`
- `StreamableHTTPServerTransport`
- an HTTP endpoint at `/mcp`
- a simple `/health` endpoint for local checks

Tool handlers call the existing `CodeIntelEngine` methods directly and return compact structured payloads.

## Consequences

- The implementation matches the currently published SDK instead of relying on older SSE-only guidance
- MCP clients connect to `http://host:port/mcp`
- The server remains stateless at the transport layer and reuses the existing indexing/search/graph engine
- Documentation must refer to Streamable HTTP, not server-side SSE
