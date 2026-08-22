---
id: telegram-proxy-runtime
title: "Runtime прокси Telegram"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, telegram, proxy]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc#status_model]
---

# Telegram Proxy runtime

Telegram Proxy — optional product с собственным provider lifecycle. Z2M
показывает установленный provider, running/stopped состояние, readiness,
health, active version и drift.

## Операции

Catalog/version checks, install/update, start/stop/restart и settings проходят
через существующий TG owner. System → Updates может обнаружить обновление, но
не создаёт второй installer. Config сохраняется и redacted evidence не
включает секреты.
