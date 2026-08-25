'use strict';
// Optional TG Proxy provider manager (variant 1: feed-authoritative).
//
// The browser sends only an allow-listed provider id and release identity. It
// cannot choose an arbitrary version, package name, URL or shell fragment.
// BOTH providers are distributed exclusively as signed Z2M provider APKs,
// resolved from the Z2M provider-feed manifest. GitHub upstream metadata is a
// discovery/build-input source only and is never the runtime install
// authority.

import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';

const STATE_FILE = getenv('Z2M_TGPROVIDER_STATE') || '/etc/zapret2-manager/proxy-provider.json';
const LOCK_DIR = getenv('Z2M_TGPROVIDER_LOCK') || '/tmp/zapret2-manager-proxy-provider.lock';
const SNAP_DIR = getenv('Z2M_TGPROVIDER_SNAP') || '/tmp/zapret2-manager-proxy-provider-snapshot';
const INIT_PATH = getenv('Z2M_TGPROVIDER_INIT') || '/etc/init.d/tg-ws-proxy';
const CONFIG_DIR = getenv('Z2M_TGPROVIDER_CONFIG') || '/etc/tg-ws-proxy';
const SECRET_PATH = CONFIG_DIR + '/secret.conf';
const BINARY_PATH = getenv('Z2M_TGPROVIDER_BINARY') || '/usr/bin/tg-ws-proxy';
const CHECK_DIR = getenv('Z2M_TGPROVIDER_CHECK') || '/tmp/zapret2-manager/proxy-provider-checks';
const CHECK_TTL = 600;
const MAX_METADATA = 4194304;
// Manager-owned shared TG lifecycle surface (independent of any provider).
// Keys must stay within proxycfg's CONF_KEY_MAP (LOGLEVEL is not one).
//
// default_config_body() IS the first-run RECOMMENDED preset. Values are
// upstream defaults, not invented: PORT 1443 and POOL_SIZE 4 are
// tg-ws-proxy-rs defaults; DEFAULT_DOMAINS=1 activates the upstream-maintained
// built-in CF proxy domain list (Rust: TG_DEFAULT_DOMAINS=true fetching the
// Flowseal GitHub list, "no Cloudflare setup needed"; Go: keeps its default
// CFPROXY_DOMAINS_URL -> Flowseal canonical source active instead of passing
// --no-cfproxy); CF_PRIORITY=1 tries the CF route before direct WS. Custom
// user domains/workers/MTProto/outbound stay empty until the user sets them.
//
// HOST binds the router's LAN IPv4 so LAN clients (Telegram Desktop on a PC)
// can actually reach the listener; a loopback-only bind is the #1 cause of
// endless "Подключение…" on clients. Written ONLY when config.conf does not
// exist yet — an existing (user-edited or upgraded) config is never touched.
function lan_address() {
	let r = run('/bin/ubus call network.interface.lan status 2>/dev/null');
	let out = trim(r.out);
	if (r.rc == 0 && out != '') {
		let ai = index(out, '"ipv4-address"');
		if (ai >= 0) {
			let tail = substr(out, ai);
			let addrStart = index(tail, '"address"');
			if (addrStart >= 0) {
				let afterColon = substr(tail, addrStart + 9);
				let q1 = index(afterColon, '"');
				if (q1 >= 0) {
					let q2 = index(substr(afterColon, q1 + 1), '"');
					if (q2 >= 0) {
						let addr = substr(afterColon, q1 + 1, q2);
						if (addr != '' && substr(addr, 0, 4) != '127.') return addr;
					}
				}
			}
		}
	}
	let r2 = run('ip -o -4 addr show br-lan 2>/dev/null | head -1');
	let line = trim(r2.out);
	if (r2.rc == 0 && line != '') {
		let parts = split(line, /\s+/);
		for (let i = 0; i < length(parts) - 1; i++) {
			if (parts[i] == 'inet') {
				let cidr = parts[i + 1];
				let cut = index(cidr, '/');
				let addr = cut > 0 ? substr(cidr, 0, cut) : cidr;
				if (addr != '' && substr(addr, 0, 4) != '127.') return addr;
			}
		}
	}
	return null;
}

