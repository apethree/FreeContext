---
title: "ADR 003: Pin Tree-sitter Runtime to Peer Range"
---

# ADR 003: Pin tree-sitter runtime to the grammar peer range

## Status

Accepted

## Context

Phase 1 uses `tree-sitter-typescript` and `tree-sitter-javascript` grammar packages.
Those packages declare optional peer compatibility with `tree-sitter` 0.21.x.

Using `tree-sitter` 0.22.x caused a fresh `npm install` to fail with peer resolution errors, which blocked the required Phase 1 verification flow on a clean checkout.

## Decision

Pin the `tree-sitter` runtime dependency to `^0.21.1` for Phase 1.

## Consequences

- A clean `npm install` works without `--legacy-peer-deps`
- The parser implementation stays within the tested compatibility window of the installed grammars
- Upgrading to a newer `tree-sitter` runtime should happen only after the grammar packages publish a matching peer range or the parser stack is updated together
