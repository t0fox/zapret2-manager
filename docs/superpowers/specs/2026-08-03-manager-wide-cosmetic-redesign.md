# Zapret 2 Manager — единый косметический редизайн LuCI

**Дата:** 2026-08-03  
**Ветка:** `feat/strategy-first-integration`  
**Статус:** утверждённый дизайн, ожидает письменного подтверждения спецификации

## 1. Цель

Перевести весь пользовательский интерфейс Zapret 2 Manager на единый визуальный язык утверждённого `zapret-prototype.html`, сохранив существующую LuCI-архитектуру, RPC-контракты, backend, конфигурационные форматы и поведение всех рабочих действий.

Это косметический проект. Он не должен менять алгоритмы Orchestra, DNS, списков, мониторинга, профилей, обслуживания или Telegram Proxy.

## 2. Жёсткие ограничения

- Работа ведётся только в `feat/strategy-first-integration`.
- Не создавать другие ветки или worktrees.
- Не менять `ucode`, rpcd plugin, ACL, каталоги стратегий, service manifests, генераторы и backend-тесты.
- Не менять имена RPC, параметры RPC, порядок apply/rollback и форматы ответов.
- Не менять содержимое встроенных Flowseal/Asterlike стратегий.
- Не создавать пользовательские Profiles при выборе встроенной стратегии.
- Выбор стратегии остаётся pending до явного применения.
- Старый расширенный Orchestra не удаляется функционально.
- TG PROXY остаётся на существующем маршруте и в существующей вкладке `Proxy`; создаётся только новый заголовок и визуальная оболочка.
- Не подключать внешние CSS, шрифты, иконки или CDN.

## 3. Источник визуального языка

Основой служит утверждённый кликабельный прототип `zapret-prototype.html`:

- тёмный canvas `#191919`;
- базовая поверхность `#202020`;
- поднятая поверхность `#282827`;
- hover `#383836`;
- основной текст белый;
- вторичный текст с пониженной непрозрачностью;
- акцент `#5E9FE8`;
- зелёный `#72BC8F`;
- оранжевый `#DE9255`;
- красный `#E97366`;
- карточки радиусом 12 px;
- кнопки, tabs, badges, modal, toast, progress и tables в одном стиле.

Точные оттенки используются как предпочтительные токены, но CSS обязан оставаться читаемым в LuCI light/dark themes и не ломать системные страницы вне Zapret 2 Manager.

## 4. Навигация

Используется существующая навигация LuCI. Второй sidebar внутри приложения не создаётся.

Итоговые пункты:

1. `Orchestra`
2. `Профили`
3. `Списки`
4. `DNS`
5. `Мониторинг`
6. `TG PROXY`
7. `Обслуживание`

Из меню удаляются только визуально избыточные пункты:

- отдельный `Advanced` — расширенный Orchestra открывается переключателем внутри `Orchestra`;
- отдельный `Combo presets` — встроенные стратегии находятся внутри `Orchestra`.

Удаление этих пунктов не удаляет backend или сами функции.

## 5. Общая оболочка страниц

Каждая страница получает одинаковую композицию:

1. **Page header** — название, короткое описание, необязательные основные действия справа.
2. **Hero/status card** — главное состояние страницы и одно первичное действие.
3. **Tabs или segmented control** — только когда на странице есть реальные разделы.
4. **Content grid** — карточки и таблицы на общей сетке.
5. **Inline results** — ошибки, предупреждения и успешные операции в одинаковых callout-блоках.
6. **Modal** — подтверждения и детальные формы.
7. **Toast** — краткие результаты операций.
8. **Sticky draft/apply bar** — только на страницах, где уже существует черновик или отложенное применение.

Страницы ограничиваются разумной шириной, но Orchestra может использовать более широкую сетку для рейтинга и списка стратегий.

## 6. Общий дизайн-кит

Основная реализация размещается в `z2m-ui.css`. Используются префиксы `z2m-`, чтобы не затрагивать другие страницы LuCI.

Обязательные компоненты:

