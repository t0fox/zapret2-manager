# Дизайн исправления дефектов, найденных в router-видео

Дата: 2026-08-04  
Статус: ожидает пользовательского review  
Основание: запись реального LuCI-интерфейса на OpenWrt длительностью около 1:49 и последующая сверка с текущим `main`.

## 1. Цель

Устранить подтверждённые записью дефекты без изменения публичного RPC-контракта без необходимости:

- длительные полноэкранные загрузки при обычной навигации и локальных UI-действиях;
- непонятное и некорректное управление черновиками;
- дублирование Service DNS между вкладками «Сервисы» и `DNS → Service Access`;
- противоречивое состояние strategy run и применение кандидата, который backend затем отвергает;
- небезопасное автоматическое раскрытие Telegram Proxy secret и неясное частично успешное состояние ротации.

Изменения должны сохранять single-view архитектуру, существующие ACL и backend-owned операции.

## 2. Подтверждённые симптомы

### 2.1 Навигация и загрузки

- При переключении вкладок текущий контент полностью заменяется на `Загрузка данных…`.
- Выбор стратегии вызывает полный `ctx.refresh('strategy')`, хотя меняется только локальное выделение.
- Отмена browser-only drafts вызывает `window.location.reload()`.
- Пользователь регулярно теряет уже отображённые данные на несколько секунд.

### 2.2 Черновики

- «Показать различия» выводит сериализованный JSON, а не semantic diff `было → стало`.
- «Открыть изменения» только переходит на первую связанную вкладку и визуально ничего не делает, если пользователь уже там.
- Scope `service-dns` не имеет пользовательского названия и маршрута в `app.js`.
- В draft попадает полная карта DNS selections, включая неизменённые пустые значения.
- Возврат поля к исходному значению не гарантирует очистку dirty-state.

### 2.3 Service DNS

- DNS-профиль сервиса редактируется и применяется во вкладке «Сервисы».
- Тот же объект конфигурации отдельно редактируется в `DNS → Service Access`.
- Два экрана используют разные apply-процессы: синхронный и async/poll/rollback.

### 2.4 Strategy

- Каталожный кандидат, показанный как рекомендуемый, может завершиться сообщением `candidate syntax rejected`.
- UI может одновременно показывать `ENOENT: run not found`, активную фазу и устаревшие счётчики.
- Ошибка получения run не приводит к однозначному terminal/stale состоянию.

### 2.5 Telegram Proxy

- Обычная загрузка вкладки автоматически делает reveal-запрос секрета.
- Ротация может изменить secret и перезапустить сервис, но провалить listener verification.
- После такого частичного результата UI продолжает выглядеть как полностью healthy и не объясняет состояние новой ссылки.

## 3. Декомпозиция на три PR

Каждый PR начинается с regression-тестов, проходит полный repository gate и автоматически мержится только при зелёном CI, неизменном проверенном head SHA, отсутствии requested changes и unresolved review threads.

### PR 1 — Responsive navigation and local refresh

#### Архитектура

`app.js` получает per-tab cache последнего успешно загруженного `data` и отрисованного состояния. Переход на вкладку:

1. немедленно показывает кэшированное содержимое, если оно есть;
2. запускает refresh в фоне;
3. заменяет содержимое только после успешного ответа;
4. при ошибке сохраняет последний успешный экран и показывает bounded warning/toast.

Полноэкранная заглушка остаётся только для первого открытия вкладки без кэша.

#### Изменения

- Удалить `window.location.reload()` из отмены drafts.
- Очищать store локально и повторно рендерить только затронутую вкладку/панель.
- Выбор strategy candidate не должен выполнять RPC и полный refresh; выбранная строка и details обновляются локально.
- Повторный клик по уже активной вкладке не должен запускать refresh без явной причины.
- Polling может обновлять только связанный status/result host; terminal refresh допускается один раз.
- Добавить visible `Обновление…` на уровне панели или вкладки без удаления старых данных.

#### Обработка ошибок

- Timeout/RPC error не удаляет последний успешный экран.
- Ошибка отображается рядом с устаревшими данными с пометкой `Показано последнее успешное состояние`.
- Activation token продолжает блокировать late responses от неактивной вкладки.

#### Acceptance criteria

- Переключение уже посещённых вкладок не показывает пустой полноэкранный loader.
- Выбор стратегии не вызывает `module.load()`.
- Отмена drafts не перезагружает документ.
- Нет одновременных дублирующихся load одного tab.
- Существующие unmount/timer guarantees сохраняются.

### PR 2 — Semantic drafts and one Service DNS owner

#### Владение функциями

Вкладка «Сервисы» отвечает только за:

- включение/выключение сервисных пакетов;
- просмотр доменов;
- bounded service check;
- catalog preview/apply.

Весь Service DNS переносится в `DNS → Service Access`:

- per-service provider selection;
- async apply status;
- rollback;
- операция и история.

Из `z2m-services.js` удаляются DNS provider RPC, selects, `applyDns()` и DNS-поля в draft `services`.

#### Draft model

Каждый scope хранит только изменившиеся поля относительно baseline, загруженного при открытии/успешном refresh.

Для `service-dns`:

```text
{
  changes: {
    discord: { before: "", after: "cloudflare" }
  }
}
```

Когда `after === before`, запись удаляется. Если changes пуст, scope удаляется полностью.

#### Apply bar

