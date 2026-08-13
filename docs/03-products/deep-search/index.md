---
id: product-deep-search-index
title: "Deep Search"
type: product
status: planned
authority: index
updated: 2026-08-14
publish: true
tags: [product, deep-search, planned]
---

# Deep Search

**Status: Planned / in development.** Deep Search is intended to be a broader exploration product area for cases where the normal candidate workflow does not provide enough useful information.

## What it is

Deep Search represents a more extensive search process than the standard Scanner path. Its purpose is to organize a wider exploration while still returning structured findings that can be reviewed by the user.

## Why it exists

Not every case is resolved by a small candidate set. A separate Deep Search product area allows the project to model a broader workflow without making normal Scanner sessions unnecessarily complex.

## Relationship to Scanner

Scanner remains the normal candidate-evaluation path. Deep Search is expected to build on related concepts such as candidates, observations, results, and ranking, while allowing a larger or more adaptive exploration process.

Neither product owns permanent application. A useful result still belongs in the Strategy workflow before it becomes durable state.

## Expected user workflow

The planned user flow is to begin with normal diagnosis and Scanner where appropriate, move to Deep Search only when broader exploration is justified, inspect the resulting candidates, and save a useful result into Strategy for review.

This keeps broader exploration separate from permanent application and preserves the same authority model used elsewhere in the project.

## Current implementation status

The public status is **planned**. The repository contains design material for Deep Search, but design material is not sufficient evidence for a shipped feature. This page therefore does not invent commands, stable configuration fields, or UI controls.

When a current implementation and fresh verification establish a supported workflow, the page can be expanded with real usage instructions and its maturity label can be reconsidered.

See [Scanner](../scanner/index.md), [Strategy](../strategy/index.md), [BlockCheck](../blockcheck/index.md), and [Status and roadmap](../../01-project/status-roadmap.md).
