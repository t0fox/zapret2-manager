import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc',
  'utf8',
);

test('production Scanner transient lock is imported before its runtime call', () => {
  const imports = source.match(/import\s*\{([^}]+)\}\s*from\s*'\.\/profiles-apply\.uc';/s);
  assert.ok(imports, 'profiles-apply import must be present');
  assert.match(imports[1], /profiles_transient_lock/);
  assert.ok(
    imports.index < source.indexOf('profiles_transient_lock(requestedSessionId)'),
    'the target ucode must resolve the transient lock declaration',
  );
});
