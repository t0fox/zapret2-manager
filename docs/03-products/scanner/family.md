---
id: product-scanner-family
title: "Scanner, BlockCheck и BlockCheck2 — три разных flow"
type: product
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [scanner, blockcheck, blockcheck2, parity, diagnostics]
---

# Scanner, BlockCheck и BlockCheck2 — три разных flow

В Avatar baseline есть несколько диагностических механизмов, которые легко ошибочно объединить под словом «сканер». Для parity zapret2-manager это принципиально неверно: **Scanner, BlockCheck и BlockCheck2 решают разные задачи, имеют разные state/result semantics и не должны становиться одним универсальным runner только потому, что все они запускают сетевые проверки**.

## Коротко

| Flow | Главный вопрос | Результат | Текущий статус в zapret2-manager |
|---|---|---|---|
| Scanner | Какая Strategy работает для заданной цели? | working/failed candidates, ranking, Strategy handoff | prototype / active development |
| BlockCheck | Какого типа проблема наблюдается и что показала диагностика? | classification/diagnostic result | отдельная Avatar-capability пока не доказана |
| BlockCheck2 | Что нашёл upstream bol-van `blockcheck2.sh`? | subprocess output + найденные варианты | частичный managed wrapper |

## Scanner

Scanner работает поверх **Strategy domain**. Он получает target/protocol/mode, строит детерминированный candidate plan, временно исполняет варианты, запускает probes, собирает typed evidence и формирует ranking/report.

Ключевой результат Scanner — не shell-output, а связь между проверенным кандидатом и Strategy identity. Именно поэтому найденный вариант должен затем перейти в обычный Strategy lifecycle: Preview → Validate → Apply.

Scanner не должен автоматически применять найденный кандидат. Его runtime по определению transient и связан с A1 ownership/cleanup.

Текущий `main` уже содержит Scanner model, planner, generator, state, probes, worker, transient layer и runtime adapter. При этом отдельные result/reconcile boundaries ещё не являются завершёнными, а полный LuCI/E2E product flow требует дальнейшего evidence. Подробнее см. [Lifecycle Scanner](./lifecycle.md).

## BlockCheck

Avatar `BlockCheck` — самостоятельный diagnostic/classification flow. Его смысл не в переборе всего Strategy catalog, а в том, чтобы проверить цель и сформировать диагностический результат: признаки блокировки, тип проблемы, дополнительные observation и связанные данные.

Это важно для будущего auto-remediation. Решение «запустить Scanner» должно приниматься потому, что diagnostic evidence указывает на DPI-сценарий, а не потому, что любое нарушение доступности автоматически трактуется как задача Strategy Scanner.

В текущем zapret2-manager отдельная Avatar-equivalent BlockCheck capability **не доказана**. Публичная страница BlockCheck поэтому остаётся planned, пока не существует законченной model → execution → result → LuCI vertical с проверенной семантикой.

## BlockCheck2

`BlockCheck2` — другой случай. В текущем репозитории есть `blockcheck-run.sh`, который управляемо вызывает upstream `/opt/zapret2/blockcheck2.sh`, а `blockcheck-apply-cli.uc` умеет работать с рекомендацией/результатом дальше по существующему пути.

Это полезная реальная capability, но она не равна ни Avatar Scanner, ни полноценному Avatar BlockCheck.

Причина — различие product contract. Managed subprocess может иметь bounded job ownership, stop/cleanup и parser результата, но upstream BlockCheck2 имеет собственные режимы, переменные окружения, streaming/result semantics и способ преобразования найденного варианта в Strategy. Для `PARITY` нужны именно эти пользовательские эффекты, а не просто факт запуска скрипта.

Поэтому текущая parity-классификация разумно рассматривает BlockCheck2 как **PARTIAL**, а не как замену всей diagnostic family.

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

Для **BlockCheck**: отдельная модель диагностики, execution, classification/result и UI, соответствующая pinned Avatar behavior.

Для **BlockCheck2**: точная характеристика режимов upstream runner, streaming/stop/result semantics и доказанный conversion найденного результата в user Strategy без обхода Strategy authority boundary.

До выполнения этих условий документация будет показывать три статуса раздельно. Это лучше, чем красивая, но ложная надпись «Scanner/BlockCheck реализованы».

Связанные страницы: [Scanner](./index.md), [Lifecycle Scanner](./lifecycle.md), [BlockCheck](../blockcheck/index.md), [Avatar parity](../../01-project/avatar-parity.md), [Roadmap](../../01-project/status-roadmap.md).