- `.z2m-page`
- `.z2m-page-header`
- `.z2m-hero`
- `.z2m-card`
- `.z2m-card-grid`
- `.z2m-tabs`
- `.z2m-segmented`
- `.z2m-button-primary`
- `.z2m-button-secondary`
- `.z2m-button-danger`
- `.z2m-badge-*`
- `.z2m-callout-*`
- `.z2m-table`
- `.z2m-field`
- `.z2m-switch`
- `.z2m-progress`
- `.z2m-console`
- `.z2m-modal-*`
- `.z2m-toast-*`
- `.z2m-empty-state`
- `.z2m-sticky-actions`

Старые inline styles постепенно заменяются классами. QR-поверхность TG PROXY остаётся белой ради читаемости сканером.

## 7. Orchestra

`orchestra-strategy.js` остаётся основной страницей.

Простой режим:

- активная глобальная стратегия;
- start/stop и rollback;
- реальный результат последнего теста;
- список встроенных стратегий;
- pending selection без auto-apply;
- проверка домена, URL или сервиса;
- рейтинг стратегий;
- точечные override-правила.

Расширенный режим:

- открывает существующий `orchestra.js` или его сохранённые панели внутри общей оболочки;
- сохраняет history, events, diagnostics, ratings, run controls и automatic mode;
- не дублируется отдельным пунктом меню.

Что убирается визуально:

- повторные заголовки;
- отдельные предупреждения, дублирующие badge состояния;
- постоянный показ длинных `NFQWS2_OPT` в простом режиме;
- отдельная страница Combo presets.

Технические аргументы доступны через раскрываемый блок или расширенный режим.

## 8. Профили

Существующая логика страницы сохраняется.

Новая композиция:

- hero с количеством активных профилей и текущим applied/draft состоянием;
- список профилей в компактной таблице или вертикальных rule cards;
- создание и редактирование в modal;
- готовые пресеты во второй колонке;
- технический итоговый `NFQWS2_OPT` только в раскрываемом advanced-блоке;
- существующие save/apply/reset handlers не меняются.

## 9. Списки

Сохраняются user include/exclude, IP lists, autohostlist, domain check и conflict protection.

Новая композиция:

- hero с количеством записей и конфликтов;
- tabs для доменов, IP и engine lists;
- редактор в карточке;
- domain check как отдельная компактная карточка;
- ошибки конфликтов отображаются красным callout перед применением;
- read-only engine lists визуально отличаются, но не получают новых действий.

## 10. DNS

Сохраняются все текущие разделы и RPC:

1. DNS Setup
2. Check & Choose
3. Service Access
4. Advanced
5. History

Косметические изменения:

- единый page header и hero с текущим resolver;
- tabs в стиле прототипа;
- provider cards с одинаковыми status, latency и action rows;
- service access в категориях и компактной grid;
- advanced settings в спокойной form-card;
- история в общей таблице;
- async testing не создаёт белых вспышек в dark theme;
- существующая логика draft/preview/apply/rollback не меняется.

## 11. Мониторинг

Сохраняются существующие status, runtime, queue, process, warnings, jobs и logs.

Новая композиция:

- hero состояния `zapret2/nfqws2`;
- KPI cards для uptime, RSS, queue и health;
- предупреждения выше технических таблиц;
- runtime instances и jobs в общей таблице;
- сырые данные и подробные диагностические поля в раскрываемом advanced-блоке;
- refresh и существующие control actions без изменения RPC.

## 12. TG PROXY

Маршрут остаётся `zapret2-manager/proxy`, файл остаётся `proxy.js`, menu item переименовывается в `TG PROXY`.

Новая композиция:

### Простой режим

- hero: installed/not installed, running/stopped, адрес и порт;
- главное действие: `Установить и запустить`, `Запустить`, `Остановить` или `Перезапустить` в зависимости от текущего backend-state;
- карточка подключения:
  - Telegram link;
  - открыть в Telegram;
  - копировать;
  - QR-код;
  - создать новый secret/link;
- recent activity в компактной таблице;
- понятное предупреждение о доступности только в пределах настроенной сети, если это следует из текущих данных.

### Расширенный блок

- существующая конфигурация;
- autostart;
- secret rotation;
- install/update details;
- logs;
- capabilities и диагностические поля.

Существующий встроенный QR-генератор, RPC и обработчики сохраняются. Разрешена только перестройка DOM и замена inline styles на общий CSS.

