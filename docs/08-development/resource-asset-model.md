---
id: resource-asset-model
title: "Модель ресурсов и assets"
type: architecture
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [development, resources, assets]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc#asset_registry_import]
---

# Модель ресурсов и assets

Resource — пользовательская запись/target; asset — typed payload, который
может быть использован Strategy/runtime. Связь хранится через references и
не заменяется ad-hoc копированием файлов из UI.

Каждое изменение имеет bounded input, provenance, revision и digest. Preview
показывает resolved assets, Validate — dependency errors, а Apply использует
canonical owner transaction.
