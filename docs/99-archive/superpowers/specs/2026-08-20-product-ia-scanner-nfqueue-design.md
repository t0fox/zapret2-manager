---
id: product-ia-scanner-nfqueue-design
title: "Product IA consolidation, Scanner wiring, and NFQUEUE dependency design"
type: spec
status: planned
authority: proposed
updated: 2026-08-20
publish: true
tags: [product, scanner, navigation, nfqueue]
---

# Product IA consolidation, Scanner wiring, and NFQUEUE dependency design

Status: approved for implementation
Date: 2026-08-20

## Architectural evidence

The discovery result changes the former assumption about Scanner ownership:

```text
ASSUMED:
scanner RPC -> scanner-orchestrator

ACTUAL:
scanner RPC -> scanner-cli -> scanner-worker -> scanner-planner

scanner-orchestrator -> present in repository -> not wired to production RPC
```

`scanner-orchestrator.uc` is therefore classified as an `unwired/non-production path` in this slice. It is not removed, renamed, or connected to RPC. The production Scanner remains the current CLI/worker/planner chain.

## Product boundaries

- The single canonical Scanner route is `scan` and its page is a consolidation shell over existing contracts.
- `Подбор стратегии` calls the existing `scanner_*` RPC contract and does not add a runtime.
- `Диагностика` keeps the existing BlockCheck, BlockCheck2, blockcheckw, and detector modes and RPCs. Their engine controls remain inside that tab; the primary strategy scan has no engine chooser.
- `История` is a bounded read-only projection of existing Scanner records under the existing Scanner runtime storage. It does not create a storage owner or an orchestrator.
- Strategy persistence and Apply remain owned by the existing Strategy API and Avatar catalog authority.
- WARP remains a UI/navigation shell only. No backend is invented; the missing production owner is an explicit remaining gap.
- Forgejo is not connected. Avatar remains canonical because no production Forgejo consumer was found.

## Navigation contract

The navigation model remains the sole route authority. Canonical primary routes are:

```text
Главная: dashboard
Обход DPI: control, strategies, scan
Прокси и маршрутизация: warp, telegram-tunnel
Списки и данные: services, resources, dns-routing
Диагностика: monitor, logs
Система: zapret, updates, settings
```

Existing bookmarks are preserved through aliases and route parameters. The compatibility routes do not create duplicate page lifecycles. Resource subtypes and WARP subviews are represented as parameters of their canonical page. Existing visual-frozen pages (Home, Strategies, DNS, Telegram Proxy) receive only route/integration changes.

## NFQUEUE contract

The backend package declares the exact target dependencies `+kmod-nfnetlink-queue +kmod-nft-queue`. Scanner start performs a read-only dependency preflight before state claim, session creation, queue/rule mutation, or candidate activation. Missing queue capability returns structured `EDEPENDENCY` with missing dependency details. No `insmod` fallback is added or used.

## Verification boundary

Host checks must prove the new tests and existing relevant suites. Package checks must prove dependency metadata and installation. Target acceptance must install the package, reboot, run without manual `insmod`, execute Scanner, verify temporary NFQUEUE creation/cleanup while production queue 300 remains, verify DNS and HTTPS, and run a completeness audit. Any unavailable target step is reported as not run, not as pass.