## 13. Обслуживание

Сохраняются backup/restore, package/system operations и прочие текущие функции.

Новая композиция:

- hero с последним backup и состоянием восстановления;
- карточки по независимым scopes;
- история backup в таблице;
- destructive actions отделены и окрашены красным;
- подтверждения выполняются через общий modal;
- существующая backend-валидация остаётся единственным источником истины.

## 14. Что разрешено убрать

Только визуальные дубли и шум:

- отдельный menu item `Advanced`;
- отдельный menu item `Combo presets`;
- повторяющиеся заголовки и длинные объяснения;
- технические поля из simple mode, если они остаются доступны в advanced/details;
- inline CSS, заменённый общими классами;
- локальные дубли badge/callout/toast/modal styles;
- неработающие декоративные кнопки без RPC или обработчика, если такие обнаружатся.

Нельзя убирать:

- рабочие действия;
- RPC declarations;
- error handling;
- rollback;
- validation;
- history;
- advanced data, если оно реально возвращается backend;
- accessibility labels и keyboard navigation.

## 15. Доступность и адаптивность

- `focus-visible` на всех интерактивных элементах;
- кнопки имеют текст или `aria-label`;
- tabs используют корректное active state;
- modal закрывается Escape и явной кнопкой;
- цвет не является единственным носителем статуса;
- таблицы на узком экране получают scroll или превращаются в stacked rows;
- grid становится одноколоночной;
- sticky action bar не перекрывает контент;
- `prefers-reduced-motion` отключает необязательные анимации.

## 16. Файлы реализации

Ожидаемые frontend-файлы:

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- `.../orchestra-strategy.js`
- `.../orchestra.js`
- `.../strategies.js`
- `.../lists.js`
- `.../dns.js`
- `.../monitor.js`
- `.../proxy.js`
- `.../maintenance.js`
- `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`

Допускается небольшой frontend-only helper, если он устраняет повторение `injectCSS`, modal, toast и page header. Он не должен обращаться к backend самостоятельно и не должен менять RPC contracts.

## 17. Проверка

### Статические тесты

- все прежние RPC method names по каждой странице остались в исходниках;
- backend-папка `zapret2-manager/files/usr/libexec/` не изменена этим косметическим набором commits;
- ACL не изменён;
- menu JSON валиден;
- отдельные `Advanced` и `Combo presets` отсутствуют в menu;
- `Proxy` route сохранён, title изменён на `TG PROXY`;
- каждая целевая страница подключает `z2m-ui.css`;
- нет внешних assets/CDN;
- нет auto-apply при выборе Orchestra strategy;
- QR generator и proxy actions остаются в `proxy.js`.

### Синтаксис

- `node --check` либо существующий LuCI JS syntax gate для изменённых файлов;
- существующие UI contract tests;
- CSS brace sanity;
- JSON parse menu file.

### Ручная проверка в браузере

- desktop и narrow viewport;
- dark и light LuCI theme;
- tabs, forms, modals, toasts, tables;
- loading/error/empty/success states;
- Orchestra pending/apply flow;
- DNS provider test and apply UI;
- TG PROXY install/start/link/QR controls;
- отсутствуют изменения backend-запросов.

Реальная работа RPC на роутере не может быть доказана только статическим тестом. Но поскольку backend не меняется, задачей проверки является отсутствие frontend-регрессий и правильная передача прежних аргументов.

## 18. Критерии приёмки

1. Все страницы Zapret 2 Manager выглядят частью одного интерфейса.
2. Визуальный язык соответствует утверждённому прототипу без копирования второго sidebar.
3. DNS и TG PROXY оформлены на том же уровне, что Orchestra.
4. TG PROXY остаётся в прежней вкладке и использует прежние RPC.
5. Отдельные Advanced и Combo presets отсутствуют в меню, но функции доступны внутри Orchestra.
6. Backend, RPC contracts, strategy definitions и config formats не изменены.
7. Простые режимы не перегружены техническими деталями.
8. Все рабочие действия и rollback сохранены.
9. Интерфейс адаптивен и читаем в light/dark LuCI themes.
10. Статические UI-тесты и syntax gates проходят.
