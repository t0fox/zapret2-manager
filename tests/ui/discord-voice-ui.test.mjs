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

test('TEST O: UI without live discord_voice renders inactive card with no mutation buttons', () => {
  const { ui, domNodes } = loadUI({
    learned: { entries: [], count: 0 },
    pools: {
      circular_1_1: { key: 'circular_1_1', protocol: 'TLS', size: 6, strategies: [] }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Discord Voice/i, 'Learned modal must contain Discord Voice heading');
  assert.match(bodyHtml, /Не используется текущей/i, 'Must indicate pool is not used by active strategy');
  assert.match(bodyHtml, /Не активно/i, 'Must have badge Не активно');
  assert.doesNotMatch(bodyHtml, /data-action="openStratPicker"[^>]*data-key="discord_voice"/, 'Inactive card must NOT have strategy picker button');
  assert.doesNotMatch(bodyHtml, /data-action="toggleStateFreeze"[^>]*data-key="discord_voice"/, 'Inactive card must NOT have freeze button');
  assert.doesNotMatch(bodyHtml, /data-action="resetLearned"[^>]*data-key="discord_voice"/, 'Inactive card must NOT have reset button');
});

test('TEST P: UI with live discord_voice renders active card and picker with 12 variants', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: { entries: [], count: 0 },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Discord Voice/i, 'Learned modal must contain Discord Voice heading');
  assert.match(bodyHtml, /STUN/i, 'Must mention STUN protocol');
  assert.match(bodyHtml, /#1/i, 'Default strategy must be #1');
  assert.match(bodyHtml, /QUIC Morph v2/i, 'Strategy #1 name should be QUIC Morph v2');
  assert.match(bodyHtml, /Авто/i, 'Mode badge must be Авто');
  assert.match(bodyHtml, /data-action="openStratPicker"[^>]*data-key="discord_voice"[^>]*data-host="nohost"/, 'Must have strategy picker button');
  assert.match(bodyHtml, /data-action="toggleStateFreeze"[^>]*data-key="discord_voice"[^>]*data-host="nohost"/, 'Must have freeze toggle button');
  assert.match(bodyHtml, /data-action="resetLearned"[^>]*data-key="discord_voice"/, 'Must have reset button');
});

test('UI: renderLearnedModal renders Discord Voice card with frozen state (#7, Зафиксировано)', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150000', mode: 'frozen' },
        { key: 'circular_1_1', host: 'youtube.com', strategy: '2', ts: '1787150001', mode: 'auto' }
      ],
      count: 2
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    }
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
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    }
  });

  ui.openStratPicker('discord_voice', 'nohost', 7, 'frozen');
  const pickerHtml = domNodes.get('strat-picker-body').innerHTML;

  assert.match(pickerHtml, /discord_voice/i);
  assert.match(pickerHtml, /#1/);
  assert.match(pickerHtml, /QUIC Morph v2/);
  assert.match(pickerHtml, /#7/);
  assert.match(pickerHtml, /#12/);
  assert.match(pickerHtml, /Fake QUIC \(x3\)/);
  assert.doesNotMatch(pickerHtml, /Fake TLS \(MD5\)/);
});

test('UI: selectStratPickerOption while frozen maintains frozen mode', () => {
  let calledApi = null;
  const Model = loadModel();
  const { ui } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'frozen' }
      ]
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
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
  const Model = loadModel();
  const { ui } = loadUI({
    learned: { entries: [] },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    },
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
  const Model = loadModel();
  const { ui } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150000', mode: 'frozen' },
        { key: 'circular_1_1', host: 'youtube.com', strategy: '2', ts: '1787150001', mode: 'auto' }
      ],
      count: 2
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
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

// ---------------------------------------------------------------------------
// TEST UI-1 to TEST UI-12 UX-Cleanup Suite
// ---------------------------------------------------------------------------

test('TEST UI-1: renderLearnedModal separates Особые ресурсы and Ресурсы sections', () => {
  const Model = loadModel();
  const domainEntries = Array.from({ length: 585 }, (_, i) => ({
    key: 'circular_1_1',
    host: `domain-${i}.com`,
    strategy: '1',
    ts: '1787150000',
    mode: 'auto'
  }));

  const { ui, domNodes } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'auto' },
        ...domainEntries
      ],
      count: 586
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      },
      circular_1_1: {
        key: 'circular_1_1',
        protocol: 'TLS',
        size: 6,
        strategies: []
      }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Особые ресурсы/i, 'Must contain "Особые ресурсы" section heading');
  assert.match(bodyHtml, /Discord Voice \/ Video/i, 'Must contain "Discord Voice / Video" card');
  assert.match(bodyHtml, /Ресурсы\s*<span[^>]*>[^<]*585/i, 'Must contain "Ресурсы — 585" section heading');
});

