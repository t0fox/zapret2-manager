---
id: product-scanner-lifecycle
title: "Lifecycle Scanner: кандидаты, A1 runtime, probes и handoff"
type: product
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [scanner, lifecycle, a1, probes, evidence, cleanup]
---

# Lifecycle Scanner: кандидаты, A1 runtime, probes и handoff

`Scanner` — отдельный продуктовый lifecycle для поиска работающей Strategy. Его назначение — **построить кандидаты, временно проверить их, собрать доказательства, сравнить результаты, очистить временный runtime и передать выбранный результат обратно в Strategy**.

Это не второй Apply engine и не новое имя для Orchestra. Scanner имеет собственную модель запроса, candidate planning, transient runtime, probes и evidence. Постоянная конфигурация по-прежнему принадлежит Strategy.

## Production gate целиком

Для Scanner нельзя определять готовность по одному существующему файлу или одному успешному test suite. Полный вертикальный путь выглядит так:

```text
Scanner request/model
        ↓
target normalization
        ↓
planner + generator
        ↓
ordered candidate set
        ↓
compiler authority
        ↓
A1 transient execution
        ↓
probe adapters / executor
        ↓
typed result + evidence
        ↓
ranking / report
        ↓
cleanup + reconciliation
        ↓
Strategy handoff
        ↓
LuCI product flow
```

**production-ready** можно говорить только тогда, когда эта цепочка доказана как единый lifecycle, включая ошибочные пути, cleanup, restart/recovery и target/router evidence. Наличие model + planner + worker само по себе этого не доказывает.

## Что уже существует в текущем `main`

На текущей ветке присутствуют существенные Scanner-компоненты: `scanner-model.uc`, `scanner-targets.uc`, `scanner-planner.uc`, `scanner-generator.uc`, `scanner-compiler-authority.uc`, `scanner-state.uc`, `scanner-transient.uc`, `scanner-probes.uc`, `scanner-probe-adapter.uc`, `scanner-probe-executor.uc`, `scanner-worker.uc`, `scanner-cli.uc` и `scanner-runtime-adapter.sh`.

Это важное отличие от раннего read-only audit package: аудит снимался с checkout `59d28af7`, где Scanner описывался как ещё не присутствующий production product. После этого в `main` была интегрирована значительная часть native Scanner vertical.

При этом некоторые запланированные границы всё ещё явно не являются доказанной законченной реализацией. Например, `scanner-results.uc` и `scanner-reconcile.uc` на текущем `main` существуют как пустые файлы. Это хороший пример того, почему документация проверяет содержимое/evidence, а не только имя файла в дереве.

## 1. Request и model

`scanner-model.uc` задаёт продуктовые ограничения запроса и state transitions. Здесь должна фиксироваться семантика режима сканирования, protocol/target и допустимых состояний, а не детали shell-процесса.

Pure model важен для двух вещей. Во-первых, одинаковый запрос должен означать одно и то же независимо от UI. Во-вторых, illegal transition должен отбрасываться до того, как worker начнёт менять transient runtime.

Scanner state не должен использовать Orchestra run ID как Strategy identity. Переиспользовать можно низкоуровневые patterns ownership, heartbeat и evidence, но продуктовые идентификаторы должны оставаться Scanner/Strategy-specific.

## 2. Targets, planner и generator

`scanner-targets.uc` и `scanner-planner.uc` отвечают за превращение запроса в детерминированный план кандидатов. Планирование включает выбор подходящих Strategy из каталога, порядок, фильтрацию по запросу и привязку к target.

`scanner-generator.uc` относится к кандидатам, которые строятся динамически, а не приходят из catalog в готовом виде. Важно, что generated candidate тоже должен получить стабильную provenance/identity внутри конкретного Scanner run; иначе resume, ranking и handoff становятся недоказуемыми.

Planner не запускает runtime. Это pure/near-pure boundary: сначала система должна уметь объяснить, **что собирается проверять и в каком порядке**, и только затем переходить к transient execution.

## 3. Compiler authority

`scanner-compiler-authority.uc` нужен, чтобы Scanner не создавал второй несовместимый compiler Strategy. Кандидат должен опираться на те же authoritative Strategy semantics, которые используются Preview/Validate.

Это одна из ключевых границ parity: Scanner может добавлять временные runtime parameters, target/probe binding и transient ownership, но не должен тихо переопределять смысл самой Strategy.

## 4. A1 transient lifecycle

Самая важная текущая нагрузочная часть Scanner — **A1 transient runtime lifecycle**. A1 связывает один candidate execution от подготовки до cleanup. Это не просто имя процесса: protocol/schema, helper contract и `scanner-runtime-adapter.sh` должны использовать одну и ту же долгоживущую identity.

Текущие acceptance-тесты проверяют повторный запуск, concurrent start, terminal state и классификацию runtime abort. Эти проверки относятся к живому lifecycle contract и не зависят от исторических audit packages.

