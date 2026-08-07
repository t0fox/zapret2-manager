import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const apiFile = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js';
const METHODS = [
  'engine_check_updates','engine_install','engine_operation_cancel',
  'engine_operation_status','engine_providers','engine_remove','engine_status'
];

function loadFacade() {
  const world = { declarations: [], calls: [] };
  const rpc = {
    declare(spec) {
      world.declarations.push(spec);
      return (...args) => {
        const params = {};
        (spec.params || []).forEach((name, index) => { params[name] = args[index]; });
        world.calls.push({ object: spec.object, method: spec.method, params, reject: spec.reject });
        return Promise.resolve({ ok: true });
      };
    }
  };
  return { api: evaluateLuciModule(apiFile, { rpc }), world };
}

test('central facade exposes the complete engine namespace lazily', async () => {
  const { api, world } = loadFacade();
  for (const name of ['providers','status','checkUpdates','install','remove','operationStatus','operationCancel'])
    assert.equal(typeof api.engine[name], 'function', name);

  await api.engine.providers();
  await api.engine.status();
  await api.engine.checkUpdates({ provider: 'remittor', channel: 'stable' });
  await api.engine.install({ provider: 'remittor', checkToken: 'token' });
  await api.engine.remove({ confirm: 'REMOVE', preserveConfig: true });
  await api.engine.operationStatus({ id: 'op-1' });
  await api.engine.operationCancel({ id: 'op-1' });

  const declarations = world.declarations.filter((spec) => spec.object === 'zapret2-manager-engine');
  assert.deepEqual(declarations.map((spec) => spec.method).sort(), [...METHODS].sort());
  for (const spec of declarations) {
    assert.equal(spec.reject, true, spec.method);
    if (['engine_providers','engine_status'].includes(spec.method)) assert.equal(spec.params, undefined);
    else assert.deepEqual(spec.params, ['edit'], spec.method);
  }
  const calls = world.calls.filter((call) => call.object === 'zapret2-manager-engine');
  assert.equal(calls.length, 7);
  for (const call of calls.filter((entry) => !['engine_providers','engine_status'].includes(entry.method))) {
    assert.equal(typeof call.params.edit, 'string', call.method);
    assert.doesNotThrow(() => JSON.parse(call.params.edit));
  }
});