test('TEST UI-2: Discord hostless row is NOT included in resources count', () => {
  const Model = loadModel();
  const domainEntries = Array.from({ length: 585 }, (_, i) => ({
    key: 'circular_1_1',
    host: `site-${i}.com`,
    strategy: '1',
    ts: '1787150000',
    mode: 'auto'
  }));

  const { ui, domNodes } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'auto' },
        ...domainEntries
      ],
      count: 586
    },
    pools: {
      discord_voice: { key: 'discord_voice', protocol: 'STUN', size: 12, strategies: [] },
      circular_1_1: { key: 'circular_1_1', protocol: 'TLS', size: 6, strategies: [] }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Ресурсы[^0-9]*585/, 'Display count for resources must be 585');
  assert.doesNotMatch(bodyHtml, /Ресурсы[^0-9]*586/, 'Must not show 586 in resources title');
});

test('TEST UI-3: Search and domain table do NOT contain nohost', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [
        { key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'auto' },
        { key: 'circular_1_1', host: 'example.com', strategy: '1', ts: '1787150000', mode: 'auto' }
      ],
      count: 2
    },
    pools: {
      discord_voice: { key: 'discord_voice', protocol: 'STUN', size: 12, strategies: [] }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.doesNotMatch(bodyHtml, /<td[^>]*learned-col-domain[^>]*>[^<]*nohost/i, 'Domain table must not contain a nohost row');
  assert.match(bodyHtml, /example\.com/i, 'Domain table must contain regular domain');
});

test('TEST UI-4: Filter buttons contain Все, TLS, QUIC and do NOT contain Discord / STUN', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: { entries: [], count: 0 },
    pools: {
      discord_voice: { key: 'discord_voice', protocol: 'STUN', size: 12, strategies: [] }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /data-proto="all"[^>]*>Все<\/button>/, 'Must have "Все" filter button');
  assert.match(bodyHtml, /data-proto="tls"[^>]*>TLS<\/button>/, 'Must have "TLS" filter button');
  assert.match(bodyHtml, /data-proto="quic"[^>]*>QUIC<\/button>/, 'Must have "QUIC" filter button');
  assert.doesNotMatch(bodyHtml, /data-proto="stun"/, 'Must NOT have "Discord / STUN" filter button');
  assert.doesNotMatch(bodyHtml, />Discord \/ STUN<\/button>/, 'Must NOT render "Discord / STUN" filter button');
});

test('TEST UI-5: Discord active card uses "Текущий вариант" and "Выбрать вариант" terminology', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [{ key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'auto' }]
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Текущий вариант/i, 'Discord card must label current choice as "Текущий вариант"');
  assert.match(bodyHtml, /Выбрать вариант/i, 'Discord card action must be "Выбрать вариант"');
  assert.doesNotMatch(bodyHtml, /Текущая стратегия/i, 'Must NOT use "Текущая стратегия" in Discord card');
  assert.doesNotMatch(bodyHtml, /Изменить стратегию/i, 'Must NOT use "Изменить стратегию" in Discord card');
});

