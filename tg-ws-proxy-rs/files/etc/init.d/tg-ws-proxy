#!/bin/sh /etc/rc.common
# init.d/tg-ws-proxy — procd service for the pinned tg-ws-proxy-rs MTProto bridge.
#
# INDEPENDENCE: this service manages ONLY /usr/bin/tg-ws-proxy. It never calls
# /etc/init.d/zapret2 (the bypass engine) and nothing on the zapret2 side calls
# this script — a restart of one service never restarts the other.
#
# STARTUP GATES (validate_config REFUSES to start — reason on stderr + syslog —
# when any of these holds):
#   1. the binary is missing/not executable (package partially removed);
#   2. config.conf is missing/unreadable (no manager apply has happened);
#   3. ENABLED != 1 (operator intent lives in the manager-owned config, and a
#      boot start with a disabled config stays down even if an rc.d symlink
#      exists);
#   4. secret.conf is missing, has a mode other than 0600, or SECRET is not
#      exactly 32 lowercase hex chars (the provider-required format);
#   5. HOST is empty or a wildcard (0.0.0.0 / :: / *) — v1 has NO wildcard
#      bind: the listener must bind the explicit LAN address (or a 127.x
#      loopback for diagnostics), and a HOST that is not a local interface
#      address is refused instead of falling back to wildcard;
#   6. PORT is not an integer in 1..65535;
#   7. a listener already holds HOST:PORT, 0.0.0.0:PORT or :::PORT (a wildcard
#      holder conflicts with any bind of that port).
#
# SECRET HANDLING: the MTProto secret reaches the provider ONLY through the
# TG_SECRET environment variable — at v1.6.5 every provider flag except
# --dc-ip has an env alias, so the secret never appears in argv (no ps
# exposure). Residual: it is visible to root via /proc/<pid>/environ; accepted
# and documented in docs/research/tg-ws-proxy-provider.md. DC mappings go via
# argv (--dc-ip) because no env alias exists — IPs are not secret material.
#
# LOGGING: the provider writes to $LOG_FILE (pre-created 0600 below). Its
# startup tg:// link EMBEDS the secret, so the log must stay root-only from
# the first byte; the manager's proxy_logs_tail redacts secret patterns before
# returning anything.
#
# NO FIREWALL RULES are installed here (v1): exposure is governed by the bind
# address alone — LAN-only by policy, never WAN.

USE_PROCD=1
START=90
STOP=10

PROG=/usr/bin/tg-ws-proxy
CONF_DIR=/etc/tg-ws-proxy
CONF="$CONF_DIR/config.conf"
SECRET_CONF="$CONF_DIR/secret.conf"
LOG_FILE=/var/log/tg-ws-proxy.log

log_refuse() {
	echo "tg-ws-proxy: refusing start: $*" >&2
	logger -t tg-ws-proxy -p daemon.err "init: refusing start: $*"
}

# conf_val KEY — value of the first active `KEY=` assignment (quotes stripped).
# KEY is always a constant here; values are manager-validated before they ever
# reach the file.
conf_val() {
	sed -n "s/^$1=//p" "$CONF" 2>/dev/null | head -n 1 | sed 's/^"//; s/"$//' | tr -d '\r'
}

# ipv4_ok ADDR — dotted quad, four octets 0..255, no leading zeros ("0" ok).
ipv4_ok() {
	case "$1" in
		""|*[!0-9.]*) return 1 ;;
	esac
	local IFS=.
	set -- $1
	[ "$#" -eq 4 ] || return 1
	local o
	for o; do
		case "$o" in
			0|[1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]) : ;;
			*) return 1 ;;
		esac
	done
	return 0
}

# port_held HOST PORT — non-empty output when a listener holds HOST:PORT or a
# wildcard (:IPv4-any / :IPv6-any) of PORT.
port_held() {
	netstat -tln 2>/dev/null | awk 'NR>2 {print $4}' | while IFS= read -r la; do
		case "$la" in
			"$1:$2"|"0.0.0.0:$2"|":::$2") echo held; break ;;
		esac
	done
}

