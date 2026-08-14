---
id: products-index
title: "Продуктовые области"
type: product
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [products, index]
---

# Продуктовые области

Публичная документация разделяет функции zapret2-manager по их назначению и праву на изменение состояния. Постоянная конфигурация относится к `Strategy`, временный поиск кандидатов — к `Scanner`, а M5 diagnostic family включает отдельный `BlockCheck`, `Block Detector` и два независимых Deep Search engines.

- [Стратегии (Strategy)](./strategy/index.md) — постоянная конфигурация, проверка и граница `Apply`.
- [Сканер (Scanner)](./scanner/index.md) — временная проверка и сравнение кандидатов.
- [BlockCheck](./blockcheck/index.md) — one-shot diagnostic flow и отдельный Block Detector monitor.
- [Deep Search](./deep-search/index.md) — official BlockCheck2 и optional BlockCheckW Fast engines.

Статус каждой области определяется текущим кодом и свежими проверками, а не наличием внутреннего design-документа.
