---
id: development-docs-freshness
title: "Актуальность документации вместе с разработкой"
type: development
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [development, docs, freshness, ci, evidence]
---

# Актуальность документации вместе с разработкой

Документация zapret2-manager должна меняться **вместе с продуктовым кодом**, а не отдельной кампанией раз в несколько месяцев. Для этого в репозитории есть bounded change-impact check `scripts/check-docs-freshness.mjs`: он сопоставляет изменившиеся product/runtime области с документацией, которую необходимо пересмотреть в том же change set.

Это не генератор текста и не попытка автоматически решить, что написано правильно. Gate отвечает на более простой, но важный вопрос: **«изменился ли продукт, а документационный impact вообще был обработан?»**

## Зачем нужен freshness gate

Без формального правила documentation drift возникает почти неизбежно. Например, Scanner получает новый lifecycle, tests становятся зелёными, а публичная страница ещё месяц говорит, что существует только planner. Или Strategy меняет Apply admission, но roadmap/parity продолжают показывать старую границу.

Поэтому существенная source mutation должна иметь один из двух результатов:

1. соответствующая public/evidence документация обновлена;
2. документация явно пересмотрена и в ней зафиксировано, что публичный контракт не изменился.

Просто отсутствие изменения Markdown больше не считается доказательством «docs не затронуты».

## Strategy

Изменения Strategy/Profile source, compiler, state, Apply/preflight или LuCI Strategy flow требуют пересмотреть как минимум одну из областей:

- `docs/03-products/strategy/`;
- публичную Avatar parity;
- evidence-backed roadmap.

Пример:

```text
strategy-compiler.uc изменился
        ↓
проверить:
  Strategy lifecycle
  parity status
  roadmap milestone
```

Если изменение только внутренне реорганизует код и не меняет product contract, допустимо коротко обновить lifecycle/evidence note с указанием, что внешняя семантика сохранена. Важно, что решение принято явно.

## Scanner

Scanner — особенно чувствительная область, потому что его зрелость сейчас быстро меняется. Изменения model/planner/generator/probes/worker/transient/runtime adapter или Scanner LuCI должны сопровождаться пересмотром:

- `docs/03-products/scanner/`;
- Avatar parity;
- roadmap.

Это защищает от двух противоположных ошибок. Первая — документация отстаёт от кода. Вторая — документация слишком рано повышает Scanner до production-ready только потому, что появился очередной модуль.

Например, усиление A1 lifecycle должно попасть в current-main delta и M3 roadmap. Но глобальный parity count не пересчитывается, пока не выполнен полный re-audit соответствующих capability.

## BlockCheck family

Изменения `BlockCheck`/`BlockCheck2` source должны отражаться в:

- странице BlockCheck;
- странице [Scanner / BlockCheck / BlockCheck2](../03-products/scanner/family.md);
- parity или roadmap.

Это не позволяет снова смешать три разных Avatar flow в один общий статус «сканирование реализовано».

## DNS, lists и routing dependencies

Изменения DNS, service-DNS, domain hub или lists требуют пересмотра [DNS, routing и assets](../03-products/dns-routing-assets.md) либо project parity/roadmap.

Причина — эти области связаны не только с UI. Они являются dependency foundation для registries, selectors, unified routing и будущего auto-remediation. Новый DNS owner или list identity может менять дорожную карту даже тогда, когда внешний экран выглядит почти так же.

## Proxy и tunnels

Изменение proxy/provider lifecycle рассматривается как потенциальное изменение tunnel foundation. Оно требует обновления DNS/routing/assets, parity или roadmap.

Это важно для будущих WARP/usque, AWG, sing-box и других providers: public docs должны показывать, какой lifecycle уже общий, а что всё ещё остаётся approved design.

## Core ownership

Изменения state/jobs/transaction/namespace/process/recovery/result или native ownership foundation требуют пересмотра:

- [Runtime flow](../02-architecture/runtime-flow.md);
- [Владение состоянием](../02-architecture/state-ownership.md);
- [Доказательства и тестирование](./evidence-testing.md);
- либо roadmap, если изменение относится к milestone foundation.

Core refactor может быть невидим пользователю, но он часто меняет свойства recovery, process identity или transaction safety. Эти свойства являются частью публичной архитектуры проекта и должны оставаться актуальными.

## Что не триггерит gate само по себе

Чтобы check не превратился в шум, первая версия ограничена product/runtime source. Изменения только в tests, docs, scripts, CI metadata или generated artifacts сами по себе не создают product freshness violation.

Это не означает, что tests не важны. Просто тесты являются **evidence**, а не причиной переписывать product docs при каждом переименовании fixture.

## Как работает CLI

Checker умеет оценивать явный список changed paths — это используется unit tests. В CLI режиме он сравнивает Git range.

Если задан `DOCS_FRESHNESS_BASE`, проверяется:

```text
DOCS_FRESHNESS_BASE..HEAD
```

Иначе локальный fallback — `HEAD^..HEAD`.

Если Git history в архивной/ограниченной среде недоступна, checker выдаёт контролируемый skip-warning. Это не следует трактовать как полноценное доказательство актуальности: источником истины для merge/deploy остаётся обычный репозиторий и fresh CI.

## RED → GREEN контракт

Freshness checker имеет отдельные tests. В частности:

```text
Scanner runtime source changed
+ no mapped docs
= FAIL

Scanner runtime source changed
+ scanner/lifecycle.md changed
= PASS
```

Аналогично проверяется Strategy и core ownership. Это означает, что gate не существует только на словах: тесты проверяют как отрицательный, так и положительный путь.

## Чего freshness gate НЕ доказывает

PASS не означает, что текст верен. Разработчик может изменить один символ в нужном Markdown и технически удовлетворить change-impact условие.

Поэтому freshness — только первый слой:

```text
source change
   ↓
docs impact gate
   ↓
knowledge/frontmatter/link validation
   ↓
public/internal Quartz build
   ↓
content/leak/static-host tests
   ↓
review фактических claims
```

Правдивость статусов по-прежнему определяется evidence hierarchy: current source/tests/target observations имеют приоритет над старым audit или design intent.

## Как обновлять parity

При небольшом product change обычно обновляется **current-main delta** соответствующей области. Полные глобальные цифры Avatar parity меняются только после deliberate capability re-audit.

Например:

```text
новый Scanner cleanup test
→ обновить Scanner current evidence / roadmap
→ не объявлять автоматически PARTIAL → PARITY
```

Такой подход позволяет документации быть живой без фальшивого live-percentage.

## Как обновлять roadmap

Milestone меняется, когда изменилось доказанное состояние или dependency. Хорошее обновление отвечает на вопросы:

- что теперь реально существует;
- какой blocker исчез;
- какой следующий slice;
- изменился ли критерий завершения;
- каким evidence новый статус подтверждается.

Roadmap поэтому становится частью engineering loop, а не презентацией будущих идей.

## Практическое правило

Если вы меняете пользовательскую capability, state ownership, runtime mutation или recovery semantics, **считайте документацию частью Definition of Done**. Изменение не считается полностью оформленным, пока релевантные Strategy/Scanner/architecture/parity/roadmap claims не были пересмотрены.

Связанные страницы: [Разработка](./index.md), [Доказательства и тестирование](./evidence-testing.md), [Контракты и решения](./decisions-and-specs.md), [Roadmap](../01-project/status-roadmap.md), [Avatar parity](../01-project/avatar-parity.md).
