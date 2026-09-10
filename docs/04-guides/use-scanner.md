---
id: public-guide-use-z2k-detect
title: "Как использовать Z2K Detect"
type: guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [guides, z2k-detect]
---

# Как использовать Z2K Detect

Откройте **Обход DPI → Z2K Detect**, выберите операцию и заполните
её поля. Запустите проверку и дождитесь typed результата; permanent Strategy и
production runtime при этом не изменяются.

После завершения:

- `detected`/`clear` — наблюдаемый verdict выбранной операции;
- `observed`/`inconclusive` — доказательства недостаточно для вывода;
- `unavailable`/ошибка — проверка завершилась fail-closed.

История сохраняется только в текущей сессии браузера. Если нужна постоянная
Strategy, настройте её отдельно в **Стратегии** и пройдите обычный
Preview → Validate → Save → Apply journey.
