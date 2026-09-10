import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuciModule } from './support/luci-module.mjs';

const modulePath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runtime-guards.js';
const formatPrelude = "String.prototype.format = function () { var args = arguments, index = 0; return this.replace(/%[sd]/g, function () { return args[index++]; }); };";

function loadRuntimeGuards(globals = {}) {
  return loadLuciModule(modulePath, {
    Promise,
    setTimeout,
    clearTimeout,
    ...globals,
  }, formatPrelude);
}

test('runtime guards preserve calls, rejection identity, and idempotent wrapping', async () => {
  const guards = loadRuntimeGuards();
  const expected = new Error('rpc failed');
  const api = {
    dns: {
      marker: 7,
      diagnose(value) { return Promise.resolve(this.marker + value); },
      check() { throw expected; },
      serviceApplyStatus: value => Promise.resolve(value),
    },
  };

  guards.install(api);
  const wrapped = api.dns.diagnose;
  guards.install(api);
  assert.strictEqual(api.dns.diagnose, wrapped);
  assert.equal(await api.dns.diagnose(5), 12);
  assert.deepEqual(await api.dns.serviceApplyStatus({ state: 'done' }), { state: 'done' });
  await assert.rejects(api.dns.check(), error => error === expected);
});

test('runtime guards reject stalled RPC calls with normalized timeout errors', async () => {
  let timeout;
  let timeoutMs;
  const guards = loadRuntimeGuards({
    setTimeout(callback, delay) {
      timeout = callback;
      timeoutMs = delay;
      return 1;
    },
    clearTimeout() {},
  });
  const api = {
    dns: {
      check: () => new Promise(() => {}),
    },
  };

  guards.install(api);
  const pending = api.dns.check();
  assert.equal(timeoutMs, 20000);
  timeout();
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'ETIMEOUT');
    assert.match(String(error.message), /20 секунд/);
    return true;
  });
});

test('runtime guards sanitize nullish DOM text on install and mutation', () => {
  const initialText = { nodeType: 3, nodeValue: ' null ' };
  const retainedText = { nodeType: 3, nodeValue: 'null value' };
  const target = { nodeType: 1, childNodes: [initialText, retainedText] };
  let observerCallback;
  let observed;
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe(node, options) { observed = { node, options }; }
  }
  const document = { documentElement: target };
  const guards = loadRuntimeGuards({ document, MutationObserver });

  guards.install({});
  assert.equal(initialText.nodeValue, '');
  assert.equal(retainedText.nodeValue, 'null value');
  assert.strictEqual(observed.node, target);
  assert.equal(observed.options.characterData, true);

  const addedText = { nodeType: 3, nodeValue: 'undefinedundefined' };
  observerCallback([{ type: 'childList', addedNodes: [addedText] }]);
  assert.equal(addedText.nodeValue, '');
});
