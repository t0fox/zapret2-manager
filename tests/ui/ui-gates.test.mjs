// Static gates for the current single-view LuCI frontend.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';
import {
  REPO_ROOT, readMenu, checkMenuAclIsArray, checkNoLubus,
  checkRpcObjects, checkRejectTrue, checkSyntax, checkNoStringFormat
} from './lib/checks.mjs';

const root = join(REPO_ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const makefilePath = join(REPO_ROOT, 'luci-app-zapret2-manager/Makefile');
const INTERNAL = {
  overview: 'z2m-overview.js', strategy: 'z2m-strategy-page.js', services: 'z2m-services.js',
  lists: 'z2m-lists.js', dns: 'z2m-dns.js', proxy: 'z2m-proxy.js',
  monitor: 'z2m-monitor.js', maintenance: 'z2m-maintenance.js'
};
const REDIRECTS = {
  'orchestra-strategy.js': 'overview', 'orchestra.js': 'strategy', 'strategies.js': 'strategy',
  'lists.js': 'lists', 'dns.js': 'dns', 'service-dns.js': 'dns', 'proxy.js': 'proxy',
  'monitor.js': 'monitor', 'maintenance.js': 'maintenance'
};
const SUPPORT = ['z2m-api.js','z2m-store.js','z2m-shell.js','z2m-ui.js','z2m-qr.js','z2m-auto.js','z2m-strategy.js','z2m-strategy-page.js'];
const source = (file) => readFileSync(join(root, file), 'utf8');
const shippedJs = () => readdirSync(root).filter((file) => file.endsWith('.js')).sort();

function noErrors(errors) { assert.deepEqual(errors, [], errors.join('\n')); }

test('gate 1: one app entry owns eight internal tabs', () => {
  const app = source('app.js');
  assert.equal((app.match(/L\.view\.extend/g) || []).length, 1);
  for (const [id, file] of Object.entries(INTERNAL)) {
    assert.equal(existsSync(join(root, file)), true, `${file} missing`);
    assert.match(app, new RegExp(`['"]${id}['"]`));
  }
});

test('gate 2: menu exposes one app route and hidden compatibility routes', () => {
  const menu = readMenu();
  const visible = Object.entries(menu).filter(([, entry]) => entry.action && entry.hidden !== true);
  assert.equal(visible.length, 1);
  assert.equal(visible[0][0], 'admin/services/zapret2-manager');
  assert.equal(visible[0][1].action.path, 'zapret2-manager/app');
  for (const file of Object.keys(REDIRECTS)) {
    const leaf = file.replace(/\.js$/, '');
    const entry = menu[`admin/services/zapret2-manager/${leaf}`];
    assert.ok(entry, `${leaf} compatibility route missing`);
    assert.equal(entry.hidden, true);
    assert.equal(entry.action.path, `zapret2-manager/${leaf}`);
  }
});

test('gate 3: every menu ACL is an iterable array', () => {
  noErrors(checkMenuAclIsArray(readMenu()));
});

test('gate 4: every menu view path resolves to a shipped JavaScript file', () => {
  for (const entry of Object.values(readMenu())) {
    if (!entry.action?.path) continue;
    const leaf = entry.action.path.split('/').pop();
    assert.equal(existsSync(join(root, `${leaf}.js`)), true, `${entry.action.path} missing`);
  }
});

test('gate 5: direct ubus access is forbidden in all shipped JavaScript', () => {
  for (const file of shippedJs()) noErrors(checkNoLubus(source(file), file));
});

test('gate 6: z2m-api is the only rpc.declare owner', () => {
  const owners = shippedJs().filter((file) => /rpc\.declare\s*\(/.test(source(file)));
  assert.deepEqual(owners, ['z2m-api.js']);
});

test('gate 7: central RPC facade uses only zapret2-manager and rejects ubus errors', () => {
  const api = source('z2m-api.js');
  noErrors(checkRpcObjects(api, 'z2m-api'));
  noErrors(checkRejectTrue(api, 'z2m-api'));
});

test('gate 8: app and internal modules load under the LuCI smoke loader', () => {
  const app = evaluateLuciModule(join(root, 'app.js'));
  assert.equal(typeof app.load, 'function');
  assert.equal(typeof app.render, 'function');
  for (const [id, file] of Object.entries(INTERNAL)) {
    const mod = evaluateLuciModule(join(root, file));
    assert.equal(mod.id, id, `${file}: wrong id`);
    for (const method of ['load','render','mount','unmount']) assert.equal(typeof mod[method], 'function', `${file}: ${method}`);
  }
});

test('gate 9: compatibility files are valid redirect views, not legacy wrappers', () => {
  for (const [file, tab] of Object.entries(REDIRECTS)) {
    const src = source(file);
    const mod = evaluateLuciModule(join(root, file));
    assert.equal(typeof mod.render, 'function');
    assert.match(src, /window\.location\.replace/);
    assert.match(src, new RegExp(`#/${tab}`));
    assert.doesNotMatch(src, /-legacy|return\s+Legacy/);
  }
});

test('gate 10: every shipped LuCI module parses as a function body', () => {
  for (const file of shippedJs()) noErrors(checkSyntax(source(file), file));
});

test('gate 11: no shipped module relies on String.prototype.format', () => {
  for (const file of shippedJs()) noErrors(checkNoStringFormat(source(file), file));
});

test('gate 12: unknown backend values have honest fallback labels', () => {
  for (const file of Object.values(INTERNAL)) {
    const src = source(file);
    assert.match(src, /—|неизвест|недоступ|Unavailable|Список пуст|не найдены|не запускал/i, `${file}: no unavailable/unknown fallback`);
  }
  assert.doesNotMatch(source('z2m-overview.js'), /metric\([^\n]+\|\|\s*0/);
  assert.doesNotMatch(source('z2m-strategy.js'), /metric\([^\n]+\|\|\s*0/);
});

test('gate 13: mutations expose an error path and shared feedback', () => {
  for (const file of ['z2m-overview.js','z2m-strategy.js','z2m-auto.js','z2m-services.js','z2m-lists.js','z2m-dns.js','z2m-proxy.js','z2m-maintenance.js']) {
    const src = source(file);
    assert.match(src, /\.catch\s*\(/, `${file}: rejected mutation has no catch path`);
    assert.match(src, /showToast|warnbar|openModal/, `${file}: no visible feedback path`);
  }
});

test('gate 14: styles and QR encoder remain local', () => {
  for (const file of ['z2m-ui.css','z2m-components.css']) {
    const css = source(file);
    assert.doesNotMatch(css, /@import|https?:\/\//);
  }
  assert.equal(existsSync(join(root, 'z2m-qr.js')), true);
  assert.doesNotMatch(source('z2m-proxy.js'), /https?:\/\/[^'"\s]+\.js|cdn/i);
});

test('gate 15: package Makefile auto-installs every shipped JS and CSS file', () => {
  const makefile = readFileSync(makefilePath, 'utf8');
  assert.match(makefile, /\$\(wildcard [^)]*view\/zapret2-manager\/\*\.js\)/);
  assert.match(makefile, /\$\(wildcard [^)]*view\/zapret2-manager\/\*\.css\)/);
  assert.doesNotMatch(makefile, /INSTALL_DATA.*view\/zapret2-manager\/overview\.js/);
});

test('gate 15 control: package globs cover a new fixture module', () => {
  const fixture = join(root, 'zz-fixture-gate.js');
  const before = shippedJs().length;
  try {
    writeFileSync(fixture, "'use strict';\nreturn {};\n");
    assert.equal(shippedJs().length, before + 1);
    assert.match(readFileSync(makefilePath, 'utf8'), /view\/zapret2-manager\/\*\.js/);
  } finally {
    try { unlinkSync(fixture); } catch {}
  }
  assert.equal(shippedJs().length, before);
});

test('gate 16: support modules are shipped and runtime legacy files are absent', () => {
  for (const file of SUPPORT) assert.equal(existsSync(join(root, file)), true, `${file} missing`);
  assert.deepEqual(shippedJs().filter((file) => file.endsWith('-legacy.js')), []);
});
