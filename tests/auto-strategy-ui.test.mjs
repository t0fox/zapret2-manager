import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const autoPath = `${root}/z2m-auto.js`;
const strategyPath = `${root}/z2m-strategy.js`;
const apiPath = `${root}/z2m-api.js`;
const RPC = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const ACL = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

test('Auto Strategy is a valid helper module mounted inside Strategy', () => {
  assert.equal(existsSync(autoPath), true);
  const mod = evaluateLuciModule(autoPath);
  for (const method of ['load','render','unmount']) assert.equal(typeof mod[method], 'function');
  const strategy = readFileSync(strategyPath, 'utf8');
  assert.match(strategy, /z2m-auto as Auto/);
  assert.match(strategy, /Auto\.load\(ctx\)/);
  assert.match(strategy, /Auto\.render\(ctx/);
  assert.match(strategy, /Auto\.unmount\(\)/);
});

test('Auto Strategy load is read-only and mutations are explicit', () => {
  const src = readFileSync(autoPath, 'utf8');
  const load = src.slice(src.indexOf('function load('), src.indexOf('function render('));
  assert.match(load, /api\.orchestra\.autoStatus/);
  assert.doesNotMatch(load, /autoEnable|autoDisable|autoRun|autoStop|autoRestore/);
  for (const token of ['api.orchestra.autoEnable','api.orchestra.autoDisable','api.orchestra.autoRun','api.orchestra.autoStop','api.orchestra.autoRestore'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
});

test('known backend phases are classified explicitly and unknown is never healthy', () => {
  const src = readFileSync(autoPath, 'utf8');
  for (const phase of ['disabled','waiting-network','healthy','degraded','scanning','applying','verifying','recovering','cooldown','failed'])
    assert.match(src, new RegExp(`['"]${phase}['"]`));
  assert.match(src, /knownPhase/);
  assert.match(src, /phaseKind/);
  assert.doesNotMatch(src, /default[^\n]*['"]g['"]/);
});

test('every mutation carries revision request id and bounded service ids', () => {
  const src = readFileSync(autoPath, 'utf8');
  assert.match(src, /expectedRevision:\s*auto\.revision/);
  assert.match(src, /requestId:\s*requestId\(\)/);
  assert.match(src, /serviceIds:\s*serviceIds\(auto\)/);
  assert.match(src, /slice\(0,\s*16\)/);
  assert.doesNotMatch(src, /candidateId|profileHash|profileRevision|proposedConfiguration/);
});

test('capabilities, pending guard, polling and terminal phases are enforced', () => {
  const src = readFileSync(autoPath, 'utf8');
  assert.match(src, /auto\.capabilities\s*\|\|\s*\{\}/);
  assert.match(src, /if\s*\(state\.pending\)\s*return/);
  assert.match(src, /pollInFlight/);
  assert.match(src, /setTimeout/);
  assert.match(src, /clearTimeout/);
  assert.match(src, /cancellation-requested/);
  assert.match(src, /already-current/);
});

test('errors are bounded and restore uses the shared modal', () => {
  const src = readFileSync(autoPath, 'utf8');
  assert.match(src, /boundedText\([^,]+,\s*200\)/);
  assert.match(src, /ECONFLICT/);
  assert.match(src, /shell\.openModal/);
  assert.match(src, /lastGood[^\n]*available/);
  assert.doesNotMatch(src, /window\.confirm|innerHTML/);
});

test('existing Auto Strategy RPC method names and ACL remain unchanged', () => {
  const api = readFileSync(apiPath, 'utf8');
  for (const name of ['orchestra_auto_status','orchestra_auto_enable','orchestra_auto_disable','orchestra_auto_run','orchestra_auto_stop','orchestra_auto_restore']) {
    assert.match(api, new RegExp(name));
    assert.match(RPC, new RegExp(name));
  }
  assert.ok(ACL.read.ubus['zapret2-manager'].includes('orchestra_auto_status'));
  assert.equal(ACL.read.ubus['zapret2-manager'].includes('orchestra_auto_enable'), false);
  for (const name of ['orchestra_auto_enable','orchestra_auto_disable','orchestra_auto_run','orchestra_auto_stop','orchestra_auto_restore'])
    assert.ok(ACL.write.ubus['zapret2-manager'].includes(name));
});
