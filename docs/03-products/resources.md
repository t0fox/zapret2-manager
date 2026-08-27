---
id: public-resources
title: "Ресурсы"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-27
publish: true
tags: [ui, resources, assets]
---

# Ресурсы

Resource Center хранит **данные и runtime-assets**, а не системные компоненты.
Asset Registry — единственный владелец managed asset metadata и bytes; Z2K Core
не получает второго writer или отдельного product owner.

В интерфейсе остаются четыре смысловых представления:

- **Обновления** — доступные изменения с переходом в «Компоненты» для
  обязательного Z2K update/review/rebase/integration-действия;
- **Установленные** — активы, которыми владеет Asset Registry;
- **Пользовательские** — добавленные пользователем assets;
- **Источники** — provenance и проверка источника.

«Z2K Resources» — системная группа assets, а не второй устанавливаемый продукт.
Её update state проецируется теми же каноническими состояниями, что и карточка
Z2K Core: «Актуально», «Доступно обновление», «Требуется проверка», «Требуется
адаптация», «Требуется интеграция», «Ошибка» и «Не проверено». Package baseline,
technical commit и manifest identity показываются только как техническая
evidence, а не как installed release.

После успешной активации Asset Registry сохраняет bounded activation receipt.
Локальная release identity использует его как confirmed authority, затем может
использовать только однозначное совпадение с известным manifest как inferred;
при ambiguity/inconsistency версия не выдумывается.

Avatar Catalog остаётся источником данных каталога. Не импортируйте ресурс как
Strategy вслепую: сначала проверьте provenance, протокол и ссылки на файлы,
затем используйте Preview/Validate в Strategy IDE.
