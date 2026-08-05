# Управление поставщиками движка zapret2

## Разделение manager и engine

`zapret2-manager` и `luci-app-zapret2-manager` — управляющий слой. Пакет
`zapret2` — отдельный runtime-движок. Backend больше не имеет жёсткой
зависимости от `zapret2`, поэтому manager, Maintenance, backups, diagnostics и
installer работают в поддерживаемом состоянии `engine_missing`.

Manager никогда не устанавливает `luci-app-zapret2`. Единственный интерфейс —
`luci-app-zapret2-manager`.

## Почему одновременно возможен только один поставщик

Remittor и 1andrevich публикуют один package name (`zapret2`) и используют
общие пути `/opt/zapret2`, `/etc/config/zapret2` и `/etc/init.d/zapret2`.
Переключение — транзакционная замена одного package, а не параллельная
установка двух вариантов.

## Provider contract

Адаптеры находятся в `providers/remittor.uc` и `providers/andrevich.uc` и
реализуют единый контракт:

- `id`, `label`;
- `metadata()`;
- `resolveLatest(architecture, channel)`;
- `resolveAsset(version, architecture)`;
- `verifyMetadata(candidate)`;
- `detectInstalled(packageMetadata, files, savedState)`.

Frontend не читает GitHub API и release index. Backend определяет APK
архитектуру через `apk --print-arch`, получает metadata по точному allowlist и
создаёт нормализованный candidate.

### 1andrevich

Используются только опубликованные stable GitHub Releases репозитория
`1andrevich/zapret2-openwrt`. Выбирается точный asset
`zapret2_<architecture>.apk`; draft, prerelease, IPK и
`luci-app-zapret2.apk` игнорируются. Первоначально compatibility allowlist
содержит `v1.0.3`. Public key принимается только с закреплённым SHA-256
fingerprint.

### Remittor

Используется официальный architecture-specific release index из ветки
`gh-pages`. Скачивается release ZIP, из которого извлекается единственный
engine APK `zapret2-*.apk`; upstream updater не запускается. Любой
`luci-app-zapret2*.apk` в архиве блокирует операцию. Первоначально
compatibility allowlist содержит `v0.9.20260307`.

Remittor не публикует подтверждённый reusable public signing key. Поэтому
manager не использует небезопасный `--allow-untrusted`: inner APK должен пройти
`apk verify` с уже доверенным системным ключом. На чистом устройстве это может
вернуть `ESIGNATURE`; это безопасный отказ, а не повод отключать проверку.

## Provenance установленного пакета

Одного `apk info -e zapret2` недостаточно. Определение использует совокупность:

- package name/version/description;
- runtime version и upstream commit;
- provider marker в установленном runtime;
- наличие runtime-контракта;
- сохранённый manager state;
- SHA-256 APK, кэшированного после успешной установки manager.

`engine-provider.json` никогда не является единственным источником истины. Он
принимается только вместе с совпадающим package/runtime и digest. При
недостаточных или противоречивых данных возвращается `provider=unknown`.
Существующий Remittor `0.9.20260307-r3` определяется best effort без
переустановки; base version и суффикс `-rN` считаются одним upstream release.

## Проверка обновлений и check token

`engine_check_updates` проверяет metadata, asset name, размер, digest,
architecture и compatibility. Результат кэшируется на 600 секунд. Frontend
получает случайный 48-hex `checkToken`, но не получает доверенный download URL.
`engine_install` принимает только provider + неистёкший одноразовый token.
Произвольные URL, version, filename, digest и shell input не принимаются.

Сравнение установленного package version выполняет `apk version -t`, а не
лексикографическое сравнение. Новая, но не внесённая в compatibility allowlist
версия отображается как доступная и несовместимая; установка блокируется.

## Async jobs

Install/update/switch/remove возвращают operation немедленно. Состояние хранится
в `/tmp/zapret2-manager/engine-operations` и переживает перерисовку LuCI.
Frontend опрашивает `engine_operation_status`.

