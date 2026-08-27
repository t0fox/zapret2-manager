import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const pageSource = fs.readFileSync(path.join(viewRoot, 'z2m-strategies.js'), 'utf8');
const modelSource = fs.readFileSync(path.join(viewRoot, 'z2m-strategies-model.js'), 'utf8');

function loadModule(source) {
  return vm.runInNewContext(`(function () {${source}\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    console,
    window: {},
    document: {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
}

test('partially truncated sources fetch once before combine and preserve every profile in order', async () => {
  const page = loadModule(pageSource);
  const model = loadModule(modelSource);
  const calls = [];
  const fullA = {
    id: 'A', name: 'A', profiles: [
      { id: 'p1', name: 'A1', args: '--filter-tcp=443', enabled: true },
      { id: 'p2', name: 'A2', args: '--filter-tcp=80', enabled: false },
    ],
  };
  const fullB = {
    id: 'B', name: 'B', profiles: [
      { id: 'p1', name: 'B1', args: '--filter-udp=443', enabled: true },
    ],
  };
  const adapter = page.createAdapter({
    strategies: {
      get: payload => {
        const request = JSON.parse(payload);
        calls.push(request.id);
        return Promise.resolve({ strategy: request.id === 'A' ? fullA : fullB });
      },
    },
  });
  const partialA = {
    id: 'A', name: 'A', profiles: [
      { id: 'p1', args: '--filter-tcp=443', argsTruncated: false, enabled: true },
      { id: 'p2', args: '', argsTruncated: true, enabled: false },
    ],
  };

  const resolved = await Promise.all([
    adapter.ensureFullStrategy(partialA),
    adapter.ensureFullStrategy(fullB),
  ]);
  const combined = model.combineStrategies(resolved);

  assert.deepEqual(calls, ['A']);
  assert.deepEqual(JSON.parse(JSON.stringify(combined.profiles.map(profile => [profile.args, profile.enabled]))), [
    ['--filter-tcp=443', true],
    ['--filter-tcp=80', false],
    ['--filter-udp=443', true],
  ]);
  assert.equal(combined.profiles.some(profile => profile.args === ''), false);
});

test('fully loaded source does not make an unnecessary strategies.get call', async () => {
  const page = loadModule(pageSource);
  let calls = 0;
  const full = { id: 'full', profiles: [{ id: 'p1', args: '', argsTruncated: false }] };
  const adapter = page.createAdapter({
    strategies: { get: () => { calls += 1; return Promise.resolve(full); } },
  });

  assert.equal(adapter.isFullStrategy(full), true);
  assert.equal(adapter.isFullStrategy({ id: 'partial', profiles: [{ id: 'p1', args: '--filter-tcp=443' }, { id: 'p2', args: '', argsTruncated: true }] }), false);
  assert.equal(adapter.isFullStrategy({ id: 'missing', profiles: [{ id: 'p1' }] }), false);
  assert.equal(await adapter.ensureFullStrategy(full), full);
  assert.equal(calls, 0);
});

test('Strategy page uses full snapshots and structured preview diagnostics', () => {
  assert.match(pageSource, /function isFullStrategy\(strategy\)/);
  assert.match(pageSource, /function ensureFullStrategy\(strategy/);
  assert.match(pageSource, /function cloneStrategy\(strategy\)/);
  assert.match(pageSource, /Preview profile count mismatch/);
  assert.match(pageSource, /profiles_count/);
  assert.match(pageSource, /Technical details|Технические сведения/);
  assert.doesNotMatch(pageSource, /Resolved assets\/dependencies:<\/b>.*JSON\.stringify/);
  assert.doesNotMatch(pageSource, /<b>effective argv:<\/b>/);
});

test('Strategy page has a fatal editor recovery boundary for create and update failures', () => {
  assert.match(pageSource, /function resetStrategyEditorRuntime\(\)/);
  assert.match(pageSource, /resetStrategyEditorRuntime\(\);[\s\S]{0,500}notify\(/);
  assert.match(pageSource, /try \{\s*state\.strategyEditor\.update\(state\.editor\);[\s\S]*catch/);
  assert.match(pageSource, /try \{[\s\S]*StrategyEditor\.create\([\s\S]*catch/);
  assert.match(pageSource, /state\.editorLoadingId\s*=\s*null/);
});

test('mergeSelected resolves every selected row through the canonical full-strategy helper', () => {
  const merge = pageSource.match(/function mergeSelected\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(merge, /ensureFullStrategy\(strategy(?:,|\))/);
  assert.doesNotMatch(merge, /profiles\.some/);
});