Почему это важно: Scanner постоянно создаёт временное состояние. Если разные уровни считают «A1» разными сущностями, после ошибки невозможно доказать, какой процесс/namespace/правило принадлежит текущему кандидату и что именно разрешено очищать.

## 5. Transient execution вместо permanent Apply

`scanner-transient.uc` и runtime adapter существуют для временного запуска кандидата. Этот путь должен оставаться отделённым от постоянной Strategy mutation.

```text
Strategy candidate
    ↓
prepare A1
    ↓
start temporary runtime
    ↓
run probes
    ↓
stop owned runtime
    ↓
cleanup owned resources
```

Если probe успешен, это ещё не разрешение записать Strategy в постоянный config. Scanner возвращает evidence/result, а пользовательский permanent flow должен пройти через Strategy.

## 6. Probes

`scanner-probes.uc`, `scanner-probe-adapter.uc` и `scanner-probe-executor.uc` формируют отдельный слой проверки доступности/поведения кандидата.

Probe result должен быть привязан минимум к target, candidate identity, attempt и runtime lifecycle. Без этой привязки успешный HTTP/TLS/другой probe нельзя надёжно приписать именно проверяемой Strategy.

Avatar baseline использует более широкий набор probe semantics, включая baseline-aware поведение и разные protocol paths. Поэтому наличие текущих probe-модулей — сильный прогресс, но parity должна оцениваться по конкретным probe/result semantics, а не по названию компонента.

## 7. Worker и durable state

`scanner-worker.uc` исполняет план и должен сохранять достаточно state, чтобы status/stop/recovery не зависели от открытой вкладки браузера.

Worker ownership включает больше, чем PID. Нужна связка job/run identity, process identity, heartbeat/control state и A1 ownership. При restart или stale state система должна отличать собственный worker от чужого процесса и безопасно определить, можно ли продолжить, завершить или reconciliate операцию.

## 8. Results и ranking

Это одна из областей, где особенно нельзя повышать статус раньше evidence. Scanner должен уметь представить working/failed evidence, порядок результатов, success semantics и понятный report/ranking.

В текущем дереве `scanner-results.uc` пуст, поэтому отдельный results owner на этой границе нельзя описывать как завершённый только из-за наличия файла. Часть result/evidence поведения может существовать внутри worker/tests, но Documentation Depth v2 намеренно требует доказанной публичной product boundary перед заявлением `CURRENT`.

Для Avatar parity важен не просто «выбрать самый быстрый». Ranking должен сохранять ожидаемые product semantics, candidate provenance и возможность однозначно перейти от выбранного результата к Strategy identity.

## 9. Cleanup и reconciliation

Cleanup — обязательная часть каждого candidate attempt. Временные resources не должны накапливаться после успеха, failed probe, stop, worker crash или restart.

Безопасный cleanup работает только с exact-owned resources. Нельзя удалять все похожие firewall/process objects широким шаблоном.

`scanner-reconcile.uc` сейчас пуст, поэтому отдельную завершённую reconciliation boundary также нельзя считать доказанной. Часть защиты уже реализована через A1 runtime ownership и acceptance tests, но production gate требует общей истории восстановления, а не только happy path.

## 10. Strategy handoff

Успешный Scanner result должен превращаться не в скрытый runtime mutation, а в **Strategy reference/handoff**.

```text
working Scanner result
        ↓
known Strategy ID / generated user Strategy
        ↓
Strategy Preview
        ↓
Strategy Validate
        ↓
explicit Apply
```

Это сохраняет single-writer модель и даёт пользователю возможность увидеть, что именно станет постоянным.

## 11. LuCI

Полный product lifecycle заканчивается не backend-тестом, а пользовательским flow: start/status/progress/stop/results/handoff должны быть доступны через bounded rpcd contract и потребляться LuCI без дублирования backend logic.

Поэтому отдельная backend-вертикаль ещё не равна «готовой вкладке Scanner». Для production acceptance нужна сквозная проверка LuCI → rpcd → worker → A1 runtime → probes → result → cleanup → Strategy handoff.

## Текущий статус

**Статус: prototype / active development.** Существующий код уже значительно глубже раннего прототипа: model/planner/probes/worker/transient/A1 runtime представлены реальными модулями, а A1 acceptance tail усилен свежими тестами. Но полный E2E lifecycle и Avatar-equivalent result/ranking/reconciliation/LuCI behavior пока нельзя считать доказанными на основании имеющегося evidence.

Следовательно, документация специально не использует формулировку «Scanner готов». Переход в более высокий статус должен происходить одновременно с кодом, тестами, target evidence, roadmap и parity update.

Связанные страницы: [Сканер](./index.md), [Scanner / BlockCheck / BlockCheck2](./family.md), [Lifecycle Strategy](../strategy/lifecycle.md), [Runtime flow](../../02-architecture/runtime-flow.md), [Roadmap](../../01-project/status-roadmap.md).
