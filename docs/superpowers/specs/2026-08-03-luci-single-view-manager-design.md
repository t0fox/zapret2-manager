# Zapret 2 Manager — single-view LuCI application

**Дата:** 2026-08-03  
**Ветка:** `feat/strategy-first-integration`  
**Статус:** утверждённый дизайн  
**Главный референс:** предоставленный пользователем `luci-zapret2.html`

> Эта спецификация является авторитетной и заменяет прежний документ
> `2026-08-03-manager-wide-cosmetic-redesign.md`. Предыдущая попытка с
> `*-legacy.js` и косметическими wrapper-view считается отклонённой.

## 1. Цель

Пересобрать frontend Zapret 2 Manager как одно цельное LuCI-приложение, максимально близкое по структуре, плотности и визуальному языку к `luci-zapret2.html`.

Системная шапка OpenWrt/LuCI остаётся. Ниже неё Manager рисует собственную верхнюю панель, горизонтальные вкладки и рабочую область. Переключение вкладок выполняется внутри одного LuCI view без полной перезагрузки страницы.

Backend, rpcd/ucode, ACL, форматы конфигурации и существующие RPC payload не меняются в рамках этого frontend-проекта.

## 2. Единственный источник истины

Главный визуальный и структурный референс — `luci-zapret2.html`.

Обязательные токены:

- background: `#17181a`;
- panel: `#1f2124`;
- panel 2: `#25282c`;
- raised: `#2c3035`;
- border: `#34383d`;
- strong border: `#3f444a`;
- primary text: `#e8eaed`;
- secondary text: `#a7aeb6`;
- muted text: `#7d858e`;
- blue: `#4b9fd5`;
- green: `#5cb98b`;
- orange: `#e0a33b`;
- red: `#e2695a`;
- purple: `#9a86d6`.

Обязательная визуальная модель:

- собственная app header-панель `zapret2·manager`;
- горизонтальная полоса вкладок;
- LuCI-подобные панели с небольшим радиусом;
- плотные таблицы и CBI-подобные form grids;
- subtabs;
- KPI strip;
- accordion/details;
- sticky apply/confirm bar;
- единые modal, toast, progress и console;
- responsive layout из референса.

Предыдущие `orchestra(1).html` и `zapret-prototype(1).html` больше не задают layout или палитру.

## 3. Архитектура приложения

### 3.1 Один LuCI view

В menu.d видимым остаётся один пункт Zapret 2 Manager, открывающий:

```text
view/zapret2-manager/app.js
```

Только `app.js` экспортирует:

```js
return L.view.extend({ load, render, handleSaveApply: null, ... });
```

Другие frontend-модули не являются LuCI views и не возвращают `L.view.extend()`.

### 3.2 Внутренние вкладки

Корневое приложение содержит восемь вкладок строго в порядке референса:

1. Обзор;
2. Стратегия;
3. Сервисы;
4. Списки;
5. DNS;
6. Telegram Proxy;
7. Мониторинг;
8. Обслуживание.

Активная вкладка хранится в URL hash, например:

```text
#/overview
#/strategy
#/services
#/lists
#/dns
#/proxy
#/monitor
#/maintenance
```

Обновление страницы восстанавливает вкладку из hash. Back/Forward браузера работает корректно.

### 3.3 Compatibility routes

Старые маршруты остаются скрытыми и используются только для совместимости с закладками:

- `orchestra-strategy` → `app#/overview`;
- `orchestra` → `app#/strategy`;
- `strategies` → `app#/strategy`;
- `lists` → `app#/lists`;
- `dns` и `service-dns` → `app#/dns`;
- `proxy` → `app#/proxy`;
- `monitor` → `app#/monitor`;
- `maintenance` → `app#/maintenance`.

Redirect-модули являются обычными валидными LuCI views. Они не импортируют и не возвращают другой view-конструктор.

### 3.4 Запрет legacy-wrapper

Запрещена конструкция:

```js
'require view.zapret2-manager.some-legacy as Legacy';
return Legacy;
```

Файлы `*-legacy.js` не участвуют в runtime. После переноса обработчиков они удаляются из пакета.

Старый код разрешено использовать только как источник существующих RPC declarations, payload и проверенной бизнес-логики обработчиков.

## 4. Файловые границы

```text
view/zapret2-manager/
  app.js                 # единственный LuCI view и lifecycle
  z2m-api.js             # существующие RPC declarations и нормализация ответов
  z2m-store.js           # UI state, pending/draft/applied, active tab
  z2m-shell.js           # app header, tabs, modal, toast, apply bars
  z2m-overview.js        # Обзор
  z2m-strategy.js        # Стратегия/Orchestra
  z2m-services.js        # Сервисы
  z2m-lists.js           # Списки
  z2m-dns.js             # DNS
  z2m-proxy.js           # Telegram Proxy
  z2m-monitor.js         # Мониторинг
  z2m-maintenance.js     # Обслуживание
  z2m-ui.css             # точная визуальная система референса
```

