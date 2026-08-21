#!/bin/sh
# Transactional worker for the one official zapret2 embedded release source.
set -u
umask 077
ID="${1:-}"; CLI=/usr/libexec/zapret2-manager/engine-cli.uc
ROOT=/tmp/zapret2-manager/engine-operations; JOB="$ROOT/$ID.json"; WORK="$ROOT/$ID.work"; BACKUP="$WORK/backup"
LOCK=/tmp/zapret2-manager/engine-operation.lock; STATE=/etc/zapret2-manager/engine-state.json; CACHE=/etc/zapret2-manager/engine-cache
INIT=/etc/init.d/zapret2; CONFIG=/opt/zapret2/config; UCI=/etc/config/zapret2; BINARY=/opt/zapret2/nfq2/nfqws2; CANCEL="$ROOT/$ID.cancel"
PAUSE_FILE=/tmp/zapret2-manager/paused; PAUSED_BY_WORKER=0
ROLLBACK_REQUIRED=0; ROLLBACK_ATTEMPTED=0; ROLLBACK_VERIFIED=0; WAS_RUNNING=0; OLD_INSTALLED=0; OLD_TREE=; RESTORE_ERROR=
case "$ID" in eng-[0-9]*-[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) ;; *) exit 2;; esac
mkdir "$WORK" || exit 1; mkdir "$BACKUP" || exit 1; chmod 700 "$WORK" "$BACKUP"
pause_watchdog(){ if [ ! -e "$PAUSE_FILE" ]; then : >"$PAUSE_FILE"; PAUSED_BY_WORKER=1; fi; }
resume_watchdog(){ [ "$PAUSED_BY_WORKER" -eq 1 ] && rm -f "$PAUSE_FILE" || true; }
cleanup(){ resume_watchdog; rm -rf "$WORK" "$CANCEL"; }; trap cleanup EXIT HUP INT TERM
phase(){ /usr/bin/ucode "$CLI" phase "$ID" "$1" "$2" "$3" >/dev/null 2>&1 || true; }
value(){ jsonfilter -i "$JOB" -e "$1" 2>/dev/null | head -n 1; }
cancelled(){ [ -f "$CANCEL" ]; }; sha(){ sha256sum "$1" | awk '{print $1}'; }; size(){ wc -c <"$1" | tr -d ' '; }
postflight(){
 [ -x "$BINARY" ] && [ -x /opt/zapret2/ip2net/ip2net ] && [ -x /opt/zapret2/mdig/mdig ] && [ -d /opt/zapret2/common ] && [ -d /opt/zapret2/ipset ] && [ -d /opt/zapret2/lua ] && [ -r "$CONFIG" ] && [ -x "$INIT" ] || return 1
 NFQWS2_ENABLE=1; . "$CONFIG" 2>/dev/null || return 1
 "$BINARY" --version >"$WORK/version" 2>&1 && [ -s "$WORK/version" ] || return 1
 for command in start stop restart start_fw reload_ifsets list_table; do grep -R -Eq "(^|[[:space:]])${command}[[:space:]]*\(\)|extra_command[[:space:]]+['\"]?${command}" "$INIT" /opt/zapret2/init.d/openwrt 2>/dev/null || return 1; done
 "$INIT" start >/dev/null 2>&1 || return 1
 if [ "$NFQWS2_ENABLE" = "1" ]; then
  tries=0; while [ "$tries" -lt 12 ]; do pidof nfqws2 >/dev/null 2>&1 && break; sleep 1; tries=$((tries+1)); done
  pidof nfqws2 >/dev/null 2>&1 || return 1
  count="$(pidof nfqws2 2>/dev/null|wc -w|tr -d ' ')"; [ "${count:-0}" -ge 1 ] && [ "$count" -le 16 ] || return 1
  grep -Eq '^[[:space:]]*300[[:space:]]' /proc/net/netfilter/nfnetlink_queue 2>/dev/null || return 1
 else
  ! pidof nfqws2 >/dev/null 2>&1 || return 1
 fi
 nft list table inet zapret2 >/dev/null 2>&1 || return 1
 ! grep -q -- '--lua-desync=old' "$CONFIG" 2>/dev/null || return 1
 ! apk info -e zapret2 >/dev/null 2>&1 || return 1
 /usr/bin/ucode /usr/libexec/zapret2-manager/status.uc --no-print >/dev/null 2>&1 && [ -s /tmp/zapret2-manager/status.json ] || return 1
 apk info -e zapret2-manager >/dev/null 2>&1 && apk info -e luci-app-zapret2-manager >/dev/null 2>&1
}
restore_config(){
 [ -f "$BACKUP/opt-config/config" ] && { mkdir -p /opt/zapret2; cp -a "$BACKUP/opt-config/config" "$CONFIG" || { RESTORE_ERROR=config; return 1; }; }
 [ -f "$BACKUP/zapret2.uci" ] && { mkdir -p /etc/config; cp -a "$BACKUP/zapret2.uci" "$UCI" || { RESTORE_ERROR=uci; return 1; }; }
 [ -d "$BACKUP/custom.d" ] && { mkdir -p /opt/zapret2/init.d/openwrt/custom.d; cp -a "$BACKUP/custom.d/." /opt/zapret2/init.d/openwrt/custom.d/ || { RESTORE_ERROR=custom; return 1; }; }
 [ -d "$BACKUP/ipset" ] && { mkdir -p /opt/zapret2/ipset; cp -a "$BACKUP/ipset/." /opt/zapret2/ipset/ || { RESTORE_ERROR=ipset; return 1; }; }
 [ -d "$BACKUP/manager-lists" ] && { mkdir -p /etc/zapret2-manager/lists; cp -a "$BACKUP/manager-lists/." /etc/zapret2-manager/lists/ || { RESTORE_ERROR=lists; return 1; }; }
 [ -f "$CONFIG" ] || { cp -a /opt/zapret2/config.default "$CONFIG" || { RESTORE_ERROR=config-default; return 1; }; chmod 600 "$CONFIG" || return 1; }
 return 0
}
remove_legacy_package(){
 [ -e /lib/apk/db/installed ] && apk info -e zapret2 >/dev/null 2>&1 || return 0
 apk del --no-interactive zapret2 >/dev/null 2>&1 || return 1
 apk info -e zapret2 >/dev/null 2>&1 && return 1
 return 0
}
rollback(){
 ROLLBACK_ATTEMPTED=1; phase rolling_back 92 'Восстанавливается предыдущий engine payload и конфигурация.'
 [ -x "$INIT" ] && "$INIT" stop >/dev/null 2>&1 || true
 [ "$OLD_INSTALLED" -eq 1 ] && [ -n "$OLD_TREE" ] || return 1
 rm -rf /opt/zapret2; mkdir -p /opt/zapret2; chmod 755 /opt/zapret2 || return 1; cp -a "$OLD_TREE/." /opt/zapret2/ || return 1; chmod 755 /opt/zapret2 || return 1
 [ -f "$BACKUP/old-init" ] && cp -a "$BACKUP/old-init" "$INIT" && chmod 755 "$INIT" || true
 restore_config || return 1
 [ -f "$BACKUP/engine-state.json" ] && { mkdir -p /etc/zapret2-manager; cp -a "$BACKUP/engine-state.json" "$STATE" || return 1; } || rm -f "$STATE"
 postflight || return 1; [ "$WAS_RUNNING" -eq 1 ] || "$INIT" stop >/dev/null 2>&1 || true
 ROLLBACK_VERIFIED=1; phase rolled_back 100 'Откат выполнен и проверен.'
}
fail(){ code="$1"; message="$2"; [ "$ROLLBACK_REQUIRED" -eq 1 ] && rollback || true; /usr/bin/ucode "$CLI" failed "$ID" "$code" "$message" "$([ "$ROLLBACK_ATTEMPTED" -eq 1 ]&&printf 1||printf 0)" "$([ "$ROLLBACK_VERIFIED" -eq 1 ]&&printf 1||printf 0)" "$([ "$ROLLBACK_VERIFIED" -eq 1 ]&&printf 'Откат проверен.'||printf 'Откат не подтверждён.')" >/dev/null 2>&1 || true; exit 1; }
exec 9>"$LOCK"; flock -n 9 || fail EBUSY 'Другая engine-операция уже выполняется.'
[ -s "$JOB" ] || fail ENOENT 'Engine job не найдена.'
ACTION="$(value '@.action')"; PRESERVE="$(value '@.preserveConfig')"; ARTIFACT_KIND="$(value '@.candidate.artifactKind')"; ARTIFACT_SCHEMA="$(value '@.candidate.schema')"; ARCH="$(value '@.candidate.architecture')"; URL="$(value '@.candidate.downloadUrl')"; EXPECTED_SHA="$(value '@.candidate.sha256')"; EXPECTED_SIZE="$(value '@.candidate.size')"; EXPECTED_VERSION="$(value '@.candidate.version')"; CONTAINER="$(value '@.candidate.container')"; CHECKSUM_URL="$(value '@.candidate.checksumUrl')"; CHECKSUM_SHA="$(value '@.candidate.checksumSha256')"; CHECKSUM_NAME="$(value '@.candidate.checksumName')"
phase preflight 5 'Проверяется устройство и отсутствие конфликтов.'
command -v apk >/dev/null 2>&1 || fail EPKGMGR 'Поддерживается только APK package manager.'
if [ "$ACTION" != uninstall ]; then [ "$ARTIFACT_SCHEMA" = 'zapret2-manager.engine-artifact.v1' ] && [ "$ARTIFACT_KIND" = 'z2m-compatible-engine' ] || fail EENGINE_INTEGRATION_REQUIRED 'Доступна только предварительно собранная совместимая версия Z2M; vanilla bol-van release заблокирован.'; fi
TARGET_ARCH="$(. /etc/openwrt_release 2>/dev/null; printf '%s' "${DISTRIB_ARCH:-}")"
if [ "$ACTION" != uninstall ]; then [ "$CONTAINER" = tar.gz ] && [ -n "$ARCH" ] && [ "$TARGET_ARCH" = "$ARCH" ] || fail EARCH 'Архитектура target не совпадает с official embedded release.'; fi
[ "$(df -Pk /overlay 2>/dev/null|awk 'NR==2{print $4}')" -ge 8192 ] 2>/dev/null || fail ENOSPC 'Недостаточно места в overlay.'
[ "$(df -Pk /tmp 2>/dev/null|awk 'NR==2{print $4}')" -ge 16384 ] 2>/dev/null || fail ENOSPC 'Недостаточно места в /tmp.'
cancelled && fail ECANCELLED 'Операция отменена до изменения runtime.'
phase backup 12 'Создаётся snapshot текущего engine payload и пользовательской конфигурации.'
if apk info -e zapret2 >/dev/null 2>&1 || { [ -x "$BINARY" ] && [ -r "$CONFIG" ] && [ -x "$INIT" ]; }; then OLD_INSTALLED=1; fi
pidof nfqws2 >/dev/null 2>&1 && WAS_RUNNING=1
[ -f "$CONFIG" ] && { mkdir "$BACKUP/opt-config" || fail EBACKUP 'Не удалось создать backup config.'; cp -a "$CONFIG" "$BACKUP/opt-config/config"; }
[ -f "$UCI" ] && cp -a "$UCI" "$BACKUP/zapret2.uci"; [ -d /opt/zapret2/init.d/openwrt/custom.d ] && cp -a /opt/zapret2/init.d/openwrt/custom.d "$BACKUP/custom.d"; [ -d /opt/zapret2/ipset ] && cp -a /opt/zapret2/ipset "$BACKUP/ipset"; [ -d /etc/zapret2-manager/lists ] && cp -a /etc/zapret2-manager/lists "$BACKUP/manager-lists"; [ -f "$STATE" ] && cp -a "$STATE" "$BACKUP/engine-state.json"
if [ "$OLD_INSTALLED" -eq 1 ]; then mkdir "$BACKUP/old-tree" || fail EBACKUP 'Не удалось сохранить текущий embedded engine.'; cp -a /opt/zapret2/. "$BACKUP/old-tree/" || fail EBACKUP 'Не удалось сохранить текущий embedded engine.'; [ -f "$INIT" ] && cp -a "$INIT" "$BACKUP/old-init"; OLD_TREE="$BACKUP/old-tree"; fi
if [ "$ACTION" = uninstall ]; then
 ROLLBACK_REQUIRED="$OLD_INSTALLED"; phase stopping 55 'Служба zapret2 останавливается.'; [ -x "$INIT" ] && "$INIT" stop >/dev/null 2>&1 || true; phase installing 65 'Удаляется только engine package.'; remove_legacy_package || fail EREMOVE 'Не удалось удалить legacy engine package.'; [ "$PRESERVE" = true ] || { rm -rf /opt/zapret2 /etc/config/zapret2; }; /usr/bin/ucode "$CLI" clear-state >/dev/null 2>&1 || fail ESTATE 'Engine state не очищен.'; ROLLBACK_REQUIRED=0; printf '{"ok":true,"state":"engine_missing"}\n' >"$WORK/result.json"; /usr/bin/ucode "$CLI" complete "$ID" "$WORK/result.json" >/dev/null 2>&1 || true; exit 0
