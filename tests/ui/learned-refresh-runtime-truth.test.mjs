import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const pagePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');

function loadRefreshHarness(learnedState, pools) {
  const source = fs.readFileSync(pagePath, 'utf8');
  const start = source.indexOf('function refreshLearned()');
  const end = source.indexOf('function stateSet(', start);
  assert.ok(start >= 0 && end > start, 'refreshLearned function must remain discoverable');
  const refreshSource = source.slice(start, end);
  const state = {
    ctx: { api: { strategies: { learnedState, pools } } },
    learned: { entries: [{ key: 'rkn_tcp', host: 'old.example', strategy: '2', mode: 'auto' }], count: 1 },
    pools: { rkn_tcp: { size: 3 } },
    learnedError: null,
    learnedPoolsError: null
  };
  const sandbox = {
    state,
    Promise,
    Array,
    Number,
    JSON,
    call: (fn, payload) => fn(JSON.stringify(payload || {})),
    renderOperationalCards: () => {}
  };
  const exportsObject = vm.runInNewContext(`(function () { ${refreshSource}\nreturn { refreshLearned }; })()`, sandbox);
  return { state, refreshLearned: exportsObject.refreshLearned };
}

function loadLearnedCardRenderHarness(learned, learnedError = null, learnedPoolsError = null) {
  const source = fs.readFileSync(pagePath, 'utf8');
  const start = source.indexOf('function renderOperationalCards()');
  const end = source.indexOf('function getStrategyOptions(', start);
  assert.ok(start >= 0 && end > start, 'renderOperationalCards function must remain discoverable');
  const renderSource = source.slice(start, end);
  const nodes = {
    '#strategy-healthcheck-info': { innerHTML: '' },
    '#strategy-learned-info': { innerHTML: '' },
    '#strategy-journal-info': { innerHTML: '' },
  };
  const state = {
    root: { querySelector: (selector) => nodes[selector] || null },
    healthcheck: {},
    healthcheckSettings: {},
    learned,
    learnedError,
    learnedPoolsError,
  };
  const sandbox = {
    state,
    Model: { humanizeLearnedEntry: (entry) => entry },
    Object,
    Array,
    Number,
    String,
    object: (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
    array: (value) => Array.isArray(value) ? value : [],
    text: (value) => value == null ? '' : String(value),
    escapeHtml: (value) => String(value == null ? '' : value),
    escapeAttr: (value) => String(value == null ? '' : value),
    svgIcon: () => '',
    healthStatusLabel: () => '',
    renderHealthcheckSettings: () => '',
    renderHealthcheckResults: () => '',
  };
  const exportsObject = vm.runInNewContext(`(function () { ${renderSource}\nreturn { renderOperationalCards }; })()`, sandbox);
  return { renderOperationalCards: exportsObject.renderOperationalCards, learnedNode: nodes['#strategy-learned-info'] };
}

test('learned refresh keeps the last confirmed rows during a transient RPC failure', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.reject({ code: 'ERPC', message: 'temporary RPC failure' }),
    () => Promise.resolve({ pools: { rkn_tcp: { size: 3 } } })
  );

  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['old.example']);
  assert.equal(state.learned.count, 1);
  assert.equal(state.learnedError.code, 'ERPC');
});

test('learned refresh treats a structured RPC failure as unavailable, not as an empty snapshot', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.resolve({ ok: false, error: { code: 'EACCESS', message: 'state unavailable' } }),
    () => Promise.resolve({ pools: { rkn_tcp: { size: 3 } } })
  );

  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['old.example']);
  assert.equal(state.learned.count, 1);
  assert.equal(state.learnedError.code, 'EACCESS');
});

test('learned refresh clears the stale error and adopts a recovered runtime snapshot', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.resolve({ entries: [{ key: 'yt_tcp', host: 'new.example', strategy: '4', mode: 'auto' }], count: 1 }),
    () => Promise.resolve({ pools: { yt_tcp: { size: 4 } } })
  );

  state.learnedError = { code: 'ERPC', message: 'previous failure' };
  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['new.example']);
  assert.equal(state.learned.count, 1);
  assert.equal(state.learnedError, null);
  assert.deepEqual(state.pools, { yt_tcp: { size: 4 } });
});

test('learned refresh adopts an appended runtime row without dropping confirmed rows', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.resolve({
      entries: [
        { key: 'rkn_tcp', host: 'old.example', strategy: '2', mode: 'auto' },
        { key: 'yt_tcp', host: 'new.example', strategy: '4', mode: 'auto' },
      ],
      count: 2,
    }),
    () => Promise.resolve({ pools: { rkn_tcp: { size: 3 }, yt_tcp: { size: 4 } } })
  );

  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['old.example', 'new.example']);
  assert.equal(state.learned.count, 2);
  assert.equal(state.learnedError, null);
  assert.deepEqual(state.pools, { rkn_tcp: { size: 3 }, yt_tcp: { size: 4 } });
});

test('learned refresh exposes an explicit retry state instead of rendering an empty success state', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /learned-refresh-warning/);
  assert.match(source, /data-action="refreshLearned"/);
  assert.match(source, /Список обучения временно недоступен\. Он не был очищен/);
});

test('learned card does not claim empty before the first confirmed snapshot', () => {
  const { renderOperationalCards, learnedNode } = loadLearnedCardRenderHarness(null);

  renderOperationalCards();

  assert.match(learnedNode.innerHTML, /Загрузка списка выученных стратегий/);
  assert.doesNotMatch(learnedNode.innerHTML, /Пока ничего не выучено/);
});

test('learned refresh rejects an incomplete RPC snapshot instead of treating it as empty success', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.resolve({}),
    () => Promise.resolve({ pools: { rkn_tcp: { size: 3 } } })
  );

  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['old.example']);
  assert.equal(state.learned.count, 1);
  assert.equal(state.learnedError.code, 'EINVALID');
});

test('learned refresh rejects a count that disagrees with the returned entries', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.resolve({ entries: [{ key: 'yt_tcp', host: 'new.example', strategy: '4', mode: 'auto' }], count: 2 }),
    () => Promise.resolve({ pools: { yt_tcp: { size: 4 } } })
  );

  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['old.example']);
  assert.equal(state.learned.count, 1);
  assert.equal(state.learnedError.code, 'EINVALID');
});

test('learned refresh keeps a fresh list separate from optional pool enrichment failure', async () => {
  const { state, refreshLearned } = loadRefreshHarness(
    () => Promise.resolve({ entries: [{ key: 'yt_tcp', host: 'new.example', strategy: '4', mode: 'auto' }], count: 1 }),
    () => Promise.resolve({ ok: false, error: { code: 'EPOOL', message: 'pool metadata unavailable' } })
  );

  await refreshLearned();

  assert.deepEqual(state.learned.entries.map((row) => row.host), ['new.example']);
  assert.equal(state.learnedError, null);
  assert.equal(state.learnedPoolsError.code, 'EPOOL');
});

test('learned card labels pool enrichment failure without claiming the learned list is stale', () => {
  const { renderOperationalCards, learnedNode } = loadLearnedCardRenderHarness(
    { entries: [{ host: 'new.example', protocol: 'TLS', variant: 'Вариант 4' }], count: 1 },
    null,
    { code: 'EPOOL' }
  );

  renderOperationalCards();

  assert.match(learnedNode.innerHTML, /Список обновлён/);
  assert.match(learnedNode.innerHTML, /Названия вариантов временно недоступны/);
  assert.doesNotMatch(learnedNode.innerHTML, /Не удалось обновить список/);
});
