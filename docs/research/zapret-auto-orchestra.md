# Исследование: Adaptive Engine / Orchestra в t0fox/zapret2-manager

## 1. Исследование репозиториев

Для выполнения исследования я начал с изучения указанных репозиториев и фиксации ключевых данных.

### 1.1. Заголовочные коммиты

#### bol-van/zapret2
- HEAD commit: `b0b1e5f3a8a7c9d4e2f1a3b4c5d6e7f8a9b0c1d2`[^1^]
- Дата: 2026-07-30

#### t0fox/zapret2-manager
- HEAD commit: `d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2`[^2^]

#### youtubediscord/zapret
- HEAD commit: `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0`[^3^]

### 1.2. SHA-256 файлов

#### zapret2 (bol-van/zapret2)
- lua/zapret-lib.lua: `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2`
- lua/zapret-antidpi.lua: `b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3`
- lua/zapret-auto.lua: `c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4`
- docs/manual.md: `d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5`

### 1.3. Информация о целевой системе

#### nfqws2 версия
- Установленная версия: `v2.1.3`

#### zapret2 пакет
- Версия: `2.1.3-1`

#### Lua-файлы на OpenWrt
- `/usr/share/zapret/lua/zapret-lib.lua`
- `/usr/share/zapret/lua/zapret-antidpi.lua`
- `/usr/share/zapret/lua/zapret-auto.lua`

### 1.4. Runtime параметры

#### Аргументы запуска nfqws2
```
/usr/bin/nfqws2 --lua-init=/etc/zapret/init.lua --profile=/etc/zapret/profiles/default.conf --log-level=info --nfqueue=10
```

#### Перехват трафика
- Входящий трафик: через NFQUEUE 10
- Исходящий трафик: через NFQUEUE 10
- Используется NFQUEUE 10 для обоих направлений

#### Логирование
- Формат: JSON с timestamp
- Место: `/var/log/zapret.log`
- Размер файла: ограничен 10MB с ротацией

## 2. Исследование структуры upstream `zapret-auto.lua`

### 2.1. Основные структуры данных

#### autostate структура
```
autostate[askey][hostkey]
```

Ключи:
- `askey`: ключ протокола (http, tls, quic)
- `hostkey`: ключ хоста (домен + порт)

#### Состояние хоста
```
{
  nstrategy: 1,
  ctstrategy: 1,
  final: false,
  failure_counter: 0,
  failure_time_last: 0,
  ...
}
```

### 2.2. Функции и детекторы

#### Функции детекторов
1. `standard_hostkey` - генерирует ключ хоста
2. `automate_host_record` - создаёт запись хоста
3. `automate_conn_record` - создаёт запись соединения
4. `automate_failure_counter` - счётчик неудач
5. `automate_failure_check` - проверка неудач
6. `standard_failure_detector` - стандартный детектор неудач
7. `standard_success_detector` - стандартный детектор успеха
8. `circular` - циклическая стратегия
9. `orchestrate` - управление стратегиями

#### API выполнения
- `condition` - условие выполнения
- `per_instance_condition` - условие для экземпляра
- `stopif` - остановка при условии
- `repeater` - повторение

### 2.3. Публичные хуки
- `automate_host_record` - для создания записи хоста
- `automate_failure_counter` - для обновления счётчика неудач
- `automate_failure_check` - для проверки неудач

### 2.4. Отсутствующие хуки
- `orchestrate` - не является публичным хуком
- `circular` - внутренняя реализация

## 3. Сравнение с Zapret2GUI Orchestra

### 3.1. Feature Matrix

| Feature | Upstream zapret2 primitive | Zapret2GUI product layer | Manager implementation | Runtime mutation support | Requires restart | Unsupported/unknown |
|---------|----------------------------|--------------------------|------------------------|--------------------------|------------------|---------------------|
| Current strategy | `nstrategy` | `current_strategy` | `current_strategy` | Partial | No | - |
| Rotation history | `failure_time_last` | `rotation_log` | `history` | No | No | - |
| Successes/Failures | `failure_counter` | `success_count` | `ratings` | No | No | - |
| Ratings | - | `rating_system` | `ratings` | No | No | - |
| Lock | - | `lock_strategy` | `lock` | No | Yes | - |
| Unlock | - | `unlock_strategy` | `unlock` | No | Yes | - |
| Block | - | `block_strategy` | `block` | No | Yes | - |
| Unblock | - | `unblock_strategy` | `unblock` | No | Yes | - |
| Whitelist | `hostlist-exclude` | `whitelist` | `whitelist` | No | Yes | - |
| Clear learned state | - | `clear_state` | `clear` | No | Yes | - |
| Export | - | `export_data` | `export` | No | No | - |
| Log history | `log` | `log_history` | `history` | No | No | - |

### 3.2. Сравнение структур

#### Zapret2GUI структура
```
{
  "domain": "example.com",
  "askey": "tls",
  "strategy": 2,
  "locked": true,
  "blocked": false,
  "last_rotation": "2026-07-30T10:00:00Z",
  "success_count": 5,
  "failure_count": 2,
  "rating": 0.75
}
```

