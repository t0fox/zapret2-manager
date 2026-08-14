---
id: development-index
title: "Разработка"
type: index
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [development, build, tests, docs]
---

# Разработка

Репозиторий организован вокруг OpenWrt packages, исходного кода приложения, автоматических тестов и базы документации в `docs/`. Публичный раздел разработки описывает структуру проекта и проверенные команды, которые нужны участнику разработки. Рабочие планы, внутренние handoff-записи и приватные engineering-инструкции остаются во внутренней документации.

## Структура репозитория

Основные области:

- `zapret2-manager/` — backend package и его implementation source;
- `luci-app-zapret2-manager/` — JavaScript frontend LuCI и package data;
- `zapret2-manager-full/` — target-specific meta-package backend + LuCI;
- `tests/` — автоматические тесты и verification gates;
- `docs/` — база знаний и исходный контент Quartz;
- `scripts/` — точки входа для документации и validation.

Сгенерированные packages, build directories, временные audit outputs и локальное состояние инструментов не должны попадать в обычное source tree.

## Сборка OpenWrt packages

Используйте стандартную систему сборки OpenWrt. В README репозитория указаны package targets:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

Host-side source test и сборка целевым OpenWrt toolchain подтверждают разные свойства. Нельзя сообщать об успешной target-сборке только потому, что локальный тест исходников завершился без ошибки.

## Текущие тесты

README указывает `scripts/test/native.sh` как текущую точку входа для проверки native foundation. Запускайте актуальные test entry points на известной ревизии и при регрессии сохраняйте точную команду и исходный текст ошибки.

Для документации отдельные тесты проверяют содержательность публичных страниц, отсутствие внутренних материалов, корректность ссылок и соответствие поведения статическому GitHub Pages hosting.

## Работа с документацией

Quartz infrastructure уже существует. Обычная работа с документацией должна расширять текущий контент и тесты, а не создавать второй сайт.

Проверка закреплённой версии Quartz:

```sh
node scripts/docs.mjs verify
```

Сборка внутренней базы:

```sh
node scripts/docs.mjs build internal
```

Сборка публичного сайта:

```sh
node scripts/docs.mjs build public
```

Стабильные выходные каталоги: `.artifacts/docs-internal` и `.artifacts/docs-public`. Bash и PowerShell wrappers используют тот же entry point `docs.mjs`.

## Проверка базы знаний

Запустите:

```sh
node scripts/validate-knowledge.mjs
```

Validator проверяет frontmatter contract, идентификаторы, даты, ссылки и другие правила базы знаний. Public-site tests дополнительно защищают границу публикации и проверяют generated links.

Новые публичные страницы используют уже существующие поля: `id`, `title`, `type`, `status`, `authority`, `updated`, `publish` и `tags`. Не создавайте параллельную metadata schema.

## Публичная и внутренняя документация

Публичная документация должна объяснять назначение проекта, текущую зрелость, поддерживаемые пользовательские workflow, архитектуру на полезном уровне, установку и устранение неполадок.

Внутренний Quartz сохраняет implementation evidence, рабочие планы, ADR, инженерные контракты, traceability и recovery history. Битая публичная ссылка не является основанием публиковать внутренний документ: нужно дать публичное объяснение, убрать ссылку или создать отдельную user-facing страницу.

## Проверка изменений документации

Само изменение Markdown не доказывает, что сайт работает. Нужно проверить metadata и links, собрать public artifact, прогнать тесты публикации и проверить generated HTML. При изменениях дерева документации важны и public, и internal builds.

Отдельно учитывайте разницу между Quartz dev-server и GitHub Pages. Публичные ссылки должны разрешаться как реально загруженные статические файлы; нельзя рассчитывать на rewrite, который существует только у локального сервера.

## С чего начать

Новому участнику полезно прочитать [Обзор проекта](../01-project/index.md), [Архитектуру](../02-architecture/index.md) и страницу нужной продуктовой области. Для понимания пользовательского пути также посмотрите [Установку](../11-operations/installation.md) и [Устранение неполадок](../11-operations/troubleshooting.md).
