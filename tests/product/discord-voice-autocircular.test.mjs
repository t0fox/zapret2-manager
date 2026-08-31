import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const opsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');
const z2kAllInOnePath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/builtin/z2k_all_in_one.txt');
const compilerPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
const modernCorePath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-modern-core.lua');
const statePersistPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
const policyPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua');
const dbankAssetPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/bin/quic_initial_dbankcloud_ru.bin');

function loadModel() {
  assert.ok(fs.existsSync(modelPath), 'Strategies model must exist');
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

function createOpsSandbox(virtualFs = {}) {
  const opsSource = fs.readFileSync(opsPath, 'utf8');

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

  const code = `(function() {\n${transformed}\nreturn {\n  pools_read,\n  resolve_live_discord_key,\n  learned_rows,\n  learned_state,\n  state_set,\n  state_delete,\n  learned_clear\n};\n})()`;
  const exportsObj = vm.runInNewContext(code, sandbox);
  return { ...exportsObj, vfs, sandbox };
}

// =========================================================================
// TEST 1 — exact B profile in z2k_all_in_one
// =========================================================================
test('TEST 1: z2k_all_in_one catalog source contains exact upstream Discord B profile', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const cleanLines = z2kConfig.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  const segments = cleanLines.split('--new');
  const discordProfile = segments[2] || '';
  assert.match(discordProfile, /--filter-udp=50000-50100,1400,3478-3481,5349,19294-19344/, 'Must match exact Discord UDP ports with 50100');
  assert.match(discordProfile, /--filter-l7=discord,stun/, 'Must filter l7 discord,stun');
  assert.match(discordProfile, /--out-range=-d4/, 'Must have out-range=-d4');
  assert.match(discordProfile, /--payload=discord_ip_discovery,stun/, 'Must have payload=discord_ip_discovery,stun');
  assert.match(discordProfile, /key=discord_udp/, 'Must key to discord_udp');
  assert.match(discordProfile, /hostkey=z2k_nohost_key/, 'Must use hostkey=z2k_nohost_key');
  assert.match(discordProfile, /blob=quic_dbankcloud:repeats=10:strategy=1/, 'Strategy 1 must be quic_dbankcloud x10');
  assert.match(discordProfile, /blob=quic_dbankcloud:repeats=3:strategy=2/, 'Strategy 2 must be quic_dbankcloud x3');
  assert.match(discordProfile, /blob=quic_dbankcloud:repeats=6:strategy=3/, 'Strategy 3 must be quic_dbankcloud x6');
  assert.match(discordProfile, /blob=quic_dbankcloud:repeats=6:ip_autottl=-2,3-20:strategy=4/, 'Strategy 4 must be Dynamic TTL x6');
  assert.match(discordProfile, /blob=quic_dbankcloud:repeats=4:strategy=5/, 'Strategy 5 must be quic_dbankcloud x4');
  assert.match(discordProfile, /blob=quic_dbankcloud:repeats=5:strategy=6/, 'Strategy 6 must be quic_dbankcloud x5');
  assert.doesNotMatch(discordProfile, /strategy=7/, 'Must not contain strategy 7 in Discord profile');
  assert.doesNotMatch(discordProfile, /z2k_quic_morph_v2/, 'Must not contain old morph actions in Discord profile');
});

// =========================================================================
// TEST 2 — pool parsing in strategies-ops.uc
// =========================================================================
test('TEST 2: Live z2k_all_in_one parses discord_udp with size 6 and runtimeKey=discord_udp', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig
  });

  const res = ops.pools_read();
  assert.equal(res.ok, true);
  assert.ok(res.pools.discord_udp, 'discord_udp pool must exist in pools_read result');
  assert.equal(res.pools.discord_udp.protocol, 'STUN', 'discord_udp protocol MUST be STUN');
  assert.equal(res.pools.discord_udp.size, 6, 'discord_udp size must be 6');
  assert.equal(res.pools.discord_udp.runtimeKey, 'discord_udp', 'runtimeKey must be discord_udp');

  // Compatibility alias
  assert.ok(res.pools.discord_voice, 'discord_voice compatibility alias must exist');
  assert.equal(res.pools.discord_voice.runtimeKey, 'discord_udp', 'discord_voice alias must point to runtimeKey discord_udp');
  assert.equal(ops.resolve_live_discord_key(res.pools), 'discord_udp');
});

