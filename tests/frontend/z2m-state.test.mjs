import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-state.js', import.meta.url);

async function loadModule() {
  const source = await readFile(modulePath, 'utf8');
  const context = vm.createContext({
    baseclass: { extend: value => value },
    _: value => value,
    console
  });
  return new vm.Script(`(function () { ${source}\n})()`, { filename: modulePath.pathname }).runInContext(context);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('store publishes immutable top-level updates and supports unsubscribe', async () => {
  const State = await loadModule();
  const store = State.createStore({ count: 1, nested: { stable: true } });
  const snapshots = [];
  const unsubscribe = store.subscribe(value => snapshots.push(value));

  const before = store.get();
  store.update({ count: 2 });
  unsubscribe();
  store.update({ count: 3 });

  assert.equal(before.count, 1);
  assert.equal(store.get().count, 3);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].count, 2);
  assert.notEqual(snapshots[0], before);
  assert.equal(snapshots[0].nested, before.nested);
});

test('normalizeError preserves structured RPC error information', async () => {
  const State = await loadModule();

  assert.deepEqual(
    plain(State.normalizeError({ error: { code: 'ECONFLICT', message: 'busy', details: { operationId: 'op-1' } } })),
    { code: 'ECONFLICT', message: 'busy', details: { operationId: 'op-1' } }
  );
  assert.deepEqual(plain(State.normalizeError('transport failed')), {
    code: 'EUNKNOWN', message: 'transport failed', details: null
  });
});

test('redact hides nested secrets and Telegram proxy links without mutating input', async () => {
  const State = await loadModule();
  const input = {
    provider: 'go',
    secret: 'abc',
    nested: { token: 'def', link: 'tg://proxy?server=router&secret=abc' },
    rows: [{ password: 'ghi', port: 443 }]
  };

  assert.deepEqual(plain(State.redact(input)), {
    provider: 'go',
    secret: '••••••',
    nested: { token: '••••••', link: '••••••' },
    rows: [{ password: '••••••', port: 443 }]
  });
  assert.equal(input.secret, 'abc');
});

test('operationFrom preserves backend phase and events without inventing progress', async () => {
  const State = await loadModule();
  const operation = State.operationFrom('dns-apply', 'Применение DNS', {
    operationId: 'dns-7',
    state: 'running',
    phase: 'verifying',
    current: { provider: 'cloudflare' },
    events: [{ ts: '2026-08-10T12:00:00Z', level: 'info', message: 'Проверка DNS' }],
    controls: { cancel: false }
  });

  assert.deepEqual(plain(operation), {
    operationId: 'dns-7',
    kind: 'dns-apply',
    title: 'Применение DNS',
    state: 'running',
    phase: 'verifying',
    current: { provider: 'cloudflare' },
    events: [{ ts: '2026-08-10T12:00:00Z', level: 'info', message: 'Проверка DNS' }],
    warnings: [],
    result: null,
    error: null,
    controls: { cancel: false }
  });
  assert.equal('progress' in operation, false);
  assert.equal('percent' in operation, false);
});
