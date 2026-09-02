import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const apiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const apiSource = fs.readFileSync(apiPath, 'utf8');

function loadTimeoutInternals() {
  const returnIndex = maintenanceSource.lastIndexOf('\nreturn baseclass.extend({');
  assert.ok(returnIndex >= 0, 'maintenance module return marker must exist');
  const prefix = maintenanceSource.slice(0, returnIndex);
  const timers = [];
  const window = {
    setTimeout(fn, ms) {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
  const internals = vm.runInNewContext(`(function () {\n${prefix}\nreturn { boundedLoad, checkedResult, Z2K_MUTATION_TIMEOUT_MS };\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    window,
    Promise,
    setTimeout,
    clearTimeout,
  }, { filename: maintenancePath });
  return { ...internals, timers };
}

function loadApi(requests) {
  const rpcDeclarations = [];
  const rpc = {
    declare(options) {
      rpcDeclarations.push(options);
      return function () { return Promise.resolve({ ok: true }); };
    },
    getSessionID() { return 'session-id'; },
    getBaseURL() { return '/ubus/'; },
    getStatusText(code) { return `status-${code}`; },
  };
  const request = {
    post(url, body, options) {
      requests.push({ url, body, options });
      return Promise.resolve({
        ok: true,
        status: 200,
        json() {
          return [{ jsonrpc: '2.0', id: body[0].id, result: [0, { ok: true, applied: 1 }] }];
        },
      });
    },
  };
  return {
    api: vm.runInNewContext(`(function () {\n${apiSource}\n})()`, {
      baseclass: { extend: value => value },
      rpc,
      request,
      Promise,
      Array,
      Object,
      Error,
      JSON,
      String,
    }, { filename: apiPath }),
    rpcDeclarations,
  };
}

test('confirmed Z2K mutation uses an independent bounded lifetime while ordinary loads stay at 30 seconds', async () => {
  const { checkedResult, Z2K_MUTATION_TIMEOUT_MS, timers } = loadTimeoutInternals();
  assert.equal(Z2K_MUTATION_TIMEOUT_MS, 180000);

  const normal = checkedResult(Promise.resolve({ ok: true }), 'page load');
  await normal;
  assert.equal(timers[0].ms, 30000);

  let resolveMutation;
  const pendingMutation = new Promise(resolve => { resolveMutation = resolve; });
  const mutation = checkedResult(pendingMutation, 'Применение Z2K', Z2K_MUTATION_TIMEOUT_MS);
  await Promise.resolve();
  assert.equal(timers[1].ms, 180000);
  assert.equal(timers[1].cleared, false, 'a still-running mutation must not be rejected by the page-load timer');

  resolveMutation({ ok: true });
  await mutation;
  assert.equal(timers[1].cleared, true);
});

test('resources.update uses a bounded operation-specific transport timeout instead of LuCI default rpctimeout', async () => {
  const requests = [];
  const { api } = loadApi(requests);
  const edit = JSON.stringify({
    bundleId: 'z2k-curated-lua',
    targetVersion: 'r-80.3',
    operation: 'upgrade',
    installedVersion: 'r-79.7',
    planToken: 'z2k-target-v2:test',
    confirm: true,
  });

  const result = await api.resources.update(edit);

  assert.deepEqual(result, { ok: true, applied: 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.timeout, 180000);
  assert.equal(requests[0].options.nobatch, true);
  assert.equal(requests[0].body[0].params[0], 'session-id');
  assert.equal(requests[0].body[0].params[1], 'zapret2-manager');
  assert.equal(requests[0].body[0].params[2], 'resources_update');
  assert.deepEqual(JSON.parse(requests[0].body[0].params[3].edit), JSON.parse(edit));
});

test('strategy Preview uses a real transport timeout instead of rpc.declare options', async () => {
  const requests = [];
  const { api } = loadApi(requests);
  const edit = JSON.stringify({
    strategy_id: 'z2k:z2k_all_in_one',
    revision: 0,
    catalog_digest: 'a'.repeat(64),
    validate: false,
  });

  const result = await api.strategies.preview(edit);

  assert.deepEqual(result, { ok: true, applied: 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.timeout, 60000);
  assert.equal(requests[0].options.nobatch, true);
  assert.equal(requests[0].body[0].params[0], 'session-id');
  assert.equal(requests[0].body[0].params[1], 'zapret2-manager');
  assert.equal(requests[0].body[0].params[2], 'strategies_preview');
  assert.equal(requests[0].body[0].params[3].edit, edit);
});

test('strategy List uses a bounded read transport for the large catalog', async () => {
  const requests = [];
  const { api } = loadApi(requests);

  const result = await api.strategies.list();

  assert.deepEqual(result, { ok: true, applied: 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.timeout, 60000);
  assert.equal(requests[0].options.nobatch, true);
  assert.equal(requests[0].body[0].params[2], 'strategies_list');
  assert.equal(JSON.stringify(requests[0].body[0].params[3]), '{}');
});

test('strategy Apply uses the long mutation transport and preserves the edit envelope', async () => {
  const requests = [];
  const { api } = loadApi(requests);
  const edit = JSON.stringify({
    strategy_id: 'z2k:z2k_all_in_one',
    revision: 0,
    catalog_digest: 'b'.repeat(64),
  });

  const result = await api.strategies.apply(edit);

  assert.deepEqual(result, { ok: true, applied: 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.timeout, 180000);
  assert.equal(requests[0].options.nobatch, true);
  assert.equal(requests[0].body[0].params[2], 'strategies_apply');
  assert.equal(requests[0].body[0].params[3].edit, edit);
});
