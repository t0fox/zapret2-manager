---
id: strategy-runtime
title: "Runtime Стратегии"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, strategy, runtime]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc#strategy_apply]
---

# Strategy runtime

Strategy — канонический владелец permanent Preview → Validate → Save → Apply.
RPC facade и IDE используют этот lifecycle; Z2K Detect возвращает только
измерение и evidence, а параллельный apply-owner не создаётся.

## Границы проверки

`Preview` строит effective projection без изменения runtime. `Validate`
добавляет native preflight, dependency evidence и execution admission. `Apply`
проверяет uncertain guard, revision/digest, наличие enabled Profile и
совместимость dependencies до записи конфигурации.

## selected и applied

`selected` — выбор интерфейса, `applied` — подтверждённое runtime-состояние,
`favorite` — пользовательская отметка. Z2K Detect возвращает evidence и не
создаёт permanent candidate; постоянное изменение начинается только в обычном
Strategy workflow.
