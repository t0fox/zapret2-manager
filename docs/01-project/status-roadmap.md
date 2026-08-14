---
id: project-status-roadmap
title: "Roadmap: зависимости, критерии завершения и evidence"
type: project
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [project, status, roadmap, evidence]
---

# Roadmap: зависимости, критерии завершения и evidence

Этот roadmap — не обещание дат релизов и не список пожеланий. Он показывает **зависимости между продуктами, текущее доказанное состояние, следующий безопасный срез и критерий, после которого milestone действительно можно считать завершённым**.

Исходный read-only audit package был снят 14 августа 2026 года с более раннего checkout. С тех пор `main` существенно продвинулся. Статусы ниже привязаны к текущему проверенному baseline и не переносят старые audit-блокеры в настоящее время, если они уже закрыты evidence.

## Current verified baseline

Проверенный baseline этой страницы:

- current main: `d8a833af4acae23d1b4a944deec0355960d1ceb7`;
- Scanner parity: **COMPLETE**;
- Scanner → Strategy handoff: **COMPLETE**;
- native aggregate: **567/567 PASS**;
- required native subgate: **36/36 PASS**;
- root gate: **120/120 PASS**;
- remaining failures: **0**.

Предыдущие 10 native failures были verification-foundation regressions и к этому baseline уже исправлены. Это подтверждает текущую зелёную verification foundation, но не означает, что native foundation «заморожен навсегда»: новые runtime/contracts/product requirements могут потребовать дальнейшего развития и повторного полного прогона gates.

## Карта зависимостей

```text
[M1 COMPLETE] Native foundation
   ├── [M2 NEXT / PARALLEL PLANNED] Canonical asset registries ───┐
   │                                                              │
   └── [M3 COMPLETE] Scanner provider/lifecycle                    │
             ↓                                                     │
        [M4 COMPLETE] Scanner → Strategy handoff                    │
             ↓                                                     │
        [M5 CURRENT / IN PROGRESS] BlockCheck family               │
             ↓                                                     │
        [M6 PLANNED] Unified routing ←──────────────────────────────┘
             ↓       ↓
     [M7 PLANNED]   [M8 FUTURE] WARP/usque
       DNS/lists          ↓
             │       [M9 FUTURE] Tunnels
             │            ↓
             └────→ [M10 FUTURE] Monitoring/failover
                            ↓
                  [M11 FUTURE] Auto-remediation

M12 Documentation — непрерывный слой над M1–M11
```

M2 остаётся параллельной foundation-веткой для последующих asset/routing consumers. Текущий следующий product milestone после закрытых M3/M4 — M5 BlockCheck family.

## M1 — Native foundation

**Статус: COMPLETE на текущем verified baseline.** Native aggregate проходит **567/567**, required native subgate — **36/36**, root gate — **120/120**, remaining failures — **0**. Предыдущие 10 verification-foundation regressions исправлены.

**Сейчас.** Native core для state/jobs/namespace/process/transaction/recovery/result, native backend contract и verification gates согласованы на ревизии `d8a833af4acae23d1b4a944deec0355960d1ceb7`.

**Зависимости.** OpenWrt/ucode toolchain, package layout, rpcd integration, process identity и state ownership.

**Следующий срез.** Не открывать новый foundation scope сам по себе. Расширять helper/contracts только под доказанную потребность следующих product milestones и после изменения заново подтверждать соответствующие native/root gates.

**Критерий завершения текущего milestone.** Для этого baseline выполнен: native verification foundation полностью зелёная и remaining failures равны нулю.

**Доказательства.** `567/567 PASS`, `36/36 PASS`, `120/120 PASS`, remaining failures `0` на current verified main.

## M2 — Canonical asset registries

**Статус: NEXT / PARALLEL PLANNED.** Это параллельная foundation-работа, но на current baseline не доказано, что реализация именно canonical asset registries уже началась. Существующие lists/catalog/domain data, asset helpers и preflight — полезный substrate, но не считаются самим M2 registry model.

**Сейчас.** В manager есть lists/catalog/domain data и preflight, умеющий проверять часть внешних зависимостей. Полного registry layer со стабильной identity/provenance/consumers пока нет.

**Зависимости.** M1 state/ownership, безопасные paths/atomic writes, package provenance.

**Следующий срез.** Вводить registries по одному домену: Lua, blob, IP-set, затем geosite/geoip/hosts, не создавая один безразмерный «файловый менеджер».

**Критерий завершения.** Каждый asset имеет owner, стабильный ID, hash/provenance, bounded CRUD/read contract и явные ссылки из Strategy/Scanner/routing consumers.

**Доказательства.** Registry tests, package manifest, dependency/preflight tests, safe upgrade/import evidence.

