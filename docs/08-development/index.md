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

Репозиторий организован вокруг OpenWrt packages, исходного кода приложения, автоматических тестов и базы документации в `docs/`. Публичный раздел разработки описывает структуру проекта, уровни evidence и проверенные команды, которые нужны участнику разработки. Внутренние рабочие материалы остаются во внутренней документации.

## Структура репозитория

Основные области:

- `zapret2-manager/` — backend package и implementation source;
- `luci-app-zapret2-manager/` — JavaScript frontend LuCI и package data;
- `zapret2-manager-full/` — target-specific meta-package backend + LuCI;
- `tests/` — автоматические тесты и verification gates;
- `docs/` — база знаний и исходный контент Quartz;
- `scripts/` — точки входа для validation/documentation tooling.

Сгенерированные packages, build directories, временные audit outputs и локальное состояние инструментов не должны попадать в обычное source tree.

## Сборка OpenWrt packages

Используйте стандартную систему сборки OpenWrt. В README репозитория указаны package targets:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

Host-side source test и сборка целевым OpenWrt toolchain подтверждают разные свойства. Нельзя сообщать об успешной target-сборке только потому, что локальный test исходников завершился без ошибки.

## Evidence важнее слова «PASS»

Разные gates отвечают на разные вопросы. Подробная [лестница доказательств](./evidence-testing.md) разделяет source/unit, integration/contract, package/toolchain, router read-only, router mutation/E2E и LAN/live evidence.

Это особенно важно для Scanner: наличие model/planner/worker/A1 runtime и зелёных source tests является серьёзным прогрессом, но production-ready статус требует доказанной полной вертикали и target evidence.

## Контракты и approved design

Публичный индекс [Контракты, решения и approved design](./decisions-and-specs.md) объясняет основные архитектурные решения без публикации внутренних рабочих журналов. Там разделены current contract, approved design и implementation evidence.

Ключевые темы: native backend contract, Strategy aggregate/catalog, Scanner design, single-writer, A1 ownership, OpenWrt-native deviations, Rust-first для нового native-кода и будущая routing/tunnel foundation.

## Документация как часть разработки

[Актуальность документации вместе с разработкой](./docs-freshness.md) описывает freshness contract. `scripts/check-docs-freshness.mjs` связывает изменения product/runtime областей с документацией, которую нужно пересмотреть в том же change set.

Например, изменение Scanner runtime без изменения Scanner docs/parity/roadmap должно давать failure. При этом freshness gate не заменяет review фактических claims: он доказывает только то, что documentation impact был явно обработан.

## Работа с Quartz

Quartz infrastructure уже существует; обычная работа с документацией расширяет текущий сайт, а не создаёт второй pipeline.

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

Стабильные выходные каталоги: `.artifacts/docs-internal` и `.artifacts/docs-public`.

## Проверка базы знаний

Запустите:

```sh
node scripts/validate-knowledge.mjs
```

Validator проверяет frontmatter contract, IDs, dates, links, authority/reachability и другие правила knowledge tree. Public-site suite дополнительно проверяет содержательность, границу публикации, generated links, GitHub Pages subpath/runtime и freshness fixtures.

Новые публичные страницы используют существующие поля `id`, `title`, `type`, `status`, `authority`, `updated`, `publish`, `tags`; параллельная metadata schema не создаётся.

## Public и internal

Публичная документация объясняет продукт, текущую зрелость, поддерживаемые workflows, архитектуру, parity, roadmap, evidence и operational boundaries.

Internal Quartz остаётся местом для детальных implementation evidence, plans/specs, engineering recovery history и внутренних operational notes. Если public link требует объяснения внутреннего решения, создаётся безопасная user-facing summary, а не публикуется весь внутренний источник.

## Проверка изменений документации

Изменение Markdown само по себе не доказывает, что сайт работает. Нужно проверить metadata/links, собрать public и internal artifacts, прогнать publication/content tests и посмотреть generated HTML.

Отдельно учитывается разница Quartz dev-server и GitHub Pages: ссылка должна разрешаться как реально загруженный static file под `/zapret2-manager/`, а не рассчитывать на rewrite только локального сервера.

## С чего начать

- [Обзор проекта](../01-project/index.md)
- [Roadmap](../01-project/status-roadmap.md)
- [Avatar parity](../01-project/avatar-parity.md)
- [Архитектура](../02-architecture/index.md)
- [Runtime flow](../02-architecture/runtime-flow.md)
- [Владение состоянием](../02-architecture/state-ownership.md)
- [Доказательства и тестирование](./evidence-testing.md)
- [Контракты и решения](./decisions-and-specs.md)
- [Актуальность документации](./docs-freshness.md)
