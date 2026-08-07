#!/bin/sh /etc/rc.common
USE_PROCD=1
START=99
STOP=10

PROG=/usr/bin/tg-ws-proxy
CONFIG_FILE=/etc/tg-ws-proxy/config.conf
SECRET_FILE=/etc/tg-ws-proxy/secret.conf
LOG_FILE=/var/log/tg-ws-proxy.log

value() {
	sed -n "s/^$1=//p" "$CONFIG_FILE" 2>/dev/null | head -n 1 | sed 's/^"//;s/"$//'
}

start_service() {
	[ -x "$PROG" ] || return 1
	[ -f "$CONFIG_FILE" ] || return 1
	[ -f "$SECRET_FILE" ] || return 1
	ENABLED=$(value ENABLED)
	[ "$ENABLED" = "1" ] || return 0
	HOST=$(value HOST); PORT=$(value PORT)
	SECRET=$(sed -n 's/^SECRET=//p' "$SECRET_FILE" | head -n 1)
	[ -n "$HOST" ] && [ -n "$PORT" ] && [ "${#SECRET}" -eq 32 ] || return 1
	POOL_SIZE=$(value POOL_SIZE); BUF_KB=$(value BUF_KB); MAX_CONNECTIONS=$(value MAX_CONNECTIONS)
	FAKETLS_DOMAIN=$(value FAKETLS_DOMAIN); CF_DOMAINS=$(value CF_DOMAINS)
	CF_WORKER_DOMAINS=$(value CF_WORKER_DOMAINS); CF_PRIORITY=$(value CF_PRIORITY)
	DEFAULT_DOMAINS=$(value DEFAULT_DOMAINS); DC_IPS=$(value DC_IPS); VERBOSE=$(value VERBOSE)
	[ -z "$(value MTPROTO_PROXIES)$(value OUTBOUND_PROXY)$(value NO_PROXY)" ] || return 1
	[ "$(value CF_BALANCE)" != "1" ] || return 1

	procd_open_instance tg-ws-proxy
	procd_set_param command "$PROG" --host "$HOST" --port "$PORT" --secret "$SECRET"
	[ -n "$POOL_SIZE" ] && procd_append_param command --pool-size "$POOL_SIZE"
	[ -n "$BUF_KB" ] && procd_append_param command --buf-kb "$BUF_KB"
	[ -n "$MAX_CONNECTIONS" ] && [ "$MAX_CONNECTIONS" != "0" ] && procd_append_param command --max-conns "$MAX_CONNECTIONS"
	[ -n "$FAKETLS_DOMAIN" ] && procd_append_param command --fake-tls-domain "$FAKETLS_DOMAIN"
	[ -n "$CF_DOMAINS" ] && procd_append_param command --cfproxy-domains "$CF_DOMAINS"
	[ -n "$CF_WORKER_DOMAINS" ] && procd_append_param command --cfproxy-worker-domain "$CF_WORKER_DOMAINS"
	[ "$CF_PRIORITY" = "0" ] && procd_append_param command --cfproxy-priority=false
	[ "$DEFAULT_DOMAINS" = "0" ] && [ -z "$CF_DOMAINS$CF_WORKER_DOMAINS" ] && procd_append_param command --no-cfproxy
	if [ -n "$DC_IPS" ]; then
		oldifs=$IFS; IFS=,
		for pair in $DC_IPS; do [ -n "$pair" ] && procd_append_param command --dc-ip "$pair"; done
		IFS=$oldifs
	fi
	[ "$VERBOSE" = "1" ] && { procd_append_param command -v; procd_append_param command --log-file "$LOG_FILE"; }
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_set_param respawn 3600 5 5
	procd_close_instance
}

reload_service() { stop; start; }
