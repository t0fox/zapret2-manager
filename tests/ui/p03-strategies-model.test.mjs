import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');

function loadModel() {
  assert.ok(fs.existsSync(modelPath), 'P03 Strategies model must exist');
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

test('Strategies model preserves canonical identity distinctions and ordered profiles', () => {
  const model = loadModel();
  const view = model.normalize({
    id: 'split', name: 'Split', origin: 'avatar_builtin', is_builtin: true,
    revision: 7, profiles: [
      { id: 'p1', name: 'TLS', args: '--filter-tcp=443 --new --filter-udp=443', enabled: true }
    ]
  }, {
    strategyStatus: { id: 'split', name: 'Split', availability: 'available' },
    runtimeSummary: { strategyId: 'split' }
  });
  assert.equal(view.id, 'split');
  assert.equal(view.isBuiltin, true);
  assert.equal(view.selected, true);
  assert.equal(view.applied, true);
  assert.equal(view.profiles[0].args, '--filter-tcp=443 --new --filter-udp=443');
});

test('Strategies model maps safe Russian states and hides raw backend fields', () => {
  const model = loadModel();
  assert.equal(model.stateLabel('loading'), 'Загрузка…');
  assert.equal(model.stateLabel('empty'), 'Стратегии не найдены');
  assert.equal(model.stateLabel('error'), 'Не удалось загрузить стратегии');
  const copy = model.actionCopy('apply');
  assert.equal(copy.pending, 'Применение…');
  assert.equal(copy.success, 'Стратегия применена');
});

test('Strategies model blocks duplicate mutations', () => {
  const model = loadModel();
  assert.equal(model.canMutate(false), true);
  assert.equal(model.canMutate(true), false);
});
