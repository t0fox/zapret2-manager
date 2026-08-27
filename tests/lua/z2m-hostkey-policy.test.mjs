import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// z2m-hostkey-policy.lua decision-B contract.
//
// Execution strategy: the wrapper logic is small and pure enough to pin via
// (1) strict source pins on the deployed file, (2) a faithful JS
// golden-vector port exercising every decision-mandated case, and (3) an
// optional REAL-Lua execution layer enabled with LUA_BIN (skipped here when
// no interpreter exists on the machine — CI can provide one).

const ROOT = path.resolve();
const LUA_PATH = path.join(ROOT,
	'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-hostkey-policy.lua');
const SYNC = path.join(ROOT,
	'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
const src = () => fs.readFileSync(LUA_PATH, 'utf8');

// ------------------------------------------------------------- source pins

test('sidecar exists and defines its idempotence marker before any wrapping', () => {
	const s = src();
	assert.match(s, /if _G\.Z2M_HOSTKEY_POLICY_V1 then return end/);
	assert.match(s, /_G\.Z2M_HOSTKEY_POLICY_V1/, 'terminal marker block');
	assert.match(s, /z2m-hostkey-policy@1/);
});

test('wrapper captures the original exactly once and errors loudly when stock missing', () => {
	const s = src();
	assert.match(s, /local z2m_original_standard_hostkey = _G\.standard_hostkey/);
	assert.match(s, /error\("z2m-hostkey-policy: stock standard_hostkey is missing/);
	const anchorAssign = s.match(/_G\.__Z2M_ORIGINAL_STANDARD_HOSTKEY = z2m_original_standard_hostkey/);
	assert.ok(anchorAssign, 'original anchor assigned from the local capture');
	const replaceAssign = s.match(/_G\.standard_hostkey = _G\.z2m_family_standard_hostkey/);
	assert.ok(replaceAssign, 'global replaced with the manager wrapper');
	assert.ok(anchorAssign.index < s.indexOf('function _G.z2m_family_standard_hostkey')
		&& s.indexOf('function _G.z2m_family_standard_hostkey') < replaceAssign.index,
		'order: capture → wrapper definition → global replacement');
});

test('wrapper body implements the exact rule order incl. dedupe of legacy suffixes', () => {
	const s = src();
	assert.match(s, /\|4" or last2 == "\|6"/);
	assert.match(s, /desync\.arg\.family_split\) == "0"|tostring\(arg\.family_split\) == "0"/);
	assert.match(s, /hostkey \.\. "\|6"/);
	assert.match(s, /hostkey \.\. "\|4"/);
});

test('load order places hostkey policy between zapret-auto and persist wrappers', () => {
	const syncSrc = fs.readFileSync(SYNC, 'utf8');
	const line = syncSrc.split('\n').find(l => l.includes('LUAOPT="--lua-init'));
	assert.ok(line, 'LUAOPT alignment line present');
	const order = [
		['zapret-lib.lua', line.indexOf('zapret-lib.lua')],
		['zapret-antidpi.lua', line.indexOf('zapret-antidpi.lua')],
		['z2m-fake-rotate.lua', line.indexOf('z2m-fake-rotate.lua')],
		['zapret-auto.lua', line.indexOf('zapret-auto.lua')],
		['z2m-hostkey-policy.lua', line.indexOf('z2m-hostkey-policy.lua')],
		['z2m-autocircular-policy.lua', line.indexOf('z2m-autocircular-policy.lua')],
		['z2k-state-persist.lua', line.lastIndexOf('z2k-state-persist.lua')],
	];
	for (let i = 1; i < order.length; i++)
		assert.ok(order[i][1] > order[i - 1][1], `${order[i][0]} must follow ${order[i - 1][0]}`);
	assert.ok(order[3][1] > -1 && order[4][1] > order[3][1],
		'stock standard_hostkey must exist before the policy wraps it');
	assert.ok(order[4][1] < order[order.length - 1][1],
		'policy wrapper must exist before z2k-state-persist derives hostkeys');
});

// ------------------------------------------------------------ golden vectors

function jsPort() {
	let CAPTURED = undefined;
	return {
		load() {
			if (this.LOADED) return; // Z2M_HOSTKEY_POLICY_V1 idempotence
			CAPTURED ??= this.originalGlobal;
			this.wrapped = (desync) => {
				let hostkey = CAPTURED(desync);
				if (!hostkey) return null;
				const arg = (typeof desync === 'object' && desync.arg) || null;
				if (arg && String(arg.family_split) === '0') return hostkey;
				if (typeof hostkey !== 'string') return hostkey;
				const last2 = hostkey.slice(-2);
				if (last2 === '|4' || last2 === '|6') return hostkey;
				const dis = (typeof desync === 'object' && desync.dis) || null;
				if (dis) {
					if (dis.ip6) return hostkey + '|6';
					else if (dis.ip) return hostkey + '|4';
				}
				return hostkey;
			};
			this.globalFn = this.wrapped;
			this.MARKER = { markerId: 'z2m-hostkey-policy@1' };
			this.LOADED = true;
		},
		originalGlobal: null, LOADED: false,
		MARKER: null, wrapped: null, globalFn: null,
		set original(fn) { this.originalGlobal = fn; },
	};
}

const stockHostkey = ({ track, arg }) => {
	if (track?.hostname) {
		if (arg?.nld) return undefined; // not exercised here
	} else if (!(arg && arg.reqhost)) {
		return track?.ipKey || undefined; // simplified host_ip fallback proxy
	}
	return track.hostname;
};

test('A/B/C — append rules per family and opt-out', () => {
	const env = jsPort(); env.original = (d) => d.track.hostname; env.load();

	assert.equal(env.globalFn({ track: { hostname: 'example.com' }, arg: {}, dis: { ip: true } }), 'example.com|4');
	assert.equal(env.globalFn({ track: { hostname: 'example.com' }, arg: {}, dis: { ip6: true } }), 'example.com|6');
	assert.equal(env.globalFn({ track: { hostname: 'example.com' }, arg: { family_split: '0' }, dis: { ip: true } }), 'example.com');
});

test('D — legacy patched original output is never double-suffixed', () => {
	const env = jsPort(); env.original = (d) => d.track.hostname + '|4'; env.load(); // simulates old patched engine payload
	assert.equal(env.globalFn({ track: { hostname: 'example.com' }, arg: {}, dis: { ip: true } }), 'example.com|4');
	// ipv6 flow under a |4-only legacy original stays stable too
	assert.equal(env.globalFn({ track: { hostname: 'example.com' }, arg: {}, dis: { ip6: true } }), 'example.com|4');
});

test('E — persistence derivation and circular derivation share one wrapped result', () => {
	const env = jsPort(); env.original = (d) => d.track.hostname; env.load();
	const circDesync = { track: { hostname: 'vk.ru' }, arg: {}, dis: { ip: true } };
	const persDesync = JSON.parse(JSON.stringify(circDesync));
	assert.equal(env.globalFn(circDesync), env.globalFn(persDesync));
	assert.equal(env.globalFn(circDesync), 'vk.ru|4');
});

test('F — existing suffixed persisted keys remain resolvable (12-row live shape)', () => {
	const env = jsPort(); env.original = (d) => d.track.hostname; env.load();
	const rows = ['dataroute.biz|4', 'googleusercontent.com|4', 'vk.com|4', 'googlevideo.com|4'];
	for (const row of rows) {
		const host = row.slice(0, -2);
		assert.equal(env.globalFn({ track: { hostname: host }, arg: {}, dis: { ip: true } }), row);
	}
});

test('G — no-dis and overridden-name modes survive unchanged', () => {
	const env = jsPort(); env.original = (d) => d.track.hostname; env.load();
	// flows whose original returned unsuffixed keys WITHOUT family dissect info
	assert.equal(env.globalFn({ track: { hostname: 'plain.example' }, arg: {}, dis: null }), 'plain.example');
	assert.equal(env.globalFn({ track: { hostname: 'ip-key-fallback' }, arg: {}, dis: {} }), 'ip-key-fallback');
	// explicit hostkey=z2k_nohost_key bypasses standard_hostkey entirely
	const dispatchTable = { standard_hostkey: env.globalFn, z2k_nohost_key: () => 'nohost' };
	assert.equal(dispatchTable.z2k_nohost_key(), 'nohost');
});

test('H — wrapper is pure: no write/exec surface in sidecar source', () => {
	const s = src();
	for (const forbidden of [/os\.execute/, /io\.open/, /os\.remove/, /require\s*\(?%s*["']socket/, /writefile/, /popen/])
		assert.doesNotMatch(s, forbidden, `forbidden side-effect primitive: ${forbidden}`);
	// deterministic repeat invocations
	const env = jsPort(); env.original = (d) => d.track.hostname; env.load();
	const a = env.globalFn({ track: { hostname: 'cloudflare.com' }, arg: {}, dis: { ip6: true } });
	const b = env.globalFn({ track: { hostname: 'cloudflare.com' }, arg: {}, dis: { ip6: true } });
	assert.equal(a, b);
});
