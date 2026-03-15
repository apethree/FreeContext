# ADR 001: Use tree-sitter instead of the TypeScript Compiler API

**Status**: Accepted
**Date**: 2026-03-15

---

## Context

We need to extract structured symbol information (names, kinds, line ranges, call expressions) from TypeScript and JavaScript source files.

Two credible options:

1. **TypeScript Compiler API** (`tsc` programmatic API)
2. **tree-sitter** with `tree-sitter-typescript` and `tree-sitter-javascript` grammars

---

## Decision

Use tree-sitter.

---

## Rationale

| Concern | TypeScript Compiler API | tree-sitter |
|---------|------------------------|-------------|
| Handles partial/invalid code | No — fails on syntax errors | Yes — produces partial AST |
| Multi-language | TypeScript only | Any language with a grammar |
| Startup time | Slow (full TS program init) | Fast (C native, grammar precompiled) |
| No-browser requirement | Needs tsc config | No config required |
| Call-graph accuracy | High (type-resolved) | Medium (syntactic only) |
| Dependency weight | Ships with TypeScript | Small native binary |

For a code intelligence engine that must be fast and resilient, tree-sitter's tolerance for partial code is more important than type-resolved accuracy at this stage.

---

## Consequences

- Call expressions are captured syntactically, not semantically. A call to `foo()` inside a method body is recorded as `calls: ["foo"]` — not resolved to a specific symbol's ID. Full resolution happens in Phase 3 via the edge extractor.
- Adding support for Python, Go, etc. in a future phase is straightforward: add the grammar, implement a parser adapter.
- We accept the `tree-sitter@0.22` / grammar peer version mismatch warning (grammars declare `^0.21` peer, actual is `0.22` — runtime is compatible).
