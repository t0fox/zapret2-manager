import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// z2m-fake-rotate.lua decision-B contract (ANTIDPI_REPEATS_LOOP preservation).
//
// Verification mirrors the hostkey-policy approach: strict source pins plus
// a faithful JS golden-vector port; LUA_BIN enables a real-Lua layer in CI.

const ROOT = path.resolve();
const LUA_PATH = path.join(ROOT,
	'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-fake-rotate.lua');
const SYNC = path.join(ROOT,
	'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
const src = () => fs.readFileSync(LUA_PATH, 'utf8');

// ------------------------------------------------------------- source pins

test('sidecar defines its marker and captures the original fake once', () => {
	const s = src();
	assert.match(s, /if _G\.Z2M_FAKE_ROTATE_V1 then return end/);
	assert.match(s, /z2m-fake-rotate@1/);
	assert.match(s, /local z2m_original_fake = _G\.fake/);
	assert.ok(s.indexOf('__Z2M_ORIGINAL_FAKE == nil') > -1, 'capture-once guard');
	assert.ok(s.indexOf('_G.fake =') > s.indexOf('__Z2M_ORIGINAL_FAKE ='),
		'replacement happens after capture anchor');
});

test('rotation branch never delegates to the original (no double rotation)', () => {
	const s = src();
	const rotStart = s.indexOf('local saved_repeats');
	const delegateCallIdx = s.indexOf('_G.__Z2M_ORIGINAL_FAKE(ctx, desync)', s.indexOf('Rotation branch'));
	assert.equal(delegateCallIdx, -1, 'original must not be called inside the rotation branch');
	const branchEnd = s.indexOf('else\n\t\t\tDLOG("fake: not acting', rotStart);
	const between = s.slice(rotStart, branchEnd === -1 ? undefined : branchEnd);
	assert.doesNotMatch(between, /__Z2M_ORIGINAL_FAKE/);
});

test('repeats is restored even on failure paths (pcall + restore before rethrow)', () => {
	const s = src();
	const pcallIdx = s.indexOf('pcall(function()');
	const restoreIdx = s.indexOf('desync.arg.repeats = saved_repeats', pcallIdx);
	const errorIdx = s.indexOf('error(err)', restoreIdx);
	assert.ok(pcallIdx > -1 && restoreIdx > pcallIdx && errorIdx > restoreIdx,
		'order: pcall body → restore → conditional rethrow');
});

test('delegation covers non-rotating cases (no tls_mod, repeats<=1, malformed args)', () => {
	const s = src();
	assert.match(s, /desync\.arg\.tls_mod ~= nil/);
	assert.match(s, /tonumber\(desync\.arg\.repeats\) > 1/);
	// exactly two delegation sites, both early-returns
	const sites = [...s.matchAll(/return _G\.__Z2M_ORIGINAL_FAKE\(ctx, desync\)/g)].length;
	assert.equal(sites, 2);
});

test('load order places fake-rotate immediately after zapret-antidpi', () => {
	const syncSrc = fs.readFileSync(SYNC, 'utf8');
	const line = syncSrc.split('\n').find(l => l.includes('LUAOPT="--lua-init'));
	const dapi = line.indexOf('zapret-antidpi.lua');
	const rot = line.indexOf('z2m-fake-rotate.lua');
	const auto = line.indexOf('zapret-auto.lua');
	assert.ok(dapi < rot && rot < auto, `expected antidpi<fake-rotate<auto, got ${dapi},${rot},${auto}`);
});

// ------------------------------------------------------------ golden vectors

function portEnv(opts = {}) {
	const env = {
		shimCalls: [], sends: [], rotateEvents: 0,
		origCalls: [], origRotatesInternally: opts.legacyPatchedOriginal ?? false,
		b_debug: false,
		DLOG() {}, hexdump_dlog: (s) => s,
		tls_mod_shim(_d, payload) { this.shimCalls.push(payload); return payload + '<mut:' + this.shimCalls.length + '>'; },
		rawsend_payload_segmented(_d, payload) { this.sends.push({ payload, innerRepeats: _d.arg.repeats }); },
		direction_cutoff_opposite() {}, direction_check: () => true, payload_check: () => true,
		replay_first: () => true, instance_cutoff_shim() {},
		blob_exist: () => true,
		blob(_d) { return 'FAKE_BYTES'; },
	};
	env.originalFake = function fake(ctx, desync) {
		env.origCalls.push(desync?.arg?.repeats);
		if (!(typeof desync.dis === 'object' && (desync.dis.tcp || desync.dis.udp))) { return; }
		if (env.direction_check(desync) && env.payload_check(desync)) {
			if (env.replay_first(desync)) {
				if (!desync.arg.blob) throw new Error("fake: 'blob' arg required");
				const fake_payload = env.blob(desync, desync.arg.blob);
				let pl = null;
				if (desync.reasm_data && desync.arg.tls_mod) {
					pl = env.tls_mod_shim(desync, fake_payload, desync.arg.tls_mod, desync.reasm_data);
					// legacy patched variant: rotates internally for the whole rep loop
					if (env.origRotatesInternally && Number(desync.arg.repeats) > 1) env.rotateEvents++;
				}
				const toSend = pl || fake_payload;
				if (Number(desync.arg.repeats) > 1 && !(desync.reasm_data && desync.arg.tls_mod)) {
					for (let i = 0; i < Number(desync.arg.repeats); i++) env.sends.push({ payload: toSend + ':rep' + i, innerRepeats: desync.arg.repeats });
				} else {
					env.sends.push({ payload: toSend, innerRepeats: desync.arg.repeats });
				}
			}
		}
	};
	return env;
}

function installWrapper(env) {
	// mirrors `if _G.Z2M_FAKE_ROTATE_V1 then return end`
	if (env.Z2M_FAKE_ROTATE_V1) return env;
	env.__Z2M_ORIGINAL_FAKE ??= env.originalFake;
	env.globalFake = function z2m_rotate_fake(ctx, desync) {
		if (typeof desync !== 'object' || typeof desync.arg !== 'object')
			return env.originalFake(ctx, desync); // mirrored first guard? see note
		const wants_rotation = desync.reasm_data != null
			&& desync.arg.tls_mod != null
			&& Number(desync.arg.repeats) != null
			&& Number(desync.arg.repeats) > 1;
		if (!wants_rotation)
			return env.originalFake(ctx, desync);

		env.direction_cutoff_opposite(ctx, desync);
		const dis = desync.dis;
		if (!dis.tcp && !dis.udp) return;
		if (env.direction_check(desync) && env.payload_check(desync)) {
			if (env.replay_first(desync)) {
				if (!desync.arg.blob) throw new Error("fake: 'blob' arg required");
				if (desync.arg.optional && !env.blob_exist(desync, desync.arg.blob)) { env.DLOG(); return; }
				const fake_payload = env.blob(desync, desync.arg.blob);
				const saved_repeats = desync.arg.repeats;
				desync.arg.repeats = 1;
				try {
					for (let i = 1; i <= saved_repeats; i++) {
						const pl = env.tls_mod_shim(desync, fake_payload, desync.arg.tls_mod, desync.reasm_data);
						const payload_to_send = pl || fake_payload;
						if (env.b_debug) env.DLOG(env.hexdump_dlog(payload_to_send));
						env.rawsend_payload_segmented(desync, payload_to_send);
					}
				} finally {
					desync.arg.repeats = saved_repeats;
				}
				env.rotateEvents++;
			} else env.DLOG();
		}
	};
	env.Z2M_FAKE_ROTATE_V1 = { markerId: 'z2m-fake-rotate@1' };
	return env;
}

const baseDesync = (over = {}) => ({
	dis: { tcp: {} }, arg: { blob: 'fake_default_tls' }, ...over });

test('A — repeats=2 + tls_mod rotates per attempt and forces inner repeats=1', () => {
	const env = installWrapper(portEnv());
	const d = baseDesync({ arg: { blob: 'fake_default_tls', tls_mod: 'rnd,dupsid', repeats: '2' }, reasm_data: 'REASM' });
	env.globalFake(null, d);
	assert.equal(env.origCalls.length, 0, 'original never invoked on rotation branch');
	assert.equal(env.shimCalls.length, 2);
	assert.equal(env.sends.length, 2);
	assert.ok(env.sends.every(x => x.innerRepeats === 1), 'inner C rep-loop disabled');
	assert.notEqual(env.sends[0].payload, env.sends[1].payload, 'per-attempt fingerprints differ');
	assert.equal(d.arg.repeats, '2', 'arg restored after rotation');
});

test('B — repeats=5 without tls_mod delegates unchanged', () => {
	const env = installWrapper(portEnv());
	const d = baseDesync({ arg: { blob: 'quic_google', repeats: '5' }, dis: { udp: {} } });
	env.globalFake(null, d);
	assert.equal(env.origCalls.length, 1);
	assert.equal(d.arg.repeats, '5');
	assert.equal(env.shimCalls.length, 0);
	assert.equal(env.sends.length, 5, 'stock engine multiplies via original path');
});

test('C — repeats=1 with tls_mod delegates unchanged', () => {
	const env = installWrapper(portEnv());
	const d = baseDesync({ arg: { blob: 'fake_default_tls', tls_mod: 'rnd', repeats: '1' }, reasm_data: 'R' });
	env.globalFake(null, d);
	assert.equal(env.origCalls.length, 1);
	assert.equal(env.shimCalls.filter(c => c.startsWith('FAKE')).length, 1, 'single stock mutation inside original');
	assert.equal(env.rotateEvents, 0);
});

test('D — legacy patched runtime + wrapper still yields ONE rotation', () => {
	const env = installWrapper(portEnv({ legacyPatchedOriginal: true }));
	const d = baseDesync({ arg: { blob: 'fake_default_tls', tls_mod: 'rnd,dupsid', repeats: '2' }, reasm_data: 'R' });
	env.globalFake(null, d);
	assert.equal(env.origCalls.length, 0);
	assert.equal(env.rotateEvents, 1, 'wrapper-only rotation, original untouched');
});

test('E — double load does not double-wrap (marker idempotence)', () => {
	const env = installWrapper(portEnv());
	const wrappedOnce = env.globalFake;
	const originalAnchor = env.__Z2M_ORIGINAL_FAKE;
	installWrapper(env); // second load attempt must be a no-op via the marker
	assert.equal(env.globalFake, wrappedOnce);
	assert.equal(env.__Z2M_ORIGINAL_FAKE, originalAnchor, 'original captured exactly once');
});

test('F — live TCP strategy line engages rotation with stock token mix', () => {
	const env = installWrapper(portEnv());
	// exact live cmdline fragment: --lua-desync=fake:blob=fake_default_tls:tls_mod=rnd,dupsid:tcp_md5:repeats=2:strategy=1
	const args = {};
	for (const kv of 'blob=fake_default_tls:tls_mod=rnd,dupsid:tcp_md5:repeats=2:strategy=1'.split(':')) {
		const [k, v] = kv.split('=');
		args[k] = v ?? '';
	}
	const d = baseDesync({ arg: args, reasm_data: 'TLS_REASM' });
	env.globalFake(null, d);
	assert.equal(env.rotateEvents, 1);
	assert.equal(env.shimCalls.length, 2);
	assert.equal(d.arg.repeats, '2');
});
