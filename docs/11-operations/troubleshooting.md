---
id: operations-troubleshooting
title: "Устранение неполадок"
type: operations
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [operations, troubleshooting, diagnostics]
---

# Устранение неполадок

Диагностика zapret2-manager должна начинаться с **evidence** и оставаться в границах приложения. Проект активно развивается, поэтому неожиданный результат может быть связан с package build, интеграцией LuCI, backend state или продуктовым workflow, который ещё не завершён полностью.

## Страница LuCI не видна

Убедитесь, что backend package и `luci-app-zapret2-manager` установлены из ожидаемой сборки. LuCI package зависит от backend и регистрирует приложение в разделе Services. До ручных изменений запишите версии установленных packages.

Если package установлен, но пункт меню не появился, полезно сначала отделить проблему package lifecycle/cache от проблемы самого backend. Не удаляйте вручную unrelated LuCI/OpenWrt state без доказательств.

## Backend status недоступен

Отделите frontend rendering problem от backend problem. Если оболочка LuCI открывается, но данные приложения не приходят, сохраните видимую ошибку и небольшой релевантный фрагмент system log из того же временного окна.

Backend package выполняет reload rpcd в post-install и включает свой service, поэтому package state и service state являются полезными первыми точками диагностики.

## Ошибка зависимостей или сборки

Используйте package Makefiles как источник истины для зависимостей. При ошибке OpenWrt SDK сохраняйте полный текст build error, выбранный target и ревизию репозитория.

Host-side source test и target package build дают разные доказательства. Успешный тест на рабочей машине не означает, что package собрался целевым toolchain.

## Проблемы Strategy и Scanner

Для `Strategy` запишите выбранный вариант, результат Preview, preflight и Validate, доступные **до Apply**. Это позволяет понять, на каком именно этапе возникло расхождение.

Для `Scanner` сохраните точную ревизию сборки, видимый статус Scanner, контекст кандидата и показанный результат или ошибку. Scanner находится в активной разработке, поэтому незавершённый Scanner path не является основанием сбрасывать постоянное состояние Strategy.

## Полезная диагностика

Хороший отчёт обычно содержит:

- commit/revision репозитория;
- версии установленных packages;
- версию и target OpenWrt;
- открывается ли LuCI;
- точное пользовательское действие, после которого возникла ошибка;
- минимальный релевантный log excerpt;
- для документации — точную команду `scripts/docs.mjs` и текст generated-site error.

Не включайте в отчёт секреты и unrelated personal configuration.

## Безопасное восстановление

Предпочитайте самое узкое recovery-действие, соответствующее компоненту, который владеет проблемным состоянием. Не превращайте локальную проблему приложения в полный сброс платформы.

Широкие действия уничтожают evidence и могут затронуть конфигурацию, которой zapret2-manager не владеет. Если текущий код не предоставляет проверенный recovery path, лучше сохранить и описать наблюдаемое состояние, чем придумывать разрушительный workaround.

## Диагностика документации

Основные команды документационного pipeline:

```sh
node scripts/docs.mjs verify
node scripts/docs.mjs build internal
node scripts/docs.mjs build public
node scripts/validate-knowledge.mjs
```

Generated outputs находятся в `.artifacts/docs-internal` и `.artifacts/docs-public`. Public tests проверяют не только существование HTML, но и publication boundary, статические ссылки для GitHub Pages и основной пользовательский контент.

Если локальный Quartz server открывает страницу, а GitHub Pages отвечает 404, сравнивайте **реальный href** с именем загруженного статического файла. Локальный server может поддерживать rewrite, которого нет у static hosting.

Для обычного первого использования вернитесь к [Установке](./installation.md) и [Первому запуску](./first-run.md). Участникам разработки также полезен раздел [Разработка](../08-development/index.md).
