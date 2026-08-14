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
   ├── [M2 CURRENT / PARTIAL] Canonical asset registries ──────────┐
   │                                                              │
   └── [M3 COMPLETE] Scanner provider/lifecycle                    │
             ↓                                                     │
        [M4 COMPLETE] Scanner → Strategy handoff                    │
             ↓                                                     │
        [M5 CURRENT / IN PROGRESS] BlockCheck family               │
             ↓                                                     │
        [M6 CURRENT / PARTIAL] Unified routing ←────────────────────┘
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

M2 typed asset registry уже является foundation для routing consumers; расширение live consumers остаётся параллельной работой. M6 использует stable hostlist/hosts identity и делегирует runtime owner-у service-DNS.

## M1 — Native foundation

**Статус: COMPLETE на текущем verified baseline.** Native aggregate проходит **567/567**, required native subgate — **36/36**, root gate — **120/120**, remaining failures — **0**. Предыдущие 10 verification-foundation regressions исправлены.

**Сейчас.** Native core для state/jobs/namespace/process/transaction/recovery/result, native backend contract и verification gates согласованы на ревизии `d8a833af4acae23d1b4a944deec0355960d1ceb7`.

**Зависимости.** OpenWrt/ucode toolchain, package layout, rpcd integration, process identity и state ownership.

**Следующий срез.** Не открывать новый foundation scope сам по себе. Расширять helper/contracts только под доказанную потребность следующих product milestones и после изменения заново подтверждать соответствующие native/root gates.

**Критерий завершения текущего milestone.** Для этого baseline выполнен: native verification foundation полностью зелёная и remaining failures равны нулю.

**Доказательства.** `567/567 PASS`, `36/36 PASS`, `120/120 PASS`, remaining failures `0` на current verified main.

## M2 — Canonical asset registries

**Статус: CURRENT / PARTIAL.** M2 registry model реализует typed stable IDs, hash/revision/provenance, bounded CRUD/resolve и consumer references. Полный набор живых consumers для каждого schema type ещё не закрыт.

**Сейчас.** Registry layer является backend owner-ом для typed assets, включая package-owned ipset и manager-owned hostlist/hosts. `geosite`/`geoip` остаются schema slots без live routing consumer-а.

**Зависимости.** M1 state/ownership, безопасные paths/atomic writes, package provenance.

**Следующий срез.** Подключать дополнительные live consumers по одному домену, сохраняя typed references и не превращая registry в произвольный файловый менеджер.

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

**Статус: COMPLETE.** M5 имеет четыре раздельных runtime products: interactive BlockCheck, background Block Detector, official BlockCheck2 и optional BlockCheckW provider/fast engine. Catalog Strategy Scanner остаётся отдельным уже закрытым flow.

**Сейчас.** Все четыре M5 flow имеют отдельные typed request/state/result/error contracts и не смешивают BlockCheck с Block Detector или BlockCheckW.

**В работе.** Target evidence углубляет characterization; он не меняет ownership и не объединяет lifecycle продуктов.

**Зависимости.** Durable jobs, завершённый M3 result/evidence lifecycle и завершённый M4 Strategy handoff.

**Следующий срез.** M6 Unified routing; новые routing features не входят в M5.

**Критерий завершения.** BlockCheck, Block Detector, BlockCheck2 и BlockCheckW имеют отдельные request/state/result/error contracts; оба search engines передают только typed Strategy aggregates существующему Preview/Validate/Apply path.

**Доказательства.** `tests/product/blockcheck-family.test.mjs`, Avatar/RPC/ACL tests, BlockCheckW target provider lifecycle и bounded runtime smoke.

## M6 — Unified routing

**Сейчас.** M6 реализует первый backend vertical aggregate `Route: selectors → primary method → ordered fallbacks` поверх service-DNS writer. Полной Avatar-like family ещё нет: существующие DNS/list/proxy/network pieces нельзя автоматически считать всеми routing methods.

**В работе.** Durable Route/CAS/ownership path есть для typed hostlist/hosts selectors и service-DNS method; остаются дополнительные live consumers, tunnel methods и failover policy.

**Зависимости.** M2 registries, device/list selectors, DNS cross-flow, безопасные runtime resource owners.

**Следующий срез.** Доказать target-router install/runtime rollback для M6 service-DNS vertical, затем добавлять следующий method только вместе с его owner/consumer.

**Критерий завершения.** Route durable/revisioned, имеет Preview, Apply, Remove и Status, а mutation затрагивает только принадлежащие manager ресурсы.

**Доказательства.** `tests/product/unified-routing.test.mjs`, target ucode/RPC smoke, service-DNS delegated Apply/Remove and foreign/orphan reconciliation. nft/ipset/tunnel fixtures остаются будущим scope.

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

На current verified baseline M3 Scanner и M4 Scanner → Strategy handoff закрыты; M2 имеет current typed registry slice, а M6 — первый service-DNS routing vertical. Остальные M6 methods/consumers и M7–M11 сохраняют прежний порядок и scope.

Связанные страницы: [Avatar parity](./avatar-parity.md), [Lifecycle Scanner](../03-products/scanner/lifecycle.md), [Lifecycle Strategy](../03-products/strategy/lifecycle.md), [Доказательства и тестирование](../08-development/evidence-testing.md), [Актуальность документации](../08-development/docs-freshness.md).
