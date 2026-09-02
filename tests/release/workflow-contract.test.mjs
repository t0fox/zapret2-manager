import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('APK is the only repository workflow', () => {
  const workflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows'))
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .sort();
  assert.deepEqual(workflows, ['apk-build.yml']);
});

test('main APK workflow builds artifacts and publishes the rolling prerelease', () => {
  const source = read('.github/workflows/apk-build.yml');
  assert.match(source, /branches:\s*\n\s*-\s*main/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /contents:\s*write/);
  assert.match(source, /scripts\/release\/build-apk\.sh/);
  assert.match(source, /scripts\/release\/verify-artifacts\.mjs/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.match(source, /name: Pack single prerelease asset/);
  assert.match(source, /tar --sort=name/);
  assert.match(source, /zstd -T0 -19/);
  assert.match(source, /TAG:\s*main-latest/);
  assert.match(source, /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /gh release delete "\$TAG" --yes --cleanup-tag/);
  assert.match(source, /gh release create "\$TAG"/);
  assert.match(source, /--target "\$GITHUB_SHA"/);
  assert.match(source, /dist\/\$BUNDLE_NAME/);
  assert.doesNotMatch(source, /gh release create[\s\S]*dist\/\*\.apk/);
  assert.match(source, /--prerelease/);
  assert.doesNotMatch(source, /release-rc/);
});
