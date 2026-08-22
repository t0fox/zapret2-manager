---
id: public-guide-use-scanner
title: "Как использовать Scanner"
type: guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [guides, scanner]
---

# Как использовать Scanner

Откройте **Обход DPI → Сканирование**, задайте target и профиль, затем запустите
проверку. Во время планирования UI должен показывать progress, а RPCD оставаться
отзывчивым.

После завершения:

- `best` с валидной Strategy — кандидат для IDE;
- `best: null` — доказанного успеха нет;
- `state: uncertain` — safety stop, ничего не применяйте.

Откройте результат в Strategy IDE, проверьте exact args, Validate и только затем
Save/Apply. Scanner сам не становится вторым владельцем permanent Apply.
