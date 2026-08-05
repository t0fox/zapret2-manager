#!/bin/sh
# Transactional root-only worker for zapret2 install/update/switch/remove.
set -u
umask 077
ID="${1:-}"; CLI=/usr/libexec/zapret2-manager/engine-cli.uc
ROOT=/tmp/zapret2-manager/engine-operations; JOB="$ROOT/$ID.json"; WORK="$ROOT/$ID.work"; BACKUP="$WORK/backup"
LOCK=/tmp/zapret2-manager/engine-operation.lock; STATE=/etc/zapret2-manager/engine-provider.json; CACHE=/etc/zapret2-manager/engine-cache
INIT=/etc/init.d/zapret2; CONFIG=/opt/zapret2/config; UCI=/etc/config/zapret2; BINARY=/opt/zapret2/nfq2/nfqws2; CANCEL="$ROOT/$ID.cancel"
ROLLBACK_REQUIRED=0; ROLLBACK_ATTEMPTED=0; ROLLBACK_VERIFIED=0; WAS_RUNNING=0; OLD_INSTALLED=0; OLD_VERSION=; OLD_APK=; OLD_KEYDIR=
case "$ID" in eng-[0-9]*-[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) ;; *) exit 2;; esac
mkdir -p "$WORK" "$BACKUP"; chmod 700 "$WORK" "$BACKUP"
cleanup(){ rm -rf "$WORK" "$CANCEL"; }; trap cleanup EXIT HUP INT TERM
phase(){ /usr/bin/ucode "$CLI" phase "$ID" "$1" "$2" "$3" >/dev/null 2>&1 || true; }
value(){ jsonfilter -i "$JOB" -e "$1" 2>/dev/null | head -n 1; }
cancelled(){ [ -f "$CANCEL" ]; }; sha(){ sha256sum "$1" | awk '{print $1}'; }; size(){ wc -c <"$1" | tr -d ' '; }
postflight(){
 [ -x "$BINARY" ] && [ -r "$CONFIG" ] && [ -r "$UCI" ] && [ -x "$INIT" ] || return 1
 "$BINARY" --version >"$WORK/version" 2>&1 && [ -s "$WORK/version" ] || return 1
 for command in start stop restart start_fw reload_ifsets list_table; do grep -R -Eq "(^|[[:space:]])${command}[[:space:]]*\\(\\)|extra_command[[:space:]]+['\"]?${command}" "$INIT" /opt/zapret2/init.d/openwrt 2>/dev/null || return 1; done
 "$INIT" start >/dev/null 2>&1 || return 1
 tries=0; while [ "$tries" -lt 12 ]; do pidof nfqws2 >/dev/null 2>&1 && break; sleep 1; tries=$((tries+1)); done
 pidof nfqws2 >/dev/null 2>&1 || return 1
 count="$(pidof nfqws2 2>/dev/null|wc -w|tr -d ' ')"; [ "${count:-0}" -ge 1 ] && [ "$count" -le 16 ] || return 1
 nft list table inet zapret2 >/dev/null 2>&1 || return 1
 grep -Eq '^300[[:space:]]' /proc/net/netfilter/nfnetlink_queue 2>/dev/null || return 1
 ! grep -q -- '--lua-desync=old' "$CONFIG" 2>/dev/null || return 1
 /usr/bin/ucode /usr/libexec/zapret2-manager/status.uc --no-print >/dev/null 2>&1 && [ -s /tmp/zapret2-manager/status.json ] || return 1
 apk info -e zapret2 >/dev/null 2>&1 && apk info -e zapret2-manager >/dev/null 2>&1 && apk info -e luci-app-zapret2-manager >/dev/null 2>&1
}
restore_config(){
 [ -d "$BACKUP/opt-config" ] && { mkdir -p /opt/zapret2; cp -a "$BACKUP/opt-config/." /opt/zapret2/ || return 1; }
 [ -f "$BACKUP/zapret2.uci" ] && { mkdir -p /etc/config; cp -a "$BACKUP/zapret2.uci" "$UCI" || return 1; }
 [ -d "$BACKUP/custom.d" ] && { mkdir -p /opt/zapret2/init.d/openwrt/custom.d; cp -a "$BACKUP/custom.d/." /opt/zapret2/init.d/openwrt/custom.d/ || return 1; }
 [ -d "$BACKUP/ipset" ] && { mkdir -p /opt/zapret2/ipset; cp -a "$BACKUP/ipset/." /opt/zapret2/ipset/ || return 1; }
 [ -d "$BACKUP/manager-lists" ] && { mkdir -p /etc/zapret2-manager/lists; cp -a "$BACKUP/manager-lists/." /etc/zapret2-manager/lists/ || return 1; }
}
rollback(){
 ROLLBACK_ATTEMPTED=1; phase rolling_back 92 'Восстанавливается предыдущий пакет и конфигурация.'
 [ -x "$INIT" ] && "$INIT" stop >/dev/null 2>&1 || true
 if [ "$OLD_INSTALLED" -eq 1 ]; then
  [ -f "$OLD_APK" ] || return 1
  if [ -n "$OLD_KEYDIR" ] && [ -d "$OLD_KEYDIR" ]; then apk --keys-dir "$OLD_KEYDIR" add --no-interactive --allow-downgrade "$OLD_APK" >/dev/null 2>&1 || return 1; else apk add --no-interactive --allow-downgrade "$OLD_APK" >/dev/null 2>&1 || return 1; fi
  restore_config || return 1
  if [ -f "$BACKUP/provider-state.json" ]; then mkdir -p /etc/zapret2-manager; cp -a "$BACKUP/provider-state.json" "$STATE" || return 1; else rm -f "$STATE"; fi
  postflight || return 1; [ "$WAS_RUNNING" -eq 1 ] || "$INIT" stop >/dev/null 2>&1 || true
 else
  apk del --no-interactive zapret2 >/dev/null 2>&1 || true; restore_config || return 1; rm -f "$STATE"
  ! apk info -e zapret2 >/dev/null 2>&1 && apk info -e zapret2-manager >/dev/null 2>&1 && apk info -e luci-app-zapret2-manager >/dev/null 2>&1 || return 1
 fi
 ROLLBACK_VERIFIED=1; phase rolled_back 100 'Откат выполнен и проверен.'
}
fail(){ code="$1"; message="$2"; [ "$ROLLBACK_REQUIRED" -eq 1 ] && rollback || true; /usr/bin/ucode "$CLI" failed "$ID" "$code" "$message" "$ROLLBACK_ATTEMPTED" "$ROLLBACK_VERIFIED" "$([ "$ROLLBACK_VERIFIED" -eq 1 ]&&printf 'Откат проверен.'||printf 'Откат не подтверждён.')" >/dev/null 2>&1 || true; exit 1; }
exec 9>"$LOCK"; flock -n 9 || fail EBUSY 'Другая engine-операция уже выполняется.'
[ -s "$JOB" ] || fail ENOENT 'Engine job не найдена.'
ACTION="$(value '@.action')"; PROVIDER="$(value '@.provider')"; PRESERVE="$(value '@.preserveConfig')"; ARCH="$(value '@.candidate.architecture')"; URL="$(value '@.candidate.downloadUrl')"; EXPECTED_SHA="$(value '@.candidate.sha256')"; EXPECTED_SIZE="$(value '@.candidate.size')"; EXPECTED_VERSION="$(value '@.candidate.packageVersion')"; CONTAINER="$(value '@.candidate.container')"; KEY_URL="$(value '@.candidate.keyUrl')"; KEY_SHA="$(value '@.candidate.keySha256')"
phase preflight 5 'Проверяется устройство и отсутствие конфликтов.'
command -v apk >/dev/null 2>&1 || fail EPKGMGR 'Поддерживается только APK package manager.'
DEVICE_ARCH="$(apk --print-arch 2>/dev/null||true)"
if [ "$ACTION" != remove ]; then [ -n "$ARCH" ] && [ "$DEVICE_ARCH" = "$ARCH" ] || fail EARCH 'Архитектура APK не совпадает с устройством.'; fi
[ "$(df -Pk /overlay 2>/dev/null|awk 'NR==2{print $4}')" -ge 8192 ] 2>/dev/null || fail ENOSPC 'Недостаточно места в overlay.'
[ "$(df -Pk /tmp 2>/dev/null|awk 'NR==2{print $4}')" -ge 16384 ] 2>/dev/null || fail ENOSPC 'Недостаточно места в /tmp.'
cancelled && fail ECANCELLED 'Операция отменена до изменения runtime.'
phase backup 12 'Создаётся snapshot пакета и пользовательской конфигурации.'
if apk info -e zapret2 >/dev/null 2>&1; then OLD_INSTALLED=1; OLD_VERSION="$(apk info -v zapret2 2>/dev/null|head -n1|sed 's/^zapret2-//')"; fi
pidof nfqws2 >/dev/null 2>&1 && WAS_RUNNING=1
[ -f "$CONFIG" ] && { mkdir -p "$BACKUP/opt-config"; cp -a "$CONFIG" "$BACKUP/opt-config/config"; }
[ -f "$UCI" ] && cp -a "$UCI" "$BACKUP/zapret2.uci"; [ -d /opt/zapret2/init.d/openwrt/custom.d ] && cp -a /opt/zapret2/init.d/openwrt/custom.d "$BACKUP/custom.d"; [ -d /opt/zapret2/ipset ] && cp -a /opt/zapret2/ipset "$BACKUP/ipset"; [ -d /etc/zapret2-manager/lists ] && cp -a /etc/zapret2-manager/lists "$BACKUP/manager-lists"; [ -f "$STATE" ] && cp -a "$STATE" "$BACKUP/provider-state.json"
if [ "$OLD_INSTALLED" -eq 1 ]; then
 if [ -f "$CACHE/current.apk" ] && [ -f "$CACHE/current.sha256" ] && [ "$(sha "$CACHE/current.apk")" = "$(cat "$CACHE/current.sha256")" ]; then cp -a "$CACHE/current.apk" "$BACKUP/old.apk"; OLD_APK="$BACKUP/old.apk"; [ -d "$CACHE/keys" ] && { cp -a "$CACHE/keys" "$BACKUP/old-keys"; OLD_KEYDIR="$BACKUP/old-keys"; }; else mkdir -p "$BACKUP/fetch"; apk fetch --output "$BACKUP/fetch" "zapret2=$OLD_VERSION" >/dev/null 2>&1 || fail EROLLBACK_UNAVAILABLE 'Старый пакет нельзя сохранить для rollback.'; OLD_APK="$(find "$BACKUP/fetch" -type f -name 'zapret2-*.apk'|head -n1)"; [ -n "$OLD_APK" ] && apk verify "$OLD_APK" >/dev/null 2>&1 || fail EROLLBACK_UNAVAILABLE 'Подпись snapshot APK не подтверждена.'; fi
