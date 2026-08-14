---
id: architecture-component-map
title: "Карта компонентов и зависимостей"
type: architecture
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [architecture, graph, dependencies, modules, graphify]
---

# Карта компонентов и зависимостей

Эта страница переводит результаты структурного аудита Graphify/UnderstandAnything в человекочитаемую карту. Она не публикует raw graph и не пытается заменить source tree. Цель — показать, **какие семейства модулей существуют, кто от кого зависит и где проходят ownership boundaries**.

Read-only audit package 14 августа 2026 года обработал 657 читаемых файлов; UnderstandAnything структурно разобрал 401 файл и построил граф примерно на **4 918 узлах / 10 142 связях**. Graphify сформировал отдельный граф примерно на **2 387 узлах / 4 386 связях** и 224 сообщества без dangling edges.

Эти числа относятся к audit snapshot `59d28af7`. Они полезны как характеристика сложности проекта, но **не являются live-метрикой текущего main**. После аудита Scanner получил дополнительные implementation commits, поэтому текущие product statuses берутся из source/tests, а не из старого graph count.

## High-level map

```text
                         ┌──────────────────────┐
                         │        LuCI          │
                         │ pages / workflows   │
                         └──────────┬───────────┘
                                    │ z2m-api / rpc.declare
                                    ▼
                         ┌──────────────────────┐
                         │     rpcd / ubus      │
                         │ bounded API facade   │
                         └──────────┬───────────┘
                                    │
          ┌─────────────────────────┼──────────────────────────┐
          │                         │                          │
          ▼                         ▼                          ▼
   ┌─────────────┐          ┌──────────────┐          ┌──────────────┐
   │  Strategy   │          │   Scanner    │          │ DNS / Lists  │
   │ catalog/apply│         │ transient A1 │          │ domain owners│
   └──────┬──────┘          └──────┬───────┘          └──────┬───────┘
          │                         │                          │
          └──────────────┬──────────┴──────────────┬───────────┘
                         ▼                         ▼
              ┌──────────────────┐      ┌────────────────────┐
              │ core ownership   │      │ runtime adapters   │
              │ state/jobs/tx    │      │ process/network    │
              └────────┬─────────┘      └──────────┬─────────┘
                       │                            │
                       ▼                            ▼
              ┌──────────────────┐      ┌────────────────────┐
              │ bounded native   │      │ zapret2 / nfqws2   │
              │ helpers          │      │ OpenWrt runtime    │
              └──────────────────┘      └────────────────────┘
```

Главное в этой схеме — не количество стрелок, а направление полномочий. UI вызывает product owner; product owner использует common ownership substrate; runtime adapter не должен становиться вторым владельцем product state.

## LuCI family

LuCI — consumer backend contracts. Страницы и workflows отвечают за взаимодействие пользователя, локальное состояние формы и rendering. `z2m-api.js` связывает UI с rpcd/ubus methods.

Публичный архитектурный contract запрещает переносить authoritative compiler/mutation logic в browser. Если Strategy command или Scanner candidate semantics вычисляются двумя независимыми реализациями — в UI и backend — рано или поздно появляется drift.

Поэтому связь направлена так:

```text
LuCI intent → backend result → LuCI rendering
```

а не так:

```text
LuCI самостоятельно меняет runtime
```

## Strategy family

Текущее семейство Strategy состоит из `strategy-model`, `strategy-catalog`, `strategy-compiler`, `strategy-state`, `strategy-status`, `strategy-cli`, а также существующего Profile/apply/preflight substrate.

```text
catalog ───┐
model ─────┼→ compiler → Preview / Validate
state ─────┘                 │
                            Apply
                              │
                  transaction / writer
                              │
                         verification
                              │
                           status
```

Catalog и user state дают identity/provenance; compiler строит effective candidate; Apply использует sanctioned permanent writer. `strategy-status` читает runtime observations, но не должен превращаться в ещё один writer Strategy metadata.

## Scanner family

Scanner — наиболее быстро меняющееся семейство. В текущем tree уже присутствуют model, targets, planner, generator, compiler authority, state, transient layer, probes, probe adapter/executor, worker, CLI и runtime adapter.

