---
id: nfqueue
title: "NFQUEUE и временный Scanner runtime"
type: product
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [technology, nfqueue, scanner]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc#scanner_candidate_activate]
---

# NFQUEUE

Production queue принадлежит Engine. Scanner может использовать только
временную, явно именованную ownership session и не должен менять production
queue 300 или `nfqws2`.

## Evidence

Перед session фиксируются process/queue/firewall/DNS/HTTPS baseline. Во время
видны temporary table, helper/process и queue. После probe Scanner обязан
удалить только свои объекты, проверить отсутствие temporary ownership и
подтвердить, что production ownership не изменился.

Если cleanup не подтверждён, состояние остаётся `uncertain`/`recovery`, а не
`success`. Это safety contract, а не UX-ошибка.
