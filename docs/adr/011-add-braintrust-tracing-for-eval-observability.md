# 011: Add Braintrust Tracing For Eval Observability

Date: 2026-03-17

## Status

Accepted

## Context

The Promptfoo eval harness now measures SDK-native coding agents, scout-bridge runs, and FreeContext MCP lift. Promptfoo scores and saved JSON are useful, but they do not show the step-by-step interaction between scout discovery, final-agent work, and FreeContext MCP calls.

We need trace-level visibility so an eval can answer:

- which tools the scout called
- which tools the final agent called
- which FreeContext MCP calls were made
- the exact FreeContext arguments, including `search_code.mode`, so semantic vs fulltext vs hybrid usage is explicit

## Decision

Add Braintrust as a dev-only eval dependency and instrument the active eval providers with manual spans.

The active trace structure is:

- `eval_case`
- `scout_phase`
- `main_phase`
- `freecontext_mcp_call`
- `tool_call`

Each `freecontext_mcp_call` span logs:

- phase
- tool name
- tool args
- `searchMode`

## Consequences

- Eval runs can be inspected at the span level without changing `src/` runtime behavior.
- Semantic retrieval usage can be verified from logged FreeContext args rather than inferred from prompts.
- The staged sandbox strategy remains unchanged:
  - fixed fixture source under `evals/workspaces/`
  - disposable staged workspaces under `evals/.promptfoo/workspaces/`
  - separate LanceDB state outside the fixed fixture source