Фазы: `queued`, `preflight`, `backup`, `stopping`, `downloading`, `verifying`,
`installing`, `restoring`, `starting`, `postflight`, `completed`, `failed`,
`rolling_back`, `rolled_back`.

`flock` запрещает параллельные engine-операции. Coordinator также блокирует
конфликты со strategy apply/rollback, Orchestra, backup restore и активными
runtime jobs. Отмена разрешена только до начала package mutation.

## Backup, установка и rollback

Перед заменой сохраняются package version/provenance и пользовательские данные:

- `/opt/zapret2/config`;
- `/etc/config/zapret2`;
- `/opt/zapret2/ipset`;
- `/opt/zapret2/init.d/openwrt/custom.d`;
- `/etc/zapret2-manager/lists`;
- provider state;
- предыдущий APK, полученный из verified manager cache или `apk fetch`.

Download проходит HTTPS allowlist, timeout, лимит размера и SHA-256. До
установки проверяются package name, version (base или base `-rN`), architecture,
native APK signature и provider metadata. Запрещены `curl | sh`,
`--allow-untrusted`, `--force-overwrite` и `--force-non-repository`.
`--allow-downgrade` используется только для уже аутентифицированного локального
APK при switch/rollback, где возврат к меньшей версии является явной частью
транзакции.

Postflight проверяет executable `nfqws2`, version output, config/init paths,
нужные init commands, запуск службы, ограниченное число процессов, nft table,
NFQUEUE 300, status collector и сохранность manager packages. Provider state
записывается только после успешного postflight.

При ошибке после mutation worker возвращает предыдущий verified APK,
конфигурацию и provider state, запускает старую версию и повторяет postflight.
`rolled_back` публикуется только после успешной проверки. При первой установке
нерабочий package удаляется и состояние возвращается в `engine_missing`.

## Удаление

Удаление по умолчанию сохраняет конфигурацию и списки, останавливает runtime и
выполняет только `apk del zapret2`. После операции проверяется, что
`zapret2-manager` и `luci-app-zapret2-manager` остались установленными.
Provider state очищается, UI переходит в `engine_missing`.

## Ubus и ACL

Object: `zapret2-manager-engine`.

Read ACL: `engine_providers`, `engine_status`, `engine_check_updates`,
`engine_operation_status`.

Write ACL: `engine_install`, `engine_remove`, `engine_operation_cancel`.

Все привилегированные действия идут LuCI → ACL → ubus → backend; browser не
запускает shell и не использует raw `fs.exec`.

## Troubleshooting

- `EARCH`: нет точного APK/ZIP для `apk --print-arch`.
- `ENETWORK`: metadata или asset не удалось получить; это не означает, что
  установлена последняя версия.
- `EMETADATA`, `ESHA256`, `ESIZE`: release metadata/asset не прошли проверку.
- `EINCOMPATIBLE`: версия опубликована, но не подтверждена текущим manager.
- `ESIGNATURE`: APK не подписан закреплённым/системным доверенным ключом.
- `EROLLBACK_UNAVAILABLE`: предыдущий verified APK нельзя сохранить; mutation
  не начинается.
- `EPOSTFLIGHT`: runtime не соответствует контракту; смотреть rollback block и
  operation log.
- `provider=unknown`: пакет существует, но provenance недостаточно надёжен;
  повторно устанавливать его автоматически нельзя.

## Router acceptance

Разрушительные проверки выполняются только в отдельном явном режиме на
OpenWrt APK target: detect existing Remittor, check обоих provider, switch в
1andrevich `v1.0.3` и обратно, remove/reinstall, reboot/autostart и bad-digest
rollback. Дополнительно нужно подтвердить target semantics `apk adbdump`,
`apk index`, `apk fetch --output`, `apk --keys-dir`, `flock -n 9` и
`--allow-downgrade`.