validate_config() {
	[ -x "$PROG" ] || { log_refuse "binary $PROG missing or not executable (package tg-ws-proxy-rs not installed?)"; return 1; }
	[ -f "$CONF" ] || { log_refuse "config $CONF missing — apply a configuration first (zapret2-manager proxy_config_apply)"; return 1; }
	[ -r "$CONF" ] || { log_refuse "config $CONF is not readable"; return 1; }

	local ENABLED; ENABLED=$(conf_val ENABLED)
	[ "$ENABLED" = "1" ] || { log_refuse "disabled by config (ENABLED != 1) — enable via the manager, not by editing init"; return 1; }

	[ -f "$SECRET_CONF" ] || { log_refuse "secret $SECRET_CONF missing — generate/rotate via zapret2-manager proxy_secret_rotate"; return 1; }
	local MODE; MODE=$(ls -l "$SECRET_CONF" 2>/dev/null | awk '{print $1}')
	local OCT
	case "$MODE" in
		-rw-------) OCT=600 ;;
		*)         OCT= ;;
	esac
	[ -n "$OCT" ] || { log_refuse "secret $SECRET_CONF has mode ${MODE:-unknown} — expected 600"; return 1; }
	SECRET=$(sed -n 's/^SECRET=//p' "$SECRET_CONF" 2>/dev/null | head -n 1 | tr -d '\r')
	if [ "${#SECRET}" -ne 32 ] || ! printf '%s' "$SECRET" | grep -q '^[0-9a-f]*$'; then
		log_refuse "SECRET in $SECRET_CONF is malformed — expected exactly 32 lowercase hex chars"
		return 1
	fi

	HOST=$(conf_val HOST)
	PORT=$(conf_val PORT)
	case "$HOST" in
		""|0.0.0.0|"::"|"*")
			log_refuse "HOST '$HOST' is empty or a wildcard — v1 policy requires an explicit LAN (or 127.x loopback) bind; wildcard is not supported"
			return 1 ;;
	esac
	if ! ipv4_ok "$HOST"; then
		log_refuse "HOST '$HOST' is not a valid IPv4 address (IPv6 bind is not supported in v1)"
		return 1
	fi
	case "$HOST" in
		127.*)
			: ;;  # loopback bind allowed for diagnostics
		*)
			ip -o addr show 2>/dev/null | grep -qw "$HOST" || {
				log_refuse "HOST $HOST is not a local interface address — refusing instead of falling back to wildcard"
				return 1
			} ;;
	esac

	case "$PORT" in
		""|*[!0-9]*) log_refuse "PORT '$PORT' is not numeric"; return 1 ;;
	esac
	[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { log_refuse "PORT $PORT out of range (1..65535)"; return 1; }

	[ -z "$(port_held "$HOST" "$PORT")" ] || {
		log_refuse "port $PORT is already bound by this address or a wildcard holder — port conflict"
		return 1
	}
	return 0
}