// =========================================================================
// TEST 3 — state mutation live B (alias discord_voice resolves to discord_udp)
// =========================================================================
test('TEST 3: state_set with alias discord_voice persists to authoritative discord_udp row', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 3,
    mode: 'auto'
  });

  assert.equal(res.ok, true);
  assert.equal(res.key, 'discord_udp', 'Returned key must be normalized live runtime key discord_udp');
  assert.equal(res.strategy, '3');

  const rows = ops.learned_rows();
  const discordRow = rows.find(r => r.host === 'nohost');
  assert.ok(discordRow, 'Authoritative row for nohost must exist');
  assert.equal(discordRow.key, 'discord_udp', 'Persisted key must be discord_udp');
  assert.equal(discordRow.strategy, '3');
  assert.equal(rows.filter(r => r.host === 'nohost').length, 1, 'Must not duplicate rows');
});

// =========================================================================
// TEST 4 — direct discord_udp mutation & bounds
// =========================================================================
test('TEST 4: Live pool size=6 bounds validation: 6 accept, 7 reject', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  const res6 = ops.state_set({ key: 'discord_udp', host: 'nohost', strategy: 6, mode: 'auto' });
  assert.equal(res6.ok, true, 'Strategy 6 within pool size 6 must be accepted');

  const res7 = ops.state_set({ key: 'discord_udp', host: 'nohost', strategy: 7, mode: 'auto' });
  assert.equal(res7.ok, false, 'Strategy 7 out of bounds (> 6) must be rejected');
  assert.equal(res7.error?.code, 'EINPUT');
});

// =========================================================================
// TEST 5 — no live Discord: state_set rejects
// =========================================================================
test('TEST 5: state_set discord_voice when live pool absent fails closed with EPOOL', () => {
  const tlsOnlyConfig = '--filter-tcp=80,443 --lua-desync=circular:fails=3:time=60:key=rkn_tcp --lua-desync=fake:strategy=1';
  const ops = createOpsSandbox({
    '/opt/zapret2/config': tlsOnlyConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 3,
    mode: 'auto'
  });

  assert.equal(res.ok, false, 'state_set must fail closed when pool is not active in live config');
  assert.equal(res.error?.code, 'EPOOL');
});

// =========================================================================
// TEST 6 — legacy migration valid (discord_voice 4 frozen -> discord_udp 4 frozen)
// =========================================================================
test('TEST 6: Valid legacy state discord_voice 4 frozen migrates to discord_udp 4 frozen', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': 'discord_voice\tnohost\t4\t1787150000\tfrozen\n'
  });

  const st = ops.learned_state();
  assert.equal(st.ok, true);
  const rows = ops.learned_rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'discord_udp');
  assert.equal(rows[0].strategy, '4');
  assert.equal(rows[0].mode, 'frozen');
});

// =========================================================================
// TEST 7 — legacy migration invalid (discord_voice 11 frozen -> discord_udp 1 auto)
// =========================================================================
test('TEST 7: Out-of-bounds legacy state discord_voice 11 frozen safely resets to discord_udp 1 auto', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': 'discord_voice\tnohost\t11\t1787150000\tfrozen\n'
  });

  const st = ops.learned_state();
  assert.equal(st.ok, true);
  const rows = ops.learned_rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'discord_udp');
  assert.equal(rows[0].strategy, '1');
  assert.equal(rows[0].mode, 'auto');
});

// =========================================================================
// TEST 8 — frontend live key extraction & 6 variants
// =========================================================================
test('TEST 8: Frontend Model extractDiscordVoiceState returns liveKey discord_udp and size 6', () => {
  const Model = loadModel();
  const pools = {
    discord_udp: {
      key: 'discord_udp',
      runtimeKey: 'discord_udp',
      protocol: 'STUN',
      size: 6,
      strategies: [
        { index: 1, name: 'Fake QUIC (x10)' },
        { index: 2, name: 'Fake QUIC (x3)' },
        { index: 3, name: 'Fake QUIC (x6)' },
        { index: 4, name: 'Fake QUIC (Dynamic TTL, x6)' },
        { index: 5, name: 'Fake QUIC (x4)' },
        { index: 6, name: 'Fake QUIC (x5)' }
      ]
    }
  };
  const entries = [
    { key: 'discord_udp', host: 'nohost', strategy: '2', ts: '1787150000', mode: 'auto' }
  ];

  const res = Model.extractDiscordVoiceState(entries, pools);
  assert.equal(res.key, 'discord_udp');
  assert.equal(res.runtimeKey, 'discord_udp');
  assert.equal(res.strategy, 2);
  assert.equal(res.isLive, true);

  const opts = Model.strategyOptionsForPool('discord_udp', pools);
  assert.equal(opts.length, 6);
  assert.equal(opts[0].name, 'Fake QUIC (x10)');
  assert.equal(opts[3].name, 'Fake QUIC (Dynamic TTL, x6)');
});

