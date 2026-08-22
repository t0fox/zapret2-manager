---
id: z2k-core
title: "Ядро Z2K (Z2K Core)"
type: product
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [technology, z2k, assets]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/z2k-component.uc#z2k_component_apply]
---

# Z2K Core

Z2K Core — manager integration layer для Z2K runtime-assets. Он не создаёт
второй пользовательский продукт: его owner — **Система → Компоненты**, а
Strategy, Scanner и Resource Center используют его проверенные capabilities.

## Контракт компонента

Перед активацией проверяются upstream manifest, классификация файлов и
revision. Принимаются только `exact-managed` файлы с совпадающим SHA-256.
Адаптированные и `review-required` изменения требуют явного rebase/review и
не могут быть включены как будто это exact match.

## Безопасная публикация

Assets сначала попадают в bounded staging path, затем Asset Registry выполняет
transaction и postflight. Ошибка проверки возвращается как structured error;
частичная публикация не должна становиться новым active state.
