import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = (name) => {
  const file = path.join(viewRoot, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

test('P03 uses a frozen donor-derived Strategies surface instead of the old custom catalog', () => {
  const page = read('z2m-avatar-strategies.js');
  assert.ok(page, 'P03 donor-derived Strategies module must exist');
  for (const marker of [
    '38ed85ce487c6b3dbdf703a5be197795f7c0cad1',
    'strategy-card', 'strategy-card-header', 'strategy-card-profiles',
    'strategy-card-actions', 'strat-editor-layout', 'profile-editor-item',
    'strategy-modal', 'preview-modal', 'strat-bulkbar',
    'ListUI', 'renderStrategyCard', 'renderEditorForm'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `missing donor marker: ${marker}`);
  assert.doesNotMatch(page, /['"]\/api\//);
  assert.doesNotMatch(page, /fetch\s*\(/);
});

test('P03 page maps supported donor actions to canonical Z2M Strategy RPCs', () => {
  const page = read('z2m-avatar-strategies.js');
  const app = read('app.js');
  const route = read('z2m-strategy-page.js');
  for (const marker of ['strategies.list', 'strategies.get', 'strategies.create', 'strategies.update',
    'strategies.delete', 'strategies.duplicate', 'strategies.favorite', 'strategies.preview',
    'strategies.validate', 'strategies.apply']) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(app, /strategies:\s*Strategy/);
  assert.match(route, /z2m-view-strategy/);
  assert.match(route, /Strategy\.render|AvatarStrategies/);
  assert.match(route, /function primaryModule[\s\S]*return AvatarStrategies/);
  assert.doesNotMatch(route, /z2m-strategy-workflow/);
});

test('P03 documents donor-only healthcheck/autocircular scope instead of faking it', () => {
  const page = read('z2m-avatar-strategies.js');
  const audit = fs.existsSync(path.join(root, 'docs/05-parity/avatar-strategies-transplant-audit.md'))
    ? fs.readFileSync(path.join(root, 'docs/05-parity/avatar-strategies-transplant-audit.md'), 'utf8') : '';
  assert.ok(page, 'P03 donor-derived Strategies module must exist');
  assert.match(`${page}\n${audit}`, /BACKEND_NOT_READY|INTENTIONAL_Z2M_DIFFERENCE/);
  assert.doesNotMatch(page, /healthcheck\/status|autocircular|API\.get\(/);
});

test('P03 static deploy does not reload the target auth daemon', () => {
  const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-strategies-parity-target.sh'), 'utf8');
  assert.match(deploy, /38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.doesNotMatch(deploy, /rpcd\s+reload/);
});
