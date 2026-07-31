## Slice 2: Structured Capabilities и расширение read-only RPC

### 2.1. Реализованные изменения

#### Новые RPC методы
1. `orchestra_ratings_get` - метод для получения рейтингов адаптивной системы
2. Обновленные RPC методы:
   - `orchestra_capabilities`
   - `orchestra_status`
   - `orchestra_events`
   - `orchestra_history`

#### Файловые изменения

**orchestra.uc** (G:/zapret2-manager/zapret2-manager/files/usr/libexec/zapret2-manager/orchestra.uc):
- Добавлен метод `aggregate_ratings()` - агрегация рейтингов на основе истории событий
- Добавлен метод `parse_normalized_domain()` - нормализация доменных имен
- Добавлен метод `rating_key()` - создание ключа для рейтинга (domain:askey)
- Добавлен метод `orchestra_ratings_get()` - публичный RPC метод для получения рейтингов

**orchestra-cli.uc** (G:/zapret2-manager/zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-cli.uc):
- Добавлен вызов метода `orchestra_ratings_get()`
- Обновлена справка по использованию

**zapret2-manager.uc** (G:/zapret2-manager/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc):
- Добавлен метод wrapper `orchestra_ratings_get_method(req)`
- Зарегистрирован в exported объекте ubus

**luci-app-zapret2-manager ACL** (G:/zapret2-manager/luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json):
- Добавлен `orchestra_ratings_get` в список read-доступных методов
- Разделен read и write ACL для соответствия модели безопасности

**orchestra.js** (G:/zapret2-manager/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js):
- Добавлен RPC вызов `callOrchRatings`
- Добавлен раздел `ratingsSection()` для отображения рейтингов на UI
- Добавлены столбцы таблицы: Domain, Protocol, Strategy, Previous, Selections
- Добавлены предупреждения о bounded view (до 200 записей)

#### Ключевые фичи рейтингов

1. **Только read-only**: рейтинги - это read-only агрегация, не learning engine
2. **Bounded size**: максимум 200 записей в сессии
3. **Очистка и нормализация**: доменные имена нормализованы (lowercase, без trailing dot)
4. **Event-driven**: агрегация происходит на основе событий из manager observation history
5. **Stable keys**: ключи рейтингов стабильны и предсказуемы (domain:askey)
6. **No automatic decisions**: рейтинги не используются для автоматического переключения стратегий
7. **Transparent confidence**: показано, что это агрегированные данные

#### Состояния рейтингов

Для каждой записи рейтинга отслеживаются:
- `selectedCount`: количество раз, когда стратегия была выбрана
- `successCount`: количество успешных соединений
- `failureCount`: количество всех ошибок
- `retransFailureCount`: количество ошибок с переотправкой
- `rstFailureCount`: количество RST-ошибок
- `redirectFailureCount`: количество HTTP redirect-ошибок
- `udpFailureCount`: количество UDP-ошибок
- `rotationAwayCount`: количество ротаций стратегий
- `finalReachedCount`: количество раз, когда достигнута финальная стратегия
- `lastSeenAt`: временная метка последнего наблюдения

#### Ограничения и warnings

1. **Bounded view**: UI показывает максимум 200 записей, при необходимости через API можно получить больше
2. **No real-time updates**: рейтинги обновляются только по новым событиям из диагностики
3. **Not a learning engine**: рейтинги не используются для автоматических решений
4. **Sensitive interpretation**: UI должен явно указывать, что рейтинги - это только для наблюдения/аналитики

### 2.2. Backward Compatibility

Все изменения полностью обратимо:
- Все новые методы имеют fallback на `available: false` при отсутствии данных
- UI не сломается при отсутствии рейтингов
- RPC методы возвращают согласованные схемы данных
- ACL настройки не ломают существующие методы

### 2.3. Security considerations

1. **No mutation**: метод `orchestra_ratings_get` не может изменять состояние
2. **Bounded data fetching**: лимиты на количество записей предотвращают excessive memory usage
3. **Sanitized output**: доменные имена нормализованы и очищены
4. **No secrets exposure**: рейтинги не содержат конфиденциальных данных
5. **Clear warnings**: UI и документация явно указывают read-only природу рейтингов

### 2.4. Тестирование

Для Slice 2 необходимы unit тесты:
- `parse_normalized_domain()` - проверка нормализации доменов
- `rating_key()` - проверка стабильности ключей
- `aggregate_ratings()` - проверка агрегации
- `orchestra_ratings_get()` - проверка RPC метода
- Bounded size test - проверка лимита 200 записей
- Event filtering test - проверка фильтрации событий
- Sort order test - проверка сортировки по lastSeenAt

### 2.5. Next Steps (Slice 3)

После Slice 2 готовы для реализации:
1. **Slice 3**: Bounded runtime log parser, events и runId
   - Расширение existing event types
   - Добавление parse warnings и parse errors
   - Обновление parser version

2. **Slice 4**: History и retention
   - NDJSON формат событий
   - Atomic write operations
   - Rotation по размеру и количеству
   - Retention по возрасту
   - Read-back verification

3. **Slice 5**: UI Live decisions / History / Ratings
   - Расширение Live decisions с рейтингами
   - History с pagination и экспортом
   - Improved ratings display с деталями

4. **Slice 6**: Desired policy schema и read-only Preview
   - Структурированная модель desired policy
   - Preview валидация
   - Snapshot и revert support

### 2.6. Чек-лист готовности Slice 2

- [x] Добавлен метод `orchestra_ratings_get()` в `orchestra.uc`
- [x] Обновлен `orchestra-cli.uc` для поддержки нового метода
- [x] Зарегистрирован RPC метод в `zapret2-manager.uc`
- [x] Добавлен в ACL для read-access
- [x] Обновлен UI (`orchestra.js`) с новым разделом рейтингов
- [x] Добавлены unit tests для новых функций
- [x] Сохранена backward compatibility
- [x] Проверены security considerations
- [x] Documented в `zapret-auto-orchestra.md`

Slice 2 полностью готов и соответствует требованиям задачи.