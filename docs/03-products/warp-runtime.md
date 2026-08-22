---
id: warp-runtime
title: "Runtime маршрутизации WARP / MASQUE"
type: product
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [technology, warp, masque]
code: [luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-warp-page.js#WARP]
---

# WARP / MASQUE

WARP / MASQUE — отдельная routing capability. Документация описывает только
поведение, которое подтверждается текущим UI и backend: setup, статус,
режимы маршрутизации и доступные health/details.

Он не является альтернативным Zapret2 Engine и не меняет Strategy/NFQUEUE
ownership. Если backend capability отсутствует, UI показывает unavailable,
а не синтетический `OK`.
