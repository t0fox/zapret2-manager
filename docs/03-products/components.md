---
id: public-components
title: "Система — Компоненты"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-27
publish: true
tags: [ui, components, engine, z2k]
---

# Система — Компоненты

Здесь находятся два обязательных foundation-компонента Z2M:

- **Zapret2 Engine** — traffic-processing runtime;
- **Z2K Core** — Lua/detectors и связанные runtime-данные, которыми владеет
  Resource Center, но управляет страница компонентов.

Страница не фиксирует готовность как «2 из 2»: итог вычисляется по фактическому
`runtimeHealth` обязательных компонентов. У каждого компонента отдельно
показываются runtime-состояние, `updateState` и compatibility. Поэтому наличие
обновления, необходимость проверки или адаптации не маскируются под ошибку
runtime, а неизвестность не становится готовностью.

Канонические состояния обновления: «Актуально», «Доступно обновление»,
«Требуется проверка», «Требуется адаптация», «Требуется интеграция», «Ошибка» и
«Не проверено». Для Engine identity также различает официальный stock release и
legacy compatibility build. Upstream release показывается только при наличии
подтверждённой authority; техническая сборка, package metadata и source commit
остаются отдельными полями.

Для Engine доступны контекстные install/reinstall/update/remove/repair-действия
и локальное раскрытие управления. Для Z2K installed release содержит значение,
confidence и authority: activation receipt — confirmed, однозначное совпадение
с известным manifest — inferred, неоднозначное или противоречивое состояние не
превращается в выдуманную версию. Avatar, Telegram Proxy и WARP имеют своих
owner pages и не являются обязательными компонентами.
