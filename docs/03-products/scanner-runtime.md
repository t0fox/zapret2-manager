---
id: scanner-runtime
title: "Runtime Сканера"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, scanner, runtime]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc#finish]
---

# Scanner runtime

Production authority Scanner: `scanner RPC → scanner-cli-entry → scanner-cli →
scanner-worker → scanner-planner`. `scanner-orchestrator.uc` остаётся
present, но unwired/non-production и не меняет этот путь.

## Полный цикл

Worker валидирует target, строит bounded plan, получает candidates, выполняет
dependency preflight, активирует временный candidate, стабилизирует runtime,
запускает реальный probe, записывает evidence и выполняет cleanup.

Временные process/table/NFQUEUE принадлежат Scanner только на время session.
Финальное состояние публикуется лишь после verified cleanup и reconciliation.
`best: null` — корректный результат без доказанного победителя; он не даёт
основания применять последний candidate.

## Handoff

Результат открывается в Strategy IDE с provenance, catalog digest и evidence.
Permanent save/apply остаётся только за Strategy API.
