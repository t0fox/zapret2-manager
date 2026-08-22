---
id: apk-build
title: "Сборка APK"
type: runbook
status: current
authority: release-engineering
updated: 2026-08-22
publish: true
tags: [development, apk, release]
code: [.github/workflows/knowledge-ci.yml#Knowledge CI]
---

# Сборка APK

Release pipeline использует pinned OpenWrt SDK и должен выдавать ровно три
manager-пакета: `zapret2-manager`, `luci-app-zapret2-manager` и
`zapret2-manager-full`, вместе с `build-manifest.json` и `SHA256SUMS`.

Документация CI не объявляет реальную SDK-сборку успешной по наличию
workflow-файла: нужны свежие artifact logs и verifier evidence. Public Quartz
публикуется отдельным artifact после Knowledge CI.
