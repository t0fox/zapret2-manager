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
готовы, запустите Scanner для конкретного target. Не смешивайте результат
доступности сайта с тем, что домен просто есть в каталоге.

Если Scanner возвращает `best: null`, сохранённой доказанной стратегии нет.
Повторите с другим profile или приложите диагностику; не применяйте случайный
кандидат.
