---
id: development-evidence-testing
title: "Доказательства и тестирование: что именно подтверждает каждый gate"
type: development
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [development, evidence, testing, ci, e2e]
---

# Доказательства и тестирование: что именно подтверждает каждый gate

В zapret2-manager нельзя использовать одно слово «тесты прошли» для всех уровней уверенности. Source/unit test, интеграционный contract test, OpenWrt package build и реальный router E2E отвечают на **разные вопросы**. Если смешать эти уровни, documentation и roadmap начинают объявлять готовым то, что доказано только частично.

Поэтому публичные статусы опираются на лестницу доказательств.

## Уровень 1 — source / unit evidence

Это проверки pure model, parser, state transition, compiler helpers и других компонентов, которые можно тестировать без настоящего OpenWrt runtime.

Они хорошо отвечают на вопросы:

- правильно ли нормализуется запрос;
- допустим ли state transition;
- сохраняется ли порядок Profiles;
- какой candidate строит planner;
- отклоняется ли некорректный input;
- стабилен ли digest/identity при заданных данных.

Но source test **не доказывает**:

- что ucode собирается и ведёт себя так же на target;
- что OpenWrt package содержит нужные файлы/permissions;
- что rpcd видит модуль после установки;
- что nfqws2/NFQUEUE/firewall runtime реально соответствует ожиданию;
- что cleanup работает после реального crash на router.

Поэтому фраза «191 тест PASS» сама по себе не может означать `production-ready`.

## Уровень 2 — contract / integration evidence

Здесь проверяется взаимодействие нескольких компонентов: RPC registration ↔ ACL ↔ CLI, Strategy model ↔ compiler, Scanner planner ↔ worker, transaction ↔ sanctioned writer, UI model ↔ backend response.

Интеграционные тесты полезны для проверки **границ ответственности**. Например:

```text
Scanner result сохраняет candidate identity?
Strategy Apply принимает только authoritative persisted identity?
rpcd method действительно разрешён ACL?
rollback возвращает exact snapshot в fixture?
```

Этот уровень уже сильнее unit tests, но всё ещё может работать на host fixtures и не доказывать реальное сетевое поведение OpenWrt.

## Уровень 3 — package / toolchain evidence

OpenWrt package build отвечает на практические вопросы, которых source test вообще не видит:

- собирается ли код целевым toolchain;
- установлены ли runtime dependencies;
- попадают ли scripts/assets/contracts в правильные package paths;
- правильны ли file modes;
- выполняется ли package lifecycle так, как ожидает OpenWrt;
- не появилось ли host-only предположение.

Поэтому `make package/.../compile` и host-side `node --test` нельзя считать взаимозаменяемыми gates.

Даже успешный package build ещё не доказывает пользовательский E2E. Он подтверждает, что artifact можно корректно построить и упаковать.

## Уровень 4 — router read-only evidence

Read-only проверка на реальном роутере важна до mutation. Она позволяет убедиться, что пакет загрузился в реальной среде и что status/RPC/process discovery работают без изменения production state.

Типичные свойства:

- rpcd object загружается;
- status method отвечает;
- process identity читается ожидаемо;
- paths/dependencies существуют на target;
- package/runtime versions определяются;
- state можно прочитать без repair-by-side-effect.

Этот уровень особенно полезен для foundation и миграций. Если read-only probe уже не может однозначно определить владельца runtime, переходить к destructive mutation рано.

## Уровень 5 — router mutation / E2E evidence

**Router E2E** проверяет реальный вертикальный пользовательский путь на target.

Для Strategy это может быть:

```text
LuCI/RPC intent
  → Preview
  → Validate
  → snapshot
  → Apply
  → restart
  → runtime verification
  → status reread
```

И обязательно forced-failure path:

```text
Apply
  → verification failure
  → rollback
  → rollback verification
```

Для Scanner E2E gate гораздо шире:

```text
request
  → planner
  → A1 transient runtime
  → probes
  → result/ranking
  → cleanup
  → Strategy handoff
```

Пока эта вертикаль не доказана на target, source-rich Scanner остаётся prototype/active development, даже если тысячи строк кода и десятки unit tests уже существуют.

## Уровень 6 — LAN / live traffic evidence

Некоторые свойства невозможно доказать fixture-тестом или даже локальным router mutation. Реальная сеть добавляет DNS resolver behavior, IPv4/IPv6 различия, QUIC, TLS, provider-specific filtering, timing и внешние сервисы.

