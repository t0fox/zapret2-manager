---
id: avatar-catalog
title: "Каталог Avatar (Avatar Catalog)"
type: product
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [technology, avatar, catalog]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc#active_pointer_write]
---

# Avatar Catalog

Avatar Catalog — импортированный источник Strategy и donor reference для
совместимой семантики. Это не отдельный runtime-компонент и не новый owner
применения.

## Verified identity

Catalog resolver связывает repository, pinned commit, aggregate digest и
active pointer. `list`, `get`, `preview`, `validate` и `apply` должны читать
один verified source. Managed snapshot не подменяет package baseline без
проверки identity.

## Совместимость

Только после compatibility proof можно использовать compact index для Quick.
Index должен быть связан с тем же digest и revision, что и full catalog;
устаревший или неполный index — dependency/verification failure.
