---
id: development-evidence-testing
title: "Доказательства и тестирование: что именно подтверждает каждый gate"
type: doc
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [development, evidence, testing, ci, e2e]
---

# Доказательства и тестирование: что именно подтверждает каждый gate

В zapret2-manager нельзя использовать одно слово «тесты прошли» для всех уровней уверенности. Source/unit test, интеграционный contract test, OpenWrt package build и реальный router E2E отвечают на **разные вопросы**. Если смешать эти уровни, documentation и roadmap начинают объявлять готовым то, что доказано только частично.

Поэтому публичные статусы опираются на лестницу доказательств.

## 1. Source / unit evidence

Этот уровень проверяет pure model, parser, state transition, compiler helpers и другие компоненты без настоящего OpenWrt runtime. Он хорошо доказывает, что запрос нормализуется предсказуемо, illegal transition отклоняется, порядок Profiles сохраняется, planner строит ожидаемый candidate, а digest/identity стабилен для заданных данных.

Но source test **не доказывает**, что ucode собирается на target, package содержит правильные files/modes, rpcd загрузит модуль, nfqws2/NFQUEUE реально поведут себя так же или cleanup переживёт crash на роутере.

## 2. Contract / integration evidence

Здесь проверяется взаимодействие компонентов: RPC registration ↔ ACL ↔ CLI, Strategy model ↔ compiler, Scanner planner ↔ worker, transaction ↔ sanctioned writer, UI model ↔ backend response.

Такой test уже может доказать, что Scanner result сохраняет candidate identity, Apply требует authoritative identity, rollback восстанавливает fixture или rpcd method действительно достижим через ACL. Но host integration всё ещё не равен реальному OpenWrt E2E.

## 3. Package / toolchain evidence

OpenWrt package build отвечает на вопросы, которых source tests не видят: собирается ли код целевым toolchain, установлены ли dependencies, попадают ли assets/scripts/contracts в ожидаемые paths, верны ли permissions и нет ли host-only предположений.

Поэтому `make package/.../compile` и `node --test` подтверждают разные свойства. Даже успешный package build означает только, что artifact корректно строится и упаковывается; пользовательский runtime он ещё не доказывает.

## 4. Router read-only evidence

Read-only проверка на настоящем роутере нужна до mutation. Она подтверждает, что package загрузился в реальной среде, rpcd object доступен, status/process discovery работают, dependencies и paths существуют на target, а state можно прочитать без repair-by-side-effect.

Если read-only probe уже не может однозначно определить owner процесса или state, переходить к destructive mutation рано.

## 5. Router mutation / E2E evidence

**Router E2E** проверяет полноценную вертикаль. Для Strategy это, например:

```text
LuCI/RPC intent
 → Preview
 → Validate
 → snapshot
 → Apply
 → runtime verification
 → status reread
```

И отдельно failure path:

```text
Apply
 → verification failure
 → rollback
 → rollback verification
```

Для Scanner E2E gate шире:

```text
request
 → planner
 → A1 transient runtime
 → probes
 → result/ranking
 → cleanup
 → Strategy handoff
```

Пока эта цепочка не доказана на target, богатый source-код Scanner остаётся prototype / active development.

## 6. LAN / live traffic evidence

Некоторые свойства видны только в реальной сети: DNS resolver behavior, IPv4/IPv6, QUIC, TLS, provider-specific filtering, timing и влияние на unrelated LAN traffic.

Live evidence может подтвердить, что target действительно работает с выбранной Strategy, failover переживает outage или серия Scanner candidates не оставляет runtime мусор. Но успех в одной сети не заменяет state-machine/error-path tests.

## Как evidence влияет на public status

| Статус | Что он означает |
|---|---|
| CURRENT | реальная vertical + consumer + подходящий уровень evidence |
| PARTIAL | значимый slice существует, но contract/consumer/evidence неполны |
| PROTOTYPE | существенный код есть, production vertical ещё не доказана |
| APPROVED DESIGN | поведение согласовано, implementation не подразумевается |
| PLANNED | dependency известна, production implementation не заявляется |

Approved design нельзя повышать до CURRENT только потому, что появился подробный spec или fixture будущего API.

## Evidence для parity

`PARITY` требует не «похожей функции», а проверенного baseline behavior: reachability, state/result semantics, error paths и подходящего evidence. Поэтому Orchestra с ranking не становится Avatar Scanner автоматически, если candidate domain и Strategy handoff различаются.

И наоборот, более строгий native preflight/rollback может быть `INTENTIONAL_DEVIATION`, если пользовательская семантика сохраняется, а OpenWrt safety становится сильнее.

## Failure evidence

Для stateful manager особенно важны stale revision, concurrent operation, timeout, worker crash, rpcd restart, partial runtime failure, cleanup failure, foreign process/resource и rollback uncertainty. Happy-path test без этих сценариев не доказывает ownership contract.

Именно поэтому A1 acceptance tail, process identity и transaction rollback имеют такой же вес, как успешный старт.

## Completion report

Хороший completion report связывает claim с gate:

```text
Claim: Strategy сохраняет ordered Profiles
Evidence: focused source/contract tests

Claim: package содержит правильные runtime files
Evidence: OpenWrt package build/content check

Claim: Scanner очищает A1 после cancel
Evidence: A1 cleanup tests + target evidence

Claim: Apply безопасно восстанавливается
Evidence: forced failure + rollback + router reread
```

Так documentation обновляется вместе с развитием конкретных claims, а не с абстрактным процентом «готовности».

Knowledge CI отдельно проверяет Quartz artifact, publication boundary и links. [Проверка актуальности документации](./docs-freshness.md) добавляет change-impact правило: продуктовый source change должен сопровождаться пересмотром релевантной документации.

Связанные страницы: [Roadmap](../01-project/status-roadmap.md), [Avatar parity](../01-project/avatar-parity.md), [Runtime flow](../02-architecture/runtime-flow.md), [Владение состоянием](../02-architecture/state-ownership.md).
