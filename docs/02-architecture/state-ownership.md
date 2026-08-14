---
id: architecture-state-ownership
title: "Владение состоянием и single-writer модель"
type: architecture
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [architecture, state, ownership, transaction, recovery]
---

# Владение состоянием и single-writer модель

В zapret2-manager недостаточно знать, **где лежит JSON или конфигурационный файл**. Важнее знать, кто имеет право считать эти данные каноническими, кто меняет их, какой generation/revision защищает запись от гонок и кто отвечает за восстановление после ошибки.

Эта модель нужна потому, что проект одновременно управляет пользовательскими draft, постоянными Strategy, durable jobs, временными Scanner-процессами, DNS/service state, runtime-наблюдениями и транзакциями. Если несколько компонентов считают себя владельцами одной и той же записи, невозможно надёжно определить, какой результат является правильным после restart, crash или частично выполненной операции.

## Каноническое состояние

**Каноническое состояние** — это durable или authoritative представление, которое владелец области использует как источник истины. Browser state, кеш страницы и промежуточный preview в эту категорию не входят.

Типичный путь выглядит так:

```text
пользовательское намерение
        ↓
      draft
        ↓
   validation
        ↓
authoritative revision
        ↓
 mutation владельца
        ↓
 runtime observation
        ↓
  reconciled status
```

Некоторые native state-документы используют versioned envelope с metadata и поколением (`generation`). Смысл generation не в красивом счётчике: он позволяет отличить состояние, на основании которого готовилась операция, от более нового состояния, появившегося до момента записи.

## Revision, generation и CAS

При изменении постоянной конфигурации опасен сценарий «прочитал старое → кто-то изменил новое → я записал старое поверх нового». Поэтому mutation path должен связывать намерение с конкретной revision/hash/generation.

CAS-проверка означает: запись допустима только если исходное authoritative состояние всё ещё соответствует ожидаемой версии. Если оно изменилось, система возвращает конфликт и требует заново построить Preview/Validate, а не пытается угадать, как слить два намерения.

Это особенно важно для Strategy, где Apply должен быть связан с persisted identity, каталогом и фактической версией состояния, а не только с тем, что браузер когда-то показал пользователю.

## Single-writer

**Single-writer** — одно из центральных правил архитектуры. Для каждого постоянного ресурса должен существовать один санкционированный владелец записи.

Например, Strategy может использовать compiler, preflight, state и status modules, но постоянная конфигурация не должна записываться разными независимыми компонентами «кому удобнее». Scanner также не должен становиться вторым Apply engine только потому, что ему нужно временно запускать кандидатов.

```text
Strategy ──────────────→ sanctioned permanent writer
Scanner ─→ transient owner ─→ evidence ─→ Strategy handoff
Orchestra ─────────────→ собственный evidence/run lifecycle
DNS scope ─────────────→ свой owner
Proxy scope ───────────→ свой owner
```

Эта граница позволяет локализовать rollback, drift и recovery: сначала определяется владелец ресурса, затем проверяется именно его state machine.

## Namespaces

Namespace — это не просто каталог файлов. Он отделяет state и runtime-ресурсы разных lifecycle так, чтобы cleanup одной операции не мог случайно удалить ресурсы другой.

Для transient Scanner особенно важно, чтобы ownership был связан с конкретной попыткой. Идентификатор `A1` в текущем Scanner runtime используется как жизненный цикл временного кандидата: protocol/schema, native/helper boundary и runtime adapter должны ссылаться на один и тот же объект владения от запуска до cleanup.

Если процесс найден только по имени executable, это недостаточное доказательство ownership. Нельзя безопасно завершать произвольный процесс только потому, что его имя похоже на ожидаемое.

## Process Identity

Для долгоживущих и worker-процессов архитектура использует более строгую **Process Identity**, чем голый PID. Минимально полезная identity связывает PID с временем старта процесса (`starttime`); в отдельных границах могут участвовать дополнительные признаки.

Причина проста: PID может быть переиспользован системой. Если после crash остался старый state с PID, а ядро уже выдало этот PID другому процессу, действие только по числу PID становится опасным.

