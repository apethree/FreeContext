---
title: Add Promptfoo Eval Harness
---

# ADR 008: Add Promptfoo Eval Harness

## Status

Accepted

## Context

FreeContext exposes a code-intelligence engine through an MCP server, but the existing verification only proves that the server starts and individual tools respond. It does not measure whether:

- the tools return stable, correct repo-specific results
- tool access improves LLM answers compared to a baseline without tools
- different model providers behave differently when FreeContext is available

We also want a local workflow with no hosted eval service and no new runtime code inside `src/`.

## Decision

FreeContext uses Promptfoo for eval infrastructure.

The harness adds:

- tool-level evals that call the live FreeContext MCP server directly through a custom JavaScript provider
- agent-level evals that compare baseline and tool-enabled providers
- managed local server startup and teardown through Promptfoo extension hooks
- repo-local YAML config, cached results, and HTML report viewing

The committed agent matrix includes:

- Anthropic
- OpenAI
- OpenAI-compatible providers through the OpenAI provider with a custom base URL

Providers without configured credentials are filtered out before the suite runs.

## Consequences

- Eval configuration stays in the repository and can run locally without extra infrastructure
- Tool evals remain tied to the current MCP contracts in `src/mcp/server.ts`
- Agent evals can compare no-tool and with-tool behavior without adding LLM client code to the library itself
- Promptfoo becomes a dev dependency and adds an eval cache/result directory that must be ignored
- Anthropic, OpenAI, and OpenAI-compatible providers remain optional at runtime; tool evals do not require an API key
