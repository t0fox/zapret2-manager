import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('main APK workflow is release-only and artifact-producing', () => {
  const source = read('.github/workflows/apk-build.yml');
  assert.match(source, /branches:\s*\n\s*-\s*main/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /contents:\s*read/);
  assert.match(source, /scripts\/release\/build-apk\.sh/);
  assert.match(source, /scripts\/release\/verify-artifacts\.mjs/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(source, /gh release create|release-rc/);
});

test('RC workflow is tag-bound, verifies the tag, and publishes immutable prereleases', () => {
  const source = read('.github/workflows/release-rc.yml');
  assert.match(source, /tags:\s*\n\s*-\s*['"]?v\*-r\*-rc\*['"]?/);
  assert.match(source, /contents:\s*write/);
  assert.match(source, /scripts\/release\/check-tag\.mjs/);
  assert.match(source, /scripts\/release\/build-apk\.sh/);
  assert.match(source, /scripts\/release\/verify-artifacts\.mjs/);
  assert.match(source, /--verify-tag/);
  assert.match(source, /--prerelease/);
  assert.doesNotMatch(source, /--clobber/);
});
