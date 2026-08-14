---
id: knowledge-home
title: "Документация zapret2-manager"
type: home
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [home, documentation, openwrt]
---

# zapret2-manager

**zapret2-manager** — приложение для управления zapret2 на OpenWrt с интерфейсом LuCI, структурированным backend и явной моделью состояния. Цель проекта — собрать пользовательские сценарии, lifecycle конфигурации, диагностику и разработку в одном понятном control plane, не превращая управление роутером в набор непрозрачных скриптов.

Проект активно развивается и пока должен восприниматься как прототип. Часть фундаментальных механизмов и продуктовых сценариев уже реализована, другие находятся в активной разработке или запланированы. Публичные статусы привязаны к evidence, чтобы design intent не выдавался за готовую функцию.

## Начать работу

Если вы открыли проект впервые, начните с [Установки](./11-operations/installation.md), а затем пройдите [Первый запуск](./11-operations/first-run.md). Инструкция по установке опирается на реальные package/Makefile paths текущего репозитория и не придумывает готовый release channel, которого проект пока не гарантирует.

Если приложение уже установлено, но что-то работает не так, используйте [Устранение неполадок](./11-operations/troubleshooting.md). Этот раздел помогает отделить проблему LuCI, backend, package или конкретного продуктового lifecycle без широких разрушительных сбросов.

## Основные возможности

### Стратегии (Strategy) — реализовано и развивается

[Strategy](./03-products/strategy/index.md) отвечает за **постоянную конфигурацию**. Подробная страница [Lifecycle Strategy](./03-products/strategy/lifecycle.md) разбирает aggregate model, ordered Profiles, catalog identity, compiler/preflight, `Preview`, `Validate`, transactional `Apply`, runtime verification и rollback.

### Сканер (Scanner) — прототип / активная разработка

[Scanner](./03-products/scanner/index.md) предназначен для проверки и сравнения кандидатов. В текущем `main` уже существуют model/planner/generator, probes, worker, transient layer и canonical A1 runtime lifecycle, но полный production E2E ещё не доказан.

[Lifecycle Scanner](./03-products/scanner/lifecycle.md) показывает точный gate: model → planner → A1 transient execution → probes → results/ranking → cleanup/reconciliation → Strategy handoff → LuCI/target evidence.

### BlockCheck и Deep Search

[BlockCheck](./03-products/blockcheck/index.md) и [Deep Search](./03-products/deep-search/index.md) имеют M5 manager-owned verticals, но target-router evidence ещё выделяется отдельно. Страница [Scanner, BlockCheck, Block Detector и BlockCheck2](./03-products/scanner/family.md) объясняет, почему эти diagnostic flows нельзя сливать в один runner только из-за похожей тематики.

## Архитектура

Проект построен вокруг ownership, а не вокруг одного большого coordinator. LuCI формирует намерение; rpcd/ubus передаёт его bounded backend owner; permanent mutation проходит через sanctioned writer; transient Scanner work имеет отдельный lifecycle.

Начните с [Архитектуры](./02-architecture/index.md), а затем переходите к двум подробным страницам:

- [Runtime flow: от LuCI до nfqws2](./02-architecture/runtime-flow.md);
- [Владение состоянием и single-writer модель](./02-architecture/state-ownership.md).

Там разобраны generation/revision, Process Identity, jobs, namespaces, snapshots, CAS, transaction verification, rollback и reconciliation.

## Parity с avatarDD/zapret-gui

[Совместимость с avatarDD/zapret-gui](./01-project/avatar-parity.md) — отдельный evidence-backed раздел. Он сохраняет pinned audit snapshot `11 PARITY / 31 PARTIAL / 28 MISSING / 2 DIVERGENT / 4 INTENTIONAL_DEVIATION` и отдельно показывает current-main delta.

Глобальные counts не превращены в фальшивый live-percentage: свежий Scanner progress попадает в delta сразу, но итоговая матрица меняется только после deliberate re-audit соответствующих capability.

## Roadmap

[Roadmap](./01-project/status-roadmap.md) теперь описывает M1–M12 как dependency/evidence graph. Для каждого milestone есть текущее состояние, blockers, следующий safe slice, критерий завершения и тип доказательств.

Это помогает увидеть, почему, например, A1 продвигает Scanner, но ещё не закрывает results/ranking/reconciliation и Strategy handoff; почему asset registries нужны до полного routing; и почему auto-remediation зависит от Scanner, classifier, DNS и tunnels.

## DNS, routing и assets

[DNS, routing и assets](./03-products/dns-routing-assets.md) разделяет то, что уже существует, и будущий aggregate routing product. Текущий manager имеет реальный DNS/list/domain substrate и отдельный proxy lifecycle, но ещё не заявляет unified Destination/Route model или полную tunnel family.

## Как проект доказывает готовность

[Доказательства и тестирование](./08-development/evidence-testing.md) разделяет source/unit, integration/contract, package/toolchain, router read-only, router mutation/E2E и LAN/live traffic evidence.

Успешный unit test не заменяет target build; package build не заменяет router E2E; live success не заменяет error-path/state-machine tests. Публичный статус capability определяется тем уровнем evidence, который реально требуется её contract.

## Документация живёт вместе с кодом

[Актуальность документации](./08-development/docs-freshness.md) описывает freshness gate. Изменение Strategy, Scanner, BlockCheck, DNS/list/proxy или core ownership source должно сопровождаться пересмотром соответствующих docs/parity/roadmap в том же change set.

Это не автоматическая генерация текста. Gate заставляет обработать documentation impact, а factual correctness по-прежнему проверяется по current source/tests/evidence.

## Основная документация

- [Установка](./11-operations/installation.md)
- [Первый запуск](./11-operations/first-run.md)
- [Обзор проекта](./01-project/index.md)
- [Roadmap](./01-project/status-roadmap.md)
- [Avatar parity](./01-project/avatar-parity.md)
- [Архитектура](./02-architecture/index.md)
- [Runtime flow](./02-architecture/runtime-flow.md)
- [Владение состоянием](./02-architecture/state-ownership.md)
- [Стратегии (Strategy)](./03-products/strategy/index.md)
- [Lifecycle Strategy](./03-products/strategy/lifecycle.md)
- [Сканер (Scanner)](./03-products/scanner/index.md)
- [Lifecycle Scanner](./03-products/scanner/lifecycle.md)
- [DNS, routing и assets](./03-products/dns-routing-assets.md)
- [Устранение неполадок](./11-operations/troubleshooting.md)
- [Разработка](./08-development/index.md)
- [Доказательства и тестирование](./08-development/evidence-testing.md)

Этот сайт — публичный слой документации проекта. Детальные внутренние working notes, raw audit graphs и служебные инструкции не включаются в публичную навигацию; их выводы переводятся в безопасные evidence-backed summaries.
