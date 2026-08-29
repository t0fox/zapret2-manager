import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const sourcePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const source = fs.readFileSync(sourcePath, 'utf8');

test('Z2K downgrade removals map managed txt classification assets to blob Registry records', () => {
	assert.match(source, /historical\.type == 'bin' \|\| historical\.type == 'txt'/);
	assert.match(source, /expectedType = historical && historical\.type == 'lua' \? 'lua' : historical && \(historical\.type == 'bin' \|\| historical\.type == 'txt'\) \? 'blob' : null/);
});
