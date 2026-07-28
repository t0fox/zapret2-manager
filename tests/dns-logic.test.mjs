// dns-logic.test.mjs — DNS slice logic (S6). Grounding: the dnsmasq/odhcpd
// facts were captured READ-ONLY from the real target (2026-07-28); no paths
// are guessed. Live DNS apply is supervised-only.
//
// Run: node --test tests/dns-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	validate_domain, validate_ipv4, validate_entries,
	render_hosts, parse_hosts, parse_dnsmasq_conf, parse_resolv_auto,
	component_scan, diff_entries,
	dnsChecks, dnsVerifyShouldRetry, DNS_VERIFY_MAX_ATTEMPTS, dnsServiceAction,
	OVERRIDES_PATH, DHCP_CONF, OVERRIDES_MODE
} from './lib/dns-logic.mjs';

// the REAL dnsmasq section from the target (captured read-only 2026-07-28)
const REAL_DHCP_CONF = `
config dnsmasq
	option domainneeded '1'
	option boguspriv '1'
	option localise_queries '1'
	option rebind_protection '1'
	option local '/lan/'
	option domain 'lan'
	option expandhosts '1'
	option authoritative '1'
	option readethers '1'
	option leasefile '/tmp/dhcp.leases'
	option resolvfile '/tmp/resolv.conf.d/resolv.conf.auto'
	option nonwildcard '1'
	option localservice '1'
	option ednspacket_max '1232'
	option filter_aaaa '0'
	option filter_a '0'

config dhcp 'lan'
	option interface 'lan'
	option start '100'

config odhcpd 'odhcpd'
	option maindhcp '0'
	option leasefile '/tmp/odhcpd.leases'
`;

const REAL_RESOLV_AUTO = `# Interface wan
nameserver 195.98.64.65
nameserver 195.98.64.66
`;

// ---- validation -------------------------------------------------------------------

test('validate_domain: LDH only, no wildcards (silent no-op guard)', () => {
	assert.equal(validate_domain('rutracker.org').ok, true);
	assert.equal(validate_domain('API.Example.COM').domain, 'api.example.com', 'lowercased');
	assert.equal(validate_domain('').ok, false);
	assert.equal(validate_domain('*.example.com').ok, false, 'wildcards refused — hosts format has none');
	assert.equal(validate_domain('localhost').ok, false, 'single label refused');
	assert.equal(validate_domain('-bad.com').ok, false);
	assert.equal(validate_domain('bad_domain').ok, false);
	assert.equal(validate_domain('a.com; rm -rf /').ok, false, 'injection refused');
});

test('validate_ipv4: strict octets', () => {
	assert.equal(validate_ipv4('195.98.64.65').ok, true);
	assert.equal(validate_ipv4('1.2.3.256').ok, false);
	assert.equal(validate_ipv4('1.2.3').ok, false);
	assert.equal(validate_ipv4('01.2.3.4').ok, false, 'leading zeros refused');
	assert.equal(validate_ipv4('::1').ok, false, 'IPv6 is out of scope (IPv4 target)');
});

test('validate_entries: duplicates and two-IPs-one-domain conflicts', () => {
	const ok = validate_entries([{ domain: 'a.com', ip: '1.2.3.4' }, { domain: 'b.com', ip: '5.6.7.8' }]);
	assert.equal(ok.ok, true);
	assert.equal(ok.entries.length, 2);
	const dup = validate_entries([{ domain: 'a.com', ip: '1.2.3.4' }, { domain: 'a.com', ip: '1.2.3.4' }]);
	assert.equal(dup.ok, false);
	const conflict = validate_entries([{ domain: 'a.com', ip: '1.2.3.4' }, { domain: 'a.com', ip: '9.9.9.9' }]);
	assert.equal(conflict.ok, false);
	assert.match(conflict.errors[0].reason, /two different IPs/);
	const bad = validate_entries([{ domain: 'a.com', ip: '999.1.1.1' }]);
	assert.equal(bad.ok, false);
});

// ---- hosts render/parse round trip ------------------------------------------------------

test('render_hosts/parse_hosts round trip incl. disabled entries', () => {
	const entries = [
		{ domain: 'rutracker.org', ip: '195.82.146.214', enabled: true },
		{ domain: 'ntc.party', ip: '104.21.5.19', enabled: false }
	];
	const text = render_hosts(entries);
	assert.ok(text.startsWith('# zapret2-manager DNS overrides'));
	const back = parse_hosts(text);
	assert.deepEqual(back, entries);
	// a foreign line (another writer's content) parses harmlessly
	const mixed = parse_hosts('127.0.0.1 localhost\n' + text);
	assert.equal(mixed.length, 2, 'only valid override lines are read back');
});

