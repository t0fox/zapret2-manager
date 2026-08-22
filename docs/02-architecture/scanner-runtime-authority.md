---
id: scanner-runtime-authority
title: "Полномочия runtime сканера"
type: architecture
status: current
authority: evidence
updated: 2026-08-21
publish: true
tags: [architecture, scanner, runtime, authority]
---

# Полномочия runtime сканера

Канонический production-путь сканера проходит через RPC, `scanner-cli-entry`,
`scanner-cli`, `scanner-worker` и `scanner-planner`. `scanner-orchestrator.uc`
присутствует в исходниках, но не подключён к production RPC.

## Исправление результата discovery

The initial architecture assumption was:

```text
ASSUMED:
scanner RPC -> scanner-orchestrator
```

Repository and live-router evidence show the production path is:

```text
ACTUAL:
scanner RPC
  -> scanner-cli-entry
  -> scanner-cli
  -> scanner-worker
  -> scanner-planner
```

`scanner-orchestrator.uc` is present in the repository, but discovery did not
find it wired to the production Scanner RPC. It is therefore classified as an
unwired/non-production path, not as legacy code. This classification prevents
future work from accidentally creating a second Scanner runtime.

## Границы продукта

- The canonical Scanner page consolidates the existing production contracts:
  strategy search uses the current Scanner API, diagnostics retain
  BlockCheck/BlockCheck2/blockcheckw controls, and history is a bounded read-only
  projection of existing Scanner state.
- History wiring must not change Scanner execution authority or introduce a new
  storage/orchestrator.
- Permanent Strategy Apply remains owned by the existing Strategy workflow.
- The engine chooser is absent from the primary scan flow; diagnostic engine
  controls remain available in Diagnostics.
- WARP remains a navigation/UI shell only until a production backend owner and
  RPC contract are proven. Forgejo is not connected; Avatar remains canonical.

## Доказательства runtime

The target-router acceptance probe confirmed that malformed starts fail with
`EINPUT` and a valid start returns the bounded accepted envelope with
`scanId` and `state: "running"`. The production queue owner remained NFQUEUE
300 during this transport probe. Host-side ucode-dependent tests are marked
unrun when no host `ucode` binary is available; they are not treated as passes.

The current planner measurement is a remaining performance gap, not an
authority change: a quick plan on the target took approximately 23–28 seconds
and returned 27–28 compiled candidates before the execution shortlist was
bounded to 20.