## M3 — Scanner provider и полный transient lifecycle

**Статус: COMPLETE.** На current verified main Scanner parity закрыта; старые claims о незавершённых results/ranking/reconciliation больше не описывают текущее состояние.

**Сейчас.** Scanner vertical доказана как завершённая для текущего milestone: model/targets/planner/generator/compiler authority/state, canonical A1 transient lifecycle, probes/execution, results/ranking/reconciliation, cleanup/recovery и observable product flow больше не числятся незакрытым Scanner blocker.

**Зависимости.** M1 process/namespace ownership, Strategy compiler authority и безопасное transient resource ownership. M2 остаётся параллельным расширением asset coverage, а не условием для сохранения статуса завершённого M3 baseline.

**Критерий завершения.** Выполнен на текущем baseline: Scanner проходит полный evidence-backed provider/lifecycle contract без permanent mutation и без незакрытого ownership/cleanup blocker.

**Доказательства.** Current verified repository state на `d8a833af4acae23d1b4a944deec0355960d1ceb7`: **Scanner parity COMPLETE**; native/root verification gates полностью зелёные.

## M4 — Scanner → Strategy handoff

**Статус: COMPLETE.** Старое утверждение, что полный product handoff ещё не доказан, больше не актуально.

**Сейчас.** Scanner result может пройти доказанный handoff в durable Strategy flow. Постоянная mutation по-прежнему не принадлежит Scanner: durable результат проходит существующую Strategy authority и обычный Preview → Validate → Apply lifecycle.

**Зависимости.** Завершённый M3 Scanner lifecycle и стабильный Strategy aggregate.

**Критерий завершения.** Выполнен на current verified baseline: Scanner → Strategy handoff доказан как завершённая capability, сохраняя Strategy authority для постоянного применения.

**Доказательства.** Current verified repository state на `d8a833af4acae23d1b4a944deec0355960d1ceb7`: **Scanner → Strategy handoff COMPLETE**.

## M5 — BlockCheck family

**Статус: CURRENT / IN PROGRESS — следующий product milestone.** Это текущий product focus после закрытых M3/M4; сам M5 ещё не объявляется complete.

**Сейчас.** Upstream `blockcheck2.sh` имеет managed wrapper/job path и часть result→profile поведения. Отдельный Avatar-equivalent BlockCheck classifier остаётся незакрытой capability.

**В работе.** Нужно не смешать три продукта: Scanner, BlockCheck, BlockCheck2.

**Зависимости.** Durable jobs, завершённый M3 result/evidence lifecycle и завершённый M4 Strategy handoff.

**Следующий срез.** Сначала отдельный BlockCheck diagnostic/classification contract; затем точная адаптация BlockCheck2 mode/env/stream/stop/result semantics.

**Критерий завершения.** Все три flow доступны независимо и имеют собственные request/state/result/error semantics; BlockCheck2 result безопасно преобразуется в Strategy aggregate.

**Доказательства.** API/model tests, parser/stream/cleanup tests, LuCI reachability и target smoke.

## M6 — Unified routing

**Сейчас.** Полного Avatar-like aggregate `Destination/selectors → primary method → ordered fallbacks` нет. Существующие DNS/list/proxy/network pieces нельзя объявлять unified routing только потому, что они уже изменяют отдельные сетевые объекты.

**В работе.** Нужна одна durable модель selectors и методов с single-writer ownership.

**Зависимости.** M2 registries, device/list selectors, DNS cross-flow, безопасные runtime resource owners.

**Следующий срез.** Реализовать schema/selectors и один минимальный method path с Preview/Apply/remove прежде, чем добавлять много tunnels.

**Критерий завершения.** Route durable/revisioned, имеет Preview, Apply, Remove и Status, а mutation затрагивает только принадлежащие manager ресурсы.

**Доказательства.** Routing compiler/ownership tests, nft/ipset/dnsmasq fixtures, target Apply/rollback.

## M7 — DNS/lists/routing cross-flow

**Сейчас.** DNS provider, global/manual DNS, service-DNS, domain hub и lists существуют как реальные отдельные slices.

**В работе.** Между ними пока нет полного Avatar unified selector/routing contract.

**Зависимости.** M2 asset IDs и M6 routing selectors.

**Следующий срез.** Связать domain/list selector с DNS decision и route preview без появления дублирующих writers.

**Критерий завершения.** Одна domain rule round-trip проходит selection → DNS/routing Preview → Apply → reread/status и однозначно показывает ownership.

**Доказательства.** DNS/routing integration tests, generated config evidence, target reread.

## M8 — WARP/usque foundation

