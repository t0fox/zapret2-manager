import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

test('events.ndjson writer ensures parent directory before lock (E2E-003)', () => {
  const source = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/events.uc'), 'utf8');
  assert.match(source, /mkdir -p.*parent/,
    'append_ndjson must mkdir -p parent before flock');
  assert.match(source, /parent\s*=\s*substr\(path, 0, rindex\(path/,
    'must derive parent from path');
});

test('luci-app Makefile installs icons alongside js/css (E2E-002 404 fix)', () => {
  const mk = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/Makefile'), 'utf8');
  assert.match(mk, /INSTALL_DIR.*icons/);
  assert.match(mk, /wildcard.*icons\/\*\.svg/);
  assert.match(mk, /INSTALL_DATA.*icon.*www\/luci-static\/resources\/view\/zapret2-manager\/icons\//);
});
