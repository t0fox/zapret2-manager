'use strict';
// dns-global.uc — global DNS configuration for the DNS tab setup pane.
// Manages: mode (system/doh/dot/udp), primary/secondary providers,
// DNS hijack (port 53 intercept), DNS cache, advanced dnsmasq settings.
//
// Draft stored in state.json under `dns-global` key.
// Apply writes dnsmasq UCI server entries and optional firewall rules.
// All mutations keep a last-good snapshot for rollback.

import { readfile, writefile, stat, unlink, popen, mkdir } from 'fs';
import { load_state, save_state } from './profiles-draft.uc';
import { dns_provider_catalog_get } from './dns-provider-catalog.uc';

const SNAP_DIR = '/tmp/zapret2-manager/last-good/dns-global';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}

function err(code, message, stage) {
	return { ok: false, stage: (stage != null) ? stage : null, error: { code: code, message: message } };
}

function now_iso() { return trim(run('date -u +%Y-%m-%dT%H:%M:%SZ').out); }

function effective_providers() {
	let result = dns_provider_catalog_get();
	return result.ok === true && type(result.providers) == 'array' ? result.providers : [];
}

function catalog_guard(draft) {
	let catalog = dns_provider_catalog_get();
	if (catalog.ok !== true || type(catalog.providers) != 'array')
		return err('ETARGET', 'DNS provider catalog is unavailable', 'catalog');
	let fields = ['primary', 'secondary'];
	for (let i = 0; i < length(fields); i++) {
		let id = draft[fields[i]];
		if (!id) continue;
		let found = false;
		for (let j = 0; j < length(catalog.providers); j++) if (catalog.providers[j].id == id) { found = true; break; }
		if (!found) return err('ENOENT', 'DNS provider ' + id + ' is not present in the effective catalog', 'catalog');
	}
	if (draft.mode != 'system' && !draft.primary)
		return err('EINPUT', 'primary DNS provider is required for a non-system mode', 'catalog');
	return null;
}

// load draft from state.json
function load_draft() {
	let ls = load_state();
	if (!ls.ok) return { mode: 'system', primary: '', secondary: '', hijack: false, cache: true, cacheSize: 1500, edns: false, minTtl: 60, strictOrder: true, blockAaaa: false, customRules: '', revision: 0 };
	let dg = ls.state['dns-global'];
	if (type(dg) != 'object' || dg == null) return { mode: 'system', primary: '', secondary: '', hijack: false, cache: true, cacheSize: 1500, edns: false, minTtl: 60, strictOrder: true, blockAaaa: false, customRules: '', revision: 0 };
	return {
		mode: (type(dg.mode) == 'string' && dg.mode != '') ? dg.mode : 'system',
		primary: type(dg.primary) == 'string' ? dg.primary : '',
		secondary: type(dg.secondary) == 'string' ? dg.secondary : '',
		hijack: dg.hijack === true,
		cache: dg.cache !== false,
		cacheSize: (type(dg.cacheSize) == 'int' && dg.cacheSize > 0) ? dg.cacheSize : 1500,
		edns: dg.edns === true,
		minTtl: (type(dg.minTtl) == 'int' && dg.minTtl > 0) ? dg.minTtl : 60,
		strictOrder: dg.strictOrder !== false,
		blockAaaa: dg.blockAaaa === true,
		customRules: type(dg.customRules) == 'string' ? dg.customRules : '',
		revision: (type(dg.revision) == 'int') ? dg.revision : 0
	};
}

function save_draft(draft) {
	let ls = load_state();
	if (!ls.ok) return false;
	draft.revision = (draft.revision || 0) + 1;
	ls.state['dns-global'] = draft;
	return save_state(ls.state);
}

function list_copy(arr) { let out = []; if (arr != null) for (let i = 0; i < length(arr); i++) push(out, arr[i]); return out; }

