import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const uiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');

function loadModel() {
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

function loadUI(mockState = {}) {
  const source = fs.readFileSync(uiPath, 'utf8');
  const Model = loadModel();

  // Minimal DOM mocking for Node.js
  const domNodes = new Map();
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      classList: {
        add: (...cls) => { el.className = (el.className + ' ' + cls.join(' ')).trim(); },
        remove: (...cls) => {
          let parts = el.className.split(/\s+/).filter(c => !cls.includes(c));
          el.className = parts.join(' ');
        },
        contains: (c) => el.className.split(/\s+/).includes(c),
        toggle: (c, force) => {
          const has = el.classList.contains(c);
          const next = force !== undefined ? force : !has;
          if (next) el.classList.add(c); else el.classList.remove(c);
          return next;
        }
      },
      attributes: {},
      setAttribute: (k, v) => { el.attributes[k] = String(v); },
      getAttribute: (k) => el.attributes[k] || null,
      removeAttribute: (k) => { delete el.attributes[k]; },
      style: {},
      dataset: {},
      _innerHTML: '',
      _textContent: '',
      get innerHTML() { return el._innerHTML; },
      set innerHTML(val) { el._innerHTML = val; },
      get textContent() { return el._textContent; },
      set textContent(val) {
        el._textContent = val === null || val === undefined ? '' : String(val);
        el._innerHTML = el._textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      },
      children: [],
      parentNode: null,
      querySelector: (sel) => {
        if (sel === '#learned-modal-body') return domNodes.get('learned-modal-body') || null;
        if (sel === '#strat-picker-body') return domNodes.get('strat-picker-body') || null;
        if (sel === '#learned-modal') return domNodes.get('learned-modal') || null;
        if (sel === '#strat-picker-modal') return domNodes.get('strat-picker-modal') || null;
        if (sel === '.learned-modal-search') return domNodes.get('learned-modal-search') || null;
        return null;
      },
      querySelectorAll: (sel) => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    return el;
  }

  const rootDiv = createElement('div');
  const learnedModal = createElement('div');
  learnedModal.id = 'learned-modal';
  const learnedModalBody = createElement('div');
  learnedModalBody.id = 'learned-modal-body';
  domNodes.set('learned-modal', learnedModal);
  domNodes.set('learned-modal-body', learnedModalBody);

  const stratPickerModal = createElement('div');
  stratPickerModal.id = 'strat-picker-modal';
  const stratPickerBody = createElement('div');
  stratPickerBody.id = 'strat-picker-body';
  domNodes.set('strat-picker-modal', stratPickerModal);
  domNodes.set('strat-picker-body', stratPickerBody);

  rootDiv.querySelector = (sel) => {
    if (sel === '#learned-modal-body') return learnedModalBody;
    if (sel === '#strat-picker-body') return stratPickerBody;
    if (sel === '#learned-modal') return learnedModal;
    if (sel === '#strat-picker-modal') return stratPickerModal;
    return null;
  };

  const sandbox = {
    window: {
      setTimeout: (fn) => setTimeout(fn, 0),
      clearTimeout: (id) => clearTimeout(id),
      location: { hash: '' }
    },
    document: {
      createElement: createElement,
      getElementById: (id) => domNodes.get(id) || null
    },
    Model: Model,
    HealthcheckModel: { config: () => ({}), catalog: () => [], resultRows: () => [] },
    Icons: { html: (name, opts) => `<svg class="${opts?.className || ''}"></svg>` },
    Nfqws2Ide: null,
    baseclass: { extend: (def) => def },
    _: (s) => s,
    console: console
  };

  // Run UI script in sandbox
  const transformed = source
    .replace(/'require [^']+';/g, '')
    .replace(/return\s+baseclass\.extend\s*\(/g, 'const __exported = baseclass.extend(');

  const uiModule = vm.runInNewContext(`(function() {\n${transformed}\nreturn {\n  ...__exported,\n  state,\n  renderLearnedModal,\n  openLearnedModal,\n  closeLearnedModal,\n  openStratPicker,\n  closeStratPicker,\n  renderStratPickerModal,\n  selectStratPickerOption,\n  stateSet,\n  toggleStateFreeze,\n  resetLearned,\n  getStrategyOptions,\n  getModeBadge\n};\n})()`, sandbox);

  uiModule.state.root = rootDiv;
  uiModule.state.learnedModal = { search: '', protoFilter: 'all', sortField: 'ts', sortDir: 'desc', visibleCount: 50, open: true };
  Object.assign(uiModule.state, mockState);

  return { ui: uiModule, domNodes, Model };
}

test('UI: renderLearnedModal renders Discord Voice card with empty state (#1, Auto)', () => {
  const { ui, domNodes } = loadUI({
    learned: { entries: [], count: 0 },
    pools: {}
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Discord Voice/i, 'Learned modal must contain Discord Voice heading');
  assert.match(bodyHtml, /STUN/i, 'Must mention STUN protocol');
  assert.match(bodyHtml, /#1/i, 'Default strategy must be #1');
  assert.match(bodyHtml, /QUIC Morph v2/i, 'Strategy #1 name should be QUIC Morph v2');
  assert.match(bodyHtml, /Авто/i, 'Mode badge must be Авто');
  assert.match(bodyHtml, /data-action="openStratPicker"[^>]*data-key="discord_voice"[^>]*data-host="nohost"/, 'Must have strategy picker action button for discord_voice/nohost');
  assert.match(bodyHtml, /data-action="toggleStateFreeze"[^>]*data-key="discord_voice"[^>]*data-host="nohost"/, 'Must have freeze toggle button for discord_voice/nohost');
});

test('UI: renderLearnedModal renders Discord Voice card with frozen state (#7, Зафиксировано)', () => {
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150000', mode: 'frozen' },
        { key: 'circular_1_1', host: 'youtube.com', strategy: '2', ts: '1787150001', mode: 'auto' }
      ],
      count: 2
    },
    pools: {}
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /#7/i, 'Must show strategy #7');
  assert.match(bodyHtml, /Fake \(Dynamic TTL\)/i, 'Strategy #7 name should be Fake (Dynamic TTL)');
  assert.match(bodyHtml, /Зафиксирован/i, 'Mode badge must indicate frozen state');

  // Verify domain table does NOT show nohost as a domain row
  assert.doesNotMatch(bodyHtml, /<span class="learned-domain-copyable"[^>]*><strong>nohost<\/strong><\/span>/, 'nohost must NOT appear as a domain row');
  assert.match(bodyHtml, /youtube\.com/, 'youtube.com must appear as a domain row');
});

test('UI: openStratPicker for discord_voice opens picker with exactly 12 Discord variants', () => {
  const { ui, domNodes } = loadUI({
    pools: {}
  });

  ui.openStratPicker('discord_voice', 'nohost', 7, 'frozen');
  const pickerHtml = domNodes.get('strat-picker-body').innerHTML;

  assert.match(pickerHtml, /discord_voice/i);
  assert.match(pickerHtml, /#1/);
  assert.match(pickerHtml, /QUIC Morph v2/);
  assert.match(pickerHtml, /#7/);
  assert.match(pickerHtml, /#12/);
  assert.match(pickerHtml, /Fake QUIC \(x3\)/);
  // Ensure TLS options are not in Discord Voice picker
  assert.doesNotMatch(pickerHtml, /Fake TLS \(MD5\)/);
});

test('UI: selectStratPickerOption while frozen maintains frozen mode', () => {
  let calledApi = null;
  const { ui } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'frozen' }
      ]
    },
    ctx: {
      api: {
        strategies: {
          stateSet: (payload) => {
            calledApi = typeof payload === 'string' ? JSON.parse(payload) : payload;
            return Promise.resolve({ ok: true });
          }
        }
      }
    }
  });

  ui.openStratPicker('discord_voice', 'nohost', 1, 'frozen');
  ui.selectStratPickerOption('7');

  assert.deepEqual(calledApi, {
    key: 'discord_voice',
    host: 'nohost',
    strategy: '7',
    mode: 'frozen'
  });
});

