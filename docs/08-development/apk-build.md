---
id: apk-build
title: "Сборка APK"
type: runbook
status: current
authority: release-engineering
updated: 2026-08-22
publish: true
tags: [development, apk, release]
code: [.github/workflows/apk-build.yml#OpenWrt APK build]
---

# Сборка APK

Release pipeline использует pinned OpenWrt SDK и должен выдавать ровно три
manager-пакета: `zapret2-manager`, `luci-app-zapret2-manager` и
`zapret2-manager-full`, вместе с `build-manifest.json` и `SHA256SUMS`.

Документация CI не объявляет реальную SDK-сборку успешной по наличию
workflow-файла: нужны свежие artifact logs и verifier evidence. Public Quartz
публикуется независимым workflow Quartz Pages по собственному push-триггеру
на файлы public-docs pipeline; тяжёлый Knowledge CI запускается только
вручную (`workflow_dispatch`) и деплой не гейтит.

Каждый успешный push в `main` дополнительно публикует rolling prerelease
`main-latest` с тремя APK, `build-manifest.json` и `SHA256SUMS`. Ассеты
скачиваются на роутер напрямую (`wget`) и ставятся через
`apk add --allow-untrusted`; перед установкой сверяйте `SHA256SUMS`.
