---
id: development-docs-freshness
title: "Актуальность документации вместе с разработкой"
type: doc
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [development, docs, freshness, ci, evidence]
---

# Актуальность документации вместе с разработкой

Документация zapret2-manager должна обновляться **вместе с продуктовым кодом**, а не отдельной кампанией раз в несколько месяцев. Для этого в репозитории есть bounded checker `scripts/check-docs-freshness.mjs`: он сопоставляет изменившиеся product/runtime области с документацией, которую необходимо пересмотреть в том же change set.

Это не генератор текста и не автоматический судья правды. Freshness gate отвечает на более узкий вопрос: **изменился ли продукт, а documentation impact вообще был обработан?**

## Почему это необходимо

Без формального правила documentation drift возникает почти неизбежно. Scanner может получить новый lifecycle, tests стать зелёными, а публичная страница продолжит описывать старый прототип. Strategy может изменить Apply admission, а parity/roadmap останутся на предыдущей модели.

Поэтому значимый source change требует явного решения: обновить релевантную страницу либо зафиксировать в ней, что публичный contract действительно не изменился.

## Strategy

Изменения Strategy/Profile source, compiler, state, Apply/preflight или Strategy LuCI требуют пересмотреть как минимум одну из областей:

- `docs/03-products/strategy/`;
- публичную Avatar parity;
- evidence-backed roadmap.

Пример:

```text
strategy-compiler.uc изменился
        ↓
проверить Strategy lifecycle
проверить parity impact
проверить roadmap impact
```

Если изменение является чистым refactor и внешняя семантика сохранена, допустимо коротко зафиксировать это в соответствующем lifecycle/evidence document. Главное — решение принято явно, а не получено молчанием.

## Scanner

Scanner сейчас развивается быстро, поэтому freshness особенно важен. Изменения model/planner/generator/probes/worker/transient/runtime adapter или Scanner LuCI должны сопровождаться пересмотром:

- `docs/03-products/scanner/`;
- Avatar parity;
- roadmap.

Так правило защищает сразу от двух ошибок: документация не отстаёт от кода и одновременно не повышает Scanner до production-ready после появления одного нового модуля.

Усиление A1 lifecycle, например, должно попасть в current-main delta и M3 roadmap. Но глобальные parity counts не пересчитываются, пока соответствующий behavioral contract не прошёл полноценный re-audit.

## BlockCheck family

Изменения BlockCheck/BlockCheck2 source должны отражаться на странице BlockCheck, в документе [Scanner, BlockCheck и BlockCheck2](../03-products/scanner/family.md) либо в parity/roadmap.

Это сохраняет важную границу: три Avatar flow не сливаются в общий статус «сканирование реализовано».

## DNS, lists и routing dependencies

Изменения DNS, service-DNS, domain hub или lists требуют пересмотреть [DNS, routing и assets](../03-products/dns-routing-assets.md), parity или roadmap.

Причина в том, что эти области являются foundation для assets/selectors, unified routing и будущего remediation. Новый list identity или DNS owner может влиять на roadmap даже при минимальном изменении UI.

## Proxy и tunnels

Изменение proxy/provider lifecycle рассматривается как потенциальный impact на tunnel foundation. Оно должно сопровождаться обновлением DNS/routing/assets, parity или roadmap.

Так будущие WARP/usque, AWG, sing-box и другие providers не смогут тихо получить отдельный несовместимый lifecycle вне общей архитектуры.

## Core ownership

Изменения state/jobs/transaction/namespace/process/recovery/result или native ownership foundation требуют пересмотреть:

- [Runtime flow](../02-architecture/runtime-flow.md);
- [Владение состоянием](../02-architecture/state-ownership.md);
- [Доказательства и тестирование](./evidence-testing.md);
- либо roadmap, если изменение относится к foundation milestone.

Core refactor может быть невидим пользователю, но менять recovery, Process Identity или transaction safety. Эти свойства являются частью публичной архитектуры.

## Что не триггерит gate само по себе

Первая версия намеренно ограничена product/runtime source. Изменения только в tests, docs, scripts, CI metadata или generated artifacts сами по себе не создают product freshness violation.

Это не уменьшает значение tests: они являются evidence, но не каждый refactor fixture требует переписывать продуктовую страницу.

## Как работает checker

Функция `evaluateDocsFreshness()` умеет оценивать явный список changed paths; это позволяет тестировать отрицательные и положительные сценарии без Git.

В CLI режиме используется Git range. Если задан `DOCS_FRESHNESS_BASE`, проверяется `DOCS_FRESHNESS_BASE..HEAD`; иначе fallback — `HEAD^..HEAD`.

Если history недоступна в архивной среде, checker выдаёт контролируемое предупреждение. Такой skip не должен считаться равным полноценному fresh CI на обычном репозитории.

## RED → GREEN

Contract покрывается tests:

```text
Scanner source changed
+ no mapped docs
= FAIL

Scanner source changed
+ scanner/lifecycle.md changed
= PASS
```

Аналогичные fixtures существуют для Strategy и core ownership. Это доказывает, что gate умеет ловить реальный missing-doc impact, а не только печатать информационное сообщение.

## Чего PASS не доказывает

Разработчик теоретически может изменить один символ в нужной странице и пройти change-impact check. Поэтому freshness — только первый слой:

```text
source change
   ↓
docs impact gate
   ↓
frontmatter/link validation
   ↓
public + internal Quartz build
   ↓
content/leak/static-host tests
   ↓
review фактических claims
```

Правдивость статуса по-прежнему определяется evidence hierarchy. Текущий source, tests и target observations имеют приоритет над старым audit snapshot или design intent.

## Parity и roadmap

Небольшой product change обычно обновляет current-main delta. Глобальные цифры Avatar parity меняются только после deliberate capability re-audit.

Roadmap обновляется, когда изменилось доказанное состояние или dependency: какой blocker исчез, что является следующим safe slice, изменился ли критерий завершения и каким evidence это подтверждается.

## Практическое правило Definition of Done

Если изменение затрагивает пользовательскую capability, state ownership, runtime mutation или recovery semantics, **документация является частью Definition of Done**. Работа не считается полностью оформленной, пока релевантные Strategy/Scanner/architecture/parity/roadmap claims не были пересмотрены.

Связанные страницы: [Разработка](./index.md), [Доказательства и тестирование](./evidence-testing.md), [Контракты и решения](./decisions-and-specs.md), [Roadmap](../01-project/status-roadmap.md), [Avatar parity](../01-project/avatar-parity.md).
