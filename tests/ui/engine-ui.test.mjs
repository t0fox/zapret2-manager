import test from 'node:test';
import assert from 'node:assert/strict';
import EngineModel from '../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-model.js';

test('engine missing shows install only after successful metadata check', () => {
  const before = EngineModel.actions({ installed: false, busy: false, checked: false, selectedProvider: 'andrevich' });
  assert.equal(before.install.visible, true);
  assert.equal(before.install.disabled, true);
  const after = EngineModel.actions({ installed: false, busy: false, checked: true, compatible: true, selectedProvider: 'andrevich' });
  assert.equal(after.install.disabled, false);
});

test('same provider update and provider switch are mutually exclusive', () => {
  const update = EngineModel.actions({ installed: true, provider: 'remittor', selectedProvider: 'remittor', updateAvailable: true, checked: true, compatible: true });
  assert.equal(update.update.visible, true);
  assert.equal(update.switchProvider.visible, false);
  const switching = EngineModel.actions({ installed: true, provider: 'remittor', selectedProvider: 'andrevich', checked: true, compatible: true });
  assert.equal(switching.update.visible, false);
  assert.equal(switching.switchProvider.visible, true);
});

test('busy state disables every conflicting control', () => {
  const actions = EngineModel.actions({ installed: true, provider: 'remittor', selectedProvider: 'andrevich', checked: true, compatible: true, busy: true });
  Object.values(actions).forEach(action => assert.equal(action.disabled, true));
});

test('incompatible update stays blocked and error state is renderable', () => {
  const actions = EngineModel.actions({ installed: true, provider: 'andrevich', selectedProvider: 'andrevich', updateAvailable: true, checked: true, compatible: false, error: { code: 'EINCOMPATIBLE' } });
  assert.equal(actions.update.visible, true);
  assert.equal(actions.update.disabled, true);
  assert.equal(EngineModel.statusKind({ state: 'error' }), 'error');
  assert.equal(EngineModel.statusKind({ state: 'engine_missing' }), 'missing');
});
