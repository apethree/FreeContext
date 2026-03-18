# ADR 012: Add Local Eval Control UI

## Status

Accepted

## Context

The active Promptfoo harness relies on repo-local runner scripts to do more than plain `promptfoo eval`:

- stage sandbox workspaces
- start and stop managed FreeContext MCP servers
- normalize direct versus proxy-backed provider env vars
- pre-filter repeated custom JS provider rows into temporary configs

Promptfoo's built-in viewer is useful for inspecting completed runs, but it is not the right place to manage provider routing or launch these repo-specific runner flows.

## Decision

Add a small local control server and static web UI under `evals/` that:

- stores local eval routing config under `evals/.promptfoo/`
- lets the user set Anthropic and OpenAI base-model routing as direct or proxy-backed
- lets the user set scout routing as OpenRouter or OpenAI-compatible local/remote
- launches the existing repo runner scripts instead of bypassing them
- shows current model-derived row labels and recent run logs

The UI remains local-only and zero-dependency. It does not replace Promptfoo's viewer; it complements it.

## Consequences

- Common eval routing changes no longer require editing shell env vars by hand
- Provider/scout combinations can be launched with less command-line friction
- The existing sandboxing and runner logic remains the single execution path
- The UI adds local convenience only; it does not change FreeContext runtime behavior