function default_config_body() {
	// LAN clients must reach the listener; fall back to loopback only when no
	// LAN address can be determined (diagnostics-only setup).
	let host = lan_address();
	if (host == null) host = '127.0.0.1';
	return '# Default Telegram MTProto WebSocket proxy configuration (manager-owned).\n' +
		'# Provider updates preserve this file.\n' +
		'# Recommended profile: upstream default Cloudflare fallback routes.\n\n' +
		'ENABLED=1\nHOST=' + host + '\nPORT=1443\nLINK_IP=\n' +
		'POOL_SIZE=4\nBUF_KB=256\nMAX_CONNECTIONS=\nQUIET=0\nVERBOSE=0\n' +
		'FAKETLS_DOMAIN=\nDC_IPS=\nCF_DOMAINS=\nCF_WORKER_DOMAINS=\n' +
		'CF_PRIORITY=1\nCF_BALANCE=0\nDEFAULT_DOMAINS=1\n' +
		'MTPROTO_PROXIES=\nOUTBOUND_PROXY=\nNO_PROXY=\n';
}
// Secret storage uses proxycfg's canonical `SECRET=<32hex>` format so both
// subsystems parse the same file; the init layer maps it to TG_* env vars.
const DEFAULT_INIT_BODY = 	'#!/bin/sh /etc/rc.common\n' +
	'# init.d/tg-ws-proxy — procd service for the pinned tg-ws-proxy-rs MTProto bridge.\n' +
	'#\n' +
	'# INDEPENDENCE: this service manages ONLY /usr/bin/tg-ws-proxy. It never calls\n' +
	'# /etc/init.d/zapret2 (the bypass engine) and nothing on the zapret2 side calls\n' +
	'# this script — a restart of one service never restarts the other.\n' +
	'#\n' +
	'# STARTUP GATES (validate_config REFUSES to start — reason on stderr + syslog —\n' +
	'# when any of these holds):\n' +
	'#   1. the binary is missing/not executable (package partially removed);\n' +
	'#   2. config.conf is missing/unreadable (no manager apply has happened);\n' +
	'#   3. ENABLED != 1 (operator intent lives in the manager-owned config, and a\n' +
	'#      boot start with a disabled config stays down even if an rc.d symlink\n' +
	'#      exists);\n' +
	'#   4. secret.conf is missing, has a mode other than 0600, or SECRET is not\n' +
	'#      exactly 32 lowercase hex chars (the provider-required format);\n' +
	'#   5. HOST is empty or a wildcard (0.0.0.0 / :: / *) — v1 has NO wildcard\n' +
	'#      bind: the listener must bind the explicit LAN address (or a 127.x\n' +
	'#      loopback for diagnostics), and a HOST that is not a local interface\n' +
	'#      address is refused instead of falling back to wildcard;\n' +
	'#   6. PORT is not an integer in 1..65535;\n' +
	'#   7. a listener already holds HOST:PORT, 0.0.0.0:PORT or :::PORT (a wildcard\n' +
	'#      holder conflicts with any bind of that port).\n' +
	'#\n' +
	'# SECRET HANDLING: the MTProto secret reaches the provider ONLY through the\n' +
	'# TG_SECRET environment variable — at v1.6.5 every provider flag except\n' +
	'# --dc-ip has an env alias, so the secret never appears in argv (no ps\n' +
	'# exposure). Residual: it is visible to root via /proc/<pid>/environ; accepted\n' +
	'# and documented in docs/research/tg-ws-proxy-provider.md. DC mappings go via\n' +
	'# argv (--dc-ip) because no env alias exists — IPs are not secret material.\n' +
	'#\n' +
	'# LOGGING: the provider writes to $LOG_FILE (pre-created 0600 below). Its\n' +
	'# startup tg:// link EMBEDS the secret, so the log must stay root-only from\n' +
	'# the first byte; the manager\'s proxy_logs_tail redacts secret patterns before\n' +
	'# returning anything.\n' +
	'#\n' +
	'# NO FIREWALL RULES are installed here (v1): exposure is governed by the bind\n' +
	'# address alone — LAN-only by policy, never WAN.\n' +
	'\n' +
	'USE_PROCD=1\n' +
	'START=90\n' +
	'STOP=10\n' +
	'\n' +
	'PROG=' + BINARY_PATH + '\n' +
	'CONF_DIR=/etc/tg-ws-proxy\n' +
	'CONF="$CONF_DIR/config.conf"\n' +
	'SECRET_CONF="$CONF_DIR/secret.conf"\n' +
	'LOG_FILE=/var/log/tg-ws-proxy.log\n' +
	'\n' +
	'log_refuse() {\n' +
	'	echo "tg-ws-proxy: refusing start: $*" >&2\n' +
	'	logger -t tg-ws-proxy -p daemon.err "init: refusing start: $*"\n' +
	'}\n' +
	'\n' +
	'# conf_val KEY — value of the first active `KEY=` assignment (quotes stripped).\n' +
	'# KEY is always a constant here; values are manager-validated before they ever\n' +
	'# reach the file.\n' +
	'conf_val() {\n' +
	'	sed -n "s/^$1=//p" "$CONF" 2>/dev/null | head -n 1 | sed \'s/^"//; s/"$//\' | tr -d \'\\r\'\n' +
	'}\n' +
	'\n' +
	'# ipv4_ok ADDR — dotted quad, four octets 0..255, no leading zeros ("0" ok).\n' +
	'ipv4_ok() {\n' +
	'	case "$1" in\n' +
	'		""|*[!0-9.]*) return 1 ;;\n' +
	'	esac\n' +
	'	local IFS=.\n' +
	'	set -- $1\n' +
	'	[ "$#" -eq 4 ] || return 1\n' +
	'	local o\n' +
	'	for o; do\n' +
	'		case "$o" in\n' +
	'			0|[1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]) : ;;\n' +
	'			*) return 1 ;;\n' +
	'		esac\n' +
	'	done\n' +
	'	return 0\n' +
	'}\n' +
	'\n' +
	'# port_held HOST PORT — non-empty output when a listener holds HOST:PORT or a\n' +
	'# wildcard (:IPv4-any / :IPv6-any) of PORT.\n' +
	'port_held() {\n' +
	'	netstat -tln 2>/dev/null | awk \'NR>2 {print $4}\' | while IFS= read -r la; do\n' +
	'		case "$la" in\n' +
	'			"$1:$2"|"0.0.0.0:$2"|":::$2") echo held; break ;;\n' +
	'		esac\n' +
	'	done\n' +
	'}\n' +
	'\n' +
	'validate_config() {\n' +
	'	[ -x "$PROG" ] || { log_refuse "binary $PROG missing or not executable (package tg-ws-proxy-rs not installed?)"; return 1; }\n' +
	'	[ -f "$CONF" ] || { log_refuse "config $CONF missing — apply a configuration first (zapret2-manager proxy_config_apply)"; return 1; }\n' +
	'	[ -r "$CONF" ] || { log_refuse "config $CONF is not readable"; return 1; }\n' +
	'\n' +
	'	local ENABLED; ENABLED=$(conf_val ENABLED)\n' +
	'	[ "$ENABLED" = "1" ] || { log_refuse "disabled by config (ENABLED != 1) — enable via the manager, not by editing init"; return 1; }\n' +
	'\n' +
	'	[ -f "$SECRET_CONF" ] || { log_refuse "secret $SECRET_CONF missing — generate/rotate via zapret2-manager proxy_secret_rotate"; return 1; }\n' +
	'	local MODE; MODE=$(ls -l "$SECRET_CONF" 2>/dev/null | awk \'{print $1}\')\n' +
	'	local OCT\n' +
	'	case "$MODE" in\n' +
	'		-rw-------) OCT=600 ;;\n' +
	'		*)         OCT= ;;\n' +
	'	esac\n' +
	'	[ -n "$OCT" ] || { log_refuse "secret $SECRET_CONF has mode ${MODE:-unknown} — expected 600"; return 1; }\n' +
	'	SECRET=$(sed -n \'s/^SECRET=//p\' "$SECRET_CONF" 2>/dev/null | head -n 1 | tr -d \'\\r\')\n' +
	'	if [ "${#SECRET}" -ne 32 ] || ! printf \'%s\' "$SECRET" | grep -q \'^[0-9a-f]*$\'; then\n' +
	'		log_refuse "SECRET in $SECRET_CONF is malformed — expected exactly 32 lowercase hex chars"\n' +
	'		return 1\n' +
	'	fi\n' +
	'\n' +
	'	HOST=$(conf_val HOST)\n' +
	'	PORT=$(conf_val PORT)\n' +
	'	case "$HOST" in\n' +
	'		""|0.0.0.0|"::"|"*")\n' +
	'			log_refuse "HOST \'$HOST\' is empty or a wildcard — v1 policy requires an explicit LAN (or 127.x loopback) bind; wildcard is not supported"\n' +
	'			return 1 ;;\n' +
	'	esac\n' +
	'	if ! ipv4_ok "$HOST"; then\n' +
	'		log_refuse "HOST \'$HOST\' is not a valid IPv4 address (IPv6 bind is not supported in v1)"\n' +
	'		return 1\n' +
	'	fi\n' +
	'	case "$HOST" in\n' +
	'		127.*)\n' +
	'			: ;;  # loopback bind allowed for diagnostics\n' +
	'		*)\n' +
	'			ip -o addr show 2>/dev/null | grep -qw "$HOST" || {\n' +
	'				log_refuse "HOST $HOST is not a local interface address — refusing instead of falling back to wildcard"\n' +
	'				return 1\n' +
	'			} ;;\n' +
	'	esac\n' +
	'\n' +
	'	case "$PORT" in\n' +
	'		""|*[!0-9]*) log_refuse "PORT \'$PORT\' is not numeric"; return 1 ;;\n' +
	'	esac\n' +
	'	[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { log_refuse "PORT $PORT out of range (1..65535)"; return 1; }\n' +
	'\n' +
	'	[ -z "$(port_held "$HOST" "$PORT")" ] || {\n' +
	'		log_refuse "port $PORT is already bound by this address or a wildcard holder — port conflict"\n' +
	'		return 1\n' +
	'	}\n' +
	'	return 0\n' +
	'}\n' +
	'\n' +
	'start_service() {\n' +
	'	validate_config || return 1\n' +
	'\n' +
	'	# Optional values (richly validated by the manager before they land here;\n' +
	'	# only coarse safety gates belong in init).\n' +
	'	LINK_IP=$(conf_val LINK_IP)\n' +
	'	POOL_SIZE=$(conf_val POOL_SIZE)\n' +
	'	BUF_KB=$(conf_val BUF_KB)\n' +
	'	MAX_CONNECTIONS=$(conf_val MAX_CONNECTIONS)\n' +
	'	QUIET=$(conf_val QUIET)\n' +
	'	VERBOSE=$(conf_val VERBOSE)\n' +
	'	FAKETLS_DOMAIN=$(conf_val FAKETLS_DOMAIN)\n' +
	'	DC_IPS=$(conf_val DC_IPS)\n' +
	'	CF_DOMAINS=$(conf_val CF_DOMAINS)\n' +
	'	CF_WORKER_DOMAINS=$(conf_val CF_WORKER_DOMAINS)\n' +
	'	CF_PRIORITY=$(conf_val CF_PRIORITY)\n' +
	'	CF_BALANCE=$(conf_val CF_BALANCE)\n' +
	'	DEFAULT_DOMAINS=$(conf_val DEFAULT_DOMAINS)\n' +
	'	MTPROTO_PROXIES=$(conf_val MTPROTO_PROXIES)\n' +
	'	OUTBOUND_PROXY=$(conf_val OUTBOUND_PROXY)\n' +
	'	NO_PROXY=$(conf_val NO_PROXY)\n' +
	'\n' +
	'	# The provider prints its startup tg:// link (embedding the secret) into\n' +
	'	# the log — keep the log root-only from the first byte.\n' +
	'	[ -f "$LOG_FILE" ] || { touch "$LOG_FILE" && chmod 0600 "$LOG_FILE"; }\n' +
	'\n' +
	'	# argv carries ONLY --dc-ip pairs (the one provider option with no env\n' +
	'	# alias; DC IPs are not secret). procd execs argv without a shell — each\n' +
	'	# token is exactly one argv element. Every pair is re-gated here.\n' +
	'	# Build dc-ip args FIRST, before repurposing $@ for env vars.\n' +
	'	local pair dc ip oldifs\n' +
	'	local dc_args=""\n' +
	'	if [ -n "$DC_IPS" ]; then\n' +
	'		oldifs=$IFS; IFS=,\n' +
	'		for pair in $DC_IPS; do\n' +
	'			dc=${pair%%:*}\n' +
	'			ip=${pair#*:}\n' +
	'			case "$dc" in\n' +
	'				""|*[!0-9-]*|*-*)   # digits with an optional single -N suffix\n' +
	'					log_refuse "DC_IPS entry \'$pair\' is malformed (expected DC:IPv4, e.g. 2:149.154.167.220)"\n' +
	'					return 1 ;;\n' +
	'			esac\n' +
	'			if [ "$ip" = "$pair" ] || ! ipv4_ok "$ip"; then\n' +
	'				log_refuse "DC_IPS entry \'$pair\' is malformed (expected DC:IPv4, e.g. 2:149.154.167.220)"\n' +
	'				return 1\n' +
	'			fi\n' +
	'			dc_args="$dc_args --dc-ip $pair"\n' +
	'		done\n' +
	'		IFS=$oldifs\n' +
	'	fi\n' +
	'\n' +
	'	# Build env vars as separate arguments. procd_set_param env OVERWRITES on\n' +
	'	# each call, so accumulate all in one call via the positional args.\n' +
	'	set -- TG_HOST="$HOST" TG_PORT="$PORT" TG_SECRET="$SECRET" TG_LOG_FILE="$LOG_FILE"\n' +
	'	[ -n "$LINK_IP" ] && set -- "$@" TG_LINK_IP="$LINK_IP"\n' +
	'	[ -n "$POOL_SIZE" ] && set -- "$@" TG_POOL_SIZE="$POOL_SIZE"\n' +
	'	[ -n "$BUF_KB" ] && set -- "$@" TG_BUF_KB="$BUF_KB"\n' +
	'	[ -n "$MAX_CONNECTIONS" ] && set -- "$@" TG_MAX_CONNECTIONS="$MAX_CONNECTIONS"\n' +
	'	[ "$QUIET" = "1" ] && set -- "$@" TG_QUIET=true\n' +
	'	[ "$VERBOSE" = "1" ] && set -- "$@" TG_VERBOSE=true\n' +
	'	[ -n "$FAKETLS_DOMAIN" ] && set -- "$@" TG_LISTEN_FAKETLS_DOMAIN="$FAKETLS_DOMAIN"\n' +
	'	[ -n "$CF_DOMAINS" ] && set -- "$@" TG_CF_DOMAIN="$CF_DOMAINS"\n' +
	'	[ -n "$CF_WORKER_DOMAINS" ] && set -- "$@" TG_CF_WORKER_DOMAIN="$CF_WORKER_DOMAINS"\n' +
	'	[ "$CF_PRIORITY" = "1" ] && set -- "$@" TG_CF_PRIORITY=true\n' +
	'	[ "$CF_BALANCE" = "1" ] && set -- "$@" TG_CF_BALANCE=true\n' +
	'	[ "$DEFAULT_DOMAINS" = "1" ] && set -- "$@" TG_DEFAULT_DOMAINS=true\n' +
	'	[ -n "$MTPROTO_PROXIES" ] && set -- "$@" TG_MTPROTO_PROXY="$MTPROTO_PROXIES"\n' +
	'	[ -n "$OUTBOUND_PROXY" ] && set -- "$@" TG_OUTBOUND_PROXY="$OUTBOUND_PROXY"\n' +
	'	[ -n "$NO_PROXY" ] && set -- "$@" TG_NO_PROXY="$NO_PROXY"\n' +
	'\n' +
	'	procd_open_instance\n' +
	'	procd_set_param command "$PROG" $dc_args\n' +
	'	procd_set_param env "$@"\n' +
	'\n' +
	'	# BOUNDED respawn: procd restarts a crashed instance at most 5 times (5s\n' +
	'	# apart) when it dies inside a 3600s window, then stops retrying — no\n' +
	'	# infinite restart loop.\n' +
	'	procd_set_param respawn 3600 5 5\n' +
	'	procd_set_param stdout 1\n' +
	'	procd_set_param stderr 1\n' +
	'	procd_close_instance\n' +
	'}\n' +
	'\n' +
	'# Config change needs a full process restart: all provider settings are fixed\n' +
	'# at process start (env/argv), there is no live-reload signal.\n' +
	'reload_service() {\n' +
	'	stop\n' +
	'	start\n' +
	'}\n' +
	'\n' +
	'extra_command "validate" "Validate config + secret + bind/port gates without starting"\n' +
	'\n' +
	'validate() {\n' +
	'	validate_config && echo "tg-ws-proxy: config OK"\n' +
	'}\n';