fi
cancelled && fail ECANCELLED 'Операция отменена до остановки службы.'
phase stopping 20 'Служба zapret2 останавливается.'; [ -x "$INIT" ] && "$INIT" stop >/dev/null 2>&1 || [ "$OLD_INSTALLED" -eq 0 ] || fail ESTOP 'Не удалось остановить zapret2.'
if [ "$ACTION" = remove ]; then
 ROLLBACK_REQUIRED="$OLD_INSTALLED"; phase installing 55 'Удаляется только пакет zapret2.'; apk del --no-interactive zapret2 >/dev/null 2>&1 || fail EREMOVE 'Не удалось удалить пакет zapret2.'
 if [ "$PRESERVE" != true ]; then rm -rf /opt/zapret2 /etc/config/zapret2; fi
 /usr/bin/ucode "$CLI" clear-state >/dev/null 2>&1 || fail ESTATE 'Provider state не очищен.'
 ! apk info -e zapret2 >/dev/null 2>&1 && apk info -e zapret2-manager >/dev/null 2>&1 && apk info -e luci-app-zapret2-manager >/dev/null 2>&1 || fail EPOSTFLIGHT 'Manager packages не прошли проверку после удаления.'
 ROLLBACK_REQUIRED=0; printf '{"ok":true,"state":"engine_missing"}\n' >"$WORK/result.json"; /usr/bin/ucode "$CLI" complete "$ID" "$WORK/result.json" >/dev/null 2>&1 || true; exit 0
