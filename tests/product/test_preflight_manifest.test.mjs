import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// native-preflight.v3 — post-retirement packaged verification authority:
//   * luaFiles: the pinned runtime Lua baseline (only field with a current
//     production consumer, read by native-preflight.uc load_manifest);
//   * minNfqws2CompatVer: engine compatibility floor;
//   * NO retired producer identity, patch series or 3/3 capability
//     descriptors remain.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const manifestPath = path.join(ROOT,
	'zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json');

test('native-preflight manifest v3 exists and drops retired architecture', () => {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	assert.equal(manifest.schema, 'zapret2-manager.native-preflight.v3');
	for (const gone of [
		'engineIntegrationIdentity',
		'engineSourceCommit',
		'patchSeries',
		'requiredCapabilities',
		'capabilities',
		'notes',
	]) {
		assert.ok(!(gone in manifest), `retired field must be removed: ${gone}`);
	}
});

test('luaFiles remains the pinned production baseline and is consumable', () => {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	assert.ok(Array.isArray(manifest.luaFiles) && manifest.luaFiles.length >= 5,
		'luaFiles must pin the runtime baseline');
	for (const f of manifest.luaFiles) {
		assert.match(f, /^\/opt\/zapret2\/lua\//, `outside allowed root: ${f}`);
		const base = path.basename(f);
		assert.ok(
			fs.existsSync(path.join(ROOT,
				'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua', base)),
			`packaged copy missing for ${base}`,
		);
	}
});

test('loader accepts v3 natively (native-preflight.uc schema gate)', () => {
	const src = fs.readFileSync(path.join(ROOT,
		'zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc'), 'utf8');
	assert.match(src, /native-preflight\.v3/);
});