start_service() {
	validate_config || return 1

	# Optional values (richly validated by the manager before they land here;
	# only coarse safety gates belong in init).
	LINK_IP=$(conf_val LINK_IP)
	POOL_SIZE=$(conf_val POOL_SIZE)
	BUF_KB=$(conf_val BUF_KB)
	MAX_CONNECTIONS=$(conf_val MAX_CONNECTIONS)
	QUIET=$(conf_val QUIET)
	VERBOSE=$(conf_val VERBOSE)
	FAKETLS_DOMAIN=$(conf_val FAKETLS_DOMAIN)
	DC_IPS=$(conf_val DC_IPS)
	CF_DOMAINS=$(conf_val CF_DOMAINS)
	CF_WORKER_DOMAINS=$(conf_val CF_WORKER_DOMAINS)
	CF_PRIORITY=$(conf_val CF_PRIORITY)
	CF_BALANCE=$(conf_val CF_BALANCE)
	DEFAULT_DOMAINS=$(conf_val DEFAULT_DOMAINS)
	MTPROTO_PROXIES=$(conf_val MTPROTO_PROXIES)
	OUTBOUND_PROXY=$(conf_val OUTBOUND_PROXY)
	NO_PROXY=$(conf_val NO_PROXY)

	# The provider prints its startup tg:// link (embedding the secret) into
	# the log — keep the log root-only from the first byte.
	[ -f "$LOG_FILE" ] || { touch "$LOG_FILE" && chmod 0600 "$LOG_FILE"; }

	# argv carries ONLY --dc-ip pairs (the one provider option with no env
	# alias; DC IPs are not secret). procd execs argv without a shell — each
	# token is exactly one argv element. Every pair is re-gated here.
	# Build dc-ip args FIRST, before repurposing $@ for env vars.
	local pair dc ip oldifs
	local dc_args=""
	if [ -n "$DC_IPS" ]; then
		oldifs=$IFS; IFS=,
		for pair in $DC_IPS; do
			dc=${pair%%:*}
			ip=${pair#*:}
			case "$dc" in
				""|*[!0-9-]*|*-*)   # digits with an optional single -N suffix
					log_refuse "DC_IPS entry '$pair' is malformed (expected DC:IPv4, e.g. 2:149.154.167.220)"
					return 1 ;;
			esac
			if [ "$ip" = "$pair" ] || ! ipv4_ok "$ip"; then
				log_refuse "DC_IPS entry '$pair' is malformed (expected DC:IPv4, e.g. 2:149.154.167.220)"
				return 1
			fi
			dc_args="$dc_args --dc-ip $pair"
		done
		IFS=$oldifs
	fi

	# Build env vars as separate arguments. procd_set_param env OVERWRITES on
	# each call, so accumulate all in one call via the positional args.
	set -- TG_HOST="$HOST" TG_PORT="$PORT" TG_SECRET="$SECRET" TG_LOG_FILE="$LOG_FILE"
	[ -n "$LINK_IP" ] && set -- "$@" TG_LINK_IP="$LINK_IP"
	[ -n "$POOL_SIZE" ] && set -- "$@" TG_POOL_SIZE="$POOL_SIZE"
	[ -n "$BUF_KB" ] && set -- "$@" TG_BUF_KB="$BUF_KB"
	[ -n "$MAX_CONNECTIONS" ] && set -- "$@" TG_MAX_CONNECTIONS="$MAX_CONNECTIONS"
	[ "$QUIET" = "1" ] && set -- "$@" TG_QUIET=true
	[ "$VERBOSE" = "1" ] && set -- "$@" TG_VERBOSE=true
	[ -n "$FAKETLS_DOMAIN" ] && set -- "$@" TG_LISTEN_FAKETLS_DOMAIN="$FAKETLS_DOMAIN"
	[ -n "$CF_DOMAINS" ] && set -- "$@" TG_CF_DOMAIN="$CF_DOMAINS"
	[ -n "$CF_WORKER_DOMAINS" ] && set -- "$@" TG_CF_WORKER_DOMAIN="$CF_WORKER_DOMAINS"
	[ "$CF_PRIORITY" = "1" ] && set -- "$@" TG_CF_PRIORITY=true
	[ "$CF_BALANCE" = "1" ] && set -- "$@" TG_CF_BALANCE=true
	[ "$DEFAULT_DOMAINS" = "1" ] && set -- "$@" TG_DEFAULT_DOMAINS=true
	[ -n "$MTPROTO_PROXIES" ] && set -- "$@" TG_MTPROTO_PROXY="$MTPROTO_PROXIES"
	[ -n "$OUTBOUND_PROXY" ] && set -- "$@" TG_OUTBOUND_PROXY="$OUTBOUND_PROXY"
	[ -n "$NO_PROXY" ] && set -- "$@" TG_NO_PROXY="$NO_PROXY"

	procd_open_instance
	procd_set_param command "$PROG" $dc_args
	procd_set_param env "$@"

	# BOUNDED respawn: procd restarts a crashed instance at most 5 times (5s
	# apart) when it dies inside a 3600s window, then stops retrying — no
	# infinite restart loop.
	procd_set_param respawn 3600 5 5
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_close_instance
}

# Config change needs a full process restart: all provider settings are fixed
# at process start (env/argv), there is no live-reload signal.
reload_service() {
	stop
	start
}

extra_command "validate" "Validate config + secret + bind/port gates without starting"

validate() {
	validate_config && echo "tg-ws-proxy: config OK"
}
