import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'G:/zapret2-manager/.codex-avatar-parity';
const pagePath = `${root}/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`;

test('P01-T T04 keeps donor quick-action pending affordance at the Z2M lifecycle boundary', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /DONOR TRANSPLANT: web\/js\/pages\/dashboard\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(source, /class.*spinner|className.*spinner/);
  assert.match(source, /aria-busy/);
  assert.match(source, /data-lifecycle-pending/);
  assert.match(source, /disabled.*isPending|isPending.*disabled/);
  assert.match(source, /runtime\.lifecycle\.pending/);
  assert.match(source, /ctx\.api\.service\[(?:action)\]|action === 'start'/);
});

test('P01-T T04 does not introduce donor backend lifecycle endpoints', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.doesNotMatch(source, /\/api\/dashboard\/|fetch\s*\(/);
});
