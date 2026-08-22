---
id: zapret2-engine
title: "Движок Zapret2 (Engine)"
type: product
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [technology, engine]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/engine-gate.uc#engine_gate_status]
---

# Zapret2 Engine

Zapret2 Engine — системный runtime для `nfqws2`. В Z2M он проверяется через
**Система → Компоненты**; это не второй Strategy API и не самостоятельный
обход, который можно незаметно заменить UI-логикой.

## Что проверяется

Страница компонентов показывает наличие binary, версию, capability и
совместимость с текущими Strategy/assets. `UNKNOWN` и отсутствие evidence не
равны `OK`. Если capability не подтверждена, Apply останавливается до
восстановления verified состояния.

## Обновление

Обновление Engine проходит через owner компонента и его preflight. После него
нужно проверить runtime process, NFQUEUE owner, активную Strategy и сохранность
manager state. Документация не объявляет обновление успешным только по факту
скачивания файла.
