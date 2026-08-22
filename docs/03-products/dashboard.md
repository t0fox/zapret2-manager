---
id: public-dashboard
title: "Главная"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, dashboard, monitoring]
---

# Главная

Главная — это status overview, а не отдельный установщик. Карточки показывают
состояние и переводят на страницу-владелец.

| Карточка | Что показывает | Куда ведёт |
|---|---|---|
| `nfqws2` | установлен ли Engine, запущен ли процесс и есть ли runtime evidence | Управление / Компоненты |
| Strategy | выбранная и применённая Strategy | Стратегии |
| Автозапуск | состояние старта manager/Engine | Управление или Компоненты |
| Telegram Proxy | установленный provider и health | Telegram Proxy |
| Компоненты | Engine и Z2K Core, их версии и readiness | Компоненты |
| Система | uptime, память, storage и общие предупреждения | Мониторинг |

Карточка сама не меняет конфигурацию, пока вы не нажали явное действие на
странице-владельце.
