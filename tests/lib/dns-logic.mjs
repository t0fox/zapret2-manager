// dns-logic.mjs — node reference for the DNS slice (S6). Mirrored by the
// shipped ucode dns.uc.
//
// TARGET GROUNDING (verified read-only on the Cudy WBR3000UAX, OpenWrt
// 25.12.5, 2026-07-28 — not guessed):
//   - dnsmasq is the resolver (/etc/config/dhcp; listens :53); odhcpd does
//     DHCPv6/RA; NO https-dns-proxy/unbound/adguard/dnscrypt present;
//   - upstream DNS comes from the WAN resolvfile
//     (/tmp/resolv.conf.d/resolv.conf.auto → ISP nameservers);
//   - the manager owns domain overrides through ONE addnhosts file
//     (/etc/zapret2-manager/dns-overrides.hosts) registered ONCE in
//     /etc/config/dhcp — no surgery on dnsmasq's own option lists, a single
//     manager-owned file with snapshot/rollback through existing primitives.
//
// Live DNS apply is a SUPERVISED action (see the overnight rules); this
// module is the pure logic — validation, render, parse, diff, conflict scan.

export const OVERRIDES_PATH = '/etc/zapret2-manager/dns-overrides.hosts';
export const DHCP_CONF = '/etc/config/dhcp';

// ---- entry validation ---------------------------------------------------------

// Domain: LDH labels (letters, digits, hyphen — not leading/trailing hyphen),
// at least two labels or an explicit single-label allowance? Pinned override
// domains are real names: require >= 2 labels, each 1..63, total <= 253.
// NO wildcards: /etc/hosts-format files (which addnhosts uses) have no
// wildcard semantics — a wildcard entry would be a silent no-op, so it is
// refused, not stored.
export function validate_domain(domain) {
	const d = String(domain ?? '').trim().toLowerCase();
	if (d === '') return { ok: false, reason: 'empty domain' };
	if (d.length > 253) return { ok: false, reason: 'domain too long (>253)' };
	if (d.includes('*')) return { ok: false, reason: 'wildcards are not supported in hosts-format overrides (would be a silent no-op)' };
	if (/[^a-z0-9.-]/.test(d)) return { ok: false, reason: 'invalid characters in domain (a-z 0-9 . - only)' };
	const labels = d.split('.');
	if (labels.length < 2) return { ok: false, reason: 'need a full domain (at least two labels)' };
	for (const l of labels) {
		if (l.length === 0 || l.length > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (l.startsWith('-') || l.endsWith('-')) return { ok: false, reason: 'labels must not start/end with a hyphen' };
	}
	return { ok: true, domain: d };
}

export function validate_ipv4(ip) {
	const s = String(ip ?? '').trim();
	const parts = s.split('.');
	if (parts.length !== 4) return { ok: false, reason: 'IPv4 must have exactly 4 octets' };
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return { ok: false, reason: 'invalid octet ' + JSON.stringify(p) };
		const n = Number(p);
		if (n > 255) return { ok: false, reason: 'octet > 255' };
		if (p.length > 1 && p.startsWith('0')) return { ok: false, reason: 'leading zeros are not allowed' };
	}
	return { ok: true, ip: parts.map(Number).join('.') };
}

// validate_entries(entries) — whole-set validation: per-entry format +
// duplicate detection + same-domain-two-IPs conflict. Entries are
// {domain, ip, enabled?}. Returns { ok, entries | errors:[{index, reason}] }.
export function validate_entries(entries) {
	const errors = [];
	const seen = new Map();
	const out = [];
	if (!Array.isArray(entries)) return { ok: false, errors: [{ index: -1, reason: 'entries must be an array' }] };
	if (entries.length > 256) return { ok: false, errors: [{ index: -1, reason: 'too many entries (max 256)' }] };
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i] || {};
		const vd = validate_domain(e.domain);
		if (!vd.ok) { errors.push({ index: i, reason: vd.reason }); continue; }
		const vi = validate_ipv4(e.ip);
		if (!vi.ok) { errors.push({ index: i, reason: vi.reason }); continue; }
		const key = vd.domain;
		if (seen.has(key) && seen.get(key) !== vi.ip) {
			errors.push({ index: i, reason: 'conflict: ' + key + ' pinned to two different IPs (' + seen.get(key) + ' vs ' + vi.ip + ')' });
			continue;
		}
		if (seen.has(key)) {
			errors.push({ index: i, reason: 'duplicate entry for ' + key });
			continue;
		}
		seen.set(key, vi.ip);
		out.push({ domain: vd.domain, ip: vi.ip, enabled: e.enabled !== false });
	}
	if (errors.length) return { ok: false, errors };
	return { ok: true, entries: out };
}

// ---- hosts render/parse -----------------------------------------------------------

// render_hosts(entries) — deterministic hosts-format: 'ip domain' per line,
// LF, trailing LF, header comment identifying the manager-owned file.
export function render_hosts(entries) {
	let out = '# zapret2-manager DNS overrides (manager-owned; edit via the DNS page)\n';
	for (const e of entries) {
		if (e.enabled === false) out += '# disabled: ' + e.ip + ' ' + e.domain + '\n';
		else out += e.ip + ' ' + e.domain + '\n';
	}
	return out;
}

