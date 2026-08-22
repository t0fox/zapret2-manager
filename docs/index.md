---
id: public-home
title: "zapret2-manager — руководство пользователя"
type: home
status: current
authority: index
updated: 2026-08-13
publish: true
tags: [home, knowledge]
---

# zapret2-manager

Управление zapret2 на OpenWrt через LuCI.

zapret2-manager (Z2M) объединяет установку и проверку компонентов, выбор
стратегии обхода DPI, Scanner, DNS, ресурсы, Telegram Proxy и диагностику.
Постоянные изменения выполняются только каноническими страницами Z2M; эта
документация не заменяет UI и не добавляет неподдерживаемых возможностей.

## Быстрые действия

- [Установка](./01-project/installation.md)
- [Начало работы](./01-project/first-start.md)
- [Руководство по интерфейсу](./03-products/index.md)
- [Практические руководства](./04-guides/index.md)
- [Устранение проблем](./05-troubleshooting/index.md)
- [Исходный код на GitHub](https://github.com/t0fox/zapret2-manager)

## Возможности

- обход DPI через совместимые `nfqws2` и Strategy;
- каталог, Visual/Raw IDE и жизненный цикл стратегий;
- Scanner с временными кандидатами и передачей результата в Strategy;
- Autocircular: `auto`, `frozen`, `excluded`;
- Telegram Proxy и WARP / MASQUE, если соответствующий backend установлен;
- Resource Center для данных и runtime-assets;
- DNS, мониторинг, журналы и резервные копии.

## Первый запуск

1. Установите три APK из одного релиза: backend, LuCI и meta-package.
2. Откройте LuCI → zapret2-manager.
3. В разделе **Система → Компоненты** проверьте Zapret2 Engine и Z2K Core.
4. В разделе **Стратегии** откройте рекомендованную стратегию, выполните Preview/Validate и Apply.
5. В разделе **Управление** проверьте `nfqws2`, автозапуск и NFQUEUE.
6. Проверьте целевой сайт. Если результата нет, используйте Scanner или [разбор проблем](./05-troubleshooting/index.md).

## Разделы интерфейса

- [Главная](./03-products/dashboard.md) — сводка состояния и ссылки на владельцев.
- [Обход DPI](./03-products/control.md) — Управление, Стратегии, Сканирование.
- [Списки и данные](./03-products/services-domains.md) — сервисы, домены и [ресурсы](./03-products/resources.md).
- [DNS](./03-products/dns.md) — профили, preview, apply, проверка и откат.
- [Прокси и маршрутизация](./03-products/telegram-proxy.md) — Telegram Proxy и [WARP / MASQUE](./03-products/warp.md).
- [Диагностика](./03-products/monitoring.md) — мониторинг и [журналы](./03-products/logs.md).
- [Система](./03-products/components.md) — компоненты, [backup](./03-products/backups.md) и настройки.

Технические контракты и архитектурные доказательства доступны в [разделе для
разработчиков](./08-development/index.md). Внутренние планы, AI-контракты и
рабочие отчёты не публикуются.
