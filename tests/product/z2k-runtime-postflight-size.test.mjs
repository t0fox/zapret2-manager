import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const sourcePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const source = fs.readFileSync(sourcePath, 'utf8');

test('Z2K runtime postflight compares size with the Registry-owned asset record', () => {
	assert.match(source, /function z2k_runtime_postflight\(target, diagnostics, listed\)/);
	assert.match(source, /registered = registry_asset\(listed && listed\.assets, item\.id\)/);
	assert.match(source, /expectedSize = registered && registered\.byteSize/);
	assert.match(source, /size != expectedSize/);
	assert.match(source, /z2k_runtime_postflight\(target, diagnostics, listed\)/);
});
