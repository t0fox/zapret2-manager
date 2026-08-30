import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// native-preflight.v4 — static packaged engine evidence only:
//   * minNfqws2CompatVer: engine compatibility floor;
//   * dynamic Z2K Lua membership is supplied by runtime-composition.uc;
//   * NO retired producer identity, patch series or 3/3 capability
//     descriptors remain.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const manifestPath = path.join(ROOT,
	'zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json');

test('native-preflight manifest v4 exists and drops retired architecture', () => {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	assert.equal(manifest.schema, 'zapret2-manager.native-preflight.v4');
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

test('dynamic Lua membership is not duplicated in the static manifest', () => {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	assert.equal(manifest.minNfqws2CompatVer, 1);
	assert.ok(!('luaFiles' in manifest), 'runtime Lua list must come from canonical resolver');
});

test('loader accepts the v4 static manifest natively (native-preflight.uc schema gate)', () => {
	const src = fs.readFileSync(path.join(ROOT,
		'zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc'), 'utf8');
	assert.match(src, /native-preflight\.v4/);
});
