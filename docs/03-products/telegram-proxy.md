---
id: public-telegram-proxy
title: "Telegram Proxy — прокси"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, telegram, proxy]
---

# Telegram Proxy

Telegram Proxy — отдельный optional-продукт со своей страницей и lifecycle.
Сначала проверьте: установлен ли provider, какой provider выбран, запущен ли
процесс, есть ли health и какая версия установлена.

Поддерживаемые в текущем репозитории варианты — `tg-ws-proxy-go` и
`tg-ws-proxy-rs`. На первом экране показываются назначение и состояние, а не
внутренний adapter ID.

Доступные действия зависят от backend: **Install**, **Start**, **Stop**,
**Restart**, **Update**, настройки и удаление. System → Components не является
установщиком TG. Кнопка на Главной должна вести сюда.

Конфигурация и секреты принадлежат lifecycle provider и не переносятся в
документацию или diagnostic report. После изменения проверьте status и
**Журналы**; при update отдельно убедитесь, что конфигурация сохранена.
