---
id: project-avatar-parity
title: "Совместимость с avatarDD/zapret-gui"
type: parity
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [avatar, parity, compatibility, roadmap]
---

# Совместимость с avatarDD/zapret-gui

Одна из целей zapret2-manager — воспроизвести важное **пользовательское поведение и продуктовые модели** `avatarDD/zapret-gui`, но сделать это нативно для OpenWrt. Parity здесь не означает копирование Python control plane, структуры файлов или каждой внутренней реализации. Сравниваются доступные пользователю capabilities, их state/result semantics и ожидаемый lifecycle.

Эта страница специально отделяет **закреплённый аудит** от более свежего verified state `main`. Исторические aggregate counts не пересчитываются без нового полного аудита всех 79 capability, но локальный статус уже повторно доказанной capability обновляется сразу.

## Закреплённый baseline

Avatar behavioral baseline:

`avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c`

Manager baseline, относительно которого была построена полная матрица:

`t0fox/zapret2-manager@152cb642d5e3a994b3be73aa096530d7f8c2a408`

Сводка закреплённого аудита:

| Статус | Количество |
|---|---:|
| `PARITY` | **11** |
| `PARTIAL` | **31** |
| `MISSING` | **28** |
| `DIVERGENT` | **2** |
| `INTENTIONAL_DEVIATION` | **4** |

Отдельно в исходной матрице отслеживаются **3 capability, требующие пользовательского продуктового решения**, и **2 legacy-dead capability**, которые не входят в основную арифметику пяти статусов.

Эти числа — **pinned audit snapshot**, а не live-счётчик. Они **не пересчитываются автоматически** после новых коммитов. Для изменения глобальных чисел нужен повторный полный аудит всех capability против выбранного Avatar baseline.

## Current verified baseline

Текущий проверенный manager baseline:

`t0fox/zapret2-manager@d8a833af4acae23d1b4a944deec0355960d1ceb7`

На нём повторно подтверждено:

- Scanner parity: **COMPLETE**;
- Scanner → Strategy handoff: **COMPLETE**;
- Scanner results/ranking/reconciliation больше не являются открытым Scanner blocker;
- native aggregate: **567/567 PASS**;
- required native subgate: **36/36 PASS**;
- root gate: **120/120 PASS**;
- remaining failures: **0**.

Этот current-main delta обновляет статус Scanner и handoff, но сам по себе не переписывает исторические aggregate counts `11/31/28/2/4` без нового полного 79-capability audit.

## Что означают статусы

**PARITY** — существующая реализация, достижимый consumer и evidence покрывают проверяемый поведенческий контракт.

**PARTIAL** — значимая часть эквивалента существует, но не хватает части поведения, consumer или доказательств.

**MISSING** — продуктовая capability как законченный пользовательский flow отсутствует.

**DIVERGENT** — текущая продуктовая модель заметно отличается и её нельзя честно представить как эквивалент исходного flow.

**INTENTIONAL_DEVIATION** — поведение или внутренний lifecycle намеренно отличается по OpenWrt-native или safety причине. Такой статус допустим только тогда, когда пользовательская семантика остаётся совместимой или отличие явно документировано.

## Dashboard и общий status

**Общий статус: PARTIAL.** В zapret2-manager уже есть status collectors, Overview, service controls, runtime summary и отображение active Strategy identity/drift. Закреплённый аудит отдельно подтвердил parity для части active Strategy projection.

До полной parity остаётся field-by-field сопоставление Avatar dashboard: набор карточек, unified logs/events, настройки, autostart и одинаковые default/refresh semantics. Наличие нескольких отдельных диагностических страниц не считается автоматически одним Avatar-equivalent dashboard.

**Критерий перехода:** все пользовательские поля и действия сопоставлены с baseline, доступны через LuCI и имеют source/UI/target evidence.

## Strategy

**Самая сильная область проекта.** В pinned audit несколько ключевых Strategy-capability уже имеют `PARITY`: aggregate Strategy с ordered Profiles, enabled/disabled semantics, builtin/user разделение, metadata, duplicate flow, Preview, Validate/Apply и части каталога.

Текущий `main` содержит отдельные `strategy-model`, `strategy-catalog`, `strategy-compiler`, `strategy-state`, `strategy-status` и CLI boundaries. Постоянная mutation использует существующий transactional Apply path с preflight, snapshot, revision/CAS guard, verification и rollback.

Не всё вокруг Strategy завершено. Полная экосистема Avatar требует Lua/blob/IP-set registries, дополнительных asset references, полной protocol/applicability семантики и дальнейших routing consumers.

**Критерий перехода оставшихся PARTIAL/MISSING строк:** asset lifecycle и catalog semantics реализованы, имеют UI/contract tests и не создают второй compiler/Apply engine.

## Scanner

В закреплённой исторической матрице Scanner был одной из крупнейших зон разрыва: product model и ranking/handoff оценивались как `DIVERGENT`, а durable state/probes/cleanup — как `PARTIAL`. Этот вывод остаётся частью pinned audit history, но **не описывает текущий verified main**.

### Текущий main: COMPLETE

На `d8a833af4acae23d1b4a944deec0355960d1ceb7` Scanner parity подтверждена как **COMPLETE**. Прежние claims о незавершённых results/ranking/reconciliation и о недоказанном полном Scanner lifecycle устарели и больше не являются текущими blockers.

Текущий доказанный Scanner vertical включает product/model planning, canonical A1 transient runtime, probes/execution, results/ranking/reconciliation, cleanup/recovery и завершённый handoff в Strategy authority.

```text
model → planner/generator → A1 transient runtime → probes
→ typed results → ranking/report → cleanup/reconciliation
→ Strategy handoff
```

