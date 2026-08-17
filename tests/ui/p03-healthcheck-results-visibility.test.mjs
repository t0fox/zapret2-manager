import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const pagePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-healthcheck-model.js');

function loadModel() {
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

test('Healthcheck model exposes completed RPC job rows, including expired jobs', () => {
  const model = loadModel();
  const rows = model.resultRows({
    job: {
      status: 'expired',
      finishedAt: 1786919728,
      rows: [{ id: 'youtube', class: 'skipped', reason: 'service domains are not in the user list' }]
    }
  }, [{ id: 'youtube', name: 'YouTube' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'YouTube');
  assert.equal(rows[0].status, 'Пропущен');
});

test('collapsed Healthcheck card renders result rows independently of settings panel', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /function renderHealthcheckResults\(\)/);
  assert.match(page, /healthContent = [\s\S]*\(settings\.open \? renderHealthcheckSettings\(\) : ''\) \+ renderHealthcheckResults\(\)/);
  assert.doesNotMatch(page, /settings\.open \? renderHealthcheckSettings\(\) \+ renderHealthcheckResults\(\) : ''/);
});
