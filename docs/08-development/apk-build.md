---
id: apk-build
title: "Сборка APK"
type: runbook
status: current
authority: release-engineering
updated: 2026-09-02
publish: true
tags: [development, apk, release]
code: [.github/workflows/apk-build.yml#OpenWrt full APK build]
---

# Сборка APK

Release pipeline использует pinned OpenWrt SDK и должен выдавать ровно один
проверяемый `zapret2-manager-full` APK, вместе с `build-manifest.json` и
`SHA256SUMS`. Full package собирает backend и LuCI из исходников напрямую;
системные зависимости остаются внешними APK-зависимостями.

Единственный автоматизированный workflow репозитория —
`.github/workflows/apk-build.yml`. Он запускается при push в `main` или вручную
через `workflow_dispatch`, устанавливает зависимости SDK, собирает APK и
проверяет manifest/checksums. Наличие workflow-файла само по себе не является
доказательством успешной сборки: нужны свежие логи и verifier evidence.

Каждый успешный push в `main` публикует rolling prerelease `main-latest` с
`zapret2-manager-full-<version>.apk`, `build-manifest.json` и `SHA256SUMS`.
После скачивания выполняются `sha256sum -c SHA256SUMS` и одна команда:
`apk add --allow-untrusted ./zapret2-manager-full-<version>.apk`.
