# ADR 013: Add Braintrust-Native Experiment Runners

## Status

Accepted

## Context

FreeContext already had:

- Promptfoo for deterministic eval execution
- Braintrust tracing for scout, main, and FreeContext tool spans

That was enough for trace drill-down, but not enough for experiment-style comparison. The main missing capability was a repo-local evaluator that:

- runs the same staged workspace and managed MCP flow as Promptfoo
- groups strategy variants into one Braintrust experiment
- records deterministic and qualitative scores directly on experiment rows

## Decision

Add repo-local Braintrust experiment runners in TypeScript for:

- non-semantic agent evals
- semantic agent evals

The runners reuse the existing provider implementations instead of rebuilding agent logic. Promptfoo remains in the repo for deterministic harnesses, smoke workflows, and the existing UI, but Braintrust becomes the primary analysis surface.

The Braintrust runners:

- load cases from the existing Promptfoo YAML suites
- expand them across the active 3-tier strategy matrix
- run strict deterministic scorers in code
- run local LLM-based scorers in code
- write a local summary artifact under `evals/.braintrust/`

## Consequences

Positive:

- one experiment table can compare strategies, scores, and metadata side by side
- scout/main/FreeContext spans remain drill-down compatible through Braintrust traces
- the active `expected` benchmark targets are reused instead of being re-entered in the Braintrust UI

Tradeoffs:

- Promptfoo and Braintrust now coexist during the migration period
- the Braintrust LLM grader depends on a configured grading model route
- Braintrust runner smoke tests require real network access plus a bindable local MCP port