// read current dnsmasq state from UCI (shell-based — avoids ucode foreach parser issues)
function current_dnsmasq_state() {
	let listen = trim(run('netstat -tulpn 2>/dev/null | grep ":53"').out);
	let running = listen != '';
	let serverStr = trim(run("uci -q get dhcp.@dnsmasq[0].server 2>/dev/null").out);
	let servers = [];
	if (serverStr != '') {
		// uci get for list values returns newline-separated
		let lines = split(serverStr, '\n');
		for (let i = 0; i < length(lines); i++)
			if (trim(lines[i]) != '') push(servers, trim(lines[i]));
	}
	let noresolv = trim(run('uci -q get dhcp.@dnsmasq[0].noresolv 2>/dev/null').out) == '1';
	let localiseQueries = trim(run('uci -q get dhcp.@dnsmasq[0].localise_queries 2>/dev/null').out) == '1';
	let cacheSizeVal = trim(run('uci -q get dhcp.@dnsmasq[0].cachesize 2>/dev/null').out);
	let cacheSize = cacheSizeVal != '' ? int(cacheSizeVal) : 150;
	let strictOrder = trim(run('uci -q get dhcp.@dnsmasq[0].strictorder 2>/dev/null').out) == '1';
	let filterAaaa = trim(run('uci -q get dhcp.@dnsmasq[0].filter_aaaa 2>/dev/null').out) == '1';
	let minTtlVal = trim(run('uci -q get dhcp.@dnsmasq[0].min_cache_ttl 2>/dev/null').out);
	let minCacheTtl = minTtlVal != '' ? int(minTtlVal) : 0;
	let wanPeerdns = trim(run('uci -q get network.wan.peerdns 2>/dev/null').out) || '1';
	let wanDns = trim(run('uci -q get network.wan.dns 2>/dev/null').out);
	let hijackCount = trim(run("iptables -t nat -L PREROUTING 2>/dev/null | grep -c 'udp dpt:53'").out || '0');
	let hijack = hijackCount != '0';
	let resolvAuto = readfile('/tmp/resolv.conf.d/resolv.conf.auto') || '';
	let inUse = list_copy(servers);
	let resolvfile = trim(run('uci -q get dhcp.@dnsmasq[0].resolvfile 2>/dev/null').out);
	if (resolvfile != '') push(inUse, 'resolvfile: ' + resolvfile);
	if (noresolv) inUse = list_copy(servers);
	return {
		ok: true, running: running, servers: servers, noresolv: noresolv,
		localiseQueries: localiseQueries, cacheSize: cacheSize, strictOrder: strictOrder,
		filterAaaa: filterAaaa, minCacheTtl: minCacheTtl, inUse: inUse,
		wanPeerdns: wanPeerdns, wanDns: wanDns, hijackActive: hijack, resolvAuto: resolvAuto
	};
}

function provider_by_id(id) {
	let providers = effective_providers();
	for (let i = 0; i < length(providers); i++)
		if (providers[i].id == id) return providers[i];
	return null;
}

function provider_resolver_ips(id) {
	let p = provider_by_id(id);
	if (!p || type(p.ipv4) != 'array' || !length(p.ipv4)) return [];
	return p.ipv4;
}

function resolve_mode_ip(mode, providerId) {
	if (mode == 'system') return '';
	let p = provider_by_id(providerId);
	if (!p) return '';
	if (mode == 'doh') {
		if (p.doh) return p.doh;
		return '';
	}
	if (mode == 'dot') return p.dot || '';
	if (type(p.ipv4) == 'array' && length(p.ipv4) > 0) return p.ipv4[0];
	return '';
}