const PROVIDERS = [
	{
		id: 'rust',
		title: 'Rust',
		short: 'Лучше обходит сложные блокировки',
		feature: 'Автоматически пробует разные способы подключения; рекомендуется большинству пользователей',
		repository: 'valnesfjord/tg-ws-proxy-rs',
		package: 'tg-ws-proxy-rs'
	},
	{
		id: 'go',
		title: 'Go',
		short: 'Простой базовый вариант',
		feature: 'Подходит для обычного подключения и поддерживает основные способы обхода блокировок',
		repository: 'spatiumstas/tg-ws-proxy-go',
		package: 'tg-ws-proxy-go',
		// Upstream release APKs register as 'tg-ws-proxy'; both names must be
		// recognized or the manager reports a false provider identity.
		packageAlt: 'tg-ws-proxy'
	}
];

function run(command) {
	let p = popen(command + ' 2>/dev/null', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { rc: rc, out: out };
}

function error(code, message) {
	return { ok: false, error: { code: code, message: message } };
}

function literal(value) {
	return type(value) == 'string' && index(value, "'") < 0 && index(value, '\n') < 0 && index(value, '\r') < 0
		? "'" + value + "'" : null;
}

function safe_token(value) {
	return type(value) == 'string' && match(value, /^[a-f0-9]{48}$/) ? value : null;
}

function safe_digest(value) {
	if (type(value) != 'string') return null;
	let found = match(value, /^sha256:([a-fA-F0-9]{64})$/);
	return found ? lc(found[1]) : null;
}

function safe_package_version(value) {
	let s = '' + (value != null ? value : '');
	if (s == '' || length(s) > 96) return false;
	for (let i = 0; i < length(s); i++) {
		let c = ord(substr(s, i, 1));
		let ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) ||
			(c >= 97 && c <= 122) || c == 43 || c == 45 || c == 46 ||
			c == 95 || c == 126;
		if (!ok) return false;
	}
	return true;
}

function read_json(path, fallback) {
	try { let raw = readfile(path); return raw ? json(raw) : fallback; }
	catch (e) { return fallback; }
}

function ensure_dir(path) {
	let quoted = literal(path);
	if (quoted == null) return false;
	if (stat(path) == null) run('mkdir -p ' + quoted);
	run('chmod 700 ' + quoted);
	return stat(path) != null;
}

function atomic_json(path, value) {
	let tmp = path + '.tmp.' + time() + '-' + length(sprintf('%J', value));
	if (!writefile(tmp, sprintf('%J', value) + '\n')) return false;
	let source = literal(tmp), target = literal(path);
	if (source == null || target == null) return false;
	let moved = run('chmod 600 ' + source + ' && mv -f ' + source + ' ' + target);
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) { } return false; }
	return stat(path) != null;
}

function random_token() {
	return trim(run("(cat /proc/sys/kernel/random/uuid; cat /proc/sys/kernel/random/uuid) | tr -cd 'a-f0-9' | cut -c1-48").out);
}

function random_hex32() {
	return substr(trim(run("(cat /proc/sys/kernel/random/uuid; cat /proc/sys/kernel/random/uuid) | tr -cd 'a-f0-9' | cut -c1-32").out), 0, 32);
}

function compare_versions(a, b) {
	if (!safe_package_version(a) || !safe_package_version(b)) return null;
	let left = literal(a), right = literal(b);
	if (left == null || right == null) return null;
	let answer = trim(run('apk version -t ' + left + ' ' + right).out);
	return answer == '<' ? -1 : answer == '>' ? 1 : answer == '=' ? 0 : null;
}

function architecture() {
	let value = trim(run(". /etc/openwrt_release 2>/dev/null; printf '%s' \"$DISTRIB_ARCH\"").out);
	if (value == '') value = trim(run('apk --print-arch').out);
	return match(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/) ? value : null;
}

function metadata_url(provider) {
	return 'https://api.github.com/repos/' + provider.repository + '/releases?per_page=30';
}

function fetch_metadata(provider) {
	let url = metadata_url(provider), quotedUrl = literal(url);
	if (url == null || quotedUrl == null) return error('ESECURITY', 'Metadata URL не входит в allowlist.');
	let file = '/tmp/zapret2-manager/proxy-provider-metadata.' + provider.id + '.' + time();
	run('mkdir -p /tmp/zapret2-manager');
	let quotedFile = literal(file);
	let result = run('ulimit -f 8192; uclient-fetch -q -T 20 --user-agent zapret2-manager/proxy -O ' + quotedFile + ' ' + quotedUrl);
	let info = stat(file);
	if (result.rc != 0 || info == null) { try { unlink(file); } catch (e) { } return error('ENETWORK', 'Не удалось проверить обновления.'); }
	if (info.size < 2 || info.size > MAX_METADATA) { try { unlink(file); } catch (e) { } return error('EMETADATA', 'Ответ upstream имеет недопустимый размер.'); }
	let document = read_json(file, null);
	try { unlink(file); } catch (e) { }
	if (document == null || type(document) != 'array')
		return error('EMETADATA', 'Ответ upstream повреждён.');
	return { ok: true, document: document };
}