```text
небезопасно: pid = 1234

надёжнее:
(pid = 1234, starttime = X, ожидаемый owner/lifecycle = Y)
```

При несовпадении identity система должна трактовать процесс как foreign/unknown, а не как автоматически принадлежащий manager.

## Durable jobs и worker ownership

Job state отделяет пользовательскую операцию от конкретного worker-процесса. Job имеет собственную идентичность, состояние и progression, а worker — исполнитель, который можно проверить по ownership/heartbeat/process identity.

Это позволяет переживать более сложные сценарии: клиент закрыл вкладку, worker продолжил работу; rpcd был перезапущен; процесс умер; старый worker state остался на диске; операция должна быть reconciled после рестарта.

Для durable jobs «процесс существует» и «job успешно завершён» — разные утверждения. Terminal result должен быть записан как результат state machine, а не выводиться только из наличия PID.

## Транзакции

Постоянная mutation должна иметь явные фазы. Типичная transaction boundary включает:

1. чтение authoritative состояния;
2. validation/preflight;
3. snapshot;
4. проверку revision/hash;
5. mutation через sanctioned writer;
6. restart/reload владельца runtime, если это требуется;
7. verification;
8. commit результата или rollback;
9. повторную verification после rollback.

`core/transaction.uc`, state/jobs foundation и apply path дают общий substrate для такой модели. Но наличие transaction module не означает, что каждая будущая продуктовая область автоматически получила полноценный transaction lifecycle — конкретный consumer должен доказать интеграцию отдельно.

## Snapshot и rollback

Snapshot — это точка восстановления, созданная **до** mutation. Хороший rollback не пытается «примерно вернуть прежние параметры» и не выполняет широкую очистку системного состояния. Он восстанавливает принадлежащий операции snapshot и затем проверяет результат.

Поэтому destructive команды вроде глобального сброса firewall не являются нормальным recovery-механизмом архитектуры. Cleanup должен быть bounded ownership: удаляется то, что создал конкретный lifecycle и что можно доказанно ему приписать.

## Reconciliation

После restart или неожиданного завершения состояние на диске и runtime могут разойтись. Reconciliation отвечает на вопрос: «какой authoritative state ожидается и что реально наблюдается сейчас?».

Возможны четыре общих результата:

- expected state подтверждён;
- операция явно завершилась ошибкой;
- rollback подтверждён;
- состояние **не удалось доказать**.

Последний случай нельзя маскировать как success. Неопределённость сама является значимым состоянием и должна приводить к контролируемому recovery или diagnostic path.

## State ownership по крупным областям

| Область | Основной владелец | Тип состояния | Что не является владельцем |
|---|---|---|---|
| Strategy | Strategy state + sanctioned Apply path | постоянное | LuCI draft, Scanner |
| Scanner | Scanner state/worker/A1 transient lifecycle | временное + evidence | постоянный Strategy writer |
| Jobs | jobs/core job state | durable operation state | конкретная вкладка браузера |
| DNS | DNS/service-DNS owner | постоянное scope state | общий UI coordinator |
| Unified Routing | M6 Route owner + delegated service-DNS writer | durable Route, revision, journal, exact delegated scope | LuCI, direct UCI/dnsmasq/nft writes |
| Orchestra | Orchestra run/evidence lifecycle | run/evidence | Scanner identity |
| Runtime nfqws2 | upstream runtime + manager verification | наблюдаемое runtime state | кеш LuCI |

## Что из этого следует разработчику

Новая функция не должна начинаться с вопроса «в какой файл удобнее записать state?». Сначала нужно определить: **кто владеет состоянием, кто единственный writer, какая revision защищает mutation, как идентифицируется процесс, как выглядит rollback и чем подтверждается reconciliation**.

Если на эти вопросы нет ответа, продуктовая функция ещё не имеет законченной state contract, даже если её happy-path demo уже работает.

Связанные страницы: [Runtime flow](./runtime-flow.md), [Lifecycle Strategy](../03-products/strategy/lifecycle.md), [Lifecycle Scanner](../03-products/scanner/lifecycle.md), [Доказательства и тестирование](../08-development/evidence-testing.md).