function snapshot_available() {
	return stat(SNAP_DIR + '/dns-global-state.json') != null;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
export const dns_global_get = function() {
	let draft = load_draft();
	let current = current_dnsmasq_state();
	let catalog = dns_provider_catalog_get();
	let providers = catalog.ok === true && type(catalog.providers) == 'array' ? catalog.providers : [];
	return {
		ok: catalog.ok === true,
		draft: draft,
		applied: current,
		providers: providers,
		providerCatalog: catalog,
		modes: ['system', 'doh', 'dot', 'udp'],
		rollbackAvailable: snapshot_available(),
		note: 'global DNS changes are drafted, previewed and applied atomically'
	};
};

export const dns_global_set = function(input) {
	if (type(input) != 'object' || input == null) return err('EINPUT', 'missing edit payload');
	let draft = load_draft();
	if (type(input.revision) == 'int' && input.revision != draft.revision)
		return err('ECONFLICT', 'dns-global draft changed elsewhere (revision ' + draft.revision + '); reload and retry');
	if (input.mode != null) {
		if (input.mode != 'system' && input.mode != 'doh' && input.mode != 'dot' && input.mode != 'udp')
			return err('EINPUT', 'mode must be one of: system, doh, dot, udp');
		draft.mode = input.mode;
	}
	if (input.primary != null) draft.primary = String(input.primary || '');
	if (input.secondary != null) draft.secondary = String(input.secondary || '');
	if (input.hijack != null) draft.hijack = input.hijack === true;
	if (input.cache != null) draft.cache = input.cache === true;
	if (input.cacheSize != null) draft.cacheSize = int(input.cacheSize) || 1500;
	if (input.edns != null) draft.edns = input.edns === true;
	if (input.minTtl != null) draft.minTtl = int(input.minTtl) || 60;
	if (input.strictOrder != null) draft.strictOrder = input.strictOrder === true;
	if (input.blockAaaa != null) draft.blockAaaa = input.blockAaaa === true;
	if (input.customRules != null) draft.customRules = String(input.customRules || '');
	let catalogError = catalog_guard(draft);
	if (catalogError) return catalogError;
	if (!save_draft(draft)) return err('ETARGET', 'failed to write dns-global draft state');
	return { ok: true, revision: draft.revision, draft: draft };
};

export const dns_global_preview = function() {
	let draft = load_draft();
	let catalogError = catalog_guard(draft);
	if (catalogError) return catalogError;
	let current = current_dnsmasq_state();
	let changes = [];

	if (draft.mode == 'system') {
		if (current.wanPeerdns == '0' || current.servers != null && length(current.servers) > 0)
			push(changes, { key: 'mode', before: 'custom', after: 'system', detail: 'peer DNS restored; manager servers removed' });
	} else {
		push(changes, { key: 'mode', before: 'system', after: draft.mode, detail: 'DNS mode set to ' + draft.mode });
		if (draft.primary) {
			let ip = resolve_mode_ip(draft.mode, draft.primary);
			push(changes, { key: 'primary', before: '', after: draft.primary, detail: 'primary upstream: ' + (ip || 'provider not found') });
		}
		if (draft.secondary && draft.secondary != '') {
			let ip2 = resolve_mode_ip(draft.mode, draft.secondary);
			push(changes, { key: 'secondary', before: '', after: draft.secondary, detail: 'secondary upstream: ' + (ip2 || 'provider not found') });
		}
	}
	if (draft.hijack != current.hijackActive)
		push(changes, { key: 'hijack', before: current.hijackActive, after: draft.hijack, detail: draft.hijack ? 'port 53 intercept will be added' : 'port 53 intercept will be removed' });
	if (draft.cacheSize != current.cacheSize && draft.cache)
		push(changes, { key: 'cacheSize', before: current.cacheSize, after: draft.cacheSize, detail: 'cache size: ' + current.cacheSize + ' -> ' + draft.cacheSize });
	if (draft.edns !== false && draft.edns != (current.edns || false))
		push(changes, { key: 'edns', before: false, after: draft.edns, detail: 'EDNS Client Subnet' });
	if (draft.strictOrder != current.strictOrder)
		push(changes, { key: 'strictOrder', before: current.strictOrder, after: draft.strictOrder, detail: 'strict DNS order' });
	if (draft.blockAaaa != current.filterAaaa)
		push(changes, { key: 'blockAaaa', before: current.filterAaaa, after: draft.blockAaaa, detail: 'block IPv6 AAAA responses' });
	if (draft.customRules != '')
		push(changes, { key: 'customRules', before: '', after: draft.customRules, detail: draft.customRules.split('\n').length + ' custom lines' });

	return {
		ok: true,
		mode: 'preview',
		changes: changes,
		zeroWrites: !length(changes),
		revision: draft.revision,
		note: 'preview only; no mutations performed'
	};
};

function snapshot_global() {
	try { mkdir('/tmp/zapret2-manager/last-good'); } catch (e) { }
	try { mkdir(SNAP_DIR); } catch (e) { }
	run('cp -f /etc/config/dhcp ' + SNAP_DIR + '/dhcp.conf 2>/dev/null');
	run('cp -f /etc/config/network ' + SNAP_DIR + '/network.conf 2>/dev/null');
	run('cp -f /etc/zapret2-manager/state.json ' + SNAP_DIR + '/dns-global-state.json 2>/dev/null');
	let nftDump = run('nft list table inet fw4 2>/dev/null');
	writefile(SNAP_DIR + '/nftables-dump.txt', nftDump.out || '');
	return true;
}

function rollback_global() {
	run('cp -f ' + SNAP_DIR + '/dhcp.conf /etc/config/dhcp 2>/dev/null');
	run('cp -f ' + SNAP_DIR + '/network.conf /etc/config/network 2>/dev/null');
	if (stat(SNAP_DIR + '/dns-global-state.json'))
		run('cp -f ' + SNAP_DIR + '/dns-global-state.json /etc/zapret2-manager/state.json 2>/dev/null');
	run('/etc/init.d/dnsmasq restart');
	run('/etc/init.d/network reload');
	return true;
}

export const dns_global_apply = function() {
	let draft = load_draft();
	let catalogError = catalog_guard(draft);
	if (catalogError) return catalogError;
	let current = current_dnsmasq_state();

	snapshot_global();

	// apply mode changes
	if (draft.mode == 'system') {
		run("uci set network.wan.peerdns='1'");
		run('uci -q delete network.wan.dns 2>/dev/null');
	} else if (draft.primary) {
		run("uci set network.wan.peerdns='0'");
		let ip = resolve_mode_ip(draft.mode, draft.primary);
		if (ip) {
			let ips = [ip];
			if (draft.secondary) {
				let ip2 = resolve_mode_ip(draft.mode, draft.secondary);
				if (ip2) push(ips, ip2);
			}
			// For DoH/DoT modes, we write server= entries to dnsmasq
			// pointing to 127.0.0.1#port if a proxy is expected, or to the
			// actual resolver IPs for UDP mode.
			if (draft.mode == 'udp') {
				// direct DNS servers via dnsmasq server= option
				run('uci -q delete dhcp.@dnsmasq[0].server 2>/dev/null');
				for (let i = 0; i < length(ips); i++)
					run("uci add_list dhcp.@dnsmasq[0].server='" + ips[i] + "'");
				run("uci set dhcp.@dnsmasq[0].noresolv='1'");
			} else if (draft.mode == 'doh' || draft.mode == 'dot') {
				// DoH/DoT require external proxy (https-dns-proxy/stubby)
				// We note this in the result but still write dnsmasq to use
				// these servers as upstream
				run('uci -q delete dhcp.@dnsmasq[0].server 2>/dev/null');
				for (let i = 0; i < length(ips); i++)
					run("uci add_list dhcp.@dnsmasq[0].server='" + ips[i] + "'");
			}
		}
	} else {
		run("uci set network.wan.peerdns='1'");
	}

	// apply hijack (port 53 intercept)
	let hijackActive = current.hijackActive;
	if (draft.hijack && !hijackActive) {
		run('iptables -t nat -I PREROUTING -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53');
		run('iptables -t nat -I PREROUTING -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53');
		hijackActive = true;
	} else if (!draft.hijack && hijackActive) {
		run('iptables -t nat -D PREROUTING -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null');
		run('iptables -t nat -D PREROUTING -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null');
		hijackActive = false;
	}

	// apply cache
	if (draft.cache && draft.cacheSize > 0)
		run("uci set dhcp.@dnsmasq[0].cachesize='" + draft.cacheSize + "'");
	else if (!draft.cache)
		run("uci set dhcp.@dnsmasq[0].cachesize='0'");

	// apply advanced settings
	if (draft.edns)
		run("uci set dhcp.@dnsmasq[0].add_subnet='1'");
	else
		run('uci -q delete dhcp.@dnsmasq[0].add_subnet 2>/dev/null');

	if (draft.minTtl > 0)
		run("uci set dhcp.@dnsmasq[0].min_cache_ttl='" + draft.minTtl + "'");

	if (draft.strictOrder)
		run("uci set dhcp.@dnsmasq[0].strictorder='1'");
	else
		run('uci -q delete dhcp.@dnsmasq[0].strictorder 2>/dev/null');

	if (draft.blockAaaa)
		run("uci set dhcp.@dnsmasq[0].filter_aaaa='1'");
	else
		run('uci -q delete dhcp.@dnsmasq[0].filter_aaaa 2>/dev/null');

	run('uci commit dhcp');
	run('uci commit network');

	// apply custom rules — write to a manager-owned conf file
	if (draft.customRules != '') {
		run('mkdir -p /etc/zapret2-manager/dns-routing.d');
		writefile('/etc/zapret2-manager/dns-routing.d/99-custom.conf', draft.customRules + '\n');
		run("uci set dhcp.@dnsmasq[0].confdir='/etc/zapret2-manager/dns-routing.d'");
		run('uci commit dhcp');
	} else {
		run('rm -f /etc/zapret2-manager/dns-routing.d/99-custom.conf 2>/dev/null');
		run("if [ \"$(uci -q get dhcp.@dnsmasq[0].confdir 2>/dev/null)\" = '/etc/zapret2-manager/dns-routing.d' ]; then uci -q delete dhcp.@dnsmasq[0].confdir; fi");
	}

	run('/etc/init.d/network reload');
	let restart = run('/etc/init.d/dnsmasq restart');

	// verify
	let retries = 0;
	let ok = false;
	while (retries < 5) {
		let check = trim(run('dnsmasq --test -C /tmp/etc/dnsmasq.conf 2>&1').out);
		let nslookup = run('sh -c \'nslookup openwrt.org 127.0.0.1 >/dev/null 2>&1 & p=$!; (sleep 3; kill $p 2>/dev/null) & t=$!; wait $p; r=$?; kill $t 2>/dev/null; exit $r\'');
		if (nslookup.rc == 0) { ok = true; break; }
		run('sleep 1');
		retries++;
	}

	return {
		ok: ok,
		action: 'apply',
		restartRc: restart.rc,
		mode: draft.mode,
		hijackActive: hijackActive,
		cacheSize: draft.cache ? draft.cacheSize : 0,
		rollbackAvailable: true,
		snapshot: SNAP_DIR,
		note: (ok ? 'dns-global applied and verified' : 'apply completed but verification failed; check dnsmasq status')
	};
};

export const dns_global_rollback = function() {
	if (!snapshot_available()) return err('ESTATE', 'no dns-global snapshot to roll back to');
	rollback_global();

	let check = trim(run('nslookup openwrt.org 127.0.0.1 2>&1').out);
	let ok = index(check, 'Address') >= 0 || index(check, 'Name:') >= 0;
	return {
		ok: ok,
		action: 'rollback',
		note: 'global DNS snapshot restored and services restarted'
	};
};