Scanner → Strategy handoff также подтверждён как **COMPLETE**. Постоянное применение найденного результата остаётся обязанностью Strategy lifecycle; завершённый handoff не создаёт второй permanent writer и не отменяет обычный Preview → Validate → Apply path.

Глобальные pinned counts не пересчитываются этой локальной статусной правкой: для них по-прежнему нужен новый полный аудит всех 79 capability.

Подробнее: [Lifecycle Scanner](../03-products/scanner/lifecycle.md).

## BlockCheck и BlockCheck2

Avatar рассматривает `Scanner`, `BlockCheck` и `BlockCheck2` как **три разных flow**.

Отдельный Avatar-like **BlockCheck classifier** в pinned audit имеет `MISSING`: нужен собственный diagnostic model, classification result и UI.

**BlockCheck2** имеет `PARTIAL`: текущий manager умеет управляемо запускать upstream `blockcheck2.sh`, связывать его с job lifecycle и разбирать часть результата, но это ещё не полное совпадение Avatar mode/env/stream/result→Strategy semantics.

Завершённый Scanner не закрывает эти две строки: их назначение и result models различаются. M5 BlockCheck family — текущий следующий product milestone.

Подробнее: [Scanner / BlockCheck / BlockCheck2](../03-products/scanner/family.md).

## DNS, lists и assets

**DNS: PARTIAL.** В manager существуют DNS provider, manual/global DNS, service-DNS и domain/list-related slices. Это реальный substrate, но per-domain routing/remediation и точное совпадение provider/default/result semantics с Avatar ещё неполны.

**Lists/assets: PARTIAL + MISSING.** Host/domain lists и catalog data существуют, но полноценные registries для Lua, blob, IP-set, geosite/geoip и связанных selector assets отсутствуют как единая продуктовая модель.

Canonical asset registries остаются **NEXT / PARALLEL PLANNED**: существующий substrate сам по себе не доказывает, что реализация M2 registry model уже начата.

Эти registries — не декоративная «страница файлов». На них зависят Strategy dependencies и будущий routing selector model.

## Unified routing

**Статус: MISSING.** Avatar имеет aggregate model вида Destination/selectors → primary method → ordered fallbacks → monitoring/failover. В текущем manager нет законченного владельца этой модели.

Проблема не решается добавлением нескольких nft-правил. Для parity нужны durable selectors, CRUD/Preview/Apply/remove, device/list/geosite/geoip linkage, health state и ownership ресурсов.

В исходном parity contract отдельно существуют пользовательские решения по cyclic fallback behavior и фактическому смыслу route priority. Пока решение не принято, документация не должна выдумывать желаемое поведение.

## Tunnels

**Telegram proxy: PARTIAL.** Есть bounded optional-provider lifecycle, status/health и UI, но это только одна tunnel capability и не вся Avatar tunnel family.

**usque/MASQUE/WARP, AWG, sing-box, mihomo, Opera, warp-in-warp: MISSING или не доказаны как production product.** Для них нужны не только executable/config, но owned interface/routing resources, secret handling, lifecycle, health, update/rollback и integration с unified routing.

## Auto-remediation

**Статус: MISSING относительно Avatar dispatcher.** В manager уже существует Auto Strategy с полезными CAS/cooldown/recovery механизмами, но это другая продуктовая модель.

Avatar-style remediation зависит от ещё незакрытых classifier/DNS/routing/tunnel слоёв:

```text
classification
  ├─ none → skip
  ├─ DNS → DNS remediation
  ├─ DPI → Scanner
  └─ IP/full block → routing/tunnel
```

Scanner теперь завершён на current verified baseline, но пока classifier, routing и tunnels не имеют законченных contracts, auto-remediation нельзя корректно объявить готовым одним orchestration-модулем.

## Maintenance и lifecycle

Backup/restore, engine lifecycle, maintenance и diagnostics имеют заметный существующий substrate и в основном находятся в зоне `PARTIAL`.

GUI self-update является примером `INTENTIONAL_DEVIATION`: OpenWrt package ownership важнее копирования self-modifying update механизма. Эквивалентное пользовательское поведение должно строиться через безопасный package lifecycle, а не через самостоятельную перезапись установленных файлов приложением.

## Главные блокеры parity

1. Создать канонические registries для Lua/blob/IP-set/geosite/geoip и связанных assets.
2. Разделить и закончить BlockCheck и BlockCheck2 capabilities.
3. Ввести unified routing с Destination/selectors, primary/fallback methods и ownership.
4. Построить tunnel lifecycle поверх routing foundation.
5. Только после этого связывать classifier, DNS, Scanner и tunnels в auto-remediation.

Scanner lifecycle и Scanner → Strategy handoff больше не входят в этот список: оба подтверждены как **COMPLETE** на current verified baseline.

## Как статус будет обновляться

Parity-страница обновляется вместе с разработкой, но **локальный verified delta и полный aggregate audit — разные операции**.

Scanner на `d8a833af4acae23d1b4a944deec0355960d1ceb7` — пример локального статуса, который уже можно поднять до `COMPLETE`, потому что соответствующий product contract повторно доказан. Исторические aggregate counts меняются только после нового полного 79-capability audit.

Так документация не отстаёт от разработки и одновременно не выдаёт локальный milestone update за молчаливый пересчёт всей Avatar parity matrix.

Дальше: [Roadmap](./status-roadmap.md), [Архитектура](../02-architecture/index.md), [Lifecycle Strategy](../03-products/strategy/lifecycle.md), [Lifecycle Scanner](../03-products/scanner/lifecycle.md), [Доказательства и тестирование](../08-development/evidence-testing.md).
