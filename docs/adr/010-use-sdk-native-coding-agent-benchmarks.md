---
title: Use SDK-Native Coding-Agent Benchmarks
---

# ADR 010: Use SDK-Native Coding-Agent Benchmarks

## Status

Accepted

## Context

The earlier Promptfoo agent harness compared a no-tools baseline against several MCP-oriented custom provider loops. That did not match the actual evaluation goal.

The goal is to measure whether FreeContext improves an already-capable coding agent:

- base agent with normal coding tools
- the same agent with FreeContext MCP added
- a scout phase that gathers evidence first, while the final coding agent still retains its own default tools
- an explicit scout-without-FreeContext tier on the Anthropic path so scout handoff can be measured separately from FreeContext lift

## Decision

FreeContext uses SDK-native coding-agent providers as the primary benchmark path for agent and edit evals.

- Codex rows use `@openai/codex-sdk`
- Claude rows use `@anthropic-ai/claude-agent-sdk`
- Promptfoo remains the orchestration and grading layer
- FreeContext MCP remains a managed local server started by the existing eval wrapper scripts
- fixture workspaces remain isolated from the real repository
- semantic capability is measured in a separate paired suite instead of enlarging the main matrix

The primary tiers are:

1. default coding tools
2. default coding tools plus FreeContext MCP
3. scout research plus a final coding agent with default tools, without FreeContext, where explicitly configured
4. scout research plus a final coding agent with default tools plus FreeContext MCP

## Consequences

- The benchmark now measures the intended comparison instead of “MCP versus a tool-less model”
- Base rows should no longer refuse by claiming they cannot inspect the repository
- Edit and non-edit agent evals share the same staged-workspace sandbox model, while the main Anthropic benchmark includes an extra scout-without-FreeContext comparison row
- Eval telemetry must distinguish local coding-agent tools, FreeContext MCP tools, and scout-phase usage
- Eval reporting must distinguish fresh prompt tokens from provider cache read or write usage
- The eval harness now depends directly on coding-agent SDKs, but only as dev-only dependencies outside `src/`