// Map a release to the provider-specific install artifact for this router.
// Rust upstream ships static musl binary tar.gz archives; Go upstream ships
// OpenWrt APK assets. Returns null when no compatible asset exists.
function provider_asset(providerId, arch, tag, assetName) {
	let target = substr(arch, 0, 8) == 'aarch64_' ? 'aarch64' : arch;
	if (providerId == 'rust') {
		if (target == 'aarch64') return assetName == 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz' ? 'archive' : null;
		if (target == 'x86_64') return assetName == 'tg-ws-proxy-x86_64-unknown-linux-musl.tar.gz' ? 'archive' : null;
		if (substr(target, 0, 4) == 'arm_') return assetName == 'tg-ws-proxy-armv7-unknown-linux-musleabihf.tar.gz' ? 'archive' : null;
		if (substr(target, 0, 8) == 'mipsel_') return assetName == 'tg-ws-proxy-mipsel-unknown-linux-musl.tar.gz' ? 'archive' : null;
		if (substr(target, 0, 5) == 'mips_') return assetName == 'tg-ws-proxy-mips-unknown-linux-musl.tar.gz' ? 'archive' : null;
		return null;
	}
	// go: OpenWrt APK asset named tg-ws-proxy_<pkgver>_openwrt_<arch>.apk
	if (substr(assetName, 0, 12) == 'tg-ws-proxy_' &&
		substr(assetName, length(assetName) - (13 + length(arch))) == '_openwrt_' + arch + '.apk')
		return 'apk';
	return null;
}

function parse_release(providerId, providerRepo, arch, release) {
	if (type(release) != 'object' || release == null || release.draft === true) return null;
	let tag = release.tag_name;
	if (type(tag) != 'string' || !match(tag, /^v?[0-9][0-9A-Za-z._-]*$/)) return null;
	let version = substr(tag, 1) != '' && substr(tag, 0, 1) == 'v' ? substr(tag, 1) : tag;
	if (!safe_package_version(version)) return null;
	let prerelease = release.prerelease === true;
	let assets = type(release.assets) == 'array' ? release.assets : [];
	for (let i = 0; i < length(assets); i++) {
		let asset = assets[i];
		if (type(asset) != 'object' || asset == null || asset.state != 'uploaded') continue;
		let name = asset.name;
		if (type(name) != 'string') continue;
		let kind = provider_asset(providerId, arch, tag, name);
		if (kind == null) continue;
		let digest = safe_digest(asset.digest != null ? asset.digest : '');
		let prefix = 'https://github.com/' + providerRepo + '/releases/download/' + tag + '/';
		if (type(asset.browser_download_url) != 'string' || asset.browser_download_url != prefix + name)
			continue; // asset must belong to THIS exact release
		return {
			provider: providerId,
			version: version,
			tag: tag,
			releaseId: release.id != null ? '' + release.id : '',
			publishedAt: release.published_at != null ? release.published_at : null,
			prerelease: prerelease,
			draft: false,
			// Release display metadata is captured for EVERY version so the UI
			// can render the changelog of the exact selected releaseId/tag
			// instead of a global "latest" blob. body is '' when upstream
			// published no notes (a real empty body, not data loss).
			name: type(release.name) == 'string' ? release.name : '',
			body: type(release.body) == 'string' ? release.body : '',
			artifactKind: kind,
			artifactName: name,
			assetSha256: digest,
			assetSize: asset.size != null ? +asset.size : 0,
			downloadUrl: asset.browser_download_url,
			metadataUrl: metadata_url({ repository: providerRepo }),
			releaseUrl: release.html_url != null ? release.html_url : null
		};
	}
	return null;
}

// Parse the full releases list into installable candidates (stable first).
function release_candidates(provider, arch, document) {
	let found = [];
	for (let i = 0; i < length(document); i++) {
		let candidate = parse_release(provider.id, provider.repository, arch, document[i]);
		if (candidate != null) push(found, candidate);
	}
	for (let j = 1; j < length(found); j++) {
		let cur = found[j];
		for (let k = j - 1; k >= 0; k--) {
			let cmp = compare_versions(cur.version, found[k].version);
			if (cmp == 0 || cmp == null) cmp = cur.version < found[k].version ? -1 : 1;
			if (cmp > 0) { found[k + 1] = found[k]; found[k] = cur; } else break;
		}
	}
	return found;
}

// Fetch and parse the full compatible release list for a provider.
function list_candidates(providerId, arch) {
	let provider = null;
	for (let i = 0; i < length(PROVIDERS); i++)
		if (PROVIDERS[i].id == providerId) { provider = PROVIDERS[i]; break; }
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let fetched = fetch_metadata(provider);
	if (!fetched.ok) return fetched;
	let candidates = release_candidates(provider, arch, fetched.document);
	if (length(candidates) == 0)
		return error('EMETADATA', 'Для архитектуры устройства нет подходящих официальных артефактов.');
	for (let i = 0; i < length(candidates); i++) {
		candidates[i].sourceId = 'official-github-release';
		candidates[i].installable = true;
		// Display-name aliases consumed by tg_product_versions.
		candidates[i].releaseName = candidates[i].name;
		candidates[i].releaseBody = candidates[i].body;
	}
	return { ok: true, candidates: candidates };
}

// Latest STABLE compatible candidate for the provider on this router.
// Lives above proxy_provider_versions: ucode resolves called functions
// positionally — a forward reference compiles to an undeclared global.
function latest_candidate(providerId, arch) {
	let resolved = list_candidates(providerId, arch);
	if (!resolved.ok) return resolved;
	let latest = null;
	for (let i = 0; i < length(resolved.candidates); i++) {
		let candidate = resolved.candidates[i];
		if (candidate.prerelease === true) continue;
		if (latest == null || compare_versions(candidate.version, latest.version) > 0)
			latest = candidate;
	}
	if (latest == null)
		return error('EMETADATA', 'Для архитектуры устройства нет подходящих официальных артефактов.');
	return { ok: true, candidate: latest };
}

function public_version_row(candidate, installedVersion) {
	// Full release identity travels with EVERY version row: the browser maps
	// each dropdown entry to its own releaseId/tag/name/publishedAt/body so
	// switching the selection swaps the changelog together with the version.
	// Metadata is never flattened into a single latest-only object here.
	return {
		version: candidate.version,
		tag: candidate.tag != null ? candidate.tag : null,
		releaseId: candidate.releaseId != null ? candidate.releaseId : '',
		releaseName: candidate.name != null ? candidate.name : '',
		publishedAt: candidate.publishedAt != null ? candidate.publishedAt : null,
		prerelease: candidate.prerelease === true,
		draft: candidate.draft === true,
		releaseBody: candidate.body != null ? candidate.body : '',
		releaseUrl: candidate.releaseUrl != null ? candidate.releaseUrl : null,
		artifactKind: candidate.artifactKind,
		installable: candidate.installable === true && candidate.assetSha256 != null,
		reason: candidate.assetSha256 == null ? 'Upstream не предоставил digest для этого asset.' : null,
		update: installedVersion != null && compare_versions(candidate.version, installedVersion) > 0
	};
}

function clone_public(provider) {
	return {
		id: provider.id,
		title: provider.title,
		short: provider.short,
		feature: provider.feature
	};
}

function provider_by_id(id) {
	for (let i = 0; i < length(PROVIDERS); i++)
		if (PROVIDERS[i].id == id) return PROVIDERS[i];
	return null;
}

function load_state() {
	let raw = readfile(STATE_FILE);
	if (!raw) return { activeProvider: null, activeVersion: null, changedAt: null };
	try {
		let parsed = json(raw);
		if (type(parsed) == 'object' && parsed != null) return parsed;
	} catch (e) { }
	return { activeProvider: null, activeVersion: null, changedAt: null, malformed: true };
}

function save_state(providerId, versionId, packageVersion) {
	let tmp = STATE_FILE + '.tmp.' + time();
	let payload = {
		schema: 'proxy-provider.v2',
		activeProvider: providerId,
		activeVersion: versionId,
		activePackageVersion: packageVersion != null ? packageVersion : null,
		changedAt: time()
	};
	writefile(tmp, sprintf('%J', payload) + '\n');
	let mv = run('mv -f ' + tmp + ' ' + STATE_FILE);
	if (mv.rc != 0) {
		try { unlink(tmp); } catch (e) { }
		return false;
	}
	return stat(STATE_FILE) != null;
}