Каждый tab-модуль экспортирует понятный frontend-контракт:

```js
{
  id,
  title,
  subtitle,
  load(api, store),
  render(ctx),
  mount(ctx),
  unmount(ctx)
}
```

`mount()` назначает события и polling, `unmount()` отменяет timers/listeners. Модуль не знает о LuCI menu и не изменяет backend.

## 5. API facade

`z2m-api.js` группирует существующие RPC по областям:

- service/status/start/stop/restart;
- profiles/strategy/catalog/apply/rollback;
- Orchestra runs/history/ratings;
- services and lists;
- DNS;
- Telegram Proxy;
- monitoring/diagnostics/logs;
- maintenance/backup/restore.

Требования:

- имена RPC не меняются;
- параметры и JSON encoding не меняются;
- write-методы используют прежние idempotency tokens, где они уже предусмотрены;
- facade не придумывает данные при ошибке;
- unsupported backend methods показываются как недоступная функция, а не ломают страницу;
- каждый запрос имеет единый error normalization.

## 6. Центральное состояние

Store разделяет:

- `server`: последний подтверждённый backend-state;
- `draft`: несохранённые изменения UI;
- `pending`: выбранная, но не применённая стратегия;
- `applied`: подтверждённая backend конфигурация;
- `jobs`: активные проверки/polling;
- `ui`: вкладка, subtabs, advanced mode, открытый modal.

Ни один выбор в интерфейсе не меняет runtime без явного Apply.

Sticky apply bar появляется при непустом draft. После успешного apply показывается confirm bar с rollback/keep. Поведение следует референсу и существующим безопасным backend-операциям.

## 7. Вкладка «Обзор»

Повторяет референс:

- состояние zapret2/nfqws2/NFQUEUE;
- start/stop/restart;
- KPI: доступные цели, задержка, сервисы с DNS, overrides;
- активная глобальная стратегия;
- автоподбор, переход к стратегиям и rollback;
- список проблемных ресурсов;
- точечная проверка домена/URL/IP;
- краткий список override-правил.

Показываются только реальные значения. При отсутствии данных используются `—`, `не проверялось` или явный warning; нули не подставляются как фиктивные значения.

## 8. Вкладка «Стратегия»

Subtabs:

1. Стратегии;
2. Цепочка профилей — advanced;
3. Проверка конфига — advanced;
4. История.

Основной список стратегий показывает:

- название и назначение;
- active/recommended/pending badges;
- реальные результаты последнего запуска;
- доступность, latency и confidence;
- выбор без auto-apply.

Тест конкретного ресурса и полный прогон используют существующий Orchestra run API. `0 targets` отображается как диагностическая ошибка корпуса/manifest, а не как успешный пустой запуск.

## 9. Вкладка «Сервисы»

- KPI доступных/включённых/изменённых сервисных наборов;
- поиск и фильтры;
- категории;
- enable switch;
- назначение DNS-профиля;
- hosts source;
- hostlist mapping по профилям;
- изменения попадают в общий draft.

Функции, которых backend не предоставляет, показываются read-only или disabled с точным пояснением. Нельзя имитировать сохранение.

## 10. Вкладка «Списки»

- проверка домена;
- include/exclude редакторы;
- счётчики;
- IP/autohostlist/engine lists в advanced/read-only секции;
- conflict и validation callouts;
- существующие save/apply handlers через API facade.

## 11. Вкладка «DNS»

Subtabs сохраняются:

1. DNS Setup;
2. Check & Choose;
3. Service Access;
4. Advanced;
5. History.

Визуальная структура и плотность соответствуют `luci-zapret2.html`.

Фактические предупреждения, например отсутствие регистрации manager overrides в dnsmasq, показываются в верхнем warning panel. Они не скрываются косметикой.

## 12. Вкладка «Telegram Proxy»

Это основная вкладка приложения, не дополнительная карточка.

Обязательный простой экран:

- installed/running/stopped state;
- listener address and port;
- masked secret;
- полный Telegram proxy link;
- Open in Telegram;
- Copy link;
- QR code;
- Rotate secret / New link с подтверждением;
- active connections, если backend предоставляет;
- recent activity/log tail.

Accordion «Настройки»:

- autostart;
- port;
- FakeTLS SNI;
- Telegram DC mappings;
- Cloudflare domains;
- Worker domains;
- CF priority/round-robin;
- WS pool;
- socket buffer;
- max connections;
- quiet/debug logging.

Accordion «Техническое»:

- start/stop/restart;
- self-test/health;
- diagnostics;
- capabilities;
- raw logs.

Сохраняются существующий QR generator и все proxy RPC. Ошибка `HTMLCollection.forEach` исключается архитектурно: UI обновляется через целевой render/replace и `Array.from()`/обычные циклы, а не перенос живой коллекции через `.forEach()`.

## 13. Вкладка «Мониторинг»

