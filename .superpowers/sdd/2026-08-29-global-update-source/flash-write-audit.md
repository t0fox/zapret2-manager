---
id: global-update-source-flash-write-audit
title: "Global Update Source Flash Write Audit"
type: doc
status: current
authority: evidence
updated: 2026-08-29
publish: false
tags: [update-source, flash, audit, cache, lkg]
---

# Flash-write audit

The question for every write below is whether it is remote browse metadata or
product state/content. Ordinary migrated metadata is now ephemeral.

| Flow | Before | After | Allowed persistent writes |
| --- | --- | --- | --- |
| Shared update metadata | Fragmented consumer caches, including Engine release metadata under `/etc` | `/tmp/zapret2-manager/update-cache`, `/tmp/zapret2-manager/update-source`, and per-source locks; atomic LKG | None; cache/status/rate state is transient. |
| Telegram provider browsing | Provider metadata was fetched in product flow | Coordinator LKG under `/tmp`; provider status/config remains product-owned | `/etc/zapret2-manager/proxy-provider.json` only for installed/configured product truth and mutation lifecycle. |
| Official Engine catalog | Release catalog used `/etc/zapret2-manager/engine-cache` alongside product state | Coordinator LKG under `/tmp`; `/etc` Engine paths remain state/artifacts only | `/etc/zapret2-manager/engine-state.json` and operation-required `engine-cache/current.*`; no browsing catalog. |
| BlockCheckW status/check | Latest-release metadata fetched directly | Coordinator LKG/status under `/tmp` | `/tmp/zapret2-manager/jobs` job state; installer-owned content writes remain mutation paths. |
| Z2K catalog/tag/manifest/Compare metadata | Lifecycle-owned metadata/cache paths | Shared coordinator LKG, status, locks, and rate state under `/tmp`; Compare keeps only normalized product evidence under `/tmp` | `/etc/zapret2-manager/registry.json`, activation receipts, CHECK_STATE, installed assets, and operation journals remain lifecycle state/content. No Z2K browse metadata is written to flash. |

The coordinator writes only bounded JSON under its configurable test roots or
the default `/tmp` roots. It stages and atomically replaces LKG after parse,
validation, and normalization; failure never replaces the previous LKG. The
product tests include a static no-flash-browse assertion and the coordinator
focused gate passed 29/29 in WSL UCode.

Persistent installed truth, activation/state receipts, operation journals,
archive bytes, checksum files, and rollback material are not browse metadata
and remain with their existing owners.
