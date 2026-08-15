---
id: product-dns-routing-assets
title: "DNS, routing и assets: что уже есть и чего не хватает"
type: product
status: current
authority: evidence
updated: 2026-08-15
publish: true
tags: [dns, routing, assets, lists, tunnels]
---

# DNS, routing и assets: что уже есть и чего не хватает

В zapret2-manager уже существует несколько сильных сетевых подсистем — DNS provider, global/manual DNS, service-DNS, domain hub, lists/catalog и optional proxy provider. M6 теперь добавляет первый backend vertical unified routing поверх этих owners; это ещё не полная Avatar-like family методов.

Эта страница показывает зависимость между тремя слоями: **данные/assets**, **DNS/domain decisions** и **routing/tunnel methods**.

## Текущий DNS substrate

В backend присутствуют `dns.uc`, `dns-global.uc`, `dnsprov.uc`, `service-dns.uc` и соответствующие CLI/worker boundaries. Это означает, что DNS в проекте — реальная продуктовая область, а не будущий placeholder.

Пользовательский слой может работать с provider/diagnostic data, global/manual настройками и service-related DNS decisions. Mutation выполняется через ограниченные backend owners; LuCI не должен напрямую редактировать произвольные системные файлы.

При этом parity с Avatar остаётся `PARTIAL`, потому что совпадение нужно доказывать не названием «DNS», а полями provider catalog, defaults, result schema, per-domain routing/remediation и lifecycle каждого поддерживаемого режима.

## DNS v2 и Telegram Proxy v2 acceptance slice

DNS v2 теперь предоставляет canonical `dns_product_*` facade с pure Preview,
Validate, Apply и Rollback поверх существующего DNS writer. Empty rollback
также снимает manager-owned `dnsmasq.addnhosts` registration, поэтому
restore возвращает исходную integration boundary, а не только пустой draft.

Telegram Proxy v2 предоставляет одну canonical `tg-product.v2` модель с
фиксированными provider IDs `go` и `rust`. Provider install/update/remove и
proxy-config lifecycle остаются делегированы существующим owners; facade не
создаёт второй state store или второй production writer. На реальном target
Rust catalog/status/preflight/health проходят, а Go availability подтверждена
через `check_updates` с честным `installable: false`.

Target backend acceptance и M6 Service DNS canary пройдены. Browser acceptance
остаётся `BLOCKED`: authenticated reload LuCI вернул HTTP `403` и
`x-luci-login-required: yes`, поэтому mobile/tablet/dead-control claims пока
не выдаются. Полные доказательства и deployment manifest находятся в
[DNS/TG v2 evidence](../05-parity/2026-08-15-dns-tg-v2-evidence.md).

## Domain hub и lists

`domain-hub.uc`, `lists.uc`, catalog data и связанные tests дают manager собственный domain/list substrate. Он уже полезен для включений, исключений, service categories и consumers Strategy/DNS.

Но list — ещё не универсальный selector. Для unified routing нужны стабильные cross-consumer identifiers: один и тот же named asset должен однозначно пониматься Strategy compiler, DNS decision layer и routing compiler.

Если каждый продукт отдельно хранит «список доменов» в своём формате без общей identity/provenance, со временем появляются дублирование, drift и невозможность безопасно удалить ресурс.

## Assets как продуктовая зависимость

Avatar parity требует более богатый набор registries, чем текущие domain lists. В частности, важны:

- Lua assets;
- blob/binary assets;
- IP-set registries;
- hostlists;
- geosite/geoip data;
- hosts-related managed data.

Смысл **registry** не в файловом браузере. Registry должен отвечать на вопросы:

```text
Какой у asset ID?
Кто его владелец?
Откуда он получен?
Как проверить hash/provenance?
Кто на него ссылается?
Можно ли безопасно удалить/заменить его?
Как обновление влияет на Strategy/routing?
```

Именно поэтому asset registries стоят в roadmap раньше полного Scanner/routing. Candidate может ссылаться на Lua/blob/list data; без стабильной identity невозможно доказать, что Scanner проверил тот же candidate, который затем передаётся Strategy.

## Strategy ↔ assets

Strategy compiler уже умеет работать с dependency/preflight concepts, но полная Avatar parity требует, чтобы ссылки на assets были product-level objects, а не только проверкой «файл где-то существует».

Правильный путь:

```text
Strategy
  ↓
stable asset reference
  ↓
registry lookup
  ↓
provenance + availability
  ↓
compiler/preflight
```

Если dependency недоступна, Preview может показать проблему, а Validate/Apply должны принимать решение до permanent mutation.

## Scanner ↔ assets

Scanner усиливает требования к provenance. Он перебирает много кандидатов, поэтому каждый result должен быть связан не только с Strategy ID, но и с набором фактически использованных dependencies.