**Сейчас.** Telegram proxy — существующая отдельная optional-provider capability. Полноценный WARP/usque/MASQUE product lifecycle не заявляется как shipped.

**В работе.** Для usque есть архитектурные исследования/design material, но design не равен runtime implementation.

**Зависимости.** M6 unified routing, interface/resource ownership, secrets policy и package lifecycle.

**Следующий срез.** Сначала install/config/secrets/interface/start-stop/health contract, затем routing adapter.

**Критерий завершения.** Tunnel имеет owned interface/config/process, health, logs, safe removal и доказанный route role.

**Доказательства.** Package/upgrade tests, secret redaction tests, TUN/route target evidence, rollback.

## M9 — Остальные tunnel products

**Сейчас.** AWG, sing-box, mihomo, Opera, warp-in-warp не считаются завершёнными product owners.

**В работе.** Их нельзя безопасно добавлять раньше общей routing/tunnel foundation, иначе каждый создаст собственный несовместимый lifecycle.

**Зависимости.** M8 foundation и M6 routing.

**Следующий срез.** Добавлять providers последовательно, переиспользуя общий lifecycle и resource ownership.

**Критерий завершения.** Каждый provider имеет reachable UI, config/process/interface ownership, health/logs, update/remove/rollback и routing integration.

**Доказательства.** Provider suites, package evidence, router resource inventory до/после forced failures.

## M10 — Monitoring, failover и optimizer

**Сейчас.** В manager уже есть monitoring/status-oriented функциональность, но это не полный multi-method route/tunnel optimizer Avatar.

**В работе.** Требуются health history, cooldown и deterministic failover semantics.

**Зависимости.** M8/M9 tunnel methods и M6 routing model.

**Следующий срез.** Ввести health state/history для одного route с двумя методами и проверяемым failover.

**Критерий завершения.** Failover детерминирован, observable и не изменяет unrelated routes; возврат к primary имеет явную политику.

**Доказательства.** Monitor/failover tests и контролируемый outage drill на target.

## M11 — Auto-remediation

**Сейчас.** `Auto Strategy` уже содержит полезные CAS/cooldown/recovery механизмы, но это не Avatar remediation dispatcher.

**В работе.** Нужна оркестрация поверх уже доказанных capabilities, а не замена отсутствующих capabilities одной большой функцией.

**Зависимости.** M3/M4 Scanner, M5 classifier, M7 DNS flow, M6/M8 routing+tunnels, M10 monitoring.

**Следующий срез.** Реализовать typed mapping `none → skip`, `DNS → DNS fix`, `DPI → Scanner`, `IP/full → routing/tunnel` сначала в Preview-only режиме.

**Критерий завершения.** Preview/auto-apply/concurrency/cooldown/postverify одинаково безопасны для всех action classes.

**Доказательства.** Classification matrix, safety tests, target canary и forced rollback.

## M12 — Living public documentation

**Сейчас.** Quartz public/internal pipeline работает, сайт русифицирован, ссылки учитывают GitHub Pages subpath. Documentation Depth v2 добавляет architecture ownership, Strategy/Scanner lifecycle, parity, evidence policy и настоящий roadmap.

**В работе.** Документация должна перестать быть ручным финальным этапом и стать частью change contract.

**Зависимости.** Все продуктовые области как источники правды; Knowledge CI и public leak/link gates.

**Следующий срез.** Docs freshness check связывает изменения Strategy/Scanner/BlockCheck/DNS/core ownership с обязательным documentation impact.

**Критерий завершения.** Существенное изменение продукта не может пройти обычный knowledge gate, если ни один релевантный public/evidence document не был затронут; parity и roadmap обновляются вместе с evidence.

**Доказательства.** RED→GREEN freshness tests, public/internal builds, leak/link tests, live serve smoke и проверка задеплоенного Pages artifact.

## Как читать roadmap

Milestone становится `COMPLETE` только на основании проверяемой вертикали и evidence соответствующего уровня. Статус относится к указанному baseline: завершённый milestone может дальше эволюционировать, а любое изменение его contract требует повторной проверки релевантных gates.

На current verified baseline M3 Scanner и M4 Scanner → Strategy handoff закрыты. Текущий product focus — M5 BlockCheck family; M2 canonical asset registries остаётся параллельной planned foundation-работой. M6–M11 сохраняют прежний порядок и scope.

Связанные страницы: [Avatar parity](./avatar-parity.md), [Lifecycle Scanner](../03-products/scanner/lifecycle.md), [Lifecycle Strategy](../03-products/strategy/lifecycle.md), [Доказательства и тестирование](../08-development/evidence-testing.md), [Актуальность документации](../08-development/docs-freshness.md).
