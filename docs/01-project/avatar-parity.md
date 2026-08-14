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

Эта страница специально отделяет **закреплённый аудит** от более свежих изменений `main`. Иначе любой новый Scanner-коммит создавал бы иллюзию, что глобальный процент совместимости автоматически пересчитан, хотя полный аудит 79 capability ещё не повторялся.

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

Эти числа — **pinned audit snapshot**, а не live-счётчик. Они **не пересчитываются автоматически** после нескольких новых коммитов. Для изменения глобальных чисел нужен повторный полный аудит всех capability против выбранного Avatar baseline.

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

Не всё вокруг Strategy завершено. Полная экосистема Avatar требует Lua/blob/IP-set registries, дополнительных asset references, полной protocol/applicability семантики и дальнейших consumers со стороны Scanner/routing.

**Критерий перехода оставшихся PARTIAL/MISSING строк:** asset lifecycle и catalog semantics реализованы, имеют UI/contract tests и не создают второй compiler/Apply engine.

## Scanner

В закреплённой матрице Scanner был одной из крупнейших зон разрыва: product model и ranking/handoff оценивались как `DIVERGENT`, а durable state/probes/cleanup — как `PARTIAL`. Orchestra давал полезные patterns, но не являлся Avatar Scanner.

### Текущий main: delta после аудита

После исходного audit package в `main` появился существенно более полный native Scanner слой: model, targets, planner, generator, compiler authority, state, transient execution, probes, probe adapter/executor, worker, CLI и runtime adapter.

Отдельные свежие изменения интегрировали **canonical A1 runtime lifecycle** и закрыли acceptance-tail сценарии вокруг повторного запуска, concurrent start, terminal state и runtime abort classification. Это важный реальный прогресс.

Но мы намеренно **не меняем глобальные 11/31/28/2/4 на основании этого delta**. В текущем дереве, например, отдельные `scanner-results` и `scanner-reconcile` boundaries ещё не представлены законченной реализацией, а полная LuCI/target E2E цепочка не доказана.

Scanner остаётся **prototype / active development**, пока не доказана вертикаль:

```text
model → planner/generator → A1 transient runtime → probes
→ typed results → ranking/report → cleanup/reconciliation
→ Strategy handoff → LuCI → target evidence
```

Подробнее: [Lifecycle Scanner](../03-products/scanner/lifecycle.md).

## BlockCheck и BlockCheck2

Avatar рассматривает `Scanner`, `BlockCheck` и `BlockCheck2` как **три разных flow**.

Отдельный Avatar-like **BlockCheck classifier** в pinned audit имеет `MISSING`: нужен собственный diagnostic model, classification result и UI.

**BlockCheck2** имеет `PARTIAL`: текущий manager умеет управляемо запускать upstream `blockcheck2.sh`, связывать его с job lifecycle и разбирать часть результата, но это ещё не полное совпадение Avatar mode/env/stream/result→Strategy semantics.

Нельзя закрыть эти две строки фразой «у нас уже есть Scanner». Их назначение и result models различаются.

Подробнее: [Scanner / BlockCheck / BlockCheck2](../03-products/scanner/family.md).

## DNS, lists и assets

**DNS: PARTIAL.** В manager существуют DNS provider, manual/global DNS, service-DNS и domain/list-related slices. Это реальный substrate, но per-domain routing/remediation и точное совпадение provider/default/result semantics с Avatar ещё неполны.

**Lists/assets: PARTIAL + MISSING.** Host/domain lists и catalog data существуют, но полноценные registries для Lua, blob, IP-set, geosite/geoip и связанных selector assets отсутствуют как единая продуктовая модель.

Эти registries — не декоративная «страница файлов». На них зависят Strategy dependencies, Scanner candidate execution и будущий routing selector model.

## Unified routing

**Статус: MISSING.** Avatar имеет aggregate model вида Destination/selectors → primary method → ordered fallbacks → monitoring/failover. В текущем manager нет законченного владельца этой модели.

Проблема не решается добавлением нескольких nft-правил. Для parity нужны durable selectors, CRUD/Preview/Apply/remove, device/list/geosite/geoip linkage, health state и ownership ресурсов.

В исходном parity contract отдельно существуют пользовательские решения по cyclic fallback behavior и фактическому смыслу route priority. Пока решение не принято, документация не должна выдумывать желаемое поведение.

## Tunnels

**Telegram proxy: PARTIAL.** Есть bounded optional-provider lifecycle, status/health и UI, но это только одна tunnel capability и не вся Avatar tunnel family.

**usque/MASQUE/WARP, AWG, sing-box, mihomo, Opera, warp-in-warp: MISSING или не доказаны как production product.** Для них нужны не только executable/config, но owned interface/routing resources, secret handling, lifecycle, health, update/rollback и integration с unified routing.

## Auto-remediation

**Статус: MISSING относительно Avatar dispatcher.** В manager уже существует Auto Strategy с полезными CAS/cooldown/recovery механизмами, но это другая продуктовая модель.

Avatar-style remediation зависит сразу от нескольких ранее незакрытых слоёв:

```text
classification
  ├─ none → skip
  ├─ DNS → DNS remediation
  ├─ DPI → Scanner
  └─ IP/full block → routing/tunnel
```

Пока Scanner, classifier, routing и tunnels не имеют законченных contracts, auto-remediation нельзя корректно объявить готовым одним orchestration-модулем.

## Maintenance и lifecycle

Backup/restore, engine lifecycle, maintenance и diagnostics имеют заметный существующий substrate и в основном находятся в зоне `PARTIAL`.

GUI self-update является примером `INTENTIONAL_DEVIATION`: OpenWrt package ownership важнее копирования self-modifying update механизма. Эквивалентное пользовательское поведение должно строиться через безопасный package lifecycle, а не через самостоятельную перезапись установленных файлов приложением.

## Главные блокеры parity

1. Довести Scanner до полного evidence-backed lifecycle и Strategy handoff.
2. Создать канонические registries для Lua/blob/IP-set/geosite/geoip и связанных assets.
3. Разделить и закончить BlockCheck и BlockCheck2 capabilities.
4. Ввести unified routing с Destination/selectors, primary/fallback methods и ownership.
5. Построить tunnel lifecycle поверх routing foundation.
6. Только после этого связывать classifier, DNS, Scanner и tunnels в auto-remediation.

## Как статус будет обновляться

Parity-страница обновляется вместе с разработкой, но **локальный delta и полный аудит — разные операции**.

Если, например, Scanner получил новый доказанный A1 lifecycle, это сразу отражается в секции current-main delta и roadmap. Но строка `PARTIAL → PARITY` и глобальные counts меняются только тогда, когда весь соответствующий behavioral contract повторно проверен на актуальной ревизии и evidence достаточен для нового статуса.

Так документация не отстаёт от разработки и одновременно не превращает каждый merged test в маркетинговую надпись «готово».

Дальше: [Roadmap](./status-roadmap.md), [Архитектура](../02-architecture/index.md), [Lifecycle Strategy](../03-products/strategy/lifecycle.md), [Lifecycle Scanner](../03-products/scanner/lifecycle.md), [Доказательства и тестирование](../08-development/evidence-testing.md).