// parse_hosts(text) → [{domain, ip, enabled}] — reads back the manager file
// (disabled entries are comments with the '# disabled: ' marker).
export function parse_hosts(text) {
	const out = [];
	for (const line of String(text ?? '').split('\n')) {
		let l = line.trim();
		if (!l) continue;
		let enabled = true;
		if (l.startsWith('# disabled: ')) { enabled = false; l = l.slice('# disabled: '.length).trim(); }
		else if (l.startsWith('#')) continue;
		const parts = l.split(/\s+/);
		if (parts.length < 2) continue;
		const ip = validate_ipv4(parts[0]);
		if (!ip.ok) continue;
		const dom = validate_domain(parts[1]);
		if (!dom.ok) continue;
		out.push({ domain: dom.domain, ip: ip.ip, enabled });
	}
	return out;
}

// ---- dnsmasq config parse (read-only) ------------------------------------------------

// parse_dnsmasq_conf(text) → { addressEntries, addnhosts, resolvfile } —
// reads the dnsmasq section facts the manager reports. List options are
// `list name 'value'`; single options are `option name 'value'`.
export function parse_dnsmasq_conf(text) {
	const addressEntries = [];
	const addnhosts = [];
	let resolvfile = null;
	for (const raw of String(text ?? '').split('\n')) {
		const l = raw.trim();
		let m = /^list\s+address\s+'([^']+)'/.exec(l);
		if (m) { addressEntries.push(m[1]); continue; }
		m = /^list\s+addnhosts\s+'([^']+)'/.exec(l);
		if (m) { addnhosts.push(m[1]); continue; }
		m = /^option\s+addnhosts\s+'([^']+)'/.exec(l);
		if (m) { addnhosts.push(m[1]); continue; }
		m = /^option\s+resolvfile\s+'([^']+)'/.exec(l);
		if (m) resolvfile = m[1];
	}
	return { addressEntries, addnhosts, resolvfile };
}

// parse_resolv_auto(text) → nameserver list (the WAN-provided upstreams).
export function parse_resolv_auto(text) {
	const out = [];
	for (const line of String(text ?? '').split('\n')) {
		const m = /^nameserver\s+(\S+)/.exec(line.trim());
		if (m) out.push(m[1]);
	}
	return out;
}

// ---- conflict scan ----------------------------------------------------------------------

const KNOWN_RESOLVER_COMPONENTS = [
	{ init: '/etc/init.d/dnsmasq', name: 'dnsmasq', role: 'system resolver (managed integration point)' },
	{ init: '/etc/init.d/https-dns-proxy', name: 'https-dns-proxy', role: 'DoH proxy — CONFLICT: bypasses dnsmasq upstreams' },
	{ init: '/etc/init.d/unbound', name: 'unbound', role: 'recursive resolver — CONFLICT: replaces dnsmasq' },
	{ init: '/etc/init.d/adguardhome', name: 'adguardhome', role: 'filtering resolver — CONFLICT: replaces dnsmasq' },
	{ init: '/etc/init.d/smartdns', name: 'smartdns', role: 'alternative resolver — CONFLICT' },
	{ init: '/etc/init.d/dnscrypt-proxy', name: 'dnscrypt-proxy', role: 'encrypted resolver — CONFLICT' }
];

export function component_scan(presentInits) {
	const found = [];
	const conflicts = [];
	for (const c of KNOWN_RESOLVER_COMPONENTS) {
		if (presentInits.includes(c.init)) {
			found.push({ name: c.name, role: c.role });
			if (c.role.startsWith('CONFLICT') || c.role.includes('CONFLICT')) conflicts.push({ name: c.name, role: c.role });
		}
	}
	return { found, conflicts };
}

// ---- apply verification policy -------------------------------------------------

// After `uci commit dhcp`, procd RESTARTS dnsmasq (not just a HUP reload) —
// port 53 and resolution bounce for a few seconds. A single-shot verify read
// inside that window false-fails (acceptance r12: port53=false at t=0 with
// 16 listeners before and after). Verification therefore retries within a
// bounded window and judges only the LAST state — honest, no fake success.
export const DNS_VERIFY_MAX_ATTEMPTS = 5;
export const DNS_VERIFY_RETRY_SEC = 2;

// dnsChecks(processAlive, portListening, entryResults) — the three gates:
// resolver process alive, port 53 listening, every ENABLED override entry
// resolves to its pinned IP.
export function dnsChecks(processAlive, portListening, entryResults) {
	const entriesMatch = entryResults.every((e) => e.matched === true);
	return {
		processAlive: processAlive === true,
		portListening: portListening === true,
		entriesMatch,
		ok: processAlive === true && portListening === true && entriesMatch
	};
}

// dnsVerifyShouldRetry(checks, attempt, maxAttempts) — retry while any gate
// is red and attempts remain; judge (fail) only when the window is exhausted.
export function dnsVerifyShouldRetry(checks, attempt, maxAttempts = DNS_VERIFY_MAX_ATTEMPTS) {
	return checks.ok !== true && attempt < maxAttempts;
}

// ---- applied↔draft diff ----------------------------------------------------------------------

export function diff_entries(applied, draft) {
	const added = [];
	const removed = [];
	const changed = [];
	const unchanged = [];
	const byDomain = new Map(applied.map((e) => [e.domain, e]));
	const draftDomains = new Set();
	for (const d of draft) {
		draftDomains.add(d.domain);
		const a = byDomain.get(d.domain);
		if (!a) added.push(d);
		else if (a.ip !== d.ip) changed.push({ domain: d.domain, from: a.ip, to: d.ip });
		else if (a.enabled === false && d.enabled !== false) changed.push({ domain: d.domain, from: 'disabled', to: 'enabled' });
		else unchanged.push(d);
	}
	for (const a of applied) {
		if (!draftDomains.has(a.domain)) removed.push(a);
	}
	return { added, removed, changed, unchanged };
}
