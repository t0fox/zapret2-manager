---
id: apk-build
title: "Сборка APK"
type: runbook
status: current
authority: release-engineering
updated: 2026-09-02
publish: true
tags: [development, apk, release]
code: [.github/workflows/apk-build.yml#OpenWrt APK build]
---

# Сборка APK

Release pipeline использует pinned OpenWrt SDK и должен выдавать ровно три
проверяемых manager-пакета: `zapret2-manager`, `luci-app-zapret2-manager` и
`zapret2-manager-full`, вместе с `build-manifest.json` и `SHA256SUMS`.

Единственный автоматизированный workflow репозитория —
`.github/workflows/apk-build.yml`. Он запускается при push в `main` или вручную
через `workflow_dispatch`, устанавливает зависимости SDK, собирает APK и
проверяет manifest/checksums. Наличие workflow-файла само по себе не является
доказательством успешной сборки: нужны свежие логи и verifier evidence.

Каждый успешный push в `main` публикует rolling prerelease `main-latest` с одним
архивом `tar.zst`. Внутри находятся три APK и два файла проверки; после
скачивания архив распаковывается, затем выполняются `sha256sum -c
SHA256SUMS` и `apk add --allow-untrusted` для всех трёх APK.
