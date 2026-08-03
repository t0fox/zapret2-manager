// rpc.js wire-semantics for the single-view architecture. z2m-api.js is the
// only rpc.declare owner; tab modules consume its grouped facade.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';
import { checkRejectTrue, checkRpcObjects, stripComments } from './lib/checks.mjs';
import { collectFacadeMethods, collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const apiSource = readFileSync(`${root}/z2m-api.js`, 'utf8');
const expected = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));

function makeRpcWorld(responses = {}) {
  const world = { declarations: [], calls: [] };
  world.rpc = {
    declare(spec) {
      world.declarations.push(spec);
      return (...args) => {
        const params = {};
        if (Array.isArray(spec.params)) spec.params.forEach((name, index) => { params[name] = args[index]; });
        world.calls.push({ method: spec.method, params, reject: spec.reject === true });
        const response = responses[spec.method];
        if (response?.type === 'ubusError') {
          if (spec.reject === true) return Promise.reject({ code: response.code, message: `ubus ${response.code}` });
          return Promise.resolve(response.code);
        }
        return Promise.resolve(response?.value ?? {});
      };
    }
  };
  return world;
}
function loadFacade(responses = {}) {
  const world = makeRpcWorld(responses);
  const api = evaluateLuciModule(`${root}/z2m-api.js`, { rpc: world.rpc });
  return { api, world };
}

test('frozen RPC contract and grouped facade remain complete', () => {
  assert.deepEqual(collectUiContract(), expected);
  assert.deepEqual(collectFacadeMethods(), [...new Set(Object.values(expected).flat())].sort());
});

test('z2m-api is the only rpc.declare owner in the shipped frontend', () => {
  const owners = readdirSync(root).filter((file) => file.endsWith('.js') && /rpc\.declare\s*\(/.test(readFileSync(`${root}/${file}`, 'utf8'))).sort();
  assert.deepEqual(owners, ['z2m-api.js']);
});

test('every declaration uses the supported object and reject:true', () => {
  assert.deepEqual(checkRpcObjects(apiSource, 'z2m-api'), []);
  assert.deepEqual(checkRejectTrue(apiSource, 'z2m-api'), []);
  const { world } = loadFacade();
  assert.ok(world.declarations.length > 80);
  for (const spec of world.declarations) {
    assert.equal(spec.object, 'zapret2-manager', spec.method);
    assert.equal(spec.reject, true, spec.method);
    if (spec.params != null) assert.equal(Array.isArray(spec.params), true, `${spec.method}: params must be positional array`);
  }
});

test('params arrays map positional arguments exactly once', async () => {
  const { api, world } = loadFacade();
  await api.lists.checkDomain('example.com');
  await api.strategy.apply('{"candidateId":"p1"}');
  await api.proxy.configApply('{"enabled":true}');
  await api.maintenance.backupCreate('{"scope":"all"}');
  assert.deepEqual(world.calls.slice(-4), [
    { method: 'lists_check_domain', params: { domain: 'example.com' }, reject: true },
    { method: 'discord_profile_apply', params: { edit: '{"candidateId":"p1"}' }, reject: true },
    { method: 'proxy_config_apply', params: { edit: '{"enabled":true}' }, reject: true },
    { method: 'backup_create', params: { edit: '{"scope":"all"}' }, reject: true }
  ]);
});

test('object-form call demonstrates the double-nesting defect and is not used by tab modules', async () => {
  const { api, world } = loadFacade();
  await api.lists.checkDomain({ domain: 'example.com' });
  assert.deepEqual(world.calls.at(-1).params, { domain: { domain: 'example.com' } });
  for (const file of ['z2m-lists.js','z2m-dns.js','z2m-services.js','z2m-overview.js','z2m-strategy.js','z2m-auto.js','z2m-proxy.js','z2m-maintenance.js']) {
    const source = stripComments(readFileSync(`${root}/${file}`, 'utf8'));
    assert.doesNotMatch(source, /\.checkDomain\s*\(\s*\{|\.status\s*\(\s*\{|\.start\s*\(\s*\{|\.stop\s*\(\s*\{/,
      `${file}: object passed to a positional facade call`);
  }
});

test('ubus errors reject and reach tab catch paths', async () => {
  const { api } = loadFacade({ lists_get: { type: 'ubusError', code: 6 } });
  await assert.rejects(api.lists.get(), (error) => error.code === 6);
  for (const file of ['z2m-overview.js','z2m-strategy.js','z2m-auto.js','z2m-services.js','z2m-lists.js','z2m-dns.js','z2m-proxy.js','z2m-monitor.js','z2m-maintenance.js']) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.match(source, /Promise\.allSettled|\.catch\s*\(/, `${file}: no rejected-RPC path`);
  }
});

test('normalizeError keeps structured code/message and never invents success', () => {
  const { api } = loadFacade();
  assert.deepEqual(api.normalizeError({ code: 'ECONFLICT', message: 'revision changed' }), {
    code: 'ECONFLICT', message: 'revision changed', details: null
  });
  assert.deepEqual(api.normalizeError({ error: { code: 'EINPUT', message: 'bad edit', details: { field: 'edit' } } }), {
    code: 'EINPUT', message: 'bad edit', details: { field: 'edit' }
  });
  assert.equal(api.normalizeError(null).code, 'unknown');
});

test('mutation modules serialize edit payloads before calling the facade', () => {
  for (const file of ['z2m-overview.js','z2m-strategy.js','z2m-auto.js','z2m-services.js','z2m-dns.js','z2m-proxy.js','z2m-maintenance.js']) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.match(source, /JSON\.stringify\(value\s*\|\|\s*\{\}\)|JSON\.stringify\(payload|JSON\.stringify\(edit/,
      `${file}: mutation payload is not visibly serialized`);
  }
});

test('read-only load paths do not invoke mutation facade methods', () => {
  const checks = {
    'z2m-overview.js': ['strategy.apply','service.start','service.stop'],
    'z2m-strategy.js': ['strategy.apply','profiles.apply','orchestra.runStart'],
    'z2m-auto.js': ['autoEnable','autoDisable','autoRun','autoStop','autoRestore'],
    'z2m-lists.js': ['lists.set'],
    'z2m-dns.js': ['dns.apply','dns.set','dns.rollback'],
    'z2m-proxy.js': ['proxy.start','proxy.stop','proxy.restart','proxy.configApply'],
    'z2m-maintenance.js': ['backupCreate','backupRestore','backupDelete']
  };
  for (const [file, mutations] of Object.entries(checks)) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    const start = source.indexOf('function load(');
    const end = source.indexOf('function render(', start);
    const load = source.slice(start, end > start ? end : undefined);
    for (const mutation of mutations) assert.doesNotMatch(load, new RegExp(mutation.replaceAll('.', '\\.')),
      `${file}: load invokes mutation ${mutation}`);
  }
});

test('secrets are redacted or guarded before display', () => {
  const app = readFileSync(`${root}/app.js`, 'utf8');
  const proxy = readFileSync(`${root}/z2m-proxy.js`, 'utf8');
  assert.match(app, /secret\|token\|password/i);
  assert.match(proxy, /redact|reveal|secret/i);
  assert.doesNotMatch(proxy, /innerHTML/);
});
