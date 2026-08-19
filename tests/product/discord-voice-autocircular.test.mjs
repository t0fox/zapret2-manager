import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const opsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');
const z2kAllInOnePath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/builtin/z2k_all_in_one.txt');

function loadModel() {
  assert.ok(fs.existsSync(modelPath), 'Strategies model must exist');
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

function createOpsSandbox(virtualFs = {}) {
  const opsSource = fs.readFileSync(opsPath, 'utf8');

  // Convert ucode syntax for VM runner
  let transformed = opsSource
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/g, '')
    .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=/g, 'const $1 =')
    .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
    .replace(/for\s*\(\s*let\s+([a-zA-Z0-9_]+)\s+in\s+([^)]+)\)/g, 'for (let $1 of __iter($2))');

  const vfs = { ...virtualFs };

  const sandbox = {
    __iter: (val) => Array.isArray(val) ? val : Object.keys(val || {}),
    getenv: (name) => {
      if (name === 'Z2M_STRATEGY_LEARNED_STATE') return '/etc/zapret2-manager/state/autocircular/state.tsv';
      if (name === 'Z2M_STRATEGY_LEARNED_DIR') return '/etc/zapret2-manager/state/autocircular';
      return null;
    },
    readfile: (p) => {
      if (p in vfs) return vfs[p];
      return null;
    },
    writefile: (p, data) => {
      vfs[p] = String(data);
      return true;
    },
    stat: (p) => p in vfs ? { size: vfs[p].length } : null,
    unlink: (p) => { delete vfs[p]; return true; },
    mkdir: () => true,
    lsdir: () => Object.keys(vfs),
    popen: (cmd, mode) => {
      const mvMatch = cmd.match(/mv -f '([^']+)' '([^']+)'/) || cmd.match(/mv -f ([^\s]+) ([^\s]+)/);
      if (mvMatch) {
        const src = mvMatch[1];
        const dst = mvMatch[2];
        if (vfs[src] !== undefined) {
          vfs[dst] = vfs[src];
          delete vfs[src];
        }
      }
      return {
        read: () => '',
        close: () => 0
      };
    },
    match: (str, re) => {
      if (typeof str !== 'string') return null;
      return str.match(re);
    },
    split: (str, delim) => {
      if (typeof str !== 'string') return [];
      return str.split(delim);
    },
    substr: (str, start, len) => {
      if (typeof str !== 'string') return '';
      if (len !== undefined) return str.substr(start, len);
      return str.substr(start);
    },
    index: (target, item) => {
      if (!target) return -1;
      if (Array.isArray(target) || typeof target === 'string') return target.indexOf(item);
      return -1;
    },
    length: (val) => {
      if (val === null || val === undefined) return 0;
      if (typeof val === 'string' || Array.isArray(val)) return val.length;
      if (typeof val === 'object') return Object.keys(val).length;
      return 0;
    },
    push: (arr, item) => {
      if (Array.isArray(arr)) arr.push(item);
      return arr.length;
    },
    join: (delim, arr) => {
      if (Array.isArray(arr)) return arr.join(delim);
      return '';
    },
    lc: (str) => typeof str === 'string' ? str.toLowerCase() : '',
    trim: (str) => typeof str === 'string' ? str.trim() : '',
    type: (val) => {
      if (val === null) return 'null';
      if (Array.isArray(val)) return 'array';
      return typeof val;
    },
    keys: (obj) => obj && typeof obj === 'object' ? Object.keys(obj) : [],
    time: () => 1787150000,
    json: (str) => JSON.parse(str),
    sprintf: (fmt, val) => {
      if (fmt === '%J') return JSON.stringify(val);
      return String(val);
    },
    health_matrix_start: () => ({ ok: true }),
    health_matrix_get: () => ({ matrix: null }),
    read_var: () => null,
    vfs
  };

  const code = `(function() {\n${transformed}\nreturn {\n  pools_read,\n  learned_rows,\n  learned_state,\n  state_set,\n  state_delete,\n  learned_clear\n};\n})()`;
  const exportsObj = vm.runInNewContext(code, sandbox);
  return { ...exportsObj, vfs, sandbox };
}

