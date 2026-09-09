---
id: scanner-runtime
title: "Runtime Сканера"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, scanner, runtime]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc#scanner_cli_dispatch]
---

# Scanner runtime

Production authority Scanner: `LuCI → typed Z2M RPC → z2k-detect --json`.
`scanner-cli.uc` остаётся compatibility shell для старых внутренних callers и
направляет только в typed Detect actions; Manager-owned worker/planner/prober
modules are not a production fallback.

## Полный цикл

Typed RPC validates the target and bounded arguments, gates execution on the
coherent Core/Detect status, invokes one fixed Detect operation, validates its
JSON envelope and records typed evidence.

Detect autodiscovery is a procd-managed service controlled through typed
status/enable/disable/restart RPCs. Detect-unavailable, stale and incoherent
states remain canonical errors; they never fall back to the retired Scanner.

## Handoff

Detect публикует typed evidence, а не transient candidate и не готовую
Strategy. Если пользователь хочет постоянное изменение, он отдельно выбирает
вариант в каталоге Strategy и проходит обычный Preview → Validate → Save →
Apply workflow; permanent save/apply остаётся только за Strategy API.