function package_present(packageName) {
	return run('apk info -e ' + packageName).rc == 0;
}

function installed_package_version(packageName) {
	if (!package_present(packageName)) return null;
	// apk-tools v3: 'apk info -v' prints the DESCRIPTION, not the version.
	// 'apk list --installed' rows start with '<name>-<version> '.
	let r = run("apk list --installed '" + packageName + "' | head -n 1 | awk '{print $1}'");
	let line = trim(r.out);
	let first = split(line, '\n')[0];
	let prefix = packageName + '-';
	if (substr(first, 0, length(prefix)) == prefix)
		first = substr(first, length(prefix));
	return safe_package_version(first) ? first : null;
}

function running() {
	return trim(run('pidof tg-ws-proxy').out) != '';
}

function service(action) {
	if (stat(INIT_PATH) == null) return 0;
	return run(INIT_PATH + ' ' + action).rc;
}

function acquire_lock() {
	return run('mkdir ' + LOCK_DIR).rc == 0;
}

function release_lock() {
	run('rmdir ' + LOCK_DIR);
}

// ---- durable operation progress ------------------------------------------------
//
// The install/remove transaction is one synchronous RPC, but the UI must show
// a real operation, not a frozen button: every phase writes a durable record
// that tg_product_operation_status serves to a polling client. A page
// (re)load mid-operation re-attaches to the RUNNING record instead of
// starting a second transaction.
const OPERATION_FILE = '/tmp/zapret2-manager/proxy-provider-operation.json';
const OPERATION_TTL = 3600;

let OPERATION = null;

function operation_stage(stage, progress, message) {
	if (OPERATION == null) return;
	OPERATION.stage = stage;
	OPERATION.progress = progress;
	if (message != null) OPERATION.message = message;
	OPERATION.updatedAt = time();
	atomic_json(OPERATION_FILE, OPERATION);
}

function operation_begin(type, providerId, version) {
	let id = 'tgop-' + substr(random_token(), 0, 16);
	OPERATION = {
		schema: 'proxy-provider-operation.v1',
		operationId: id,
		type: type,
		provider: providerId,
		version: version,
		state: 'RUNNING',
		stage: 'PREPARE',
		progress: 5,
		message: null,
		startedAt: time(),
		updatedAt: time(),
		error: null,
		rollbackState: null
	};
	atomic_json(OPERATION_FILE, OPERATION);
	return id;
}

function operation_complete(state, result) {
	if (OPERATION == null) return;
	OPERATION.state = state;
	OPERATION.progress = state == 'COMPLETE' ? 100 : OPERATION.progress;
	if (result != null && type(result) == 'object') {
		if (result.error != null) OPERATION.error = result.error;
		if (result.rollbackFailures != null) OPERATION.rollbackState = length(result.rollbackFailures) > 0 ? 'ROLLBACK_FAILED' : (state == 'ROLLED_BACK' ? 'ROLLED_BACK' : null);
		else if (state == 'ROLLED_BACK') OPERATION.rollbackState = 'ROLLED_BACK';
	}
	OPERATION.updatedAt = time();
	atomic_json(OPERATION_FILE, OPERATION);
}

function operation_public(record) {
	if (record == null || type(record) != 'object') return null;
	return {
		operationId: record.operationId, type: record.type, provider: record.provider,
		version: record.version, state: record.state, stage: record.stage,
		progress: record.progress, message: record.message,
		startedAt: record.startedAt, updatedAt: record.updatedAt,
		error: record.error, rollbackState: record.rollbackState
	};
}

function snapshot_settings() {
	run('rm -rf ' + SNAP_DIR);
	let hadConfig = stat(CONFIG_DIR) != null;
	let hadBinary = stat(BINARY_PATH) != null;
	if (hadConfig && run('mkdir -p ' + SNAP_DIR + '/config').rc != 0)
		return { ok: false, hadConfig: true, hadBinary: hadBinary };
	if (hadConfig && run('cp -a ' + CONFIG_DIR + '/. ' + SNAP_DIR + '/config/').rc != 0)
		return { ok: false, hadConfig: true, hadBinary: hadBinary };
	if (hadBinary && run('cp -a ' + literal(BINARY_PATH) + ' ' + literal(SNAP_DIR + '/binary')).rc != 0)
		return { ok: false, hadConfig: hadConfig, hadBinary: true };
	return { ok: true, hadConfig: hadConfig, hadBinary: hadBinary };
}

function restore_settings(snapshot) {
	if (snapshot == null || snapshot.hadConfig !== true) return true;
	if (stat(SNAP_DIR + '/config') == null) return false;
	if (run('mkdir -p ' + CONFIG_DIR).rc != 0) return false;
	return run('cp -a ' + SNAP_DIR + '/config/. ' + CONFIG_DIR + '/').rc == 0;
}

function restore_binary(snapshot) {
	if (snapshot == null || snapshot.hadBinary !== true) return true;
	if (stat(SNAP_DIR + '/binary') == null) return false;
	return run('cp -a ' + literal(SNAP_DIR + '/binary') + ' ' + literal(BINARY_PATH) +
		' && chmod 755 ' + literal(BINARY_PATH)).rc == 0;
}

function clear_snapshot() {
	run('rm -rf ' + SNAP_DIR);
}

function provider_package_names(provider) {
	let names = [ provider.package ];
	if (provider.packageAlt != null) push(names, provider.packageAlt);
	return names;
}

function installed_rows() {
	let rows = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		let names = provider_package_names(provider);
		for (let j = 0; j < length(names); j++) {
			let packageVersion = installed_package_version(names[j]);
			if (packageVersion != null) {
				push(rows, { provider: provider.id, package: names[j], packageVersion: packageVersion });
				break;
			}
		}
	}
	return rows;
}

function state_package_version(providerId, version) {
	if (!safe_package_version(version)) return null;
	if (providerId == 'rust') return version + '-r1';
	if (providerId == 'go') {
		let found = match(version, /^(.+)-([0-9]+)$/);
		return found ? found[1] + '-r' + found[2] : null;
	}
	return null;
}

export const proxy_provider_catalog = function () {
	let out = [];
	for (let i = 0; i < length(PROVIDERS); i++) push(out, clone_public(PROVIDERS[i]));
	return {
		ok: true,
		optional: true,
		latestOnly: false,
		providers: out,
		note: 'Показывается установленная версия и последний совместимый официальный release.'
	};
};

function installed_version_row(status, providerId) {
	for (let i = 0; i < length(status.packages); i++) {
		let item = status.packages[i];
		if (item.provider == providerId)
			return {
				provider: providerId,
				version: status.activeProvider == providerId && status.activeVersion != null
					? status.activeVersion : item.packageVersion,
				packageVersion: item.packageVersion,
				installed: true,
				sourceId: 'installed-runtime',
				artifactAvailable: true,
				installable: true,
				architectureCompatible: true,
				unavailableReason: null
			};
	}
	return null;
}

export const proxy_provider_status = function () {
	let state = load_state();
	let installed = installed_rows();
	let activeProvider = state.activeProvider;
	let stateProvider = provider_by_id(activeProvider);
	if (length(installed) == 0 && stateProvider != null &&
		safe_package_version(state.activeVersion) && stat(BINARY_PATH) != null) {
		push(installed, {
			provider: stateProvider.id,
			package: null,
			packageVersion: safe_package_version(state.activePackageVersion) ? state.activePackageVersion : state_package_version(stateProvider.id, state.activeVersion),
			source: 'pinned-release'
		});
	}
	if (activeProvider == null && length(installed) == 1)
		activeProvider = installed[0].provider;

	let activeInstalled = false;
	let activePackageVersion = null;
	for (let i = 0; i < length(installed); i++) {
		if (installed[i].provider == activeProvider) {
			activeInstalled = true;
			activePackageVersion = installed[i].packageVersion;
		}
	}

	let provider = provider_by_id(activeProvider);
	let activeVersion = activeInstalled && state.activeProvider == activeProvider && safe_package_version(state.activeVersion)
		? state.activeVersion : activePackageVersion;
	return {
		ok: true,
		optional: true,
		latestOnly: false,
		installed: activeInstalled,
		activeProvider: activeInstalled ? activeProvider : null,
		activeVersion: activeVersion,
		activePackageVersion: activeInstalled ? activePackageVersion : null,
		latestVersion: null,
		updateAvailable: null,
		packages: installed,
		binaryPresent: stat(BINARY_PATH) != null,
		running: running(),
		configPreserved: stat(CONFIG_DIR) != null,
		drift: length(installed) > 1 || (length(installed) == 1 && !activeInstalled)
	};
};