```text
model / targets
       ↓
planner ──→ generator
       ↓
compiler authority
       ↓
A1 transient owner
       ↓
probe executor
       ↓
result / ranking boundary
       ↓
cleanup / reconciliation
       ↓
Strategy handoff
```

Graph здесь подчёркивает две критические зависимости. Во-первых, Scanner использует **Strategy compiler authority**, а не собственную несовместимую модель Strategy. Во-вторых, A1 transient owner отделён от permanent Apply.

Отдельные result/reconcile files в текущем tree ещё не означают законченные boundaries; readiness определяется содержимым и E2E evidence. Поэтому family описывается как prototype / active development.

## Core ownership family

Core modules образуют substrate, которым пользуются несколько product domains:

```text
state / generation
jobs / worker identity
process identity
namespaces
transactions
recovery
errors / result
```

Эти компоненты нельзя рассматривать как «бизнес-функцию» сами по себе. Их роль — дать product owner одинаковые правила для atomic state, stale revision, Process Identity, bounded transaction и recovery.

Зависимость должна идти **product → substrate**, а не наоборот: core не должен знать детали Strategy catalog или Scanner ranking настолько глубоко, чтобы стать скрытым продуктовым coordinator.

## DNS, domain и lists family

Существующий сетевой family включает DNS providers/global/manual behavior, service-DNS, domain hub и lists. Эти компоненты уже реальны, но пока не сведены в единый unified routing aggregate.

```text
DNS owners ─────┐
domain hub ─────┼→ будущие stable selectors → unified routing
lists/catalog ──┘
```

Именно здесь будущие canonical asset registries становятся важной dependency: Strategy, Scanner и routing должны ссылаться на одинаковую identity list/blob/IP-set/geosite data.

## Orchestra и evidence-driven execution

Orchestra является отдельным run/evidence domain. Он архитектурно ценен благодаря durable jobs, candidate execution patterns, evidence, cleanup и ranking/winner gates.

Но dependency map специально **не помещает Orchestra внутрь Scanner**. Разрешено переиспользовать низкоуровневые patterns; нельзя автоматически наследовать candidate identity, target model или product semantics.

```text
Orchestra patterns ──→ reusable ownership/evidence ideas
Orchestra product ─X→ Scanner identity
```

## BlockCheck family

Managed `blockcheck2.sh` execution, one-shot BlockCheck classifier и background Block Detector должны оставаться отдельными от Scanner. Общая зависимость у них — jobs/evidence/state substrate и Strategy handoff для найденного результата, но request/result models и lifecycles различаются.

Подробнее это показано на странице [Scanner, BlockCheck и BlockCheck2](../03-products/scanner/family.md).

## Native boundary

Native helpers должны оставаться узкими. Новый native-код в проекте проектируется Rust-first; C используется как исключение при конкретной технической причине, а проверенный существующий C не переписывается только ради унификации.

Архитектурная стрелка выглядит так:

```text
ucode/product owner
      ↓ bounded request
native helper
      ↓ bounded result
ucode/product owner
```

Helper не получает право самостоятельно управлять Strategy/Scanner lifecycle или решать, какой candidate применить.

## Куда растёт dependency graph

Audit показывает несколько крупных будущих dependency chains:

```text
asset registries
      ↓
Strategy + Scanner completeness
      ↓
unified routing selectors
      ↓
tunnel methods
      ↓
monitoring / failover
      ↓
auto-remediation
```

Это объясняет порядок roadmap. Если прыгнуть прямо к auto-remediation, не завершив owners под ним, получится coordinator, который вынужден сам реализовывать DNS, Scanner и routing semantics — то есть снова монолит.

## Как использовать карту при разработке

Перед новым модулем полезно задать четыре вопроса:

1. К какому product family он принадлежит?
2. Какой existing owner он использует?
3. Добавляет ли он новый durable writer?
4. Какие evidence и documentation edges должны измениться вместе с ним?

Если новый файл не удаётся естественно поместить в карту без появления второй authority для того же состояния, это сигнал пересмотреть design boundary до реализации.

Связанные страницы: [Архитектура](./index.md), [Runtime flow](./runtime-flow.md), [Владение состоянием](./state-ownership.md), [Roadmap](../01-project/status-roadmap.md), [Avatar parity](../01-project/avatar-parity.md).