- `service-dns` отображается как `DNS: доступ сервисов`.
- Scope маршрутизируется в вкладку `dns`, subpane `access`.
- `Что изменено` открывает semantic diff с понятными названиями и `было → стало`.
- `Перейти к изменениям` показывается только если пользователь находится не в соответствующем месте.
- Если пользователь уже на нужной вкладке, действие заменяется на `Показать на странице` и прокручивает/подсвечивает изменённые поля.
- `Отменить все` очищает browser drafts без document reload.

#### Acceptance criteria

- В «Сервисы» отсутствуют DNS selects и `Применить DNS`.
- Единственный владелец Service DNS — `DNS → Service Access`.
- Нельзя применить одну конфигурацию двумя разными UI-процессами.
- Возврат всех значений к baseline скрывает apply bar.
- Semantic diff не показывает неизменённые пустые selections и внутренний JSON.
- Apply bar не выводит сырой scope `service-dns`.

### PR 3 — Strategy/run and Proxy operation correctness

#### Strategy candidate validation

Перед apply frontend использует backend-owned validation/preview, если такой RPC уже существует в frozen contract. Если отдельного validation RPC нет, исправление выполняется в существующем backend apply path без добавления второго парсера во frontend.

Каталог должен различать:

- `applicable` — кандидат прошёл backend validation;
- `invalid` — кандидат нельзя применить, кнопка disabled и отображается причина;
- `unknown` — validation недоступна, кандидат нельзя маркировать как рекомендуемый без предупреждения.

`candidate syntax rejected` должен быть расследован до конкретного несовпадения serializer/parser/corpus; запрещено скрывать ошибку или просто переименовывать сообщение.

#### Run state reconciliation

- `ENOENT` для ранее известного run преобразуется в terminal `stale`/`missing`, а не оставляет фазу `testing`.
- При missing run очищаются active polling и активные счётчики.
- Последний snapshot может оставаться только как historical snapshot с явной меткой `Запуск больше не найден`.
- Нельзя одновременно показывать active phase и terminal error.
- История и active status нормализуются одной функцией.

#### Proxy secret

- Первичная загрузка получает только masked link.
- Reveal выполняется только по отдельному пользовательскому действию и требует явного подтверждения.
- Revealed value не сохраняется в store/cache дольше текущего отображения modal/card.
- Частичный результат ротации моделируется явно:
  - secret changed;
  - restart completed/failed;
  - listener verification completed/failed.
- При `secret changed + verification failed` UI показывает warning state, блокирует утверждение `полностью работает` и предлагает только безопасные backend-supported действия: повторная health verification и rollback, если rollback поддерживается контрактом.
- Старую и новую ссылку нельзя показывать как одновременно валидные без backend evidence.

#### Acceptance criteria

- Невалидный кандидат нельзя применить из UI.
- Missing run останавливает polling и не отображается как active.
- Proxy link не раскрывается при обычном открытии вкладки.
- Частично успешная ротация не отображается как полный success.
- Секреты не попадают в logs, drafts, semantic diff и persistent store.

## 4. Локализация и диагностическая информация

В рамках затрагиваемых экранов:

- пользовательские заголовки и действия переводятся на русский;
- сырые RPC chain names убираются из обычного режима;
- технические operation IDs и backend evidence остаются доступными только в расширенном режиме или диагностическом блоке;
- backend error code сохраняется, но сопровождается понятным пользовательским объяснением.

Полная локализация всего проекта вне затронутых экранов не входит в этот цикл.

## 5. Тестирование

### Regression tests

- `app.js`: stale-while-revalidate cache, no document reload, no refresh on local candidate selection.
- Drafts: baseline diff, automatic scope cleanup, routing `service-dns → dns/access`, semantic diff rendering.
- Services/DNS ownership: DNS RPC отсутствуют в Services; async Service DNS workflow существует только в DNS.
- Strategy: invalid candidate disabled; missing run terminalizes state and stops polling.
- Proxy: no automatic reveal; partial rotation status is explicit; secret redaction.

### Gates для каждого PR

- focused tests затронутых модулей;
- полный `tools/run-all-tests.sh` — ноль red;
- LuCI JavaScript syntax;
- menu/ACL JSON;
- CSS/local asset gates;
- `git diff --check`;
- отсутствие secrets и router credentials;
- GitHub Actions success на текущем head SHA.

Количество green тестов может увеличиваться; запрещено фиксировать реализацию под старое число `1036`, но red должно оставаться `0`.

## 6. Router validation

После каждого PR достаточно CI и host-side harness для merge. После третьего PR выполняется единый router acceptance pass без обязательного reboot:

1. установить свежие пакеты поверх работающей системы;
2. очистить LuCI cache штатным post-install;
3. повторить сценарий исходного видео;
4. записать тайминги loader, результаты действий, strategy и proxy statuses;
5. не объявлять PASS, если внешняя connectivity не позволяет подтвердить результат.

Router validation не должна содержать secrets, IP/session cookies или реальные proxy links.

## 7. Non-goals

- Переписывание backend RPC API.
- Новый frontend framework.
- Полный редизайн всех страниц.
- Исправление внешней connectivity роутера.
- Автоматический reboot.
- Скрытие backend failures через allowlist/`continue-on-error`.

## 8. Merge policy

Пользователь разрешил автоматически мержить каждый из трёх PR после выполнения всех условий:

- PR не draft и mergeable;
- проверенный head SHA не изменился;
- полный локальный gate и required GitHub checks зелёные;
- нет unresolved review threads или requested changes;
- ветка актуальна относительно `main` либо merge-result проверен;
- merge выполняется без admin bypass и force-push.

При любом новом red PR не мержится: сначала расследуется и исправляется первопричина.
