import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve();
const PREFLIGHT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
	'zapret2-manager', 'native-preflight.uc');
const PREFLIGHT_SOURCE = fs.readFileSync(PREFLIGHT, 'utf8');

test('native preflight classifies TLS capability by the actual z2k_* tls_mod family', () => {
	assert.match(PREFLIGHT_SOURCE, /function requires_z2k_tls_mod\(candidate\)/);
	assert.match(PREFLIGHT_SOURCE, /tls_mod=.*z2k_/,
		'the capability classifier must inspect the tls_mod value, not any token text');
	assert.doesNotMatch(PREFLIGHT_SOURCE,
		/if \(index\(v, 'tls_mod='\) >= 0 \|\| index\(v, 'grease'\) >= 0 \|\| index\(v, 'alpn_flood'\) >= 0\)/,
		'stock tls_mod=rnd,dupsid must not be treated as Z2K_TLS_MOD');
});

test('the catalog all-in-one preset uses stock TLS modifiers', () => {
	const catalog = fs.readFileSync(path.resolve(
		'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/builtin/z2k_all_in_one.txt',
	), 'utf8');
	assert.match(catalog, /tls_mod=rnd,dupsid/);
	assert.doesNotMatch(catalog, /tls_mod=[^\s:]*z2k_/);
});
