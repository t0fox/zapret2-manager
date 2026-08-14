---
id: product-blockcheck-index
title: "BlockCheck"
type: product
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [product, blockcheck, block-detector, current]
---

# BlockCheck

**Статус: реализовано в M5.** BlockCheck — отдельный интерактивный one-shot diagnostic flow; Block Detector рядом с ним, но не является его режимом.

## Что это такое

BlockCheck поддерживает `quick`, `full` и `dpi_only`, bounded domain input, progress/status, cancellation, evidence/results, Deep Trace/traceroute и typed recommendations. Его результат — информация для пользователя и других продуктовых сценариев, а не постоянная конфигурация сама по себе.

## Зачем он нужен

Отдельная диагностика делает последующие результаты понятнее. Пользователь получает исходный контекст, а базовая проверка не смешивается с более широкой задачей перебора и ранжирования кандидатов, которой занимается Scanner.

## Связь со Scanner

Scanner остаётся отдельным workflow проверки кандидатов. BlockCheck предоставляет контекст, который помогает понять, нужен ли запуск Scanner и какие направления проверки имеют смысл. Он не заменяет Scanner и не получает полномочия Strategy.

## Предполагаемый сценарий

Путь: передать контекст и домены, выполнить bounded probes, посмотреть evidence/classification и при необходимости перейти к Scanner или Deep Search. Infrastructure/dependency failure не превращается в ложный DPI finding.

## Block Detector — отдельный flow

Block Detector — фоновый DNS-monitoring product. Он обнаруживает домены из dnsmasq/AdGuard log (или сообщает unavailable для AF_PACKET), периодически выполняет probes и сохраняет discovered domains, findings и candidates для managed lists. Его `start/status/results/stop` lifecycle не смешивается с интерактивным BlockCheck.

## Текущее состояние реализации

Production surface находится во вкладке BlockCheck. BlockCheck2 и BlockCheckW Fast доступны там же как независимые engines; только существующий Strategy authority может выполнять Preview → Validate → Apply.

Evidence: `tests/product/blockcheck-family.test.mjs`, pinned ucode model/CLI smoke и upstream Avatar SHA `947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c`. Физический router smoke в этом change set не запускался.

См. также [Scanner](../scanner/index.md), [Strategy](../strategy/index.md) и [Статус и план развития](../../01-project/status-roadmap.md).