fi
case "$PROVIDER:$URL" in andrevich:https://github.com/1andrevich/zapret2-openwrt/releases/download/v*/zapret2_*.apk) ;; remittor:https://github.com/remittor/zapret-openwrt/releases/download/v*/zapret2_v*.zip) ;; *) fail ESECURITY 'Download URL не входит в allowlist.';; esac
case "$EXPECTED_SHA" in [a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) ;; *) fail EMETADATA 'Некорректный digest.';; esac
phase downloading 32 'Загружается проверенный release asset.'; ASSET="$WORK/asset"; uclient-fetch -q -T 60 -O "$ASSET" "$URL" || fail ENETWORK 'Не удалось скачать release asset.'
[ -s "$ASSET" ] && [ "$(size "$ASSET")" -eq "$EXPECTED_SIZE" ] 2>/dev/null || fail ESIZE 'Размер release asset не совпадает с metadata.'; [ "$(sha "$ASSET")" = "$EXPECTED_SHA" ] || fail ESHA256 'SHA-256 release asset не совпадает.'
cancelled && fail ECANCELLED 'Операция отменена до установки.'
phase verifying 45 'Проверяются APK metadata и подпись.'
if [ "$CONTAINER" = zip ]; then mkdir -p "$WORK/unpack"; unzip -qq "$ASSET" -d "$WORK/unpack" || fail EARCHIVE 'Архив поставщика повреждён.'; [ -z "$(find "$WORK/unpack" -type f -name 'luci-app-zapret2*.apk' -print -quit)" ] || fail ESECURITY 'Архив содержит запрещённый LuCI package.'; APK="$(find "$WORK/unpack" -type f -name 'zapret2-*.apk' -print|head -n1)"; [ -n "$APK" ] && [ "$(find "$WORK/unpack" -type f -name 'zapret2-*.apk'|wc -l)" -eq 1 ] || fail EPACKAGE 'В архиве нет единственного zapret2 APK.'; else APK="$ASSET"; fi
KEYDIR=
if [ "$PROVIDER" = andrevich ]; then
 case "$KEY_URL" in https://github.com/1andrevich/zapret2-openwrt/releases/download/v*/zapret2-1andrevich.pub) ;; *) fail ESECURITY 'Public key URL не входит в allowlist.';; esac
 mkdir -p "$WORK/keys"; cp -a /etc/apk/keys/. "$WORK/keys/" 2>/dev/null || true; uclient-fetch -q -T 30 -O "$WORK/keys/zapret2-1andrevich.pub" "$KEY_URL" || fail EKEY 'Не удалось скачать pinned public key.'; [ "$(sha "$WORK/keys/zapret2-1andrevich.pub")" = "$KEY_SHA" ] || fail EKEY 'Fingerprint public key не совпадает.'; KEYDIR="$WORK/keys"; apk --keys-dir "$KEYDIR" verify "$APK" >/dev/null 2>&1 || fail ESIGNATURE 'APK signature не подтверждена pinned key.'
