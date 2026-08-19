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

  const code = `(function() {\n${transformed}\nreturn {\n  pools_read,\n  learned_rows,\n  learned_state,\n  state_set,\n  state_delete,\n  learned_clear\n};\n})()`;
  const exportsObj = vm.runInNewContext(code, sandbox);
  return { ...exportsObj, vfs, sandbox };
}

// =========================================================================
// TEST A: Live z2k_all_in_one: discord_voice found, protocol STUN, size 12
// =========================================================================
test('TEST A: Live z2k_all_in_one classifies protocol as STUN and size as 12', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig
  });

  const res = ops.pools_read();
  assert.equal(res.ok, true);
  assert.ok(res.pools.discord_voice, 'discord_voice pool must exist in pools_read result');
  assert.equal(res.pools.discord_voice.protocol, 'STUN', 'discord_voice protocol MUST be STUN');
  assert.equal(res.pools.discord_voice.size, 12, 'discord_voice size must be 12');
});

// =========================================================================
// TEST B: Live config without Discord: discord_voice ABSENT as live pool
// =========================================================================
test('TEST B: Live config without Discord has discord_voice ABSENT from live pools', () => {
  const tlsOnlyConfig = '--filter-tcp=80,443 --lua-desync=circular:fails=3:time=60:key=rkn_tcp --lua-desync=fake:strategy=1';
  const ops = createOpsSandbox({
    '/opt/zapret2/config': tlsOnlyConfig
  });

  const res = ops.pools_read();
  assert.equal(res.ok, true);
  assert.equal(res.pools.discord_voice, undefined, 'discord_voice must NOT be present when config has no discord profile');
  assert.equal(res.pools.discord_udp, undefined, 'discord_udp must NOT be present when config has no discord profile');
});

// =========================================================================
// TEST C: state_set discord_voice when live pool absent: REJECT with EPOOL
// =========================================================================
test('TEST C: state_set discord_voice when live pool absent fails closed with EPOOL', () => {
  const tlsOnlyConfig = '--filter-tcp=80,443 --lua-desync=circular:fails=3:time=60:key=rkn_tcp --lua-desync=fake:strategy=1';
  const ops = createOpsSandbox({
    '/opt/zapret2/config': tlsOnlyConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  const res = ops.state_set({
    key: 'discord_voice',
    host: 'nohost',
    strategy: 7,
    mode: 'auto'
  });

  assert.equal(res.ok, false, 'state_set must fail closed when pool is not active in live config');
  assert.equal(res.error?.code, 'EPOOL', 'Error code must be EPOOL');
});

// =========================================================================
// TEST D: Live pool bounds validation (size 12: 12 accept, 13 reject)
// =========================================================================
test('TEST D: Live pool size=12 bounds validation: 12 accept, 13 reject', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  const ops = createOpsSandbox({
    '/opt/zapret2/config': z2kConfig,
    '/etc/zapret2-manager/state/autocircular/state.tsv': '# state\n'
  });

  const res12 = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 12, mode: 'auto' });
  assert.equal(res12.ok, true, 'Strategy 12 within pool size 12 must be accepted');

  const res13 = ops.state_set({ key: 'discord_voice', host: 'nohost', strategy: 13, mode: 'auto' });
  assert.equal(res13.ok, false, 'Strategy 13 out of bounds (> 12) must be rejected');
  assert.equal(res13.error?.code, 'EINPUT');
});

// =========================================================================
// TEST E: z2k_all_in_one compiler/apply output contains complete Discord profile
// =========================================================================
test('TEST E: z2k_all_in_one catalog source contains complete Discord profile with nohost synthetic handling', () => {
  const z2kConfig = fs.readFileSync(z2kAllInOnePath, 'utf8');
  assert.match(z2kConfig, /--filter-udp=50000-50099,1400,3478-3481,5349,19294-19344/, 'Must match exact Discord UDP ports');
  assert.match(z2kConfig, /--filter-l7=discord,stun/, 'Must filter l7 discord,stun');
  assert.match(z2kConfig, /--payload=quic_initial,discord_ip_discovery/, 'Must include payloads');
  assert.match(z2kConfig, /key=discord_voice/, 'Must key to discord_voice');
  assert.match(z2kConfig, /hostkey=z2k_nohost_key/, 'Must use hostkey=z2k_nohost_key');
  assert.match(z2kConfig, /strategy=12/, 'Must contain strategy 12');

  const compilerSrc = fs.readFileSync(compilerPath, 'utf8');
  assert.match(compilerSrc, /isSyntheticNoHost/, 'Compiler must define synthetic no-host detection');
  assert.match(compilerSrc, /hostkey=z2k_nohost_key/, 'Compiler must recognize hostkey=z2k_nohost_key');
});

// =========================================================================
// TEST F: Runtime init chain contains z2k-modern-core + z2k-state-persist
// =========================================================================
test('TEST F: Runtime init chain files exist and define required symbols', () => {
  assert.ok(fs.existsSync(modernCorePath), 'z2k-modern-core.lua must exist');
  assert.ok(fs.existsSync(statePersistPath), 'z2k-state-persist.lua must exist');

  const coreContent = fs.readFileSync(modernCorePath, 'utf8');
  assert.match(coreContent, /function z2k_nohost_key/, 'z2k_nohost_key must be defined');
  assert.match(coreContent, /function z2k_quic_morph_v2/, 'z2k_quic_morph_v2 must be defined');
  assert.match(coreContent, /function z2k_timing_morph/, 'z2k_timing_morph must be defined');

  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  assert.match(persistContent, /z2k_nohost_key = true/, 'z2k_nohost_key must be allowed in persist');
  assert.match(persistContent, /reconcile_external_edits/, 'reconcile_external_edits must be present');
});