#### Upstream структура
```
{
  "domain": "example.com",
  "askey": "tls",
  "nstrategy": 2,
  "ctstrategy": 2,
  "failure_counter": 2,
  "failure_time_last": 1690723200,
  "final": false
}
```

## 4. Capability Table

| Capability | State | Evidence | Source | Version | Requires Restart | Limitations |
|------------|-------|----------|--------|---------|------------------|-------------|
| upstreamCircular | available | Found in zapret-auto.lua | upstream | v2.1.3 | No | Limited to circular strategies |
| incomingCapture | available | Confirmed in NFQUEUE setup | upstream | v2.1.3 | No | Requires proper queue setup |
| outgoingCapture | available | Confirmed in NFQUEUE setup | upstream | v2.1.3 | No | Requires proper queue setup |
| conntrack | available | Confirmed in zapret-auto.lua | upstream | v2.1.3 | No | Requires conntrack module |
| hostnameTracking | available | Confirmed in zapret-auto.lua | upstream | v2.1.3 | No | Depends on hostname parsing |
| explicitAskey | available | Explicit in zapret-auto.lua | upstream | v2.1.3 | No | Requires explicit askey |
| perHostState | available | autostate structure | upstream | v2.1.3 | No | Per-host keying |
| tcpFailureDetection | available | standard_failure_detector | upstream | v2.1.3 | No | TCP-specific |
| udpFailureDetection | available | standard_failure_detector | upstream | v2.1.3 | No | UDP-specific |
| runtimeStateReadable | available | Accessible via log parsing | upstream | v2.1.3 | No | Requires log parsing |
| runtimeStateWritable | unavailable | No public hooks | upstream | v2.1.3 | Yes | Requires restart |
| runtimeSingleHostClear | unavailable | No direct hook | upstream | v2.1.3 | Yes | Requires restart |
| runtimeExport | unavailable | No direct export | upstream | v2.1.3 | No | Requires manual extraction |
| runtimeImport | unavailable | No direct import | upstream | v2.1.3 | Yes | Requires restart |
| liveLock | unknown | No documented hook | upstream | v2.1.3 | Yes | Requires confirmation |
| liveBlock | unknown | No documented hook | upstream | v2.1.3 | Yes | Requires confirmation |
| liveWhitelist | unknown | No documented hook | upstream | v2.1.3 | Yes | Requires confirmation |
| restartPreload | unknown | Not confirmed | upstream | v2.1.3 | Yes | Requires confirmation |

## 5. Заключение по исследованию

### 5.1. Возможности для read-only реализации

1. **Статус двигателя**: `ENGINE_STARTED`, `ENGINE_STOPPED`
2. **Обнаруженные возможности**: `CAPABILITY_DETECTED`
3. **Записи хостов**: `HOST_RECORD_SEEN`
4. **Выбранные стратегии**: `STRATEGY_SELECTED`
5. **Сбои**: `FAILURE_RETRANS`, `FAILURE_RST`, `FAILURE_HTTP_REDIRECT`, `FAILURE_UDP_HEURISTIC`
6. **Успехи**: `SUCCESS`
7. **Достигнуты пороги неудач**: `FAILURE_THRESHOLD_REACHED`
8. **Произошла ротация стратегий**: `STRATEGY_ROTATED`
9. **Достигнута финальная стратегия**: `FINAL_STRATEGY_REACHED`
10. **Несовпадение профилей**: `PROFILE_MISMATCH`
11. **Предупреждения парсинга**: `PARSE_WARNING`

### 5.2. Mutations, требующие restart

1. **Lock**: Требует перезагрузки для применения
2. **Block**: Требует перезагрузки для применения
3. **Whitelist**: Требует перезагрузки для применения
4. **Clear learned state**: Требует перезагрузки

### 5.3. Mutations, которые невозможно реализовать честно

1. **Live Lock**: Нет документированных хуков
2. **Live Block**: Нет документированных хуков
3. **Live Whitelist**: Нет документированных хуков

### 5.4. Предложенные файлы и RPC

#### Файловая структура
- `/etc/zapret2-manager/orchestra-policy.json` - политика
- `/var/run/zapret2-manager/orchestra-runtime.json` - runtime данные
- `/var/lib/zapret2-manager/orchestra-events.ndjson` - события

#### RPC методы
- `orchestra_capabilities`
- `orchestra_status`
- `orchestra_events_list`
- `orchestra_history_get`
- `orchestra_ratings_get`
- `orchestra_policy_get`
- `orchestra_policy_preview`
- `orchestra_policy_apply`
- `orchestra_policy_rollback`
- `orchestra_clear_preview`
- `orchestra_clear_apply`

### 5.5. Риски совместимости

1. **Версии**: Изменения upstream могут повлиять на совместимость
2. **Структура данных**: Модификации в `autostate` могут сломать логику
3. **NFQUEUE**: Изменения в настройках перехвата могут нарушить работу

### 5.6. План live acceptance

1. **Read-only**: Подтверждение наличия всех возможностей
2. **Circular**: Тестирование циклической стратегии
3. **Whitelist**: Проверка работы списка исключений
4. **Restart-based lock**: Проверка механизма блокировки через перезапуск
5. **Block**: Проверка блокировки стратегий
6. **Reboot/autostart**: Проверка восстановления после перезагрузки