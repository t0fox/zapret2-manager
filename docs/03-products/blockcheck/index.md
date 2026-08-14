---
id: product-blockcheck-index
title: "BlockCheck"
type: product
status: planned
authority: index
updated: 2026-08-14
publish: true
tags: [product, blockcheck, planned]
---

# BlockCheck

**Status: Planned / in development.** BlockCheck is intended to be a focused diagnostic product area that provides structured evidence before a larger candidate-evaluation workflow begins.

## What it is

BlockCheck is designed as a bounded diagnostic step. Its result should be information that another product workflow can consume, not durable configuration by itself.

## Why it exists

A dedicated diagnostic stage makes later results easier to interpret. It gives the user a clearer starting point and keeps basic diagnosis separate from the broader search and ranking responsibilities of Scanner.

## Relationship to Scanner

Scanner is the candidate-evaluation workflow. BlockCheck is expected to provide context that can help decide whether a Scanner session is useful and what should be evaluated. It does not replace Scanner result handling or the Strategy authority path.

## Expected user workflow

The planned model is simple: provide the relevant context, run the bounded check, inspect its result, and then decide whether to continue into Scanner or another product area. A diagnostic result should remain distinguishable from a candidate Strategy and from durable application state.

## Current implementation status

The current public status remains **planned**. This page intentionally does not provide command examples, stable API fields, or detailed UI instructions because the repository does not yet justify presenting a finished BlockCheck workflow as shipped functionality.

When current code and fresh verification establish a real public path, this page can be expanded with verified usage. Until then it documents purpose, boundaries, and relationships only.

See [Scanner](../scanner/index.md), [Strategy](../strategy/index.md), and [Status and roadmap](../../01-project/status-roadmap.md).
