import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const upstream = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
const resourceUpdate = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const strategyRefresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');

test('Z2K check binds branch manifest and candidate fetches to one resolved commit', () => {
  assert.match(upstream, /commits\?sha=z2k-enhanced/);
  assert.match(upstream, /sourceCommit: remote\.sourceCommit/);
  assert.match(upstream, /necronicle\/z2k.*remote\.sourceCommit/);
  assert.doesNotMatch(upstream, /z2k-enhanced\/files\/lua\/z2k-state-persist\.lua/);
});

test('Resource status exposes runtime and Strategy source coherence without auto-Apply', () => {
  assert.match(resourceUpdate, /strategy_coherence/);
  assert.match(resourceUpdate, /installedRuntimeRevision/);
  assert.match(resourceUpdate, /availableUpstreamRevision/);
  assert.match(resourceUpdate, /currentStrategySourceRevision/);
  assert.match(resourceUpdate, /candidateStrategyRevision/);
  assert.match(resourceUpdate, /coherenceStatus/);
  assert.doesNotMatch(resourceUpdate, /strategy_source_refresh\([^)]*\).*resource_center_status/);
});

test('release preparation and Strategy refresh retain one immutable source revision', () => {
  assert.match(versions, /RAW_ROOT.*commitSha/);
  assert.match(versions, /fetch_manifest\(version, resolved\.commitSha/);
  assert.match(resourceUpdate, /target\.targetCommitSha/);
  assert.match(resourceUpdate, /sourceCommit: target\.targetCommitSha/);
  assert.match(strategyRefresh, /sourceCommit/);
  assert.match(strategyRefresh, /raw\.githubusercontent\.com.*sourceCommit/);
  assert.match(strategyRefresh, /compilerSnapshot/);
  assert.match(strategyRefresh, /native_preflight\(/);
});