// =========================================================================
// TEST 1: Active config contains key=discord_voice (z2k_all_in_one).
// pools_read() returns: discord_voice.protocol == STUN, discord_voice.size == 12
// =========================================================================
test('TEST 1: Active config with discord_voice classifies protocol as STUN and size as 12', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig
  });

  const res = ops.pools_read();
  assert.equal(res.ok, true);
  assert.ok(res.pools.discord_voice, 'discord_voice pool must exist in pools_read result');
  assert.equal(res.pools.discord_voice.protocol, 'STUN', 'discord_voice protocol MUST be STUN, not QUIC');
  assert.equal(res.pools.discord_voice.size, 12, 'discord_voice size must be 12');

  // Verify other pools are properly classified
  assert.equal(res.pools.circular_1_1.protocol, 'TLS');
  assert.equal(res.pools.circular_1_1.size, 6);
  assert.equal(res.pools.yt_quic.protocol, 'QUIC');
  assert.equal(res.pools.yt_quic.size, 9);
});

// =========================================================================
// TEST 2: Empty state.tsv - UI/model determines available discord_voice pool
// Discord Voice control must have currentStrategy=1, mode=auto, poolSize=12
// =========================================================================
test('TEST 2: Empty state.tsv defaults Discord Voice to strategy=1, mode=auto, poolSize=12', () => {
  const Model = loadModel();
  const emptyEntries = [];
  const pools = {
    discord_voice: {
      key: 'discord_voice',
      protocol: 'STUN',
      size: 12,
      strategies: Model.DEFAULT_RUNTIME_POOLS?.discord_voice?.strategies || []
    }
  };

  assert.equal(typeof Model.extractDiscordVoiceState, 'function', 'Model.extractDiscordVoiceState helper must exist');
  const state = Model.extractDiscordVoiceState(emptyEntries, pools);
  assert.equal(state.key, 'discord_voice');
  assert.equal(state.host, 'nohost');
  assert.equal(state.strategy, 1);
  assert.equal(state.mode, 'auto');
  assert.equal(state.isFrozen, false);
  assert.equal(state.exists, false);

  const options = Model.strategyOptionsForPool('discord_voice', state.strategy, pools);
  assert.equal(options.length, 12);
  assert.equal(options[0].selected, true);
  assert.equal(options[0].name, 'QUIC Morph v2');
});

// =========================================================================
// TEST 3: Manual select: discord_voice/nohost -> #7 auto creates state row
// =========================================================================
test('TEST 3: Manual select discord_voice/nohost -> #7 auto creates canonical state row', () => {
  const ops = createOpsSandbox({
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# empty state\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 7,
    mode: 'auto'
  });

  assert.equal(res.ok, true);
  assert.equal(res.key, 'discord_voice');
  assert.equal(res.host, 'nohost');
  assert.equal(res.strategy, '7');
  assert.equal(res.mode, 'auto');

  const rows = ops.learned_rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'discord_voice');
  assert.equal(rows[0].host, 'nohost');
  assert.equal(rows[0].strategy, '7');
  assert.equal(rows[0].mode, 'auto');
});

// =========================================================================
// TEST 4: Freeze: discord_voice/nohost #7 auto -> frozen
// =========================================================================
test('TEST 4: Freeze discord_voice/nohost #7 auto -> frozen', () => {
  const ops = createOpsSandbox({
    '/etc/zapret2-manager/state/autocircular/state.tsv': 'discord_voice\tnohost\t7\t1787150000\tauto\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 7,
    mode: 'frozen'
  });

  assert.equal(res.ok, true);
  assert.equal(res.mode, 'frozen');

  const rows = ops.learned_rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'discord_voice');
  assert.equal(rows[0].host, 'nohost');
  assert.equal(rows[0].strategy, '7');
  assert.equal(rows[0].mode, 'frozen');
});