export const proxy_provider_versions = function () {
	let status = proxy_provider_status(), arch = architecture(), rows = [], allOk = arch != null;
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i], versions = [], installed = installed_version_row(status, provider.id), latest = null;
		if (arch != null) {
			let resolved = latest_candidate(provider.id, arch);
			if (resolved.ok) {
				latest = resolved.candidate;
				push(versions, latest);
			} else if (installed == null) {
				allOk = false;
			}
		}
		if (installed != null) push(versions, installed);
		push(rows, { id: provider.id, provider: provider.id, versions: versions, latest: latest,
			architecture: arch, error: latest == null && installed == null ? 'Версия недоступна.' : null });
	}
	return { ok: status.ok === true && allOk, optional: true, latestOnly: false, architecture: arch, providers: rows };
};

function check_input(value) {
	if (type(value) != 'object' || value == null || type(value.provider) != 'string' || provider_by_id(value.provider) == null)
		return false;
	let ks = keys(value);
	if (length(ks) == 1) return true;
	if (length(ks) == 2 && type(value.version) == 'string' && safe_package_version(value.version)) return true;
	return length(ks) == 3 && type(value.sourceId) == 'string' &&
		(value.sourceId == 'z2m-provider-feed' || value.sourceId == 'official-github-release') &&
		type(value.version) == 'string' && safe_package_version(value.version);
}

export const proxy_provider_check_updates = function (input) {
	if (!check_input(input)) return error('EINPUT', 'Нужно выбрать Rust или Go.');
	let arch = architecture();
	if (arch == null) return error('EARCH', 'Архитектура устройства не распознана.');
	let resolved = list_candidates(input.provider, arch);
	if (!resolved.ok) return resolved;
	let candidates = resolved.candidates;
	let status = proxy_provider_status();
	let installedVersion = status.installed && status.activeProvider == input.provider
		? status.activeVersion : null;
	let versions = [];
	for (let i = 0; i < length(candidates); i++)
		push(versions, public_version_row(candidates[i], installedVersion));
	let latest = null;
	for (let j = 0; j < length(candidates); j++)
		if (candidates[j].prerelease !== true && (latest == null ||
			compare_versions(candidates[j].version, latest.version) > 0))
			latest = candidates[j];
	if (input.version != null) {
		let exact = null;
		for (let k = 0; k < length(candidates); k++)
			if (candidates[k].version == input.version) { exact = candidates[k]; break; }
		if (exact == null)
			return error('EVERSION', 'Выбранная версия недоступна для этой архитектуры.');
	}
	let token = random_token();
	if (safe_token(token) == null) return error('EINTERNAL', 'Не удалось создать token проверки.');
	ensure_dir(CHECK_DIR);
	let now = time();
	let record = { schema: 'proxy-provider-check.v2', token: token, checkedAt: now,
		expiresAt: now + CHECK_TTL, provider: input.provider, candidates: candidates };
	if (!atomic_json(CHECK_DIR + '/' + token + '.json', record)) return error('EINTERNAL', 'Не удалось сохранить результат проверки.');
	return {
		ok: true,
		checkToken: token,
		checkedAt: now,
		expiresAt: now + CHECK_TTL,
		provider: input.provider,
		installedVersion: installedVersion,
		latestVersion: latest != null ? latest.version : null,
		availableVersions: versions,
		updateAvailable: installedVersion != null && latest != null &&
			compare_versions(latest.version, installedVersion) > 0,
		providerSwitch: status.installed && status.activeProvider != input.provider
	};
};

function load_checked_candidate(providerId, token, version) {
	if (provider_by_id(providerId) == null || safe_token(token) == null) return error('EINPUT', 'Некорректный provider или check token.');
	let path = CHECK_DIR + '/' + token + '.json', record = read_json(path, null);
	if (record == null || record.token != token || record.provider != providerId)
		return error('ECHECKTOKEN', 'Сначала выполните проверку обновлений.');
	if (+record.expiresAt < time()) { try { unlink(path); } catch (e) { } return error('ECHECKEXPIRED', 'Результат проверки устарел. Повторите проверку.'); }
	if (type(version) != 'string' || !safe_package_version(version))
		return error('EINPUT', 'Требуется точная выбранная версия.');
	let candidate = null;
	for (let i = 0; i < length(record.candidates); i++)
		if (record.candidates[i].version == version) { candidate = record.candidates[i]; break; }
	if (candidate == null || candidate.installable !== true)
		return error('EINCOMPATIBLE', 'Выбранная версия недоступна или небезопасна для установки.');
	try { unlink(path); } catch (e) { }
	return { ok: true, candidate: candidate };
}

function remove_packages() {
	let failures = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		if (!package_present(provider.package)) continue;
		let names = provider_package_names(provider);
		for (let j = 0; j < length(names); j++) {
			if (!package_present(names[j])) continue;
			let r = run('apk del --no-interactive ' + names[j]);
			if (r.rc != 0 || package_present(names[j])) push(failures, names[j]);
		}
	}
	let state = load_state();
	if (length(failures) == 0 && state.activeProvider != null && stat(BINARY_PATH) != null) {
		let removed = run('rm -f ' + literal(BINARY_PATH));
		if (removed.rc != 0 || stat(BINARY_PATH) != null) push(failures, 'direct-binary-remove');
	}
	return failures;
}

function restore_previous(previous, wasRunning, settingsSnapshot) {
	let failures = remove_packages();
	if (previous.activeProvider != null && previous.packageVersion != null) {
		let provider = provider_by_id(previous.activeProvider);
		if (provider == null || !safe_package_version(previous.packageVersion)) {
			push(failures, 'previous-provider-unknown');
		} else if (previous.package != null && !package_present(previous.package)) {
			let add = run('apk add --no-interactive --allow-untrusted ' + previous.package + '=' + previous.packageVersion);
			if (add.rc != 0 || !package_present(previous.package)) push(failures, 'previous-package-restore');
			else if (!save_state(previous.activeProvider, previous.activeVersion, previous.packageVersion))
				push(failures, 'previous-state-restore');
		} else if (!save_state(previous.activeProvider, previous.activeVersion, previous.packageVersion)) {
			push(failures, 'previous-state-restore');
		}
	} else if (!save_state(null, null, null)) push(failures, 'empty-state-restore');
	if (!restore_settings(settingsSnapshot)) push(failures, 'settings-restore');
	if (!restore_binary(settingsSnapshot)) push(failures, 'binary-restore');
	if (wasRunning && length(failures) == 0 && service('start') != 0) push(failures, 'previous-service-restore');
	return failures;
}

// Manager-owned shared TG lifecycle surface. Guarantees init script,
// default config and secret exist BEFORE any provider install runs, so a
// clean router never hits "no service owner -> cannot install".
// Repair semantics (design §5: manager-owned surface, repaired at runtime):
//  - init script is rewritten whenever its content drifts from
//    DEFAULT_INIT_BODY (e.g. after package update changes the body);
//  - secret.conf missing OR in the legacy `TG_SECRET=` format is migrated to
//    the canonical `SECRET=<32hex>` without changing ownership/mode;
//  - config.conf is only created when missing (user edits are preserved).
function ensure_shared_lifecycle() {
	let failures = [];
	let noRepair = getenv('Z2M_TGPROVIDER_NO_REPAIR') == '1';
	if (!noRepair) {
		if (stat(INIT_PATH) != null) {
			let cur = readfile(INIT_PATH);
			if (cur == null || cur != DEFAULT_INIT_BODY) {
				let tmp = INIT_PATH + '.z2m.new';
				if (!writefile(tmp, DEFAULT_INIT_BODY)) push(failures, 'init-repair-write');
				else if (run('chmod 755 ' + literal(tmp) + ' && mv -f ' + literal(tmp) + ' ' + literal(INIT_PATH)).rc != 0)
					push(failures, 'init-repair');
			}
		}
	}
	if (stat(INIT_PATH) == null) {
		run('mkdir -p ' + literal(substr(INIT_PATH, 0, INIT_PATH.lastIndexOf('/'))));
		if (!writefile(INIT_PATH, DEFAULT_INIT_BODY)) push(failures, 'init-write');
		else if (run('chmod 755 ' + literal(INIT_PATH)).rc != 0) push(failures, 'init-chmod');
	}
	if (stat(CONFIG_DIR + '/config.conf') == null) {
		run('mkdir -p ' + literal(CONFIG_DIR));
		if (!writefile(CONFIG_DIR + '/config.conf', default_config_body()))
			push(failures, 'config-write');
	}
	let secretRaw = stat(SECRET_PATH) != null ? readfile(SECRET_PATH) : null;
	let canonical = match(secretRaw != null ? secretRaw : '', /(^|\n)SECRET=[a-f0-9]{32}(\n|$)/) != null;
	if (!canonical) {
		// Migrate the legacy TG_SECRET=48hex form by reusing its first 32 hex
		// characters; otherwise generate a fresh CSPRNG secret.
		let legacy = match(secretRaw != null ? secretRaw : '', /TG_SECRET=([a-f0-9]{48})/);
		let token = legacy != null ? substr(legacy[1], 0, 32) : random_hex32();
		run('mkdir -p ' + literal(CONFIG_DIR));
		if (token == null || !writefile(SECRET_PATH, '# MTProto secret for tg-ws-proxy — managed by zapret2-manager.\nSECRET=' + token + '\n'))
			push(failures, 'secret-write');
		else if (run('chmod 600 ' + literal(SECRET_PATH)).rc != 0) push(failures, 'secret-chmod');
	}
	return length(failures) == 0 ? { ok: true } : error('ESTATE', 'Не удалось подготовить shared lifecycle: ' + join(',', failures));
}

