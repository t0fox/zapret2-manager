---
id: development-decisions-specs
title: "Контракты, решения и approved design"
type: development
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [development, contract, design, decisions, architecture]
---

# Контракты, решения и approved design

В репозитории есть подробные engineering contracts, design/spec материалы и исторические планы. Публичная документация **не публикует внутренний рабочий журнал целиком**, но должна объяснять решения, которые реально влияют на архитектуру и пользовательское поведение.

Эта страница — безопасный индекс таких решений. Важно различать три уровня: **normative/current contract**, **approved design** и **implementation evidence**. Approved design описывает согласованное направление, но сам по себе не означает, что функция уже реализована.

## Native backend v1 contract

**Статус: normative/current contract.**

Native backend contract определяет общие правила для state, errors/results, process identity, namespaces, jobs, transactions и recovery. Его основная архитектурная ценность — единый язык ownership, generation/revision и bounded operations.

Публичный смысл контракта:

- state имеет явного владельца;
- process ownership нельзя доказывать только PID;
- mutation должна быть ограниченной и проверяемой;
- транзакция отделяет snapshot, mutation, verification и rollback;
- неопределённое состояние не маскируется под success;
- helper не становится вторым control plane.

Текущий `main` содержит contract/source foundation, включая result/error boundary. Это отличается от более раннего read-only audit snapshot, где часть этих файлов отсутствовала в локальном checkout.

Подробнее: [Владение состоянием](../02-architecture/state-ownership.md) и [Runtime flow](../02-architecture/runtime-flow.md).

## Strategy aggregate и catalog

**Статус: implemented/current с дальнейшей parity-работой.**

Ключевое продуктовое решение: `Strategy` является агрегатом и владеет ordered `Profiles[]`. Profile — дочерняя исполнимая единица, а не независимый верхнеуровневый product owner.

Из этого следуют важные ограничения:

- порядок enabled Profiles сохраняется;
- builtin catalog и user Strategy имеют разные mutation rights;
- backend является compiler authority;
- Preview и Validate не равны Apply;
- постоянная mutation использует существующий transactional writer;
- active runtime observations не превращаются в вечную metadata Strategy.

Это решение уже имеет реальную implementation vertical в текущем source и tests, поэтому публичная документация рассматривает Strategy как одну из наиболее зрелых областей.

Подробнее: [Lifecycle Strategy](../03-products/strategy/lifecycle.md).

## Avatar Strategy Scanner parity design

**Статус: approved design + частичная текущая implementation.**

Scanner design закрепляет flow:

```text
Strategy catalog
   ↓
Scanner planning
   ↓
transient candidate execution
   ↓
probes / evidence
   ↓
ranking/report
   ↓
Strategy handoff
```

Главное решение — Scanner не становится вторым Strategy model, catalog или Apply engine. Он может использовать Strategy compiler authority и low-level ownership patterns, но владеет только planning, transient execution, evidence, ranking и handoff.

После утверждения design в `main` уже появились model/planner/probes/worker/transient/runtime modules и canonical A1 lifecycle. Поэтому статус больше не «только design». При этом пустые/незавершённые result/reconcile boundaries и отсутствие доказанного полного target/LuCI E2E не позволяют назвать весь Scanner current production capability.

Подробнее: [Lifecycle Scanner](../03-products/scanner/lifecycle.md).

## OpenWrt-native deviation

Parity с Avatar сравнивает продуктовую семантику, а не обязанность повторить внутреннюю архитектуру.

Некоторые решения сознательно отличаются:

- procd/init и OpenWrt package lifecycle предпочтительнее отдельного self-managed process/package control;
- более строгий preflight допустим, если он не ломает valid Strategy behavior;
- snapshot/CAS/verified rollback могут быть строже baseline;
- bounded rpcd/ubus contract предпочтительнее arbitrary shell execution;
- target-owned paths/resources должны следовать OpenWrt conventions.

Такие отличия обозначаются как `INTENTIONAL_DEVIATION`, а не скрываются под словом parity.

## Single-writer decision

**Статус: архитектурный инвариант.**

Ни Scanner, ни Orchestra, ни UI coordinator не должны создавать альтернативный permanent writer для состояния, которым уже владеет Strategy/DNS/другой domain owner.

Это решение снижает риск конфликтующих apply paths и делает rollback/reconciliation локальными. Новый product flow сначала определяет owner и sanctioned mutation boundary, а потом добавляет UI.

## Scanner A1 ownership

**Статус: current implementation slice.**

A1 обозначает transient lifecycle одного Scanner candidate execution. Protocol/schema, runtime adapter и helper ownership должны ссылаться на одну и ту же A1 identity на всём пути start → probe → stop → cleanup.

Свежая implementation и acceptance-tail tests усилили именно эту связь. Это важное evidence для roadmap, но не автоматическое доказательство полной Scanner parity.

## Rust-first для нового native-кода

**Статус: архитектурное правило проекта.**

Новый native-код проектируется Rust-first. C допускается как исключение, когда есть конкретная техническая причина, по которой Rust существенно хуже подходит. Уже существующий и проверенный C-код не переписывается автоматически только ради унификации.

Это правило относится к реализации, а не к Avatar parity: пользовательская behavior compatibility не зависит от того, на каком native-языке реализован bounded helper.

## Routing и tunnels

**Статус: approved direction / planned product domains.**

Unified routing должен появляться как durable aggregate с Destination/selectors, method registry, primary/fallback policy, ownership, Preview/Apply/remove и status. Tunnel providers должны подключаться как methods поверх общей foundation, а не каждый создавать собственный отдельный routing control plane.

WARP/usque и другие tunnels поэтому не считаются shipped только на основании исследовательского design или наличия upstream проекта.

Подробнее: [DNS, routing и assets](../03-products/dns-routing-assets.md) и [Roadmap](../01-project/status-roadmap.md).

## Как читать этот индекс

Если здесь написано **current contract**, это означает, что контракт применяется к текущей архитектуре и должен поддерживаться implementation/tests.

Если написано **approved design**, это означает, что направление и boundaries согласованы, но текущий source всё ещё нужно проверять отдельно.

Если конкретная implementation отстаёт от design, публичный status определяется implementation evidence, а не намерением документа.

Именно эта дисциплина защищает документацию от типичной ошибки: «есть подробный spec → значит функция уже существует».

Связанные страницы: [Доказательства и тестирование](./evidence-testing.md), [Актуальность документации](./docs-freshness.md), [Avatar parity](../01-project/avatar-parity.md), [Roadmap](../01-project/status-roadmap.md).