// =========================================================================
// TEST 5: Changing strategy while frozen: #7 frozen -> select #4 => #4 frozen
// =========================================================================
test('TEST 5: Changing strategy while frozen keeps mode as frozen', () => {
  const ops = createOpsSandbox({
    '/etc/zapret2-manager/state/autocircular/state.tsv': 'discord_voice\tnohost\t7\t1787150000\tfrozen\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 4,
    mode: 'frozen'
  });

  assert.equal(res.ok, true);
  assert.equal(res.strategy, '4');
  assert.equal(res.mode, 'frozen');

  const rows = ops.learned_rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].strategy, '4');
  assert.equal(rows[0].mode, 'frozen');
});

// =========================================================================
// TEST 6: Reset Discord only - deletes discord_voice/nohost, leaves others intact
// =========================================================================
test('TEST 6: Reset Discord deletes only discord_voice/nohost without wiping other learned entries', () => {
  const initialTsv = [
    'circular_1_1\tyoutube.com\t3\t1787150001\tauto',
    'yt_quic\tgstatic.com\t2\t1787150002\tauto',
    'discord_voice\tnohost\t7\t1787150003\tfrozen'
  ].join('\n') + '\n';

  const ops = createOpsSandbox({
    '/etc/zapret2-manager/state/autocircular/state.tsv': initialTsv
  });

  const res = ops.state_delete({
    key: 'discord_voice',
    host: 'nohost'
  });

  assert.equal(res.ok, true);
  assert.equal(res.deleted, true);

  const rows = ops.learned_rows();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, 'circular_1_1');
  assert.equal(rows[0].host, 'youtube.com');
  assert.equal(rows[1].key, 'yt_quic');
  assert.equal(rows[1].host, 'gstatic.com');
});

// =========================================================================
// TEST 7: Domain table filter excludes host=nohost
// =========================================================================
test('TEST 7: Domain table filter excludes host=nohost', () => {
  const Model = loadModel();
  const entries = [
    { key: 'circular_1_1', host: 'youtube.com', strategy: '3', ts: '1787150001', mode: 'auto' },
    { key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150003', mode: 'frozen' },
    { key: 'yt_quic', host: 'gstatic.com', strategy: '2', ts: '1787150002', mode: 'auto' }
  ];

  assert.equal(typeof Model.filterDomainLearnedEntries, 'function', 'Model.filterDomainLearnedEntries must exist');
  const domainEntries = Model.filterDomainLearnedEntries(entries);
  assert.equal(domainEntries.length, 2);
  assert.ok(domainEntries.every(e => e.host !== 'nohost'), 'No entry in domain table may have host=nohost');
  assert.equal(domainEntries[0].host, 'youtube.com');
  assert.equal(domainEntries[1].host, 'gstatic.com');
});

// =========================================================================
// TEST 8: Bounds validation for live discord_voice (size 12)
// 12 => accepted, 13 => rejected, 999 => rejected, 0 => rejected, abc => rejected
// =========================================================================
test('TEST 8: Backend state_set enforces pool bounds for discord_voice (size 12)', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  // 12 => accepted
  const res12 = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 12, mode: 'auto' });
  assert.equal(res12.ok, true, 'Strategy 12 within pool size 12 must be accepted');

  // 13 => rejected
  const res13 = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 13, mode: 'auto' });
  assert.equal(res13.ok, false, 'Strategy 13 out of bounds (> 12) must be rejected');
  assert.equal(res13.error?.code, 'EINPUT');

  // 999 => rejected
  const res999 = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 999, mode: 'auto' });
  assert.equal(res999.ok, false, 'Strategy 999 must be rejected');

  // 0 => rejected
  const res0 = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 0, mode: 'auto' });
  assert.equal(res0.ok, false, 'Strategy 0 must be rejected');

  // abc => rejected
  const resAbc = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 'abc', mode: 'auto' });
  assert.equal(resAbc.ok, false, 'Non-integer strategy must be rejected');
});

