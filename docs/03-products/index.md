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

Публичная документация разделяет функции zapret2-manager по их назначению и праву на изменение состояния. Постоянная конфигурация относится к `Strategy`, временный поиск кандидатов — к `Scanner`, а `BlockCheck` и `Deep Search` пока описываются как планируемые области.

- [Стратегии (Strategy)](./strategy/index.md) — постоянная конфигурация, проверка и граница `Apply`.
- [Сканер (Scanner)](./scanner/index.md) — временная проверка и сравнение кандидатов.
- [BlockCheck](./blockcheck/index.md) — планируемый ограниченный диагностический этап.
- [Deep Search](./deep-search/index.md) — планируемый расширенный поиск для сложных случаев.

Статус каждой области определяется текущим кодом и свежими проверками, а не наличием внутреннего design-документа.
