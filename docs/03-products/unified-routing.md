---
id: product-unified-routing
title: "Unified Routing: COMPLETE — initial backend vertical M6"
type: product
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [routing, assets, service-dns, ownership]
---

# Unified Routing: COMPLETE — initial backend vertical M6

M6 завершает утверждённый initial backend vertical с bounded-моделью `Route`: typed asset selectors, primary method, ordered fallbacks, revision/CAS, Preview/Validate, Apply, Status, Remove и Reconcile. Это backend vertical, а не полная Avatar parity; UI и автоматический failover в этот срез не входят.

## Что реализовано

- Route хранится в `/etc/zapret2-manager/routes.json`, journal operations — в `/etc/zapret2-manager/routes-journal/`.
- Selector принимает только ссылку на M2 asset типа `hostlist` или `hosts`: `type`, `id`, `revision`, `contentSha256`. Произвольные filesystem paths и inline CIDR не принимаются.
- Первый реальный method — `{kind: "service_dns", service_id, profile_id}`. Runtime mutation делегируется существующему `service-dns` writer; Unified Routing не пишет UCI, dnsmasq, nft или Strategy state.
- Apply записывает exact delegated scope: service, previous selection, applied selection, operation ID и managed resource IDs. Remove восстанавливает только этот scope и отказывается вмешиваться при foreign change.
- Preview/Validate read-only; Apply/Update/Remove требуют expected revision. Status различает `applied`, `runtime_missing` и `foreign`; Reconcile обрабатывает bounded orphan journals.

## Fallback semantics

Fallbacks сохраняются в порядке, проверяются на duplicate и показывают typed `unavailable`, если профиль отсутствует. В текущем срезе fallback не переключается автоматически: Apply использует primary method, а изменение метода требует нового Preview/Apply. Это оставляет failover policy отдельным следующим решением, а не скрывает его в coordinator.

## Scope и ограничения

Текущий selector contract использует domain assets, потому что service-DNS имеет реального consumer-а для domain selections. `ipset`, `geosite`, `geoip`, devices, tunnels, nft route rules и arbitrary CIDR не объявляются поддержанными без живого owner/consumer и target evidence. Это следующий scope, а не silently accepted data.

RPC surface bounded: `route_list`, `route_get`, `route_create`, `route_update`, `route_preview`, `route_validate`, `route_apply`, `route_status`, `route_remove`, `route_reconcile`. RPC принимает bounded JSON edit, а не команду, путь или shell fragment. ACL разделяет read и mutation operations.

Связанные страницы: [DNS, routing и assets](./dns-routing-assets.md), [Владение состоянием](../02-architecture/state-ownership.md), [Roadmap](../01-project/status-roadmap.md), [Доказательства и тестирование](../08-development/evidence-testing.md).
