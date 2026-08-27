import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
// Canonical surviving authority for the packaged Lua baseline:
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT,
	'zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json'), 'utf8'));

test('Task 4: engine-smoke.uc provides bounded Lua-init smoke runner with dummy queue', () => {
	const smokePath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/engine-smoke.uc');
	assert.ok(fs.existsSync(smokePath), 'engine-smoke.uc must exist');

	const content = fs.readFileSync(smokePath, 'utf8');
	assert.match(content, /export const engine_smoke/, 'Must export engine_smoke function');
	assert.match(content, /30999/, 'Must use dummy test queue 30999 (no production mutation)');
	assert.match(content, /--dry-run|--intercept=0/, 'Must run dry or zero-intercept mode');
});

test('required Z2K/manager Lua functions are defined in the manifest baseline set', () => {
	// The manifest luaFiles list is the packaged runtime authority (native-
	// preflight.v3). Every one of its basenames must exist in the packaged
	// runtime-assets and every historically required orchestration function
	// must be defined there — a missing definition would make the install-time
	// Lua smoke unsatisfiable and Z2K could never reach ready.
	const luaDir = path.join(ROOT,
		'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua');

	for (const f of MANIFEST.luaFiles) {
		const base = path.basename(f);
		assert.ok(fs.existsSync(path.join(luaDir, base)),
			`manifest luaFile ${base} must exist in runtime-assets`);
	}

	const sources = fs.readdirSync(luaDir)
		.filter(name => name.endsWith('.lua'))
		.map(name => fs.readFileSync(path.join(luaDir, name), 'utf8'));
	const all = sources.join('\n');

	for (const fn of ['circular', 'fake', 'standard_hostkey', 'z2m_family_standard_hostkey', 'z2m_rotate_fake']) {
		const pattern = new RegExp(
			`(function|)\\s*(_G\\.)?${fn}\\s*=\\s*function|(?:local\\s+)?function\\s+(?:_G\\.)?${fn}\\s*\\(`,
			'm');
		assert.match(all, pattern,
			`required runtime function ${fn} must be defined in the package baseline`);
	}
});