// ---- dnsmasq/resolv parsing (REAL target data) --------------------------------------------

test('parse_dnsmasq_conf on the REAL target config: resolvfile + no address entries', () => {
	const p = parse_dnsmasq_conf(REAL_DHCP_CONF);
	assert.equal(p.resolvfile, '/tmp/resolv.conf.d/resolv.conf.auto');
	assert.deepEqual(p.addressEntries, []);
	assert.deepEqual(p.addnhosts, []);
	// and with our registration present
	const registered = parse_dnsmasq_conf(REAL_DHCP_CONF + "\tlist addnhosts '" + OVERRIDES_PATH + "'\n");
	assert.deepEqual(registered.addnhosts, [OVERRIDES_PATH]);
});

test('parse_resolv_auto on the REAL WAN resolvfile', () => {
	assert.deepEqual(parse_resolv_auto(REAL_RESOLV_AUTO), ['195.98.64.65', '195.98.64.66']);
});

// ---- conflict scan -----------------------------------------------------------------------------

test('component_scan: dnsmasq is the integration point; conflicts are named', () => {
	const clean = component_scan(['/etc/init.d/dnsmasq', '/etc/init.d/odhcpd']);
	assert.equal(clean.found.length, 1);
	assert.equal(clean.conflicts.length, 0, 'the real target has no resolver conflicts');
	const dirty = component_scan(['/etc/init.d/dnsmasq', '/etc/init.d/https-dns-proxy']);
	assert.equal(dirty.conflicts.length, 1);
	assert.match(dirty.conflicts[0].role, /CONFLICT/);
});

// ---- diff ---------------------------------------------------------------------------------------

test('diff_entries: added/removed/changed/unchanged', () => {
	const applied = [
		{ domain: 'a.com', ip: '1.1.1.1', enabled: true },
		{ domain: 'b.com', ip: '2.2.2.2', enabled: true }
	];
	const draft = [
		{ domain: 'a.com', ip: '1.1.1.1', enabled: true },
		{ domain: 'b.com', ip: '3.3.3.3', enabled: true },
		{ domain: 'c.com', ip: '4.4.4.4', enabled: true }
	];
	const d = diff_entries(applied, draft);
	assert.equal(d.added.length, 1);
	assert.equal(d.changed.length, 1);
	assert.equal(d.changed[0].from, '2.2.2.2');
	assert.equal(d.unchanged.length, 1);
	assert.equal(d.removed.length, 0);
	const d2 = diff_entries(applied, []);
	assert.equal(d2.removed.length, 2, 'empty draft removes all applied overrides (explicitly reported, never silent)');
});

// ---- apply verification policy (r12 acceptance defect) ------------------------------

test('dnsChecks/dnsVerifyShouldRetry: a bounced first read retries, a green window passes', () => {
	const bounced = dnsChecks(true, false, [{ matched: false }]);
	assert.equal(bounced.ok, false);
	assert.equal(dnsVerifyShouldRetry(bounced, 1), true, 'r12 case: port53 bounced at attempt 1 → retry, not fail');
	assert.equal(dnsVerifyShouldRetry(bounced, DNS_VERIFY_MAX_ATTEMPTS), false, 'window exhausted → judge fail');
	const green = dnsChecks(true, true, [{ matched: true }, { matched: true }]);
	assert.equal(green.ok, true);
	assert.equal(dnsVerifyShouldRetry(green, 1), false, 'green → no retry');
	const mismatch = dnsChecks(true, true, [{ matched: false }]);
	assert.equal(mismatch.entriesMatch, false, 'a mismatched override is a REAL failure (not a bounce)');
	assert.equal(dnsVerifyShouldRetry(mismatch, 5), false);
});

test('dnsServiceAction: restart on registration OR content change (conf + cache semantics)', () => {
	assert.equal(dnsServiceAction({ registrationChanged: true, contentChanged: false }), 'restart',
		'registration change: conf regenerates only on full restart (r13)');
	assert.equal(dnsServiceAction({ registrationChanged: false, contentChanged: true }), 'restart',
		'override set change: HUP keeps serving cached NXDOMAIN/stale IP (r15)');
	assert.equal(dnsServiceAction({ registrationChanged: false, contentChanged: false }), 'reload',
		'nothing in the resolution data changed → HUP suffices');
});

test('OVERRIDES_MODE is 0644 (dnsmasq runs unprivileged; r14 unreadable-file defect)', () => {
	assert.equal(OVERRIDES_MODE, 0o644);
	assert.equal(OVERRIDES_MODE.toString(8), '644',
		'ucode writefile creates 0600 root-only — the backend must chmod after every write/restore or the daemon cannot read the overrides');
});