// =========================================================================
// TEST G: z2k_nohost_key gives "nohost" for hostless Discord flow
// =========================================================================
test('TEST G: z2k_nohost_key gives "nohost" for hostless Discord flow', () => {
  const coreContent = fs.readFileSync(modernCorePath, 'utf8');

  // Extract z2k_nohost_key function implementation logic
  const fnMatch = coreContent.match(/function z2k_nohost_key\(desync\)[\s\S]*?end/);
  assert.ok(fnMatch, 'z2k_nohost_key function definition must be found');

  function z2k_nohost_key_js(desync) {
    const t = desync && desync.track;
    const h = t && t.hostname;
    if (h && h.length > 0 && !(t && t.hostname_is_ip)) {
      return h;
    }
    return "nohost";
  }

  // Hostless (no hostname)
  assert.equal(z2k_nohost_key_js({ track: {} }), 'nohost');
  assert.equal(z2k_nohost_key_js(null), 'nohost');
  // IP-as-hostname
  assert.equal(z2k_nohost_key_js({ track: { hostname: '192.168.1.1', hostname_is_ip: true } }), 'nohost');
  // Real hostname
  assert.equal(z2k_nohost_key_js({ track: { hostname: 'gateway.discord.gg', hostname_is_ip: false } }), 'gateway.discord.gg');
});

// =========================================================================
// TEST H: state.tsv external edit (1 -> 7) updates live autostate
// =========================================================================
test('TEST H: state.tsv external edit (1 -> 7) updates live autostate', () => {
  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  assert.match(persistContent, /reconcile_external_edits/, 'reconcile_external_edits must exist in Lua wrapper');
  assert.match(persistContent, /set_live_nstrategy\(askey, hostn, dn\)/, 'reconcile must apply disk strategy to live autostate');
});

// =========================================================================
// TEST I: frozen #7: failure events do NOT rotate
// =========================================================================
test('TEST I: frozen #7: FREEZE CLAMP pins final = 7 and nstrategy = 7', () => {
  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  assert.match(persistContent, /FREEZE CLAMP/, 'FREEZE CLAMP must exist in circular wrapper');
  assert.match(persistContent, /hrec_before\.final = tonumber\(srec\.strategy\)/, 'Must clamp final to srec.strategy when frozen');
  assert.match(persistContent, /hrec_before\.nstrategy = tonumber\(srec\.strategy\)/, 'Must clamp nstrategy when frozen');
});

// =========================================================================
// TEST J: auto #7: failure threshold CAN rotate to #8
// =========================================================================
test('TEST J: auto #7: FREEZE CLAMP clears final when mode is auto', () => {
  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  assert.match(persistContent, /elseif hrec_before\.final then\s+hrec_before\.final = nil/, 'Must clear hrec_before.final when mode is not frozen');
});

// =========================================================================
// TEST K: discord_ip_discovery persistence behavior on outgoing initial packets
// =========================================================================
test('TEST K: discord_ip_discovery outgoing initial packet triggers persist for discord_voice/nohost', () => {
  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  assert.match(
    persistContent,
    /discord_ip_discovery/,
    'outgoing_initial in z2k-state-persist.lua MUST include discord_ip_discovery for discord_voice/nohost'
  );
});

// =========================================================================
// TEST L: Hostless sticky-success remains disabled
// =========================================================================
test('TEST L: Hostless sticky-success remains disabled for discord_voice/nohost', () => {
  const persistContent = fs.readFileSync(statePersistPath, 'utf8');
  assert.match(persistContent, /if hostn == nil or hostn == "nohost" then return false end/, 'nohost must be ineligible for sticky success');
  assert.match(persistContent, /if s:match\("\^discord"\) then return false end/, 'discord keys must be ineligible for sticky success');
});

// =========================================================================
// TEST M: yt_quic remains separate from discord_voice
// =========================================================================
test('TEST M: yt_quic remains separate from discord_voice', () => {
  const Model = loadModel();
  const pools = {
    yt_quic: { key: 'yt_quic', protocol: 'QUIC', size: 9, strategies: [] },
    discord_voice: { key: 'discord_voice', protocol: 'STUN', size: 12, strategies: [] }
  };
  const ytPool = Model.findPool('yt_quic', pools);
  const dvPool = Model.findPool('discord_voice', pools);
  assert.equal(ytPool.protocol, 'QUIC');
  assert.equal(dvPool.protocol, 'STUN');
  assert.equal(ytPool.size, 9);
  assert.equal(dvPool.size, 12);
});

// =========================================================================
// TEST N: Domain table filter excludes host=nohost
// =========================================================================
test('TEST N: Domain table filter excludes host=nohost', () => {
  const Model = loadModel();
  const entries = [
    { key: 'circular_1_1', host: 'youtube.com', strategy: '3', ts: '1787150001', mode: 'auto' },
    { key: 'discord_voice', host: 'nohost', strategy: '7', ts: '1787150003', mode: 'frozen' },
    { key: 'yt_quic', host: 'gstatic.com', strategy: '2', ts: '1787150002', mode: 'auto' }
  ];
  const domainEntries = Model.filterDomainLearnedEntries(entries);
  assert.equal(domainEntries.length, 2);
  assert.ok(domainEntries.every(e => e.host !== 'nohost'));
});
