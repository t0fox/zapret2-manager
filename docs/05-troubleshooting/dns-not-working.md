---
id: public-trouble-dns
title: "DNS не работает"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, dns]
---

# DNS не работает

**Проверить:** DNS → dnsmasq state, active provider, last apply и health.

**Норма:** конфигурация прошла Preview/Validate, apply подтверждён, local и
upstream query отвечают.

**Следующее действие:** при invalid config или external conflict откройте
Details, исправьте источник и используйте rollback только при доступном
verified snapshot.
