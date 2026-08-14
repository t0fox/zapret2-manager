---
id: architecture-index
title: "Architecture Overview"
type: architecture
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [architecture, openwrt, overview]
---

# Architecture overview

The zapret2-manager architecture is designed around clear ownership. User interface code, application state, product logic, platform integration, and small native components are kept as separate responsibilities. The goal is to make it possible to answer a simple question for every change: which part of the application owns this state and which product path is allowed to make it durable?

## Main layers

At the top, LuCI provides the browser-facing interface. The application then crosses the normal OpenWrt service boundary into backend orchestration. Backend code works with canonical application state and delegates platform-specific work through adapters and narrow helpers.

This layered model matters because the project contains more than one product workflow. Strategy and Scanner can both reason about configuration candidates, but they do not have the same authority.

## Canonical state

Canonical state is the representation that the application treats as durable truth. User-interface state is not a replacement for it. A page can display or edit a proposal, but the backend remains responsible for the state that survives across sessions and application lifecycle events.

The native helper foundation supports backend responsibilities such as bounded parsing, safe filesystem access, hashing, and atomic writes. These helpers are deliberately narrow. They support the control plane rather than becoming a second independent product architecture.

## Strategy ownership

Strategy owns durable configuration. A Strategy can move through definition, compile, preflight, Preview, and Validate stages before the user reaches Apply. That separation means a proposal can be inspected without being treated as already permanent.

Apply is therefore an authority boundary rather than just another button. It marks the transition from reviewable intent to application-owned durable state.

## Scanner ownership

Scanner owns candidate exploration. Its work is temporary and should remain associated with one Scanner lifecycle: planning, candidate evaluation, observations, results, ranking, and cleanup.

A useful Scanner result is not automatically durable. The result can move into the Strategy model and then follow the Strategy review path. This prevents exploratory work from silently gaining permanent authority.

## Single-writer idea

When one product area owns a piece of canonical state, another product area should not independently make conflicting durable changes to it. This single-writer idea keeps state transitions understandable and reduces ambiguity during recovery.

It also improves diagnostics: if the problem concerns a durable Strategy, start with Strategy state; if it concerns a temporary Scanner candidate, start with the Scanner lifecycle.

## Reconciliation and cleanup

Application-owned state needs a predictable lifecycle across success, failure, restart, and recovery. Reconciliation compares expected owned state with what the application can observe and resolves differences through the component that owns the state.

Temporary work should be cleaned up through its owning lifecycle. Durable state should be changed through its owning product path. Broad resets are intentionally not part of the public architecture model.

## Safety model

The architecture favors bounded responsibilities, explicit ownership, review before durable changes, and scoped recovery. These are not separate security features added at the end; they are design constraints that shape the product workflow.

## Current maturity

The package, LuCI, backend, state, and native-helper foundations are real. Strategy is current and evolving. Scanner has substantial implementation but is still a prototype under active development. BlockCheck and Deep Search remain planned. The existence of an architectural layer is not evidence that every workflow using it is production-complete.

Continue with [Strategy](../03-products/strategy/index.md), [Scanner](../03-products/scanner/index.md), [Project overview](../01-project/index.md), [Installation](../11-operations/installation.md), [First Run / Quick Start](../11-operations/first-run.md), [Troubleshooting](../11-operations/troubleshooting.md), or [Development](../08-development/index.md).
