---
id: product-strategy-index
title: "Strategy"
type: product
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [product, strategy, workflow]
---

# Strategy

Strategy is the zapret2-manager product area for **durable configuration**. It is where a configuration can move from a definition that can be inspected into state that the application owns persistently. That makes Strategy different from Scanner: Scanner explores candidates, while Strategy owns the permanent Apply boundary.

The current Strategy path is evolving, so this page describes the product lifecycle without claiming that every possible configuration or validation path is already production-complete.

## Strategy catalog

The Strategy catalog is the user-facing collection of available Strategy definitions. A definition is data that can be selected, inspected, compiled, and reviewed. It should not be confused with an already applied configuration.

The repository also maintains Strategy state for selection and favorites. That state belongs to the product model and allows the interface to distinguish catalog contents from the current user choice.

## Compile and preflight

Before a Strategy becomes a runtime result, the project uses compile and preflight concepts. Compilation translates the selected definition into the form needed by the current backend. Preflight checks whether the proposal is coherent enough to proceed to later review stages.

A compile or preflight success is not the same thing as Apply. It is an earlier gate intended to make errors visible before durable state changes.

## Preview

**Preview** is the review surface for the proposed Strategy result. It gives the user a chance to understand what the application intends to do without treating the preview as already applied.

The useful mental model is:

```text
Strategy definition
       ↓
     compile
       ↓
    preflight
       ↓
     Preview
       ↓
    Validate
       ↓
      Apply
```

The exact fields shown by Preview come from the current implementation; public documentation does not invent example schema fields that are not verified by the repository.

## Validate

**Validate** is another gate before durable application where the current Strategy path supports it. It exists to catch a candidate that can be represented but should not be applied in its current form.

Validation results are evidence for the tested build. They do not replace OpenWrt SDK compilation, target-specific testing, or later runtime observation.

## Apply: the permanent authority boundary

**Apply is intentionally special.** It is the point where a reviewed Strategy can become durable application state. Previewing, compiling, validating, or discovering a candidate does not grant that authority.

This boundary prevents exploratory workflows from silently becoming permanent. Scanner can discover something useful, but the durable result still belongs to Strategy and should move through the Strategy review path.

## Rollback and reconciliation

The architecture includes reconciliation and recovery concepts for application-owned state. Public documentation only claims rollback behavior when the current implementation exposes and verifies it; users should not assume a universal rollback command exists for every development build.

The safer rule is to preserve observable state, use product-owned lifecycle actions, and avoid replacing a narrow recovery problem with broad manual reset actions.

## Relationship to Scanner

Scanner evaluates candidates and returns findings. Those findings are not permanent Strategies by default. A candidate that is worth keeping can be saved or promoted into the Strategy model, where it becomes subject to the same review and authority boundary as other durable configuration.

That separation also makes development easier to reason about: Scanner owns temporary exploration, Strategy owns persistent application.

## Current status

**Status: current, evolving.** Strategy is a real product area in the current repository, but the project as a whole remains a prototype. Treat the available UI and backend behavior of the exact build you are testing as the source of truth for supported fields and actions.

For a first session, follow [First Run / Quick Start](../../11-operations/first-run.md). For system ownership, see [Architecture](../../02-architecture/index.md). For maturity across all product areas, see [Status and roadmap](../../01-project/status-roadmap.md).
