import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const upstream = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
const component = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-component.uc');
const resourceUpdate = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const generator = read('tools/generate-z2k-classification.mjs');
const integration = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));

test('classification policy is explicit: production shell drift is advisory, trust roots are blocking', () => {
  assert.match(generator, /reviewPolicy/);
  const policies = Object.fromEntries(integration.files
    .filter(item => item.class === 'watched')
    .map(item => [item.sourcePath, item.reviewPolicy]));
  assert.equal(policies['files/z2k-config-validator.sh'], 'advisory');
  assert.equal(policies['files/z2k-geosite.sh'], 'advisory');
  assert.equal(policies['files/z2k-update-lists.sh'], 'advisory');
  assert.equal(policies['files/etc/z2k-roots.pem'], 'blocking');
  assert.equal(policies['files/etc/z2k-update-pub.pem'], 'blocking');
});

test('canonical plan separates update availability from attention and apply eligibility', () => {
  for (const field of ['updateState', 'attentionState', 'canApply', 'updates', 'rebases', 'reviews', 'advisoryReviews', 'blockingReviews', 'blockingReasons', 'manifest']) {
    assert.match(upstream, new RegExp('\\b' + field + '\\b'), `upstream plan must expose ${field}`);
  }
  assert.match(upstream, /canApply[\s\S]{0,240}updates/);
  assert.match(upstream, /advisoryReviews/);
  assert.match(upstream, /blockingReviews/);
  assert.match(upstream, /reviewPolicy/);
  assert.match(upstream, /unknown.*blocking|blocking.*unknown/i);
});

test('component planner consumes canonical upstream plan instead of a second precedence machine', () => {
  const start = component.indexOf('export const z2k_component_plan');
  const end = component.indexOf('export const z2k_component_apply');
  assert.ok(start >= 0 && end > start);
  const planBody = component.slice(start, end);
  assert.match(planBody, /z2k_upstream_plan\(remoteManifest\)/);
  assert.doesNotMatch(planBody, /for \(let sourcePath in keys\(checked\.manifest\.files_sha256\)\)/);
  assert.doesNotMatch(planBody, /if \(length\(watched\)\)/);
  assert.match(planBody, /attentionState/);
  assert.match(planBody, /canApply/);
});

test('check state carries a bounded plan token and update consumes the checked snapshot', () => {
  assert.match(resourceUpdate, /planToken/);
  assert.match(resourceUpdate, /ECHECK_STALE/);
  assert.match(resourceUpdate, /manifest\.current/);
  assert.match(resourceUpdate, /checkedAt/);
  const updateBody = resourceUpdate.slice(resourceUpdate.indexOf('export const resource_center_update'));
  assert.doesNotMatch(updateBody, /signedForZ2k\s*=\s*z2k_upstream_check\(\)/, 'apply must not perform a second network check');
  assert.match(updateBody, /load_check_state/);
  assert.match(updateBody, /planToken/);
});

test('available release and activation receipt version come from manifest.current', () => {
  const projection = resourceUpdate.slice(resourceUpdate.indexOf('function z2k_projection'), resourceUpdate.indexOf('function z2k_local_projection'));
  assert.match(projection, /availableRelease:\s*known_release\(manifest\.current\)/);
  const remoteVersionLine = resourceUpdate.match(/let remoteVersion\s*=([^;]+);/);
  assert.ok(remoteVersionLine, 'Z2K update must define remoteVersion');
  assert.match(remoteVersionLine[1], /manifest\.current/);
  assert.doesNotMatch(remoteVersionLine[1], /signedForZ2k\.release/);
  const componentApply = component.slice(component.indexOf('export const z2k_component_apply'));
  assert.match(componentApply, /let version\s*=\s*planned\.manifest\.current/);
  assert.doesNotMatch(componentApply, /version:\s*request\.version/);
});
