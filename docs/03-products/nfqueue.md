---
id: nfqueue
title: "NFQUEUE и runtime ownership"
type: product
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [technology, nfqueue, scanner]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc#health_block]
---

# NFQUEUE

Production queue принадлежит Engine. Typed Detect не владеет NFQUEUE и не
подменяет `nfqws2`; runtime status читает queue ownership и правила как
evidence для Engine health.

## Evidence

Для внутренних profile-activation операций общий runtime adapter может иметь
временную ownership session с bounded cleanup. Это не является Scanner
product API и не меняет permanent Engine ownership.

Если cleanup не подтверждён, состояние остаётся `uncertain`/`recovery`, а не
`success`. Это safety contract, а не UX-ошибка.