else apk verify "$APK" >/dev/null 2>&1 || fail ESIGNATURE 'Remittor APK не подписан доверенным системным ключом.'; fi
META="$WORK/meta"; apk adbdump "$APK" >"$META" 2>/dev/null || { mkdir -p "$WORK/index"; apk index -o "$WORK/index/APKINDEX.tar.gz" "$APK" >/dev/null 2>&1 && tar -xOzf "$WORK/index/APKINDEX.tar.gz" APKINDEX >"$META" 2>/dev/null; } || fail EPACKAGE 'Не удалось прочитать APK metadata.'
PKG_NAME="$(awk -F: '/^(name|P):/{print $2;exit}' "$META"|tr -d ' ')"; PKG_VERSION="$(awk -F: '/^(version|V):/{print $2;exit}' "$META"|tr -d ' ')"; PKG_ARCH="$(awk -F: '/^(arch|A):/{print $2;exit}' "$META"|tr -d ' ')"
[ "$PKG_NAME" = zapret2 ] || fail EPACKAGE 'APK package name не zapret2.'; case "$PKG_VERSION" in "$EXPECTED_VERSION"|"$EXPECTED_VERSION"-r[0-9]*) ;; *) fail EVERSION 'APK package version не совпадает с кандидатом.';; esac; [ "$PKG_ARCH" = "$ARCH" ] || fail EARCH 'APK architecture не совпадает с устройством.'
ROLLBACK_REQUIRED=1; phase installing 60 'Устанавливается только engine package zapret2.'
if [ -n "$KEYDIR" ]; then apk --keys-dir "$KEYDIR" add --no-interactive --allow-downgrade "$APK" >/dev/null 2>&1 || fail EINSTALL 'APK installation failed.'; else apk add --no-interactive --allow-downgrade "$APK" >/dev/null 2>&1 || fail EINSTALL 'APK installation failed.'; fi
phase restoring 72 'Восстанавливаются конфигурация и пользовательские списки.'; restore_config || fail ERESTORE 'Не удалось восстановить пользовательские данные.'
phase starting 82 'Запускается новый runtime.'; phase postflight 88 'Проверяется runtime-контракт manager.'; postflight || fail EPOSTFLIGHT 'Новый engine не прошёл postflight.'
mkdir -p "$CACHE" "$CACHE/keys"; chmod 700 "$CACHE" "$CACHE/keys"; cp -a "$APK" "$CACHE/current.apk"; sha "$CACHE/current.apk" >"$CACHE/current.sha256"; rm -rf "$CACHE/keys"/*; [ -n "$KEYDIR" ] && cp -a "$KEYDIR/." "$CACHE/keys/" || true
/usr/bin/ucode "$CLI" commit-state "$ID" >/dev/null 2>&1 || fail ESTATE 'Provider state не подтверждён.'
[ "$WAS_RUNNING" -eq 1 ] || [ "$OLD_INSTALLED" -eq 0 ] || "$INIT" stop >/dev/null 2>&1 || true
ROLLBACK_REQUIRED=0; printf '{"ok":true,"provider":"%s","packageVersion":"%s"}\n' "$PROVIDER" "$PKG_VERSION" >"$WORK/result.json"; /usr/bin/ucode "$CLI" complete "$ID" "$WORK/result.json" >/dev/null 2>&1 || true
