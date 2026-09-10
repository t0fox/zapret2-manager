---
id: z2k-core
title: "Ядро Z2K (Z2K Core)"
type: product
status: current
authority: current-ui
updated: 2026-08-28
publish: true
tags: [technology, z2k, assets]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc#z2k_resolve_version, zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc#resource_center_prepare_version]
---

# Z2K Core

Z2K Core — manager integration layer для coherent Z2K runtime-assets. Он не
создаёт второй пользовательский продукт: его единственный lifecycle owner —
**Система → Компоненты**, а Strategy, Z2K Detect и Resource Center
используют его проверенные capabilities. Resource Center не является вторым
Z2K writer.

## Контракт компонента

Каталог релизов строится по upstream tags, а выбранный tag разрешается в
immutable commit SHA. Manifest и assets читаются только из этого commit.
Перед активацией проверяются exact-managed membership, SHA-256 и локальный
fingerprint. Адаптированные и `review-required` изменения не превращаются в
обычный update.

## Безопасная публикация

Сначала сохраняется target snapshot v2 с операцией install/upgrade/reinstall/
downgrade и opaque plan token. После явного подтверждения assets попадают в
bounded staging path, затем Asset Registry выполняет одну transaction и
postflight. Ошибка проверки возвращается как structured error; partial или
hybrid publication не должна становиться новым active state. Старый
component-совместимый lifecycle удалён. Применение выполняется только
через подготовленный target Resource Center и его текущую transaction boundary.
