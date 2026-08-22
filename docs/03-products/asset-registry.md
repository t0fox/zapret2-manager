---
id: asset-registry
title: "Реестр assets (Asset Registry)"
type: product
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [technology, assets, resources]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc#asset_registry_register_builtin]
---

# Asset Registry

Asset Registry — единый registry для hostlists, ipsets, blobs, Lua и других
typed assets. Для каждого asset важны ownership, provenance, revision, path,
digest и список references.

## Ownership

Package/builtin assets immutable и проверяются по package manifest. Imported,
generated и user-created assets могут быть mutable только в разрешённом
canonical user path. Resource Center не создаёт второй каталог и не меняет
Strategy syntax самовольно.

## Изменение

Import/update нормализует содержимое, проверяет размер и тип, записывает
atomic file, читает SHA-256 обратно и только затем публикует metadata. Lua
может иметь статус `passed-structural-only` или `unavailable`, что не следует
показывать как полноценную runtime-синтаксическую проверку.