// =========================================================================
// TEST 9: Legacy migration: discord_udp nohost 5 frozen -> normalized to discord_voice
// =========================================================================
test('TEST 9: Legacy discord_udp is recognized and normalized to discord_voice upon mutation', () => {
  const Model = loadModel();
  const legacyEntries = [
    { key: 'discord_udp', host: 'nohost', strategy: '5', ts: '1787150000', mode: 'frozen' }
  ];

  const state = Model.extractDiscordVoiceState(legacyEntries, {});
  assert.equal(state.strategy, 5);
  assert.equal(state.mode, 'frozen');
  assert.equal(state.isFrozen, true);
  assert.equal(state.legacyKey, 'discord_udp');

  // Mutating via backend state_set normalizes to discord_voice and eliminates discord_udp
  const ops = createOpsSandbox({
    '/etc/zapret2-manager/state/autocircular/state.tsv': 'discord_udp\tnohost\t5\t1787150000\tfrozen\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 6,
    mode: 'frozen'
  });

  assert.equal(res.ok, true);
  const rows = ops.learned_rows();
  assert.equal(rows.length, 1, 'Only one normalized row must exist');
  assert.equal(rows[0].key, 'discord_voice');
  assert.equal(rows[0].host, 'nohost');
  assert.equal(rows[0].strategy, '6');
  assert.equal(rows[0].mode, 'frozen');
});

// =========================================================================
// TEST 10: Existing TLS behavior regression
// =========================================================================
test('TEST 10: Existing TLS pool circular_1_1 behavior regression', () => {
  const Model = loadModel();
  const pools = {
    circular_1_1: {
      key: 'circular_1_1',
      protocol: 'TLS',
      size: 6,
      strategies: [
        { index: 1, name: 'Fake TLS (MD5)' },
        { index: 2, name: 'Multidisorder (midsld) + Fake (Dynamic TTL)' },
        { index: 3, name: 'Multisplit (SeqOvl) + Multisplit (host)' },
        { index: 4, name: 'Fake (Dynamic TTL) + Multidisorder (host)' },
        { index: 5, name: 'Fake TLS + Multisplit (midsld)' },
        { index: 6, name: 'Multisplit (host)' }
      ]
    }
  };

  const options = Model.strategyOptionsForPool('circular_1_1', 2, pools);
  assert.equal(options.length, 6);
  assert.equal(options[1].selected, true);
  assert.equal(options[1].name, 'Multidisorder (midsld) + Fake (Dynamic TTL)');
  assert.equal(Model.resolveStrategyName('circular_1_1', 1, pools), 'Fake TLS (MD5)');
});

// =========================================================================
// TEST 11: Existing yt_quic regression
// =========================================================================
test('TEST 11: Existing yt_quic pool behavior regression (9 runtime variants, QUIC)', () => {
  const Model = loadModel();
  const pools = {
    yt_quic: {
      key: 'yt_quic',
      protocol: 'QUIC',
      size: 9,
      strategies: [
        { index: 1, name: 'Fake QUIC (google x11)' },
        { index: 2, name: 'Fake QUIC (google x8)' },
        { index: 3, name: 'Fake QUIC (google x6)' },
        { index: 4, name: 'Fake QUIC (x3) + IPFrag' },
        { index: 5, name: 'UDPLen (+4) + Fake QUIC (x2)' },
        { index: 6, name: 'UDPLen (+8) + Fake QUIC (x2)' },
        { index: 7, name: 'UDPLen (+25) + Fake QUIC (x2)' },
        { index: 8, name: 'Fake QUIC (x6)' },
        { index: 9, name: 'UDPLen (+8) + Fake QUIC (x2)' }
      ]
    },
    discord_voice: {
      key: 'discord_voice',
      protocol: 'STUN',
      size: 12,
      strategies: []
    }
  };

  const quicOptions = Model.strategyOptionsForPool('yt_quic', 1, pools);
  assert.equal(quicOptions.length, 9);
  assert.equal(quicOptions[0].name, 'Fake QUIC (google x11)');
  assert.notEqual(Model.resolveStrategyName('yt_quic', 1, pools), Model.resolveStrategyName('discord_voice', 1, pools));
});
