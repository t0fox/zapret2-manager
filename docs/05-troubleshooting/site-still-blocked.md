---
id: public-trouble-site
title: "Сайт всё ещё не открывается"
type: troubleshooting
status: current
authority: user-guide
updated: 2026-08-22
publish: true
tags: [troubleshooting, dpi]
---

# Сайт всё ещё не открывается

Проверьте сначала DNS, затем active/applied Strategy и `nfqws2`. Если они
готовы, запустите Z2K Detect для конкретного target. Не смешивайте результат
доступности сайта с тем, что домен просто есть в каталоге.

Если Detect возвращает `inconclusive` или `unavailable`, доказательств для
вывода недостаточно. Повторите измерение с корректным target или приложите
диагностику; не применяйте случайный кандидат.
