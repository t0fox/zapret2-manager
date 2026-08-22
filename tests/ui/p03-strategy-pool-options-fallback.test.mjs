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

// --- combineStrategies -------------------------------------------------

test('P03 strategies model source parses and loads without syntax errors', () => {
  assert.doesNotThrow(() => loadModel(), 'model source must be syntactically valid JavaScript');
});

test('combineStrategies merges profiles from every donor strategy in order', () => {
  const model = loadModel();
  const combined = model.combineStrategies([
    { id: 'alpha', name: 'Alpha', profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=443', enabled: true }] },
    { id: 'beta', name: 'Beta', profiles: [{ id: 'p1', name: 'P1', args: '--filter-udp=443', enabled: false }] }
  ]);
  assert.equal(combined.id, '');
  assert.equal(combined.name, 'Alpha + Beta');
  assert.equal(combined.description, 'Объединено из: Alpha, Beta');
  assert.equal(combined.origin, 'user');
  assert.equal(combined.isBuiltin, false);
  assert.ok(Array.isArray(combined.profiles), 'combineStrategies must return a profiles array');
  assert.equal(combined.profiles.length, 2);
  assert.equal(combined.profiles[0].args, '--filter-tcp=443');
  assert.equal(combined.profiles[0].enabled, true);
  assert.equal(combined.profiles[1].args, '--filter-udp=443');
  assert.equal(combined.profiles[1].enabled, false);
});

test('combineStrategies falls back to a generated label when no strategy names are present', () => {
  const model = loadModel();
  const combined = model.combineStrategies([{ profiles: [{ args: '--new' }] }]);
  assert.equal(combined.name, 'Объединённая стратегия');
  assert.equal(combined.profiles.length, 1);
});

// --- strategyOptionsForPool ---------------------------------------------

test('strategyOptionsForPool deduplicates repeated strategy indices, keeping the first occurrence', () => {
  const model = loadModel();
  const pools = {
    dup_pool: {
      key: 'dup_pool',
      strategies: [
        { index: 1, name: 'First' },
        { index: 1, name: 'Duplicate Should Be Ignored' },
        { index: 2, name: 'Second' }
      ]
    }
  };
  const options = model.strategyOptionsForPool('dup_pool', 1, pools);
  assert.equal(options.length, 2, 'duplicate index must not inflate the derived pool size');
  assert.equal(options[0].name, 'First');
  assert.equal(options[1].name, 'Second');
});

test('strategyOptionsForPool ignores strategy entries with a non-positive index', () => {
  const model = loadModel();
  const pools = {
    invalid_pool: {
      key: 'invalid_pool',
      strategies: [
        { index: 0, name: 'Invalid Zero' },
        { index: -1, name: 'Invalid Negative' },
        { index: 1, name: 'Valid' }
      ]
    }
  };
  const options = model.strategyOptionsForPool('invalid_pool', 1, pools);
  assert.equal(options.length, 1);
  assert.equal(options[0].name, 'Valid');
});

test('strategyOptionsForPool derives pool size from unique strategy indices when no explicit size/max is given', () => {
  const model = loadModel();
  const pools = {
    sized_pool: {
      key: 'sized_pool',
      strategies: [{ index: 1, name: 'One' }, { index: 2, name: 'Two' }, { index: 3, name: 'Three' }]
    }
  };
  const options = model.strategyOptionsForPool('sized_pool', 1, pools);
  assert.equal(options.length, 3);
  assert.deepEqual(options.map((o) => o.name), ['One', 'Two', 'Three']);
});

test('strategyOptionsForPool honors an explicit size larger than the unique strategy count', () => {
  const model = loadModel();
  const pools = {
    padded_pool: {
      key: 'padded_pool',
      size: 5,
      strategies: [{ index: 1, name: 'Only Known' }]
    }
  };
  const options = model.strategyOptionsForPool('padded_pool', 1, pools);
  assert.equal(options.length, 5, 'explicit size must still fill remaining slots with generated names');
  assert.equal(options[0].name, 'Only Known');
  assert.equal(options[1].name, 'Стратегия #2');
  assert.equal(options[4].name, 'Стратегия #5');
});

test('strategyOptionsForPool caps runaway pool sizes at the safe maximum of 128', () => {
  const model = loadModel();
  const pools = { huge_pool: { key: 'huge_pool', size: 5000 } };
  const options = model.strategyOptionsForPool('huge_pool', 1, pools);
  assert.equal(options.length, 128, 'total option count must be capped at SAFE_MAX');
  assert.equal(options[127].index, 128);
});

test('strategyOptionsForPool still appends an unknown option beyond the capped total', () => {
  const model = loadModel();
  const pools = { huge_pool: { key: 'huge_pool', size: 5000 } };
  const options = model.strategyOptionsForPool('huge_pool', 300, pools);
  assert.equal(options.length, 129, 'capped list plus one unknown entry for the out-of-range current strategy');
  const unknown = options[options.length - 1];
  assert.equal(unknown.index, 300);
  assert.equal(unknown.isUnknown, true);
  assert.equal(unknown.selected, true);
  assert.equal(unknown.name, 'Неизвестная стратегия #300');
});

test('strategyOptionsForPool marks the option matching currentStrategy as selected', () => {
  const model = loadModel();
  const pools = { basic_pool: { key: 'basic_pool', size: 3 } };
  const options = model.strategyOptionsForPool('basic_pool', 2, pools);
  assert.deepEqual(options.map((o) => o.selected), [false, true, false]);
});

// --- resolveStrategyName -------------------------------------------------

test('resolveStrategyName falls back to DEFAULT_RUNTIME_POOLS when the live pool lacks a matching strategy entry', () => {
  const model = loadModel();
  const pools = {
    yt_quic: {
      key: 'yt_quic',
      size: 9,
      strategies: [{ index: 1, name: 'Custom Only One' }]
    }
  };
  // Index 5 is missing from the live pool but present in DEFAULT_RUNTIME_POOLS.yt_quic.
  const name = model.resolveStrategyName('yt_quic', 5, pools);
  assert.equal(name, model.DEFAULT_RUNTIME_POOLS.yt_quic.strategies[4].name);
});

test('resolveStrategyName falls back to DEFAULT_RUNTIME_POOLS when the live pool has no strategies array at all', () => {
  const model = loadModel();
  const pools = { yt_quic: { key: 'yt_quic', size: 9 } };
  const name = model.resolveStrategyName('yt_quic', 3, pools);
  assert.equal(name, model.DEFAULT_RUNTIME_POOLS.yt_quic.strategies[2].name);
});

test('resolveStrategyName prefers the live pool entry over the DEFAULT_RUNTIME_POOLS fallback', () => {
  const model = loadModel();
  const pools = {
    yt_quic: {
      key: 'yt_quic',
      size: 9,
      strategies: [{ index: 1, name: 'Live Override Name' }]
    }
  };
  const name = model.resolveStrategyName('yt_quic', 1, pools);
  assert.equal(name, 'Live Override Name');
});

test('resolveStrategyName returns a generated label when neither live nor default pools match', () => {
  const model = loadModel();
  const name = model.resolveStrategyName('unknown_pool_key', 42, {});
  assert.equal(name, 'Стратегия #42');
});

test('resolveStrategyName treats a non-numeric or missing currentStrategy as index 1', () => {
  const model = loadModel();
  const name = model.resolveStrategyName('yt_quic', 'not-a-number', {});
  assert.equal(name, model.DEFAULT_RUNTIME_POOLS.yt_quic.strategies[0].name);
});