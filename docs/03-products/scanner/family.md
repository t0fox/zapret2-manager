---
id: product-scanner-family
title: "Scanner, BlockCheck, Block Detector и BlockCheck2 — разные flow"
type: product
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [scanner, blockcheck, blockcheck2, parity, diagnostics]
---

# Scanner, BlockCheck, Block Detector и BlockCheck2 — разные flow

В Avatar baseline есть несколько диагностических механизмов, которые легко ошибочно объединить под словом «сканер». Для parity zapret2-manager это принципиально неверно: **Scanner, BlockCheck и BlockCheck2 решают разные задачи, имеют разные state/result semantics и не должны становиться одним универсальным runner только потому, что все они запускают сетевые проверки**.

## Коротко

| Flow | Главный вопрос | Результат | Текущий статус в zapret2-manager |
|---|---|---|---|
| Scanner | Какая Strategy работает для заданной цели? | working/failed candidates, ranking, Strategy handoff | prototype / active development |
| BlockCheck | Какого типа проблема наблюдается и что показала диагностика? | classification/diagnostic result | separate one-shot M5 vertical |
| Block Detector | Какие домены из живого DNS требуют фональной проверки? | discovered domains + periodic findings | отдельный managed background lifecycle |
| BlockCheck2 | Что нашёл upstream bol-van `blockcheck2.sh`? | subprocess output + найденные варианты | managed official engine |
| BlockCheckW Fast | Что быстро показывает external Rust engine? | upstream status/scan/universal/check report | optional provider + managed engine |

## Scanner

Scanner работает поверх **Strategy domain**. Он получает target/protocol/mode, строит детерминированный candidate plan, временно исполняет варианты, запускает probes, собирает typed evidence и формирует ranking/report.

Ключевой результат Scanner — не shell-output, а связь между проверенным кандидатом и Strategy identity. Именно поэтому найденный вариант должен затем перейти в обычный Strategy lifecycle: Preview → Validate → Apply.

Scanner не должен автоматически применять найденный кандидат. Его runtime по определению transient и связан с A1 ownership/cleanup.

Текущий `main` уже содержит Scanner model, planner, generator, state, probes, worker, transient layer и runtime adapter. При этом отдельные result/reconcile boundaries ещё не являются завершёнными, а полный LuCI/E2E product flow требует дальнейшего evidence. Подробнее см. [Lifecycle Scanner](./lifecycle.md).

## BlockCheck

Avatar `BlockCheck` — самостоятельный diagnostic/classification flow. Его смысл не в переборе всего Strategy catalog, а в том, чтобы проверить цель и сформировать диагностический результат: признаки блокировки, тип проблемы, дополнительные observation и связанные данные.

Это важно для будущего auto-remediation. Решение «запустить Scanner» должно приниматься потому, что diagnostic evidence указывает на DPI-сценарий, а не потому, что любое нарушение доступности автоматически трактуется как задача Strategy Scanner.

В текущем M5 BlockCheck имеет отдельную model → execution → result → LuCI vertical с quick/full/dpi_only, evidence, cancellation и Deep Trace. BlockCheckW может быть отдельным accelerator, но не подменяет этот contract.

## Block Detector

Avatar Block Detector — фоновой DNS-monitoring flow. Он обнаруживает домены из live DNS/log sources и периодически выполняет probes. Его state, stop и results отличаются от интерактивного BlockCheck; недоступный capture/probe dependency возвращается как infrastructure, а не как DPI finding.

## BlockCheck2

`BlockCheck2` — другой случай. В текущем репозитории есть `blockcheck-run.sh`, который управляемо вызывает upstream `/opt/zapret2/blockcheck2.sh`, а `blockcheck-apply-cli.uc` умеет работать с рекомендацией/результатом дальше по существующему пути.

Это отдельная real capability, но она не равна ни Avatar Scanner, ни BlockCheck, ни Block Detector.

Причина — различие product contract. Managed subprocess может иметь bounded job ownership, stop/cleanup и parser результата, но upstream BlockCheck2 имеет собственные режимы, переменные окружения, streaming/result semantics и способ преобразования найденного варианта в Strategy. Для `PARITY` нужны именно эти пользовательские эффекты, а не просто факт запуска скрипта.

BlockCheck2 и BlockCheckW не заменяют diagnostic family; их results converges to the existing Strategy Preview → Validate → Apply authority.

## Почему Orchestra тоже не Scanner

В zapret2-manager есть Orchestra — развитый evidence-driven candidate runner. Он умеет durable runs, worker ownership, target-bound evidence, cleanup, ranking/winner gates и безопасный дальнейший apply flow.

Архитектурно это очень полезный источник patterns. Scanner может переиспользовать идеи process identity, heartbeat, bounded logs, evidence IDs, stale-worker handling и exact-owned cleanup.

Но **product identity Orchestra отличается**. Его corpus, service targets, candidate IDs и ranking semantics не являются автоматически Avatar Strategy Scanner. Если просто переименовать Orchestra в Scanner, мы получим технически рабочий runner с неправильным продуктовым контрактом.

```text
можно переиспользовать:
  process identity
  worker control
  bounded evidence
  cleanup patterns
  timeout/recovery

нельзя считать автоматически одинаковым:
  candidate domain
  target model
  ranking semantics
  Strategy identity
  result handoff
```

## Разные ownership boundaries

У трёх flow различается и владение состоянием.

**Scanner** владеет Scanner run, candidate plan, A1 transient runtime и evidence. Он не владеет permanent Strategy writer.

**BlockCheck** должен владеть diagnostic run и classification result, не превращая observation в постоянную конфигурацию.

**BlockCheck2** владеет managed lifecycle конкретного upstream subprocess/job и его parsed result. Он не получает право считать свой output полноценным Scanner report без отдельной conversion boundary.

## Как они могут быть связаны в будущем

Логичная orchestration chain выглядит так:

```text
проверка доступности
      ↓
BlockCheck / classifier
      ↓
      ├─ DNS-проблема → DNS remediation flow
      ├─ DPI-проблема → Scanner
      ├─ IP/full block → routing/tunnel flow
      └─ none/unknown → diagnostic result без mutation

Scanner
      ↓
working Strategy candidate
      ↓
Strategy handoff
      ↓
Preview → Validate → Apply
```

Это и объясняет зависимость roadmap: auto-remediation нельзя считать завершённым до того, как diagnostic classification, Scanner, DNS и routing/tunnel paths имеют собственные доказанные contracts.

## Что требуется для parity

Для **Scanner**: полная вертикаль request/model → candidate plan → transient runtime → probes → ranking/report → cleanup/reconciliation → Strategy handoff → LuCI, плюс target evidence.

Для **BlockCheck**: отдельная модель диагностики, execution, classification/result и UI, соответствующая pinned Avatar behavior. Для **Block Detector**: background discovery, periodic probe, independent lifecycle and managed-list candidates.

Для **BlockCheck2**: точная характеристика режимов upstream runner, streaming/stop/result semantics и conversion найденного результата в user Strategy без обхода Strategy authority boundary. Для **BlockCheckW**: provider/version lifecycle plus bounded fast-engine adapter.

Статусы остаются раздельными: готовность одного engine не повышает автоматически Scanner, BlockCheck или Block Detector.

Связанные страницы: [Scanner](./index.md), [Lifecycle Scanner](./lifecycle.md), [BlockCheck](../blockcheck/index.md), [Avatar parity](../../01-project/avatar-parity.md), [Roadmap](../../01-project/status-roadmap.md).
