---
id: product-strategy-index
title: "Стратегии"
type: product
status: current
authority: index
updated: 2026-08-13
publish: true
tags: [product, strategy]
---

# Стратегии

Strategy — это набор параметров nfqws2/zapret2 для конкретных протоколов,
портов, hostlist/IPSet и payload. Стратегия не является просто названием:
важны профиль TCP/UDP/QUIC, порядок аргументов, Lua/blob и ссылки на ресурсы.

## Рабочий процесс

1. Найдите вариант в каталоге поиском, фильтрами или рекомендациями.
2. Откройте карточку, сравните протоколы, hostlist/IPSet и provenance.
3. Выполните **Preview**: проверьте effective strategy, exact args и resolved assets.
4. Выполните **Validate**: ошибки syntax, файлов, портов и capability должны
   быть исправлены до Save/Apply.
5. Сохраните draft или создайте пользовательскую копию, затем примените через
   канонический Strategy API.

Visual editor показывает только lossless распознанные поля: desync mode,
repeats, splits, fake/template, hostlist/IPSet, Z2K flags и Lua options. Raw
editor сохраняет неизвестный syntax без потерь. Если преобразование небезопасно,
IDE остаётся в Raw-only mode.

## Важные различия

- **selected** — выбранный в UI вариант;
- **applied** — подтверждённый runtime вариант;
- **favorite** — только пользовательская отметка;
- **autocircular auto/frozen/excluded** — состояние обучения, не отдельный
  permanent Apply path.

Scanner создаёт transient candidate. Он попадает в Strategy IDE и проходит тот
же Preview → Validate → Save → Apply путь; Scanner не владеет постоянным Apply.

См. [полномочия применения стратегий](../../07-decisions/adr-005-strategy-apply-authority.md)
и [происхождение каталога](./source-provenance.md).

Граница каталога и происхождения описана в документе
[«Происхождение источников стратегий»](./source-provenance.md).
