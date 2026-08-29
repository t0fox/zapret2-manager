import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc',
  'utf8',
);

test('Z2K runtime activation spec is included in every staging cleanup path', () => {
  assert.match(
    source,
    /let runtimeSpecPath = root \+ '\/runtime-activation\.tsv';[\s\S]{0,180}push\(paths, runtimeSpecPath\);/,
    'runtime-activation.tsv must be registered with the paths cleaned after activation',
  );
});