fi
case "$URL" in https://github.com/bol-van/zapret2/releases/download/v*/zapret2-v*-openwrt-embedded.tar.gz) ;; *) fail ESECURITY 'Download URL не входит в official allowlist.';; esac
printf '%s\n' "$EXPECTED_SHA" | grep -Eq '^[a-f0-9]{64}$' || fail EMETADATA 'Некорректный official digest.'
phase downloading 28 'Загружается проверенный official release asset.'; ASSET="$WORK/asset"; uclient-fetch -q -T 60 -O "$ASSET" "$URL" || fail ENETWORK 'Не удалось скачать official release asset.'
[ -s "$ASSET" ] && [ "$(size "$ASSET")" -eq "$EXPECTED_SIZE" ] 2>/dev/null || fail ESIZE 'Размер release asset не совпадает с catalog.'; [ "$(sha "$ASSET")" = "$EXPECTED_SHA" ] || fail ESHA256 'SHA-256 release asset не совпадает с catalog.'
case "$CHECKSUM_URL:$CHECKSUM_NAME" in https://github.com/bol-van/zapret2/releases/download/v*/sha256sum.txt:sha256sum.txt) ;; *) fail ESECURITY 'Checksum URL не входит в official allowlist.';; esac
printf '%s\n' "$CHECKSUM_SHA" | grep -Eq '^[a-f0-9]{64}$' || fail EMETADATA 'Checksum asset digest отсутствует.'
CHECKSUM="$WORK/sha256sum.txt"; uclient-fetch -q -T 30 -O "$CHECKSUM" "$CHECKSUM_URL" || fail ENETWORK 'Не удалось скачать checksum manifest.'; [ "$(sha "$CHECKSUM")" = "$CHECKSUM_SHA" ] || fail ESHA256 'Checksum manifest digest не совпадает.'
grep -Eq '^[a-f0-9]{64}[[:space:]]+zapret2-v[0-9A-Za-z._-]+/binaries/linux-arm64/nfqws2$' "$CHECKSUM" || fail ESHA256 'Checksum manifest не содержит linux-arm64 nfqws2.'
cancelled && fail ECANCELLED 'Операция отменена до остановки службы.'
pause_watchdog
phase verifying 45 'Проверяется official embedded payload.'; mkdir "$WORK/unpack" || fail EARCHIVE 'Не удалось создать каталог распаковки.'
if tar -tzf "$ASSET" | grep -Eq '(^/|(^|/)\.\.(\/|$))'; then fail ESECURITY 'Embedded archive содержит unsafe path.'; fi
tar -xzf "$ASSET" -C "$WORK/unpack" || fail EARCHIVE 'Embedded archive повреждён.'
ROOTDIR="$WORK/unpack/zapret2-v$EXPECTED_VERSION"; [ -d "$ROOTDIR" ] || fail EPACKAGE 'Embedded archive root не найден.'; ENGINE_STAGE="$WORK/engine-stage"; mkdir -p "$ENGINE_STAGE/nfq2" "$ENGINE_STAGE/ip2net" "$ENGINE_STAGE/mdig" "$ENGINE_STAGE/lua" "$ENGINE_STAGE/init.d/openwrt"
BINDIR="$ROOTDIR/binaries/linux-arm64"; [ -x "$BINDIR/nfqws2" ] || BINDIR="$ROOTDIR/nfq2"; [ -x "$BINDIR/nfqws2" ] || fail EPACKAGE 'Embedded archive не содержит nfqws2 для aarch64.'
RUNTIME_SHA="$(awk '$2 ~ /\/binaries\/linux-arm64\/nfqws2$/ {print $1; exit}' "$CHECKSUM")"; printf '%s\n' "$RUNTIME_SHA" | grep -Eq '^[a-f0-9]{64}$' || fail ESHA256 'Checksum manifest не содержит digest nfqws2.'; [ "$(sha "$BINDIR/nfqws2")" = "$RUNTIME_SHA" ] || fail ESHA256 'SHA-256 nfqws2 не совпадает с checksum manifest.'
cp -a "$ROOTDIR/blockcheck2.sh" "$ENGINE_STAGE/" || fail EPACKAGE 'Не удалось подготовить blockcheck2.'; cp -a "$ROOTDIR/blockcheck2.d" "$ENGINE_STAGE/" || fail EPACKAGE 'Не удалось подготовить blockcheck2 catalog.'; cp -a "$ROOTDIR/common" "$ENGINE_STAGE/" || fail EPACKAGE 'Не удалось подготовить common runtime.'; cp -a "$ROOTDIR/ipset" "$ENGINE_STAGE/" || fail EPACKAGE 'Не удалось подготовить ipset runtime.'; cp -a "$ROOTDIR/files" "$ENGINE_STAGE/" || fail EPACKAGE 'Не удалось подготовить fake packet data.'; cp -a "$ROOTDIR/config.default" "$ENGINE_STAGE/" || fail EPACKAGE 'Не удалось подготовить default config.'; cp -a "$BINDIR/nfqws2" "$ENGINE_STAGE/nfq2/nfqws2" || fail EPACKAGE 'Не удалось подготовить nfqws2.'; cp -a "$BINDIR/ip2net" "$ENGINE_STAGE/ip2net/ip2net" || fail EPACKAGE 'Не удалось подготовить ip2net.'; cp -a "$BINDIR/mdig" "$ENGINE_STAGE/mdig/mdig" || fail EPACKAGE 'Не удалось подготовить mdig.'; [ -d "$ROOTDIR/lua" ] && for lua in "$ROOTDIR"/lua/*.lua.gz; do [ -f "$lua" ] || continue; gzip -dc "$lua" >"$ENGINE_STAGE/lua/$(basename "$lua" .gz)" || fail EPACKAGE 'Не удалось распаковать Lua module.'; done; [ -d "$ROOTDIR/init.d/openwrt" ] && cp -a "$ROOTDIR/init.d/openwrt/." "$ENGINE_STAGE/init.d/openwrt/" || true
ROLLBACK_REQUIRED=1; phase stopping 52 'Служба zapret2 останавливается.'; [ -x "$INIT" ] && "$INIT" stop >/dev/null 2>&1 || [ "$OLD_INSTALLED" -eq 0 ] || fail ESTOP 'Не удалось остановить zapret2.'
phase installing 65 'Удаляется legacy package и устанавливается полный official engine payload.'; remove_legacy_package || fail EREMOVE 'Legacy package ownership не удалось снять.'; rm -rf /opt/zapret2; mkdir -p /opt/zapret2; chmod 755 /opt/zapret2 || fail EINSTALL 'Не удалось установить mode /opt/zapret2.'; cp -a "$ENGINE_STAGE/." /opt/zapret2/ || fail EINSTALL 'Official embedded engine files не установлены.'; chmod 755 /opt/zapret2 || fail EINSTALL 'Не удалось закрепить mode /opt/zapret2.'; [ -x "$ENGINE_STAGE/init.d/openwrt/zapret2" ] && cp -a "$ENGINE_STAGE/init.d/openwrt/zapret2" "$INIT" && chmod 755 "$INIT" || true; [ -f "$ENGINE_STAGE/init.d/openwrt/90-zapret2" ] && cp -a "$ENGINE_STAGE/init.d/openwrt/90-zapret2" /etc/hotplug.d/iface/90-zapret2 || true; [ -f "$ENGINE_STAGE/init.d/openwrt/firewall.zapret2" ] && cp -a "$ENGINE_STAGE/init.d/openwrt/firewall.zapret2" /etc/firewall.zapret2 || true
phase restoring 75 'Восстанавливаются конфигурация и пользовательские списки.'; restore_config || fail ERESTORE "Не удалось восстановить пользовательские данные: ${RESTORE_ERROR:-unknown}."
phase starting 82 'Запускается новый official runtime.'; phase postflight 88 'Проверяется runtime, NFQUEUE и nft.'; postflight || fail EPOSTFLIGHT 'Новый engine не прошёл postflight.'
mkdir -p "$CACHE"; chmod 700 "$CACHE"; cp -a "$ASSET" "$CACHE/current.tar.gz"; sha "$CACHE/current.tar.gz" >"$CACHE/current.sha256"
/usr/bin/ucode "$CLI" commit-state "$ID" >/dev/null 2>&1 || fail ESTATE 'Engine state не подтверждён.'
[ "$WAS_RUNNING" -eq 1 ] || [ "$OLD_INSTALLED" -eq 0 ] || "$INIT" stop >/dev/null 2>&1 || true
ROLLBACK_REQUIRED=0; printf '{"ok":true,"upstream":"bol-van/zapret2","installedRelease":"v%s"}\n' "$EXPECTED_VERSION" >"$WORK/result.json"; /usr/bin/ucode "$CLI" complete "$ID" "$WORK/result.json" >/dev/null 2>&1 || true
