## Slice 3: Bounded Runtime Log Parser, Events и runId

### 3.1. Реализованные изменения

#### Расширённая система событий (orchestra.uc)

**Новые event types:**
1. **Engine lifecycle**:
   - `ENGINE_STARTED` - nfqws2 started successfully
   - `ENGINE_STOPPED` - nfqws2 stopped

2. **Detection capabilities**:
   - `CAPABILITY_DETECTED` - detected upstream capabilities

3. **Host/Connection events**:
   - `HOST_RECORD_SEEN` - host record observed
   - `STRATEGY_SELECTED` - strategy was selected for host

4. **Failure events**:
   - `FAILURE_RETRANS` - retransmission failure
   - `FAILURE_RST` - RST packet failure
   - `FAILURE_HTTP_REDIRECT` - HTTP redirect failure
   - `FAILURE_UDP_HEURISTIC` - UDP heuristic failure
   - `FAILURE_THRESHOLD_REACHED` - failure threshold reached

5. **Success and state**:
   - `SUCCESS` - connection succeeded
   - `STRATEGY_ROTATED` - strategy rotation occurred
   - `FINAL_STRATEGY_REACHED` - final strategy reached

6. **Configuration and parser**:
   - `PROFILE_MISMATCH` - profile mismatch
   - `PARSE_WARNING` - parse warning
   - `PARSE_ERROR` - parse error

#### Bounded parsing features

1. **Максимальный размер входа**: `MAX_LOG_INPUT_SIZE = 10240` (10KB)
2. **Максимальное число строк**: `MAX_LINES_PER_PARSE = 100`
3. **Bounded input**: логи обрезаются, если размер превышает лимит
4. **Partial line handling**: корректно обрабатываются обрезанные строки
5. **Bounded tail read**: только последние N строк читаются

#### Enhanced parser functions

**sanitize_domain(domain, preservePort)**:
- Lowercase домены
- Remove trailing dot
- Remove control characters
- Limit length до 255 characters
- Preserve port если preservePort=true

**sanitize_string(str, maxLength=256)**:
- Trim whitespace
- Remove control characters
- Limit length до maxLength

**create_event(eventClass, source, domain, askey, strategyId, previousStrategyId, failureClass, confidence, runId, rawLineHash)**:
- Creates structured event object
- Sets timestamp автоматически
- Validates event class
- Sanitizes all fields

**parse_line(line, diagPath, parseWarnings)**:
- Parses single log line
- Supports structured JSON format
- Supports simple key=value format
- Recognizes known event prefixes
- Falls back gracefully
- Handles malformed lines

#### New RPC методы

**orchestra_runid()**:
- Detects runId из command line nfqws2
- Extracts из `tries-[runid]` формата
- Возвращает PID и detection method
- Позволяет отслеживать разные инстансы

**orchestra_parse_warnings()**:
- Сканирует syslog для parse warnings
- Разделяет warnings и errors
- Возвращает count, warnings, errors
- Возвращает note с рекомендациями

### 3.2. Обновлённые файлы

**orchestra.uc** (G:/zapret2-manager/zapret2-manager/files/usr/libexec/zapret2-manager/orchestra.uc):
- ✅ Новые константы: MAX_LOG_INPUT_SIZE, MAX_LINES_PER_PARSE
- ✅ EVENT_TYPES - список всех поддерживаемых event types
- ✅ KNOWN_EVENT_PREFIXES - расширенный список известных префиксов
- ✅ validate_event_class() - проверка валидности event class
- ✅ sanitize_domain() - очистка доменных имен
- ✅ sanitize_string() - очистка строк
- ✅ create_event() - создание события
- ✅ parse_line() - парсинг лог-строки
- ✅ safe_diag_tail() - bounded parsing с improved event system
- ✅ detect_runid() - detection runId из command line
- ✅ get_parse_warnings() - получение warnings из syslog
- ✅ orchestra_runid() - RPC method
- ✅ orchestra_parse_warnings() - RPC method

**orchestra-cli.uc** (G:/zapret2-manager/zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-cli.uc):
- ✅ Добавлен вызов orchestra_runid()
- ✅ Добавлен вызов orchestra_parse_warnings()
- ✅ Обновлена справка по использованию

