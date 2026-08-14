---
id: product-scanner-index
title: "Scanner"
type: product
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [product, scanner, prototype]
---

# Scanner

**Status: prototype / under active development.** Scanner is the zapret2-manager product area for evaluating candidate configurations without giving those candidates permanent authority. The repository already contains substantial Scanner implementation, but the complete production end-to-end lifecycle is still being completed and should not be described as stable.

## Purpose

Scanner exists to turn an open-ended search problem into a bounded candidate workflow. It takes a target and current scan settings, plans candidates, evaluates them through the available runtime path, records observations, ranks useful results, and cleans up temporary state.

The important product distinction is that a Scanner result is a **finding**, not an automatically applied Strategy.

## Candidate planning

Candidate generation is represented in the current repository by dedicated Scanner model and generator components. Planning determines which candidates should be evaluated and preserves enough structure for the rest of the lifecycle to identify the candidate being processed.

The public documentation does not publish internal search heuristics or assume that every planned candidate family is already complete. What matters to a user is that Scanner evaluates explicit candidates rather than making an unexplained permanent change.

## Transient execution

Scanner work is temporary by design. The repository contains a transient runtime component, worker path, runtime adapter, native Scanner helper, probe components, state handling, and result handling. Those pieces show that Scanner is more than a placeholder, but active integration work means they should not be interpreted as proof of full production E2E maturity.

A simplified lifecycle is:

```text
Scanner request
      ↓
    planner
      ↓
   candidate
      ↓
transient runtime
      ↓
 observation / probe
      ↓
 result and ranking
      ↓
    cleanup
```

Temporary execution belongs to the Scanner lifecycle. Cleanup is part of the lifecycle rather than an optional afterthought.

## Probes and observations

Scanner uses probe-oriented components to collect evidence about a candidate. The exact supported probe set is implementation-defined and can change while the prototype evolves. Public documentation therefore explains the role of probes without inventing a stable CLI or configuration schema that the current repository does not guarantee.

Probe output becomes useful only when it remains associated with the candidate and test context that produced it.

## Ranking and results

A scan can produce more than one candidate result. Ranking exists to help compare findings rather than forcing the first observed candidate to become the answer. Result handling should preserve enough context for the user or later product logic to decide whether a candidate is worth keeping.

A ranked result still does not cross the permanent Strategy authority boundary by itself.

## Save as Strategy

The durable handoff is conceptually **Save as Strategy**: a useful Scanner candidate can be represented in the Strategy product model and then reviewed through Strategy's compile, preflight, Preview, Validate, and Apply stages.

This separation is intentional. Scanner owns exploration; Strategy owns durable application. It prevents an exploratory workflow from silently becoming persistent state.

## Cleanup and recovery

Scanner-created temporary state should be identifiable as Scanner-owned and cleaned up through controlled lifecycle paths. A failed candidate should not imply that unrelated OpenWrt state needs to be reset.

When diagnosing a Scanner problem, preserve the build revision, candidate context, visible status, and result or error information. That evidence is more useful than a broad manual reset that erases the state needed to understand the failure.

## Current implementation boundary

The current tree contains Scanner CLI/model/state/generator/transient/probe/worker/result/runtime-adapter pieces and native Scanner code. At the same time, current engineering work still includes lifecycle/protocol integration. The correct public conclusion is therefore **substantial prototype, not finished production runtime**.

When later implementation and verification prove the full lifecycle, this page can be promoted. Until then, the status label stays conservative.

## Related documentation

- [Strategy](../strategy/index.md)
- [Architecture](../../02-architecture/index.md)
- [First Run / Quick Start](../../11-operations/first-run.md)
- [Troubleshooting](../../11-operations/troubleshooting.md)
- [Status and roadmap](../../01-project/status-roadmap.md)