test('UI: toggleStateFreeze switches auto -> frozen and frozen -> auto', () => {
  const calls = [];
  const { ui } = loadUI({
    learned: { entries: [] },
    ctx: {
      api: {
        strategies: {
          stateSet: (payload) => {
            calls.push(typeof payload === 'string' ? JSON.parse(payload) : payload);
            return Promise.resolve({ ok: true });
          }
        }
      }
    }
  });

  ui.toggleStateFreeze('discord_voice', 'nohost', 7, 'auto');
  assert.equal(calls[0].mode, 'frozen');

  ui.toggleStateFreeze('discord_voice', 'nohost', 7, 'frozen');
  assert.equal(calls[1].mode, 'auto');
});

test('UI: resetLearned for nohost deletes only Discord hostless state', () => {
  let deletedPayload = null;
  const { ui } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150000', mode: 'frozen' },
        { key: 'circular_1_1', host: 'youtube.com', strategy: '2', ts: '1787150001', mode: 'auto' }
      ],
      count: 2
    },
    ctx: {
      api: {
        strategies: {
          stateDelete: (payload) => {
            deletedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
            return Promise.resolve({ ok: true, deleted: true });
          }
        }
      }
    }
  });

  ui.resetLearned('nohost', 'discord_voice');

  assert.deepEqual(deletedPayload, { host: 'nohost', key: 'discord_voice' });
  assert.equal(ui.state.learned.entries.length, 1);
  assert.equal(ui.state.learned.entries[0].host, 'youtube.com');
});