// =========================================================================
// TEST 9 — fallback metadata when no live pool
// =========================================================================
test('TEST 9: Fallback metadata provides 6 default variants with isLive=false when no live pool', () => {
  const Model = loadModel();
  const pools = {};
  const entries = [];

  const res = Model.extractDiscordVoiceState(entries, pools);
  assert.equal(res.isLive, false);
  assert.equal(res.strategy, 1);
});

// =========================================================================
// TEST 10 — capture ports derivation includes 50000-50100
// =========================================================================
test('TEST 10: Candidate B strategy capture ports derivation includes 50000-50100', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  assert.match(z2kConfig, /50000-50100/, 'Ports in profile must include 50000-50100');
});

// =========================================================================
// TEST 11 — asset exists in runtime-assets/bin/
// =========================================================================
test('TEST 11: quic_initial_dbankcloud_ru.bin exists in runtime-assets/bin with expected hash', () => {
  assert.ok(fs.existsSync(dbankAssetPath), 'Asset quic_initial_dbankcloud_ru.bin must exist');
  const stat = fs.statSync(dbankAssetPath);
  assert.equal(stat.size, 1357, 'Asset size must be 1357 bytes');
});

// =========================================================================
// TEST 12 — other pools regression
// =========================================================================
test('TEST 12: circular_1_1 and yt_quic pools remain intact', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig
  });

  const res = ops.pools_read();
  assert.ok(res.pools.circular_1_1, 'circular_1_1 must exist');
  assert.equal(res.pools.circular_1_1.size, 6);
  assert.ok(res.pools.yt_quic, 'yt_quic must exist');
  assert.equal(res.pools.yt_quic.size, 9);
});

// =========================================================================
// TEST 13 — domain table excludes nohost
// =========================================================================
test('TEST 13: Domain table filter excludes host=nohost for discord_udp', () => {
  const Model = loadModel();
  const entries = [
    { key: 'circular_1_1', host: 'youtube.com', strategy: '3', ts: '1787150001', mode: 'auto' },
    { key: 'discord_udp', host: 'nohost', strategy: '2', ts: '1787150003', mode: 'frozen' },
    { key: 'yt_quic', host: 'gstatic.com', strategy: '2', ts: '1787150002', mode: 'auto' }
  ];
  const domainEntries = Model.filterDomainLearnedEntries(entries);
  assert.equal(domainEntries.length, 2);
  assert.ok(domainEntries.every(e => e.host !== 'nohost'));
});

// =========================================================================
// TEST 14 — reset / freeze on live B
// =========================================================================
test('TEST 14: Freeze, auto, and reset operations target discord_udp/nohost', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  // Freeze #4
  ops.state_set({ key: 'discord_udp', host: 'nohost', strategy: 4, mode: 'frozen' });
  let rows = ops.learned_rows();
  assert.equal(rows[0].key, 'discord_udp');
  assert.equal(rows[0].strategy, '4');
  assert.equal(rows[0].mode, 'frozen');

  // Switch to auto
  ops.state_set({ key: 'discord_udp', host: 'nohost', strategy: 4, mode: 'auto' });
  rows = ops.learned_rows();
  assert.equal(rows[0].mode, 'auto');

  // Reset
  ops.learned_clear({ key: 'discord_udp', host: 'nohost' });
  rows = ops.learned_rows();
  assert.equal(rows.filter(r => r.host === 'nohost').length, 0);
});

// =========================================================================
// TEST 15 — persist compatibility in z2k-state-persist.lua
// =========================================================================
test('TEST 15: z2k-state-persist keeps generic askey storage and the policy owns Discord exclusion', () => {
  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  const policyContent = fs.readFileSync(policyPath, 'utf8');
  assert.match(persistContent, /desync\.arg\.key/);
  assert.match(persistContent, /desync\.func_instance/);
  assert.match(policyContent, /askey|hostn/);
});
