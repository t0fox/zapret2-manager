---
id: autocircular
title: "Автоподбор Autocircular"
type: product
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [technology, autocircular, strategy]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc#auto_state_save]
---

# Autocircular

Autocircular — режим обучения и восстановления поверх Strategy, а не новый
тип стратегии. Состояния `auto`, `frozen` и `excluded` описывают поведение
ресурса/профиля и сохраняются с revision.

## Правила

- `auto` разрешает runtime выбирать следующий проверенный вариант;
- `frozen` закрепляет выбранный вариант;
- `excluded` исключает ресурс из автоподбора;
- Discord Voice / Video — отдельный профиль, если capability действительно
  доступна.

Изменение состояния проверяет expected revision и публикуется атомарно. При
конфликте UI должен перечитать актуальное состояние, а не молча перезаписать
чужую правку.
