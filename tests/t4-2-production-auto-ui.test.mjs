import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const auto = readFileSync(`${root}/z2m-auto.js`, 'utf8');
const page = readFileSync(`${root}/z2m-strategy-page.js`, 'utf8');
const api = readFileSync(`${root}/z2m-api.js`, 'utf8');
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8') + '\n' + readFileSync(`${root}/z2m-components.css`, 'utf8');

test('production Strategy composes the Auto Strategy controller', () => {
  assert.match(page, /z2m-auto as Auto/);
  assert.match(page, /Auto\.load\(ctx\)/);
  assert.match(page, /Auto\.render\(ctx/);
  assert.match(page, /Auto\.unmount\(\)/);
});

test('Auto status load is read-only', () => {
  const load = auto.slice(auto.indexOf('function load('), auto.indexOf('\nfunction shouldPoll('));
  assert.match(load, /api\.orchestra\.autoStatus/);
  assert.doesNotMatch(load, /autoEnable|autoDisable|autoRun|autoStop|autoRestore/);
});

test('all sanctioned Auto RPC methods are preserved in the facade', () => {
  for (const method of ['orchestra_auto_status','orchestra_auto_enable','orchestra_auto_disable','orchestra_auto_run','orchestra_auto_stop','orchestra_auto_restore'])
    assert.match(api, new RegExp(method));
});

test('mutations carry revision, request id and bounded services', () => {
  assert.match(auto, /expectedRevision:\s*auto\.revision/);
  assert.match(auto, /requestId:\s*requestId\(\)/);
  assert.match(auto, /serviceIds:\s*serviceIds\(auto\)/);
  assert.match(auto, /slice\(0,\s*16\)/);
});

test('known phases never upgrade unknown state to healthy', () => {
  for (const phase of ['disabled','waiting-network','healthy','degraded','scanning','applying','verifying','recovering','cooldown','failed'])
    assert.match(auto, new RegExp(`['"]${phase}['"]`));
  assert.match(auto, /knownPhase/);
  assert.doesNotMatch(auto, /default[^\n]*['"]g['"]/);
});

test('pending mutation blocks duplicate actions and capabilities gate buttons', () => {
  assert.match(auto, /if\s*\(state\.pending\)\s*return/);
  assert.match(auto, /auto\.capabilities\s*\|\|\s*\{\}/);
  assert.match(auto, /capabilities\.runNow/);
});

test('restore uses shared confirmation modal and sends no candidate payload', () => {
  assert.match(auto, /shell\.openModal/);
  const restore = auto.slice(auto.indexOf('function confirmRestore('), auto.indexOf('\nfunction render('));
  assert.doesNotMatch(restore, /candidateId|profileHash|profileRevision|proposedConfiguration/);
  assert.doesNotMatch(auto, /window\.confirm/);
});

test('polling is bounded, non-overlapping and lifecycle-cleaned', () => {
  assert.match(auto, /pollInFlight/);
  assert.match(auto, /setTimeout/);
  assert.doesNotMatch(auto, /setInterval/);
  assert.match(auto, /clearTimeout/);
});

test('errors are bounded and revision conflicts are friendly', () => {
  assert.match(auto, /boundedText\([^,]+,\s*200\)/);
  assert.match(auto, /ECONFLICT/);
  assert.match(auto, /Состояние изменилось/);
});

test('Auto panel follows the local responsive visual system', () => {
  assert.match(css, /\.z2m-panel/);
  assert.match(css, /\.z2m-btn/);
  assert.match(css, /@media/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
});
