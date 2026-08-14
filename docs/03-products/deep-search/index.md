---
id: product-deep-search-index
title: "Deep Search"
type: product
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [product, deep-search, blockcheck2, blockcheckw, current]
---

# Deep Search

**Статус: реализовано в M5 как два независимых engines.** Deep Search — расширенный поисковый workflow для случаев, когда обычной проверки кандидатов недостаточно.

## Что это такое

Deep Search exposes official BlockCheck2 (`blockcheck2.sh`) and BlockCheckW Fast (`status`, `scan`, `universal`, `check`). Manager owns typed request validation, durable jobs, process identity, bounded output/results and cancellation; upstream engines own algorithms.

## Зачем он нужен

Не каждый случай решается небольшим набором кандидатов. Отдельная продуктовая область позволяет расширять поиск, не усложняя обычные Scanner-сессии для всех пользователей.

## Связь со Scanner

Scanner остаётся отдельным Catalog Strategy workflow. BlockCheckW — отдельный external Rust provider with manual-only version/update policy; it is not a replacement for Avatar BlockCheck or Block Detector.

Ни Scanner, ни Deep Search не владеют постоянным применением. Полезный результат должен перейти в Strategy и пройти её проверку до того, как станет долговременным состоянием.

## Предполагаемый сценарий

Путь: выбрать engine и typed options, наблюдать progress/live output, изучить parsed report, затем отправить server-produced Strategy aggregate в Preview и Validate. Permanent Apply остаётся за Strategy.

Так сохраняется общая модель полномочий: исследование отделено от постоянного применения.

## Текущее состояние реализации

Evidence: BlockCheck2 env/parser/stream tests, BlockCheckW report adapter/provider tests and LuCI wiring in `z2m-blockcheck-page.js`. Router execution remains a separate target gate.

См. [Scanner](../scanner/index.md), [Strategy](../strategy/index.md), [BlockCheck](../blockcheck/index.md) и [Статус и план развития](../../01-project/status-roadmap.md).