Subtabs:

- Соединения;
- Диагностика;
- Журнал службы.

Polling запускается только при активной вкладке и отменяется при уходе. Отсутствующий `events_tail` отображается как unsupported capability, без бесконечных ошибок и без падения приложения.

## 14. Вкладка «Обслуживание»

- service/system facts;
- restart, config export, list update, support archive;
- manager settings;
- backups по существующим scopes;
- create, preview, restore, delete;
- preview отображается в общем modal или inline panel;
- destructive operations требуют подтверждения.

Обновление DOM не ищет устаревший `.cbi-map`; компоненты перерисовываются через корневой app context.

## 15. Shell-компоненты

### App header

- бренд `zapret2·manager`;
- версия пакета;
- hostname/router address;
- service status chip.

### Horizontal tabs

- точный порядок восьми вкладок;
- active state;
- badges только для реальных счётчиков;
- горизонтальный scroll на узких экранах.

### Apply bar

- hidden без draft;
- показывает количество и тип изменений;
- Discard, Diff, Apply;
- после apply: Rollback now, Keep;
- не перекрывает содержимое.

### Modal and toast

- один modal host;
- Escape/overlay close, кроме обязательных блокирующих операций;
- focus management;
- toast с уровнями info/success/warn/error.

## 16. Error handling

- ошибка одного tab load не ломает app shell;
- каждый tab имеет error boundary и retry;
- Promise rejection всегда завершается visible state;
- polling не запускает параллельные запросы;
- runtime exceptions считаются blocker;
- нет fake success;
- отсутствие backend capability не интерпретируется как пустой успешный результат.

## 17. Migration

1. Добавить RED tests для единственного LuCI view, tabs и запрета legacy-wrapper.
2. Создать shell/store/API facade.
3. Перенести Обзор и Стратегию напрямую из существующих RPC handlers.
4. Перенести Сервисы и Списки.
5. Перенести DNS.
6. Перенести Telegram Proxy, включая QR и lifecycle.
7. Перенести Мониторинг.
8. Перенести Обслуживание и backup preview.
9. Добавить compatibility redirects.
10. Удалить `*-legacy.js` и старые wrapper files.
11. Обновить menu/package tests.
12. Поднять LuCI package release.
13. Собрать и проверить на тестовом OpenWrt.

Во время миграции нельзя оставлять рабочую ветку с root route, который импортирует и возвращает legacy view.

## 18. Тестирование

### Host tests

- ровно один runtime `L.view.extend()` для основного приложения;
- component-модули не экспортируют view constructors;
- отсутствуют `require ...-legacy`;
- отсутствует `return Legacy...`;
- восемь tabs и правильный порядок;
- hash navigation and restore;
- все существующие RPC names сохранены;
- menu JSON содержит один видимый app entry и скрытые redirects;
- package tests учитывают `hidden` и не считают redirects primary tabs;
- CSS содержит точные reference tokens;
- no external assets/CDN;
- proxy DOM update не использует `HTMLCollection.forEach`;
- maintenance preview имеет видимый success/error state;
- JS syntax and full Node suite pass.

### Live OpenWrt acceptance

- приложение открывается без `factory yielded invalid constructor`;
- нет browser console exceptions при переходах;
- refresh сохраняет текущую вкладку;
- Overview показывает реальные status values;
- Strategy selection остаётся pending до Apply;
- Lists domain check;
- все DNS subtabs;
- Telegram Proxy stop/start/restart/link/copy/QR/rotate;
- Monitor polling starts/stops корректно;
- Backup create/preview/restore dialog;
- narrow viewport;
- LuCI cache clean/reload;
- package version подтверждена на устройстве.

## 19. Не входит в этот frontend-проект

Ниже перечисленные проблемы диагностируются и отображаются, но не исправляются косметическим frontend-коммитом без отдельного backend design:

- `nft table zapret2 missing or empty`;
- `nfqws2 process gone`;
- Orchestra run с `0 targets` из-за backend/catalog/manifest;
- Import applied profiles, если backend не создаёт draft;
- регистрация DNS manager overrides в dnsmasq;
- отсутствие backend method `events_tail`.

## 20. Критерии приёмки

1. Интерфейс визуально узнаваемо соответствует `luci-zapret2.html`, а не старым LuCI pages.
2. Один видимый LuCI route открывает цельное приложение с восемью горизонтальными вкладками.
3. Telegram Proxy — полноценная основная вкладка.
4. Нет `*-legacy.js` в runtime и нет wrapper-export другого view.
5. Нет `factory yielded invalid constructor` и других browser exceptions.
6. Backend, ACL и RPC payload не изменены.
7. Pending/draft не меняют runtime до Apply.
8. Sticky apply/confirm bar работает на всех поддерживаемых изменениях.
9. Ошибки и unsupported capabilities показаны честно.
10. Full Node suite, JS syntax, packaging tests и live smoke tests проходят перед заявлением о готовности.