function download_verified_artifact(candidate) {
	if (type(candidate.downloadUrl) != 'string' || substr(candidate.downloadUrl, 0, 8) != 'https://')
		return error('ESECURITY', 'Ссылка release не прошла allowlist.');
	if (candidate.assetSize != null && (+candidate.assetSize < 1024 || +candidate.assetSize > 33554432))
		return error('EINCOMPATIBLE', 'Размер артефакта вне допустимых границ.');
	let archive = '/tmp/zapret2-manager/tg-proxy.' + time() + '.artifact';
	run('mkdir -p /tmp/zapret2-manager');
	let archiveQ = literal(archive), urlQ = literal(candidate.downloadUrl);
	if (archiveQ == null || urlQ == null) return error('ESECURITY', 'Ссылка release не прошла allowlist.');
	let download = run('ulimit -f 65536; uclient-fetch -q -T 60 --user-agent zapret2-manager/tg-proxy -O ' + archiveQ + ' ' + urlQ);
	if (download.rc != 0 || stat(archive) == null) {
		run('rm -f ' + archiveQ);
		return error('ENETWORK', 'Не удалось загрузить официальный release.');
	}
	if (candidate.assetSha256 != null) {
		let digest = trim(run('sha256sum ' + archiveQ + " | awk '{print $1}'").out);
		if (lc(digest) != lc(candidate.assetSha256)) {
			run('rm -f ' + archiveQ);
			return error('EVERIFY', 'SHA-256 артефакта не совпал с digest из GitHub release.');
		}
	}
	return { ok: true, path: archive };
}

// RustAdapter: tar.gz -> validated extraction in private staging ->
// atomic binary replace. Rejects absolute paths and ../ traversal.
function install_rust_archive(candidate) {
	let fetched = download_verified_artifact(candidate);
	if (!fetched.ok) return fetched;
	let archiveQ = literal(fetched.path);
	let staging = '/tmp/zapret2-manager/tg-proxy-extract.' + time();
	let stagingQ = literal(staging);
	if (stagingQ == null) { run('rm -f ' + archiveQ); return error('EINTERNAL', 'Staging недоступен.'); }
	let listing = run('tar -tzf ' + archiveQ);
	if (listing.rc != 0) { run('rm -rf ' + archiveQ + ' ' + stagingQ); return error('EVERIFY', 'Архив повреждён.'); }
	let rows = split(listing.out, '\n');
	for (let i = 0; i < length(rows); i++) {
		let entry = trim(rows[i]);
		if (entry == '') continue;
		if (substr(entry, 0, 1) == '/' || index(entry, '../') >= 0 || index(entry, '..\\') >= 0) {
			run('rm -rf ' + archiveQ + ' ' + stagingQ);
			return error('EVERIFY', 'Архив содержит небезопасные пути.');
		}
	}
	if (run('mkdir ' + stagingQ + ' && tar -xzf ' + archiveQ + ' -C ' + stagingQ).rc != 0) {
		run('rm -rf ' + archiveQ + ' ' + stagingQ);
		return error('EVERIFY', 'Архив не удалось распаковать.');
	}
	let binary = trim(run("find " + stagingQ + " -type f -name tg-ws-proxy | head -n 1").out);
	let binaryQ = literal(binary), staged = literal(BINARY_PATH + '.new');
	let bad = binaryQ == null || stat(binary) == null ||
		run('chmod 755 ' + binaryQ + ' && cp -f ' + binaryQ + ' ' + staged +
			' && chmod 755 ' + staged + ' && mv -f ' + staged + ' ' + literal(BINARY_PATH)).rc != 0;
	run('rm -rf ' + archiveQ + ' ' + stagingQ);
	if (bad) return error('ETARGET', 'Не удалось установить tg-ws-proxy binary.');
	return { ok: true };
}

// GoAdapter: OpenWrt APK asset -> verified apk add.
function install_go_apk(candidate) {
	let fetched = download_verified_artifact(candidate);
	if (!fetched.ok) return fetched;
	let archiveQ = literal(fetched.path);
	let add = run('apk add --no-interactive --allow-untrusted ' + archiveQ);
	run('rm -f ' + archiveQ);
	if (add.rc != 0 || stat(BINARY_PATH) == null)
		return error('ETARGET', 'Установка Go provider APK не удалась или binary отсутствует.');
	return { ok: true };
}

// Local hard health gate. External Telegram reachability is NEVER part of
// this gate; it is a separate runtime signal. Process/listener detection
// waits bounded seconds for procd to actually fork+exec the binary.
function tg_provider_health(providerId) {
	if (stat(BINARY_PATH) == null) {
		operation_stage('HEALTHCHECK', 90, 'diag: ' + trim(run('ls -la ' + literal(BINARY_PATH) + ' 2>&1; ls ' + literal(BINARY_PATH) + '.* 2>&1').out));
		return { ok: false, code: 'EBINARY', message: 'Binary tg-ws-proxy отсутствует.' };
	}
	if (stat(INIT_PATH) == null) return { ok: false, code: 'EINIT', message: 'Init script tg-ws-proxy отсутствует.' };
	if (stat(SECRET_PATH) == null) return { ok: false, code: 'ESECRET', message: 'Secret файл отсутствует.' };
	let lastProcessCode = 'EPROCESS', lastProcessMessage = 'Процесс tg-ws-proxy не найден после запуска.';
	let processes = [], port = null;
	for (let attempt = 0; attempt < 6; attempt++) {
		if (attempt > 0) run('sleep 1');
		processes = [];
		let psLines = split(run('ps w').out, '\n');
		for (let i = 0; i < length(psLines); i++)
			if (index(psLines[i], BINARY_PATH) >= 0) push(processes, psLines[i]);
		if (length(processes) == 0) { lastProcessCode = 'EPROCESS'; lastProcessMessage = 'Процесс tg-ws-proxy не найден после запуска.'; continue; }
		if (length(processes) > 1) { lastProcessCode = 'EPROCESSCOUNT'; lastProcessMessage = 'Запущено более одного процесса tg-ws-proxy.'; break; }
		let pid = trim(split(trim(processes[0]), /\s+/)[0]);
		port = null;
		let netLines = split(run('netstat -tlnp 2>/dev/null').out, '\n');
		for (let j = 0; j < length(netLines); j++) {
			let rowLine = netLines[j];
			// busybox netstat -p prints "PID/basename", never the full path.
			if (index(rowLine, 'LISTEN') < 0) continue;
			if (pid != '' && index(rowLine, pid + '/') < 0 && index(rowLine, ' ' + pid + ' ') < 0) continue;
			let parts = split(trim(rowLine), /\s+/);
			if (length(parts) >= 4) {
				let seg = split(parts[3], ':');
				port = seg[length(seg) - 1];
			}
			break;
		}
		if (port != null)
			return { ok: true, listenerPort: port, processEvidence: trim(processes[0]) };
		lastProcessCode = 'ELISTENER';
		lastProcessMessage = 'Процесс запущен, но не владеет TCP listener.';
	}
	return { ok: false, code: lastProcessCode, message: lastProcessMessage };
}

