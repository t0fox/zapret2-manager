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

Канонический production-путь сканера проходит через typed RPC, `z2k-detect`
и bounded JSON schema validation. `scanner-cli.uc` сохранён как compatibility
shell и не импортирует старый Manager-owned scanner.

## Исправление результата discovery

The historical architecture assumption was:

```text
ASSUMED:
scanner RPC -> manager-owned worker/planner
```

Repository and live-router evidence show the production path is:

```text
ACTUAL:
LuCI Scanner
  -> typed z2k_detect_* RPC
  -> coherent z2k-detect authority
  -> bounded JSON result
```

The retired Manager-owned worker, planner and probe modules are absent from
the production package. Detect-unavailable and incoherent states are surfaced
as canonical errors; there is no Detect-to-old-Scanner fallback.

## Границы продукта

- The canonical Scanner page exposes typed `probe`, `classify`, `quic`, `voice`
  and `tcp16` actions plus typed autodiscovery status/control.
- History wiring must not change Detect execution authority or introduce a new
  storage/orchestrator.
- Detect returns typed evidence only; it does not create candidates or own a
  Strategy handoff. Permanent Strategy Apply remains owned by the existing
  Strategy workflow.
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

Detect execution remains bounded by the typed RPC contract; permanent Strategy
Apply remains owned by the existing Strategy workflow.
