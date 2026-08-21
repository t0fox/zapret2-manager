import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const opsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');
const viewPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
const persistPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
const donorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile.uc');
const cliPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const apiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');

function loadModel() {
  return vm.runInNewContext(`(function () { ${fs.readFileSync(modelPath, 'utf8')}\n })()`, {
    baseclass: { extend: value => value }
  });
}

function createOpsSandbox(config, stateText) {
  let source = fs.readFileSync(opsPath, 'utf8')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/g, '')
    .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*/g, 'const $1 = ')
    .replace(/for\s*\(let\s+([a-zA-Z0-9_]+)\s+in\s+([^)]+)\)/g, 'for (let $1 of __iter($2))');
  const vfs = {
    '/opt/zapret2/config': config,
    '/etc/zapret2-manager/state/autocircular/state.tsv': stateText
  };
  const sandbox = {
    __iter: value => Array.isArray(value) ? value : Object.keys(value || {}),
    getenv: name => name === 'Z2M_STRATEGY_LEARNED_STATE'
      ? '/etc/zapret2-manager/state/autocircular/state.tsv'
      : name === 'Z2M_STRATEGY_LEARNED_DIR'
        ? '/etc/zapret2-manager/state/autocircular' : null,
    readfile: p => vfs[p] ?? null,
    writefile: (p, value) => { vfs[p] = String(value); },
    stat: p => p in vfs ? { size: String(vfs[p]).length } : null,
    popen: command => ({
      read: () => '',
      close: () => {
        const match = String(command).match(/mv -f '([^']+)' '([^']+)'/);
        if (match && match[1] in vfs) { vfs[match[2]] = vfs[match[1]]; delete vfs[match[1]]; }
        return 0;
      }
    }),
    match: (value, re) => typeof value === 'string' ? value.match(re) : null,
    split: (value, delim) => typeof value === 'string' ? value.split(delim) : [],
    substr: (value, start, len) => typeof value === 'string' ? value.substr(start, len) : '',
    index: (value, item) => typeof value === 'string' ? value.indexOf(item) : -1,
    length: value => value == null ? 0 : typeof value === 'object' ? Object.keys(value).length : value.length,
    push: (arr, value) => arr.push(value), join: (delim, arr) => arr.join(delim),
    lc: value => String(value || '').toLowerCase(), trim: value => String(value || '').trim(),
    type: value => value == null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    keys: value => Object.keys(value || {}), time: () => 1787330000,
    sprintf: (_fmt, value) => JSON.stringify(value),
    health_matrix_start: () => ({ ok: true }), health_matrix_get: () => ({ matrix: null }),
    read_var: () => null
  };
  const code = `(function () { ${source}\n return { learned_rows, state_set }; })()`;
  return { ...vm.runInNewContext(code, sandbox), vfs };
}

const config = '--filter-tcp=80,443 --lua-desync=circular:key=tls --lua-desync=fake:strategy=1 --lua-desync=fake:strategy=2 --lua-desync=fake:strategy=3';

test('autocircular state accepts excluded and preserves legacy rows as auto', () => {
  const ops = createOpsSandbox(config, 'tls\tyoutube.com\t3\t1787330000\n');
  assert.equal(ops.learned_rows()[0].mode, 'auto');
  const result = ops.state_set({ key: 'tls', host: 'youtube.com', strategy: 3, mode: 'excluded' });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'excluded');
  const row = ops.learned_rows()[0];
  assert.deepEqual({ key: row.key, host: row.host, strategy: row.strategy, mode: row.mode }, {
    key: 'tls', host: 'youtube.com', strategy: '3', mode: 'excluded'
  });
});

test('autocircular state rejects an invalid mode instead of silently normalizing it', () => {
  const ops = createOpsSandbox(config, '# state\n');
  const result = ops.state_set({ key: 'tls', host: 'youtube.com', strategy: 1, mode: 'banana' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});

test('model keeps excluded rows visible and exposes reversible mode semantics', () => {
  const model = loadModel();
  const item = model.humanizeLearnedEntry({ key: 'tls', host: 'youtube.com', strategy: '3', mode: 'excluded' });
  assert.equal(item.mode, 'excluded');
  assert.equal(item.excluded, true);
  assert.match(item.modeLabel, /Без обхода/);
  assert.match(model.modeBadge('excluded').label, /Без обхода/);
});

test('learned UI exposes DPI exclusion and re-enable actions', () => {
  const view = fs.readFileSync(viewPath, 'utf8');
  assert.match(view, /Исключить из DPI-обхода/);
  assert.match(view, /Включить обратно/);
  assert.match(view, /mode:\s*['"]excluded['"]/);
});

test('Lua persistence contract recognizes excluded as a user mode and has a per-resource bypass gate', () => {
  const lua = fs.readFileSync(persistPath, 'utf8');
  assert.match(lua, /auto\|frozen\|excluded/);
  assert.match(lua, /mode\s*==\s*["']excluded["']/);
  assert.match(lua, /plan_clear\(desync\)/);
});

test('Discord enable uses the existing canonical Discord preview/apply lifecycle', () => {
  const donor = fs.readFileSync(donorPath, 'utf8');
  const cli = fs.readFileSync(cliPath, 'utf8');
  const api = fs.readFileSync(apiPath, 'utf8');
  assert.match(donor, /export const discord_autocircular_donor/);
  assert.match(donor, /key=discord_udp/);
  assert.match(donor, /hostkey=z2k_nohost_key/);
  assert.match(cli, /mode == 'discord_donor'/);
  assert.match(api, /discordProfilePreview/);
  assert.match(api, /discordProfileApply/);
  const view = fs.readFileSync(viewPath, 'utf8');
  const enable = view.slice(view.indexOf('function enableDiscord'), view.indexOf('function excludeLearned'));
  assert.match(enable, /api\.preview/);
  assert.match(enable, /api\.apply/);
  assert.match(enable, /changeHash/);
  assert.match(enable, /idempotencyToken/);
  assert.match(enable, /refreshData\(true\)[\s\S]*renderLearnedModal/);
  assert.doesNotMatch(enable, /api\.create/);
  assert.doesNotMatch(enable, /api\.validate/);
  assert.doesNotMatch(enable, /renderEditorForm/);
});
