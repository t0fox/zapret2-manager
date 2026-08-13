---
title: "Avatar Strategy Scanner — Task 5 Ownership Amendment (Per-operation Dedicated Table, Model A1)"
date: 2026-08-13
status: approved-pending-user-review
amends: docs/superpowers/plans/2026-08-12-avatar-strategy-scanner-parity.md
---

# Avatar Strategy Scanner Task 5 Ownership Amendment

## Status

**Architecture APPROVED** subject to the two corrections below. This document is the canonical written spec/amendment. Implementation is **blocked** until the mandatory USER REVIEW GATE is passed.

## Главный Invariant (неизменный)

> Scanner **никогда** не использует userspace get/list/check → delete/mutate как primary ownership synchronization primitive.
> Ownership доказывается **kernel ownership model** (`NFT_TABLE_F_OWNER`, no `PERSIST`) + durable journal + process identity.
> Любая неопределённость → **fail closed**.

## Ownership Model (Model A1 — Approved)

- Per-operation dedicated table + `NFT_TABLE_F_OWNER` + **no `PERSIST`** + durable journal + Task 7 reconciliation.
- Kernel semantics: owner table защищена от манипуляции другими процессами; при смерти owning netlink endpoint таблица автоматически удаляется kernel’ом.
- `NFT_TABLE_F_PERSIST` не используется по умолчанию. Orphan takeover не требуется.

## Owner Process — Fixed Resolution

**Bounded long-lived per-operation ownership helper** (рефакторинг `z2m-scanner-firewall-helper.c`):

- Открывает и удерживает netlink socket на всё время операции.
- Создаёт **ровно одну** dedicated `inet` таблицу с `NFT_TABLE_F_OWNER`, без `PERSIST`.
- Устанавливает только цепочку и правила **этой** операции.
- Сообщает Scanner runtime `READY` + operation identity.
- Остаётся живым ровно столько, сколько существует transient firewall object.
- По запросу cleanup удаляет **только свою** таблицу.
- При SIGKILL/crash helper’а — kernel автоматически удаляет таблицу.
- **Никогда**:
  - не управляет чужими таблицами/правилами;
  - не выполняет произвольные nft-команды;
  - не становится вторым Scanner/business-logic engine.

Product logic (планирование кандидатов, state machine Scanner, ranking, Strategy semantics, reconciliation policy, permanent Apply, общее управление firewall) **остаётся** в ucode-слоях (Task 7 и выше).

## Table Naming (Correction 1 Applied)

- Формат: `z2m_sc_<sid8>_<cid8>_<gen4>_<nonce32>`
  - `sid8` = 8 hex (4 байта session)
  - `cid8` = 8 hex (4 байта candidate)
  - `gen4` = 4 hex (2 байта generation)
  - `nonce32` = **32 hex символа = 128-битное случайное значение**

- Максимальная длина имени: **62 символа** (7 + 8 + 1 + 8 + 1 + 4 + 1 + 32).
- Длина остаётся значительно ниже лимита nftables (256).
- Nonce обеспечивает collision-resistant naming и stable identity.
- **Security boundary ownership** — kernel `NFT_TABLE_F_OWNER`, а не секретность имени.

## Kernel-visible Operation Metadata

- Table userdata содержит: operation UUID + generation + 128-bit nonce.
- Userdata — reconciliation/diagnostics/identity маркер.
- **Не** является synchronization primitive и **не** устраняет TOCTOU.

## Canonical Journal Ownership (Correction 2 Applied)

**ucode Scanner / Task 7** — единственный владелец и писатель канонического operation journal.

Bounded C ownership helper:
- Выполняет ограниченное kernel/netlink действие.
- Возвращает структурированное evidence/result в ucode.
- **Не** владеет product journal, Scanner lifecycle policy, reconciliation policy или permanent state.
- Может хранить минимальное ephemeral process-local состояние для удержания netlink socket и identity таблицы.

### Journal State Machine (ucode — single writer)

| Состояние       | Кто пишет (ucode) | Обязательное evidence перед записью                          | Crash до записи (kernel action мог выполниться) | Task 7 recovery (owner dead)                                      |
|-----------------|-------------------|---------------------------------------------------------------|--------------------------------------------------|-------------------------------------------------------------------|
| **PREPARED**    | ucode             | operation identity, expected table name, nonce               | helper не spawned                                | verify absence таблицы → reconcile process/queue/journal         |
| **TABLE_CREATED** | ucode (после verified helper response) | таблица создана, owner установлен                           | таблица может отсутствовать                      | verify absence → reconcile                                       |
| **RULES_READY** | ucode             | цепочка + правила + NFQUEUE установлены                      | правила могут отсутствовать                      | verify absence → reconcile                                       |
| **PROCESS_BOUND** | ucode           | nfqws2 запущен, PID/starttime/argv digest зафиксированы      | процесс может отсутствовать                      | verify absence → reconcile                                       |
| **ACTIVE**      | ucode             | все предыдущие + probes выполняются                          | —                                                | normal owned cleanup                                             |
| **CLEANING**    | ucode             | nfqws2 остановлен и verified                                 | cleanup может быть неполным                      | verify absence → reconcile                                       |
| **CLEANED**     | ucode (после verified helper delete result) | таблица удалена                                          | —                                                | done                                                             |

Task 7 **никогда** не реконструирует nft ownership из имён/digest’ов. Он только проверяет отсутствие таблицы при dead owner и reconcile’ит process/queue/journal state.

## NFQUEUE — Отдельная Proof Obligation

Table ownership решает только nftables часть.

**NFQUEUE ownership model** (должна быть определена и протестирована отдельно):

- Operation identity → allocation очереди
- nfqws2 bind к очереди
- Process identity evidence (PID + starttime + argv digest)
- Shutdown → release → reconciliation
- Task 7 **не имеет права** убивать/релизить foreign NFQUEUE/process state.

Task 5 считается решённым **только** после того, как и table ownership, и NFQUEUE ownership доказаны и протестированы.

## Adversarial Property OWNER (требует actual test)

Пока ownership helper жив, **внешний процесс не должен** иметь возможности удалить/пересоздать таблицу под тем же именем.

Сценарий после смерти helper’а:
- Owner dead → таблица должна была исчезнуть kernel’ом.
- Таблица неожиданно существует → foreign/uncertain → **FAIL CLOSED** → never delete.

## fw4 Behavior

Утверждения о поведении fw4 reload/flush **не включены** в дизайн до получения isolated теста + чтения `firewall4` source.

## Summary — Approved Architecture

- Per-operation dedicated table (62 символа max)
- Bounded long-lived ownership helper (рефакторинг `z2m-scanner-firewall-helper.c`)
- `NFT_TABLE_F_OWNER`, **no `PERSIST`**
- 128-bit nonce32 в имени + userdata
- ucode Scanner/Task 7 — единственный canonical journal writer
- Durable explicit journal state machine (ucode пишет все переходы)
- Task 7 reconciliation только для process/queue/journal state (не ownership guessing)
- Kernel automatic table destruction on owner death
- **Userspace get/list/check → delete никогда не является primary ownership primitive**
- NFQUEUE ownership — отдельная proof obligation

---

**Section APPROVED** (с Correction 1 и Correction 2).

Next mandatory step: USER REVIEW GATE.
Do not begin implementation.