test('TEST UI-6: Auto mode shows "Автоподбор" and button "Зафиксировать #1"', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [{ key: 'discord_voice', host: 'nohost', strategy: '1', ts: '1787150000', mode: 'auto' }]
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Автоподбор/i, 'Mode label must be "Автоподбор"');
  assert.match(bodyHtml, /Зафиксировать\s*#1/i, 'Freeze button must show "Зафиксировать #1"');
});

test('TEST UI-7: Frozen mode shows #7, "Зафиксировано", and button "Вернуть автоподбор"', () => {
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [{ key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150000', mode: 'frozen' }]
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /#7/i, 'Must show variant #7');
  assert.match(bodyHtml, /Зафиксировано/i, 'Mode label must be "Зафиксировано"');
  assert.match(bodyHtml, /Вернуть автоподбор/i, 'Unfreeze button must show "Вернуть автоподбор"');
});

test('TEST UI-8: Inactive live pool shows "Не используется текущей стратегией" and no mutation buttons', () => {
  const { ui, domNodes } = loadUI({
    learned: { entries: [] },
    pools: {
      circular_1_1: { key: 'circular_1_1', protocol: 'TLS', size: 6, strategies: [] }
    }
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Не используется текущей стратегией/i);
  assert.match(bodyHtml, /Не активно/i);
  assert.doesNotMatch(bodyHtml, /Выбрать вариант/i);
  assert.doesNotMatch(bodyHtml, /Зафиксировать/i);
  assert.doesNotMatch(bodyHtml, /Сбросить выбор/i);
});

test('TEST UI-9: Discord reset action sends key=discord_voice, host=nohost and labels button "Сбросить выбор"', () => {
  let deletedPayload = null;
  const Model = loadModel();
  const { ui, domNodes } = loadUI({
    learned: {
      entries: [{ key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150000', mode: 'frozen' }]
    },
    pools: {
      discord_voice: {
        key: 'discord_voice',
        protocol: 'STUN',
        size: 12,
        strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
      }
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

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Сбросить выбор/i, 'Discord reset button must be labeled "Сбросить выбор"');
  assert.match(bodyHtml, /data-action="resetLearned"[^>]*data-key="discord_voice"[^>]*data-host="nohost"/);

  ui.resetLearned('nohost', 'discord_voice');
  assert.deepEqual(deletedPayload, { host: 'nohost', key: 'discord_voice' });
});

test('TEST UI-10: Global footer reset button is labeled "Сбросить обучение"', () => {
  const { ui, domNodes } = loadUI({
    learned: { entries: [] },
    pools: {}
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /Сбросить обучение/i, 'Global reset button must be labeled "Сбросить обучение"');
  assert.doesNotMatch(bodyHtml, /Сбросить всё/i, 'Must NOT use "Сбросить всё" in footer');
});

test('TEST UI-11: Domain table column header uses "Вариант" instead of "Стратегия"', () => {
  const { ui, domNodes } = loadUI({
    learned: { entries: [] },
    pools: {}
  });

  ui.renderLearnedModal();
  const bodyHtml = domNodes.get('learned-modal-body').innerHTML;

  assert.match(bodyHtml, /<th>Вариант<\/th>/i, 'Domain table column header must be "Вариант"');
  assert.doesNotMatch(bodyHtml, /<th>Стратегия<\/th>/i, 'Must NOT use "Стратегия" as column header');
});

test('TEST UI-12: Existing domain row edit and freeze toggle remain functional', () => {
  const Model = loadModel();
  const calls = [];
  const { ui } = loadUI({
    learned: {
      entries: [{ key: 'circular_1_1', host: 'example.com', strategy: '2', ts: '1787150000', mode: 'auto' }]
    },
    pools: {
      circular_1_1: { key: 'circular_1_1', protocol: 'TLS', size: 6, strategies: [] }
    },
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

  ui.toggleStateFreeze('circular_1_1', 'example.com', 2, 'auto');
  assert.deepEqual(calls[0], { key: 'circular_1_1', host: 'example.com', strategy: '2', mode: 'frozen' });
});


