---
id: development-decisions-specs
title: "Контракты, решения и approved design"
type: doc
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [development, contract, design, decisions, architecture]
---

# Контракты, решения и approved design

В zapret2-manager есть normative contract, approved design и implementation evidence. Это три разных уровня. Публичная документация должна объяснять архитектурно важные решения, но не выдавать подробный внутренний план за уже реализованную capability.

## Native backend v1 contract

**Статус: normative/current contract.** Native foundation задаёт общий язык для state, generation, errors/results, Process Identity, namespaces, jobs, transactions и recovery.

Публичные инварианты:

- state имеет явного owner;
- Process Identity строже голого PID;
- mutation должна быть bounded;
- transaction разделяет snapshot, mutation, verification и rollback;
- unknown/uncertain result не превращается автоматически в success;
- native helper не становится вторым control plane.

В текущем `main` присутствуют соответствующие contract/source boundaries, включая result/error layer. Более ранний read-only audit фиксировал неполный локальный checkout, поэтому текущий tree имеет больший приоритет.

## Strategy aggregate и catalog

**Статус: current implementation с дальнейшей parity-работой.**

Ключевое решение: `Strategy` владеет ordered `Profiles[]`. Profile остаётся дочерней исполнимой единицей; backend является compiler authority; builtin и user Strategy имеют разные mutation rights; Preview и Validate не равны Apply.

Permanent mutation использует существующий transactional writer, а runtime observations не сохраняются как вечная metadata Strategy. Это решение уже имеет source/tests/consumer, поэтому речь идёт не только об approved design.

Подробнее: [Lifecycle Strategy](../03-products/strategy/lifecycle.md).

## Avatar-compatible Scanner design

**Статус: approved design + существенная текущая implementation.**

Продуктовый contract строится так:

```text
Strategy catalog
 → Scanner planning
 → transient candidate execution
 → probes / evidence
 → ranking / report
 → Strategy handoff
```

Scanner не создаёт второй Strategy model, catalog или Apply engine. Он владеет planning, transient runtime, evidence, result/ranking и handoff.

После утверждения design в `main` уже появились model, planner, generator, probes, worker, transient layer и canonical A1 runtime lifecycle. Но полный results/reconciliation/LuCI/target E2E ещё нельзя считать доказанным, поэтому вся capability остаётся prototype / active development.

Подробнее: [Lifecycle Scanner](../03-products/scanner/lifecycle.md).

## Single-writer

**Статус: архитектурный инвариант.** Один durable ресурс должен иметь одного sanctioned writer. Scanner, Orchestra или UI coordinator не получают альтернативное постоянное право записи только потому, что используют тот же runtime.

Из single-writer следуют локальные rollback и reconciliation: сначала определяется owner состояния, затем вызывается его lifecycle.

## A1 transient ownership

**Статус: current Scanner implementation slice.** A1 связывает одну попытку transient candidate execution от start до cleanup. Protocol/schema, helper/runtime adapter и process/resource ownership должны ссылаться на одну lifecycle identity.

Свежие Scanner tests усиливают именно этот contract. Однако A1 является частью production gate, а не доказательством всей Scanner parity.

## OpenWrt-native deviations

Behavioral parity не требует копировать внутреннюю архитектуру Avatar. Допустимы intentional deviations, когда они явно документированы и сохраняют нужный пользовательский эффект.

Примеры направления:

- procd/init и OpenWrt package lifecycle вместо отдельного self-managed control plane;
- более строгий preflight;
- snapshot/CAS/verified rollback;
- bounded rpcd/ubus вместо arbitrary shell execution;
- OpenWrt-owned paths и resource lifecycle.

Такие отличия должны называться `INTENTIONAL_DEVIATION`, а не скрываться под словом PARITY.

## Rust-first для нового native-кода

**Статус: правило проекта.** Новый native-код проектируется Rust-first. C допустим только при конкретной технической причине; существующий проверенный C не переписывается автоматически ради унификации.

Это implementation decision и не меняет смысл behavioral parity: пользовательская compatibility определяется contract и evidence, а не языком bounded helper.

## Routing и tunnels

**Статус: approved direction / planned product domains.** Unified routing должен появляться как durable aggregate: Destination/selectors → primary method → ordered fallbacks → status/monitoring. Tunnel providers подключаются поверх общей routing/resource foundation, а не каждый создаёт отдельный control plane.

Поэтому research/design по WARP/usque или другому provider не считается shipped implementation без package, config/secrets, process/interface ownership, health, routing integration и rollback evidence.

## Как читать этот индекс

**Current contract** — правило действует сейчас и должно поддерживаться implementation/tests.

**Approved design** — направление и boundaries согласованы, но готовность определяется отдельно по source/consumer/evidence.

**Implementation evidence** — конкретный slice реально присутствует и проверяется.

Эта граница защищает проект от ошибки «есть подробный spec → функция готова».

Связанные страницы: [Доказательства и тестирование](./evidence-testing.md), [Актуальность документации](./docs-freshness.md), [Avatar parity](../01-project/avatar-parity.md), [Roadmap](../01-project/status-roadmap.md), [Владение состоянием](../02-architecture/state-ownership.md).
