import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'build-apk.sh'), 'utf8');

test('release build installs only the feeds needed by the manager package graph', () => {
  assert.match(source, /FEED_PACKAGES='[^']+'/);
  assert.match(source, /scripts\/feeds install \$FEED_PACKAGES/);
  assert.doesNotMatch(source, /scripts\/feeds install \$FEED_NAMES/);

  for (const packageName of [
    'ucode', 'ucode-mod-fs', 'ucode-mod-io', 'ucode-mod-socket', 'ucode-mod-uloop',
    'kmod-nfnetlink-queue', 'kmod-nft-queue', 'ncat', 'flock', 'uclient-fetch',
    'ca-bundle', 'unzip', 'jsonfilter', 'libjson-c', 'luci-base'
  ]) {
    assert.match(source, new RegExp(`\\b${packageName.replaceAll('-', '\\-')}\\b`), packageName);
  }
});