Live evidence отвечает на вопросы вида:

- действительно ли target доступен с выбранной Strategy;
- работает ли baseline-aware verdict;
- не ломается ли unrelated LAN traffic;
- как ведёт себя failover при реальном outage;
- остаются ли правила/процессы чистыми после серии кандидатов.

Но и live success нельзя превращать в универсальную гарантию. «Работает в одной сети» не доказывает correctness state machine для всех error paths. Поэтому live evidence дополняет, а не заменяет lower-level tests.

## Snapshot из read-only audit package

Audit package от 14 августа 2026 года фиксировал для checkout `59d28af7`:

- targeted tests: **191 PASS, 0 FAIL, 11 SKIP**; skip были связаны с отсутствием `ucode` в той host-среде;
- native-foundation subset: **34 PASS, 2 FAIL**; аудит указывал на отсутствующие в том checkout native contract/result source.

Этот snapshot полезен как историческая evidence-точка, но **не является live-статусом текущего main**. В актуальном `main` ранее отсутствующие contract/result файлы уже существуют. Текущий CI или новый target run имеют более высокий приоритет, чем старый audit summary.

Именно поэтому документация хранит baseline и delta отдельно.

## Evidence для public status

Когда публичная страница говорит `CURRENT`, `PARTIAL`, `PROTOTYPE` или `PLANNED`, нужно понимать, что стоит за словом.

| Public status | Минимальный смысл |
|---|---|
| CURRENT | реальная source vertical + consumer + подходящие tests/evidence |
| PARTIAL | значимый работающий slice есть, но контракт/consumer/evidence неполны |
| PROTOTYPE | существенный код существует, но production vertical ещё не доказана |
| APPROVED DESIGN | поведение согласовано в design/spec, implementation не подразумевается |
| PLANNED | dependency/goal известны, production implementation не заявляется |

`APPROVED DESIGN` нельзя автоматически повышать до `CURRENT`, если появились только тестовые fixtures будущего API. Нужна реализация и соответствующий consumer.

## Evidence для parity

`PARITY` требует большего, чем «у нас есть похожая функция». Нужно проверить baseline behavior, reachability, result/state semantics и доказательства.

Например, наличие Orchestra с candidate ranking не делает его Avatar Scanner parity, если candidate identity, target model и Strategy handoff различаются. И наоборот, более строгий native rollback может быть допустимым `INTENTIONAL_DEVIATION`, если сохраняет пользовательскую семантику и лучше защищает OpenWrt runtime.

## Failure evidence важнее happy path

Для stateful manager особенно важны сценарии:

- stale revision;
- concurrent operation;
- timeout;
- process crash;
- rpcd restart;
- partial runtime failure;
- cleanup failure;
- foreign process/resource;
- rollback failure/uncertainty.

Если тестируется только happy path, ownership contract остаётся недоказанным. Поэтому Scanner A1 acceptance tail, transaction rollback и process identity имеют такое же значение, как успешный запуск.

## Что должно попасть в отчёт о завершении

Хороший completion report не пишет просто `tests PASS`. Он связывает claim с gate:

```text
Claim: Strategy compiler preserves ordered Profiles
Evidence: focused source/contract tests

Claim: package installs expected runtime files
Evidence: OpenWrt package build/content check

Claim: Scanner cleans A1 resources after cancel
Evidence: A1 cancel/cleanup test + target evidence

Claim: production Apply is safe
Evidence: transaction test + forced rollback + router reread
```

Такой формат помогает документации обновляться вместе с кодом: новый evidence меняет конкретный claim, roadmap milestone или parity row, а не абстрактный процент «готовности проекта».

## CI и документация

Knowledge CI проверяет сам Quartz artifact, publication boundary, links и документационный contract. Дополнительно вводится [проверка актуальности документации](./docs-freshness.md): если меняется значимая product/runtime область, change set должен затронуть соответствующую документацию или roadmap/parity.

Freshness gate не доказывает правдивость текста автоматически. Он заставляет разработчика **явно обработать documentation impact**, после чего обычные content/build/link tests проверяют техническое качество публикации.

Связанные страницы: [Roadmap](../01-project/status-roadmap.md), [Avatar parity](../01-project/avatar-parity.md), [Runtime flow](../02-architecture/runtime-flow.md), [Владение состоянием](../02-architecture/state-ownership.md).
