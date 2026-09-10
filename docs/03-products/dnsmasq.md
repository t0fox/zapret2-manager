---
id: dnsmasq
title: "DNS и dnsmasq"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, dns, dnsmasq]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc#dns_product_validate]
---

# DNS и dnsmasq

DNS product facade объединяет состояние DNS и каталог провайдеров для видимого
DNS UI, но сохраняет существующие writers как единственных владельцев записи.

## Контракт

`Get` и `Status` читают сводное состояние, а `Validate` проверяет структуру и
revision. Изменения проходят через владельца соответствующего scope: DNS
overrides, global routing, service-DNS или provider catalog.

Ошибки должны сохранять structured code: `dnsmasq unavailable`, invalid
config, provider unreachable, timeout и external conflict — разные причины и
разные действия пользователя.
