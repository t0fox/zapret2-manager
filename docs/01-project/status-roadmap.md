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

Исходный read-only audit package был снят 14 августа 2026 года с checkout `59d28af7`. С тех пор `main` изменился, особенно в Scanner. Поэтому ниже сохранена архитектурная последовательность аудита, но устаревшие наблюдения перепроверены по текущему дереву. Например, audit фиксировал отсутствие native result contract/source, однако в текущем `main` уже присутствуют и native backend contract, и `core/result.uc`; этот старый blocker не переносится в roadmap как будто он всё ещё актуален.

## Карта зависимостей

```text
M1 Native foundation
   ↓
M2 Asset registries ─────────────┐
   ↓                             │
M3 Scanner provider/lifecycle    │
   ↓                │            │
M4 Strategy handoff │            │
                    ↓            │
                  M5 BlockCheck  │
                                 ↓
                         M6 Unified routing
                              ↓       ↓
                     M7 DNS/lists   M8 WARP/usque
                              │       ↓
                              │     M9 Tunnels
                              │       ↓
                              └──→ M10 Monitoring/failover
                                         ↓
                              M11 Auto-remediation

M12 Documentation — не конец цепочки, а непрерывный слой над M1–M11
```

Документация обновляется на каждом milestone. `M12` означает зрелый публичный documentation product, а не правило «документы пишем только после завершения кода».

## M1 — Native foundation

**Сейчас.** В текущем `main` есть native core для state/jobs/namespace/process/transaction/recovery/result, отдельный native backend contract и соответствующие test suites. Старое наблюдение audit package о пропавших `core/result.uc` и contract-файле к текущему `main` уже не относится.

**В работе.** Foundation продолжает использоваться новыми product slices, поэтому важнее не только наличие исходников, но стабильность contract при реальном package/toolchain/target использовании.

**Зависимости.** OpenWrt/ucode toolchain, package layout, rpcd integration, process identity и state ownership.

**Следующий срез.** Сохранять foundation narrow: Rust-first для нового native-кода, C только когда есть конкретная техническая причина; расширять helper/contracts только под доказанную потребность продукта.

**Критерий завершения.** Native contract, source, package и read-only target behavior согласованы на одной ревизии; state/process/transaction boundaries не требуют второго writer.

**Доказательства.** Native unit/contract tests, ucode compilation, package build/install evidence, read-only router probe. Source tests сами по себе не равны target acceptance.

## M2 — Canonical asset registries

**Сейчас.** В manager есть lists/catalog/domain data и preflight, умеющий проверять часть внешних зависимостей. Но это не единый Avatar-like asset layer.

**В работе.** Нужно разделить понятия «файл существует» и «asset имеет стабильную identity, provenance и consumers».

**Зависимости.** M1 state/ownership, безопасные paths/atomic writes, package provenance.

**Следующий срез.** Вводить registries по одному домену: Lua, blob, IP-set, затем geosite/geoip/hosts, не создавая один безразмерный «файловый менеджер».

**Критерий завершения.** Каждый asset имеет owner, стабильный ID, hash/provenance, bounded CRUD/read contract и явные ссылки из Strategy/Scanner/routing consumers.

**Доказательства.** Registry tests, package manifest, dependency/preflight tests, safe upgrade/import evidence.

## M3 — Scanner provider и полный transient lifecycle

**Сейчас.** Это уже не только план. В `main` присутствуют `scanner-model`, targets, planner, generator, compiler authority, state, probes, probe executor/adapter, worker, transient layer, CLI и runtime adapter. Также интегрирован **canonical A1 lifecycle**.

**В работе.** Результаты/ranking/reconciliation и полная product vertical ещё требуют доказательств; отдельные `scanner-results`/`scanner-reconcile` boundaries в текущем дереве не представлены законченной реализацией.

**Зависимости.** M1 process/namespace ownership; M2 assets для более полного Avatar candidate set; Strategy compiler authority; безопасное transient resource ownership.

**Следующий срез.** Закрыть typed results → ranking/report → cleanup/reconciliation как явные owners и связать их с текущим A1 lifecycle.

**Критерий завершения.** Один Scanner run проходит model → planner → A1 runtime → probes → typed report → ranking → cleanup/recovery без permanent mutation и без unowned resource cleanup.

**Доказательства.** Unit/provider tests, concurrent/cancel/crash/rerun tests, namespace/process ownership evidence, target-router Scanner run с подтверждённым cleanup.

## M4 — Scanner → Strategy handoff

**Сейчас.** Strategy vertical уже умеет catalog/model/compiler/Preview/Validate/transactional Apply. Scanner умеет строить и исполнять значительную часть кандидатов, но полный product handoff ещё не считается доказанным.

**В работе.** Нужно сохранить Strategy identity/provenance от Scanner result до постоянного применения.

**Зависимости.** M3 typed report/ranking и стабильный Strategy aggregate.

**Следующий срез.** Working result превращается в Strategy reference либо generated user Strategy; затем обязательно проходит обычный Preview → Validate → Apply.

**Критерий завершения.** E2E-путь сохраняет Strategy ID/catalog digest/provenance от scan result до verified Apply; failure Apply подтверждает rollback.

**Доказательства.** E2E contract test, transaction test, LuCI flow, target run и forced-failure rollback evidence.

## M5 — BlockCheck family

**Сейчас.** Upstream `blockcheck2.sh` имеет managed wrapper/job path и часть result→profile поведения. Отдельный Avatar-equivalent BlockCheck classifier остаётся незакрытой capability.

**В работе.** Нужно не смешать три продукта: Scanner, BlockCheck, BlockCheck2.

**Зависимости.** Durable jobs, M3 result/evidence model, Strategy handoff.

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

Milestone не становится `готов` из-за того, что создан файл или закрыт один unit test. Для перехода статуса смотрим на **вертикаль**: model/contract → consumer → mutation/ownership → failure/recovery → evidence соответствующего уровня.

Именно поэтому A1 lifecycle заметно продвигает M3, но пока не переводит весь Scanner в production-ready. Аналогично существующий Telegram proxy не закрывает M8/M9, а существующий DNS не равен unified routing.

Связанные страницы: [Avatar parity](./avatar-parity.md), [Lifecycle Scanner](../03-products/scanner/lifecycle.md), [Lifecycle Strategy](../03-products/strategy/lifecycle.md), [Доказательства и тестирование](../08-development/evidence-testing.md), [Актуальность документации](../08-development/docs-freshness.md).