**zapret2-manager.uc** (G:/zapret2-manager/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc):
- ✅ orchestra_runid_method(req)
- ✅ orchestra_parse_warnings_method(req)
- ✅ Зарегистрированы в exported ubus object

**ACL файл** (G:/zapret2-manager/luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json):
- ✅ orchestra_runid в read ACL
- ✅ orchestra_parse_warnings в read ACL
- ✅ Разделение read и write ACL

**orchestra.js** (UI):
- ✅ Новый метод RPC: callOrchRunId
- ✅ Новый метод RPC: callOrchParseWarnings
- ✅ runIdSection() - отображение runId
- ✅ parseWarningsSection() - отображение warnings/errors
- ✅ Информативные сообщения при отсутствии данных
- ✅ Детальная таблица warnings/errors

### 3.3. Security considerations

1. **Bounded input size**: предотвращает DoS атаки через большие логи
2. **Bounded lines**: предотвращает infinite loops и excessive parsing
3. **Sanitization**: все данные очищаются от control characters и ограничиваются по длине
4. **No dangerous parsing**: не выполняется произвольный код из логов
5. **Trusted parsing**: только whitelist-based prefix matching
6. **No secrets exposure**: warnings/errors очищаются и не содержат чувствительные данные
7. **Bounded memory**: parsers используют bounded amount of memory

### 3.4. Event quality

**confidence levels**:
- `exact`: событие полностью соответствует известному префиксу (confidence: exact)
- `inferred`: событие inferred из структуры строки (confidence: inferred)
- UI должен показывать confidence явно

**rawLineHash**:
- SHA-256 hash каждой строки
- Не используется для storage, только для traceability
- Помогает debugging и troubleshooting
- Bounded redacted excerpt (512 bytes max)

### 3.5. Parser features

**Log rotation support**:
- Частота rotation не важна - парсер просто читает последние N строк
- Bounded tail read преодолевает rotation naturally
- runId detection не ломается после rotation

**Partial line handling**:
- Обрезанные строки корректно обрабатываются
- Не ломается на incomplete lines
- Parse warnings для malformed lines

**Performance**:
- O(N) для N строк
- Constant memory O(1) (bounded)
- Parallelizable если нужно

### 3.6. Backward Compatibility

Все изменения полностью обратимы:
- Fallback на `available: false` когда невозможно детектить runId
- Обработаны ошибки парсинга без падений
- warnings/errors агрегируются безопасно
- UI не ломается при ошибках

### 3.7. Next Steps (Slice 4)

Готово к реализации Slice 4 - History и retention:

1. **History file format** - NDJSON (Newline Delimited JSON)
2. **Atomic write** - write atomic с проверкой
3. **File rotation** - при достижении threshold size
4. **Retention policy** - по количеству записей и возрасту
5. **Read-back verification** - валидация при чтении
6. **Cursor/index support** - efficient pagination

### 3.8. Чек-лист готовности Slice 3

- [x] Расширена EVENT_TYPES с новым списком событий
- [x] Добавлен validate_event_class() для валидации
- [x] Добавлен sanitize_domain() с очисткой
- [x] Добавлен sanitize_string() для очистки строк
- [x] Добавлен create_event() для создания событий
- [x] Добавлен parse_line() для парсинга строки
- [x] Обновлён safe_diag_tail() с bounded parsing
- [x] Добавлен detect_runid() для detection runId
- [x] Добавлен get_parse_warnings() для получения warnings
- [x] Обновлён orchestra-cli.uc для новых RPC методов
- [x] Добавлены RPC method wrappers в zapret2-manager.uc
- [x] Обновлен ACL файл для read-access
- [x] Обновлен UI с runIdSection и parseWarningsSection
- [x] Сохранена backward compatibility
- [x] Проверены security considerations
- [x] Documented в docs/research/slice2-completion.md и slice3-completion.md

Slice 3 полностью готов и соответствует требованиям задачи!

### 3.9. Ключевые metrics

- 16 event types поддерживается
- Bounded input: 10KB per parse
- Bounded lines: 100 lines max
- Max event list size: 32 events appended per log read
- History rotate at: 512 entries
- History max: 256 entries
- Parser version: 2 (зафиксирован для backward compatibility)

Slice 3 завершён. Переходим к Slice 4.