// Unified lifecycle transaction for BOTH providers: resolve exact selected
// version -> download+verify -> snapshot -> stop -> adapter install ->
// start -> local hard health gate -> state commit. Failures roll back to
// the previous working provider.
export const proxy_provider_install = function (input) {
	if (type(input) != 'object' || input == null || type(input.provider) != 'string' ||
		type(input.checkToken) != 'string')
		return error('EINPUT', 'Установка требует provider и token свежей проверки.');
	let provider = provider_by_id(input.provider);
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let checked = load_checked_candidate(provider.id, input.checkToken, input.version);
	if (!checked.ok) return checked;
	let latest = checked.candidate;
	let opType = 'INSTALL';
	operation_begin(opType, provider.id, latest.version);
	operation_stage('PREPARE', 8, 'Подготавливаем shared lifecycle');
	let shared = ensure_shared_lifecycle();
	if (!shared.ok) { operation_complete('FAILED', shared); return shared; }
	if (!acquire_lock()) { let e = error('EBUSY', 'Установка TG Proxy уже выполняется.'); operation_complete('FAILED', e); return e; }

	let previousStatus = proxy_provider_status();
	let previous = {
		activeProvider: previousStatus.activeProvider,
		activeVersion: previousStatus.activeVersion,
		packageVersion: previousStatus.activePackageVersion,
		package: previousStatus.packages && length(previousStatus.packages) ? previousStatus.packages[0].package : null
	};
	let wasRunning = previousStatus.running === true;
	if (provider.id != previous.activeProvider && previous.activeProvider != null) opType = 'SWITCH';
	OPERATION.type = opType;
	operation_stage('PREFLIGHT', 16, 'Проверяем выбранный релиз');
	let settingsSnapshot = snapshot_settings();
	let result = null;
	try {
		let alreadyLatest = previousStatus.installed &&
			previous.activeProvider == provider.id &&
			previous.activeVersion == latest.version;
		if (!settingsSnapshot.ok) {
			result = error('ESTATE', 'Настройки не удалось сохранить; установка не начата.');
		} else if (alreadyLatest) {
			operation_stage('COMMIT', 100, 'Уже установлено');
			result = { ok: true, changed: false, status: previousStatus };
		} else {
			if (wasRunning) {
				operation_stage('BACKUP', 24, previous.activeProvider != provider.id ? 'Сохраняем настройки текущего провайдера' : 'Создаём точку отката');
				if (service('stop') != 0) {
					result = error('ETARGET', 'Не удалось остановить текущий TG Proxy.');
				}
			}
			if (result == null) {
				// Providers are mutually exclusive: the Rust adapter installs a
					// raw binary that does not trigger APK CONFLICTS, so the Go
					// package must be removed explicitly (rollback restores it).
					operation_stage('INSTALL', 58, 'Убираем конфликтующий провайдер');
					let conflicts = provider.id == 'rust' ? [ 'tg-ws-proxy-go', 'tg-ws-proxy' ] : [ 'tg-ws-proxy-rs' ];
					for (let ci = 0; ci < length(conflicts); ci++)
						if (package_present(conflicts[ci])) run('apk del --no-interactive ' + conflicts[ci]);
					operation_stage('INSTALL', 62, 'Устанавливаем ' + provider.title + ' ' + latest.version);
				operation_stage('DOWNLOAD', 40, 'Скачиваем релиз ' + latest.version);
				let installed = latest.artifactKind == 'apk' ? install_go_apk(latest) : install_rust_archive(latest);
				if (!installed.ok) {
					result = { ok: false, error: installed.error, rollbackFailures: restore_previous(previous, wasRunning, settingsSnapshot) };
				} else {
						if (!restore_settings(settingsSnapshot))
						result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось восстановить настройки после установки.' }, rollbackFailures: restore_previous(previous, wasRunning, settingsSnapshot) };
					else {
						operation_stage('RESTART', 78, 'Запускаем сервис');
						if (service('enable') != 0 || service('start') != 0)
							result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось запустить сервис TG Proxy.' }, rollbackFailures: restore_previous(previous, wasRunning, settingsSnapshot) };
						else {
							operation_stage('HEALTHCHECK', 90, 'Проверяем Telegram Proxy');
							let health = tg_provider_health(provider.id);
							if (!health.ok) {
								// We started this service; the failed version must not
								// keep running while rollback restores the previous one.
								service('stop');
								let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
								let restartedOk = wasRunning ? service('start') == 0 : true;
								if (!restartedOk) push(rollbackFailures, 'previous-service-restart');
								result = { ok: false, error: { code: 'ETGHEALTH', message: health.message }, health: health, rollbackFailures: rollbackFailures };
							} else {
								save_state(provider.id, latest.version, state_package_version(provider.id, latest.version));
								let reread = proxy_provider_status();
								result = {
									ok: reread.installed && reread.activeProvider == provider.id &&
										reread.activeVersion == latest.version && health.ok,
									changed: true,
									provider: provider.id,
									version: latest.version,
									health: health,
									status: reread,
									settingsPreserved: settingsSnapshot.hadConfig === true
								};
								if (!result.ok) {
									service('stop');
									result.rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
									result.error = { code: 'EVERIFY', message: 'Установка не подтверждена повторным чтением.' };
								}
							}
						}
					}
				}
			}
		}
	} catch (e) {
		let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
		result = { ok: false, error: { code: 'EINTERNAL', message: 'Сбой транзакции установки.' }, rollbackFailures: rollbackFailures };
	}
	if (result == null) result = error('EINTERNAL', 'Транзакция установки не завершилась.');
	if (result.ok === true) operation_stage('COMMIT', 100, 'Готово');
	if (length(result.rollbackFailures != null ? result.rollbackFailures : []) > 0)
		operation_complete('ROLLED_BACK', result);
	else if (result.ok === true)
		operation_complete('COMPLETE', result);
	else
		operation_complete('FAILED', result);
	clear_snapshot();
	release_lock();
	return result;
};

export const proxy_provider_remove = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'REMOVE')
		return error('EINPUT', 'Удаление требует подтверждение REMOVE.');
	if (!acquire_lock()) return error('EBUSY', 'Другая операция TG Proxy уже выполняется.');
	let status = proxy_provider_status();
	operation_begin('REMOVE', status.activeProvider, status.activeVersion);
	let wasRunning = running();
	let settingsSnapshot = snapshot_settings();
	let result = null;
	try {
		if (!settingsSnapshot.ok) result = error('ESTATE', 'Настройки не удалось сохранить; удаление не начато.');
		else {
			operation_stage('STOP', 30, wasRunning ? 'Останавливаем сервис' : 'Сервис не запущен');
			if (wasRunning && service('stop') != 0) result = error('ETARGET', 'Не удалось остановить TG Proxy.');
			else {
				operation_stage('REMOVE', 65, 'Удаляем провайдер');
				let failures = remove_packages();
				if (length(failures) > 0) result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить пакет TG Proxy.' }, failures: failures };
				else if (!restore_settings(settingsSnapshot)) result = error('ETARGET', 'Пакет удалён, но настройки восстановить не удалось.');
				else if (!save_state(null, null, null)) result = error('ETARGET', 'Не удалось обновить состояние после удаления.');
				else result = { ok: true, installed: false, settingsPreserved: settingsSnapshot.hadConfig === true, running: false };
			}
		}
	} catch (e) {
		result = error('EINTERNAL', 'Сбой удаления TG Proxy.');
	}
	if (result.ok === true) { operation_stage('VERIFY', 90, 'Проверяем результат'); operation_complete('COMPLETE', result); }
	else operation_complete('FAILED', result);
	clear_snapshot();
	release_lock();
	return result;
};

// Poll target for the UI progress modal. Returns the durable record; after a
// page reload mid-transaction the RUNNING state lets the client re-attach
// instead of starting a second install on top of the active one.
export const proxy_provider_operation_status = function (input) {
	let record = read_json(OPERATION_FILE, null);
	if (record == null) return { ok: true, operation: null };
	if (type(input) == 'object' && input != null && input.operationId != null &&
		input.operationId != record.operationId)
		return { ok: true, operation: null };
	if (record.state == 'RUNNING' && time() - (+record.updatedAt) > OPERATION_TTL) {
		// Orphaned RUNNING record (e.g. router clock jump): expire it.
		record.state = 'FAILED';
		record.error = { code: 'EOPERATIONSTALE', message: 'Операция прервалась и не была завершена.' };
		record.updatedAt = time();
		atomic_json(OPERATION_FILE, record);
	}
	return { ok: true, operation: operation_public(record) };
};

export const proxy_provider_purge = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'PURGE')
		return error('EINPUT', 'Полная очистка требует подтверждение PURGE.');
	let removed = proxy_provider_remove({ confirm: 'REMOVE' });
	if (!removed.ok) return removed;
	let rm = run('rm -rf ' + CONFIG_DIR + ' ' + STATE_FILE);
	if (rm.rc != 0 || stat(CONFIG_DIR) != null) return error('ETARGET', 'Пакет удалён, но настройки очистить не удалось.');
	return { ok: true, installed: false, settingsPreserved: false, purged: true };
};