Иначе после обновления catalog/blob/list невозможно понять, относится ли старый успешный result к текущей Strategy.

Для production-quality ranking важны candidate digest и dependency identity. Это ещё одна причина не объявлять asset layer второстепенной UI-функцией.

## Что такое unified routing

Unified routing — это не набор ручных network commands. Это durable product model, который связывает **что маршрутизировать** с **каким методом** и **какой fallback использовать**.

Концептуально:

```text
Destination
  ├─ domains
  ├─ CIDRs
  ├─ named lists
  ├─ hostlists / IP sets
  ├─ geosite / geoip
  ├─ devices
  └─ дополнительные selectors
        ↓
Route
  ├─ primary method
  └─ ordered fallbacks
        ↓
Method
  ├─ direct / nfqws2-like path
  ├─ tunnel provider
  └─ другой зарегистрированный runtime owner
```

Каждый Route должен иметь revision/state, Preview, Apply/Remove, status и точный resource ownership. Без этого routing превращается в набор несогласованных side effects.

## Что доказано в M6

`Route` теперь имеет durable identity/revision, typed M2 asset selectors, ordered methods, Preview/Validate/Apply/Status/Remove/Reconcile и exact delegated ownership. Первый real method — service-DNS; он делегирует mutation существующему service-DNS writer. Подробный контракт описан на странице [Unified Routing M6](./unified-routing.md).

Это означает **PARTIAL**, а не полную parity: нет device/CIDR/ipset/geosite/geoip consumers, tunnel methods и автоматического failover.

Это не означает, что «ничего сетевого нет». Наоборот, foundation уже богатый. Просто **существование отдельных сетевых функций не доказывает aggregate product contract**.

## DNS → routing cross-flow

Будущая интеграция должна позволять, например, domain/list decision ссылаться на route selector без появления второго writer.

```text
domain/list identity
       ↓
DNS decision / selector
       ↓
Route Preview
       ↓
Route Apply
       ↓
runtime observations
```

DNS owner остаётся владельцем DNS-specific state, routing owner — владельцем route resources. Coordinator может объединять пользовательский workflow, но не должен становиться скрытым writer обеих областей.

## Tunnel methods

Telegram proxy уже является отдельной существующей optional-provider capability, но он не закрывает всю tunnel parity.

WARP/usque/MASQUE, AWG, sing-box, mihomo, Opera и другие providers должны появляться **после общей resource/routing foundation**, иначе каждый provider принесёт собственные правила владения interface/routes/secrets/processes.

Для tunnel product недостаточно «бинарник запускается». Нужны:

- package/install ownership;
- config и secret lifecycle;
- process identity;
- interface/resource ownership;
- health/status;
- start/stop/restart/remove;
- routing method integration;
- rollback и orphan checks.

До появления этой vertical такие providers в roadmap считаются planned/design work, а не shipped functionality.

## Auto-remediation зависит от этих слоёв

Avatar-like auto-remediation должен выбирать действие на основании classification:

```text
DNS issue → DNS remediation
DPI issue → Scanner
IP/full blocking → routing/tunnel
unknown → diagnostic result без опасной mutation
```

Следовательно, auto-remediation нельзя реализовать честно раньше Scanner, DNS cross-flow и routing/tunnels. Иначе orchestrator будет существовать, а action owners под ним — нет.

## Текущая карта зрелости

| Область | Статус | Почему |
|---|---|---|
| DNS providers/global/manual | CURRENT / PARTIAL parity | реальный backend и tests, но не полное Avatar field parity |
| Service DNS/domain flow | CURRENT / PARTIAL parity | owner и worker существуют; cross-routing неполон |
| Domain/lists | CURRENT / PARTIAL parity | полезный substrate, но не полный universal registry |
| Lua/blob/IP-set/geosite/geoip registry | PLANNED / MISSING parity | нет законченных owners/consumers |
| Unified routing | CURRENT / PARTIAL parity | M6 service-DNS vertical доказан; остальные consumers и methods не входят в slice |
| Telegram proxy | CURRENT / PARTIAL parity | отдельный provider, не вся tunnel family |
| WARP/usque и другие tunnels | PLANNED / MISSING parity | требуют routing/resource foundation |

## Критерий следующего уровня

Следующий уровень здесь — не «добавить побольше вкладок», а сделать данные и ownership повторно используемыми. Asset должен иметь identity/provenance; route — durable model и single-writer; tunnel — owned lifecycle; DNS cross-flow — ссылаться на эти модели вместо дублирования state.

Тогда Strategy, Scanner, routing и remediation смогут использовать одни и те же доказуемые objects, а не обмениваться неструктурированными строками.

См. также: [Roadmap](../01-project/status-roadmap.md), [Avatar parity](../01-project/avatar-parity.md), [Владение состоянием](../02-architecture/state-ownership.md), [Lifecycle Scanner](./scanner/lifecycle.md).
