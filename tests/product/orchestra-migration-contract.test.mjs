import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const view = name => fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager', name), 'utf8');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

test('Dashboard domain check is a bounded Z2K Detect measurement', () => {
  const source = view('z2m-overview.js');
  assert.doesNotMatch(source, /orchestra/i);
  assert.match(source, /ctx\.api\.z2kDetectProbe/);
  assert.match(source, /z2kDetectProbe\(domain,\s*\d+\)/);
  assert.doesNotMatch(source, /totalTimeoutSec|maxAttempts|maxCandidates|candidateMode/);
});

test('Services checks use one bounded Z2K Detect probe per service', () => {
  const source = view('z2m-services.js');
  assert.doesNotMatch(source, /orchestra/i);
  assert.match(source, /ctx\.api\.z2kDetectProbe/);
  assert.match(source, /z2kDetectProbe\(domain,\s*\d+\)/);
  assert.doesNotMatch(source, /totalTimeoutSec|maxAttempts|maxCandidates|candidateMode/);
});

test('retired Orchestra and Profiles products have no public reachability chain', () => {
  const api = view('z2m-api.js');
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
  const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');

  assert.doesNotMatch(api, /orchestra|profiles_(?:list|create|update|clone|delete|reorder|validate|import_applied|apply)|discord_profile/i);
  assert.doesNotMatch(rpc, /orchestra_|zapret2-manager-orchestra|discord_profile_/i);
  assert.doesNotMatch(rpc, /const PROFILES_CLI|profiles_(?:list|create|update|clone|delete|reorder|validate|import_applied|apply)_method/);
  assert.doesNotMatch(acl, /orchestra_|zapret2-manager-orchestra|discord_profile_|profiles_(?:list|create|update|clone|delete|reorder|validate|import_applied|apply)/i);

  for (const relative of [
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-auto.js',
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js',
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow.js',
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow-core.js',
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js',
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-profiles-workflow.js',
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js',
    'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-orchestra.uc',
    'zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile-cli.uc',
    'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json'
  ]) assert.equal(exists(relative), false, relative);
});
