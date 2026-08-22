---
id: public-architecture
title: "Архитектура Z2M"
type: architecture
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [development, architecture]
code: [luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js#GROUPS]
---

# Архитектура Z2M

Z2M разделяет UI navigation, RPC facade, product owner и runtime adapter.
Публичная документация следует этим границам: UI объясняет действие, RPC —
контракт, backend — источник evidence.

## Основные владельцы

Strategy владеет permanent Apply; Scanner — temporary test и result handoff;
Engine владеет production `nfqws2`/NFQUEUE; DNS — existing dnsmasq writer;
Asset Registry — typed runtime-assets; TG и WARP — optional owners.
