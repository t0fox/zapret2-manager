---
id: dnsmasq
title: "DNS и dnsmasq"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, dns, dnsmasq]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc#dns_product_apply]
---

# DNS и dnsmasq

DNS product facade объединяет overrides, global routing и service-DNS, но
сохраняет existing dnsmasq writer как единственного владельца записи.

## Preview и Apply

`Preview` показывает exact result выбранного scope. `Validate` проверяет
структуру и revision. `Apply` сначала сохраняет draft через соответствующий
writer, затем запускает его canonical apply. Rollback доступен только при
наличии подтверждённого snapshot.

Ошибки должны сохранять structured code: `dnsmasq unavailable`, invalid
config, provider unreachable, timeout и external conflict — разные причины и
разные действия пользователя.
