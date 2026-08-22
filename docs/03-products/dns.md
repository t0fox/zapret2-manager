---
id: public-dns
title: "DNS — настройка"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, dns, dnsmasq]
---

# DNS

DNS Z2M управляет существующим dnsmasq writer и не создаёт второй DNS-owner.
Страница показывает активный профиль/provider, состояние dnsmasq, последний
apply, provenance и health.

Типичный workflow: выбрать профиль или provider → **Preview** → **Apply** →
дождаться async progress/status → проверить результат. **Rollback** показывается
только когда есть подтверждённый snapshot и операция действительно может быть
откачена.

Внутри UI могут быть области **Настройка**, **Проверка и выбор**,
**Маршрутизация**, **Для сервисов**, **Дополнительно** и **История**. Их exact
состояние зависит от backend: ошибки `dnsmasq unavailable`, invalid config,
provider unreachable, timeout и external conflict должны показываться с
техническими details, а не как безликий RPC error.

После Apply проверяйте local DNS, WAN/upstream DNS и Monitoring. Если verified
snapshot отсутствует, не пытайтесь принудительно записать конфигурацию.
