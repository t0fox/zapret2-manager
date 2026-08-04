import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const ui = fs.readFileSync(`${root}/z2m-proxy.js`, 'utf8');
const api = fs.readFileSync(`${root}/z2m-api.js`, 'utf8');
const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const cfg = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc', 'utf8');
const acl = JSON.parse(fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

test('proxy lifecycle methods remain in the central facade and backend', () => {
  for (const method of ['proxy_status','proxy_start','proxy_stop','proxy_restart','proxy_health','proxy_link_info','proxy_logs_tail']) {
    assert.match(api, new RegExp(method));
    assert.match(rpc, new RegExp(method));
  }
});

test('Start Stop Restart are explicit guarded actions', () => {
  assert.match(ui, /ctx\.api\.proxy\.start/);
  assert.match(ui, /ctx\.api\.proxy\.stop/);
  assert.match(ui, /ctx\.api\.proxy\.restart/);
  assert.match(ui, /if \(state\.busy\) return/);
  assert.match(ui, /\.catch\(showError\)/);
});

test('refresh reloads all read-only proxy state without replaying mutations', () => {
  const load = ui.slice(ui.indexOf('function load('), ui.indexOf('\nfunction renderProxy('));
  for (const call of ['capabilities','status','configGet','linkInfo','health','logsTail']) assert.match(load, new RegExp(`api\\.proxy\\.${call}`));
  assert.doesNotMatch(load, /\.start\(|\.stop\(|\.restart\(|configApply|secretRotate/);
});

test('revealed link requires explicit backend reveal confirmation', () => {
  const load = ui.slice(ui.indexOf('function load('), ui.indexOf('\nfunction renderProxy('));
  assert.match(ui, /function\s+revealLink\s*\(/);
  assert.match(ui, /reveal:\s*true/);
  assert.match(ui, /confirm:\s*['"]REVEAL['"]/);
  assert.doesNotMatch(load, /reveal:\s*true|confirm:\s*['"]REVEAL['"]/);
  assert.doesNotMatch(ui, /linkRevealError/);
});

test('link, QR and rotation workflows are user initiated', () => {
  for (const label of ['Открыть в Telegram','Копировать ссылку','QR-код','Новая ссылка']) assert.match(ui, new RegExp(label));
  assert.match(ui, /Qr\.render\(url/);
  assert.match(ui, /shell\.openModal/);
  assert.doesNotMatch(ui, /window\.confirm/);
});

test('settings stay draft-first before validate preview apply', () => {
  assert.match(ui, /ctx\.setDraft\(['"]proxy/);
  assert.match(ui, /api\.proxy\.configValidate/);
  assert.match(ui, /api\.proxy\.configPreview/);
  assert.match(ui, /Прокси применяется только через общий координатор/);
  assert.match(ui, /ctx\.openSemanticDiff/);
  assert.doesNotMatch(ui, /ctx\.api\.proxy\.configApply/);
  assert.match(ui, /blocker:\s*_/);
});

test('backend log strings are rendered as text and remain redacted', () => {
  assert.match(ui, /asArray\(logs\.lines\)\.map\(String\)/);
  assert.match(ui, /redacted/);
  assert.doesNotMatch(ui, /innerHTML/);
});

test('copy fallback owns and removes its temporary textarea', () => {
  assert.match(ui, /document\.createElement\(['"]textarea['"]\)/);
  assert.match(ui, /document\.body\.appendChild\(area\)/);
  assert.match(ui, /area\.parentNode\.removeChild\(area\)/);
});

test('proxy runtime never downloads executable code from the page', () => {
  assert.doesNotMatch(ui, /fetch\s*\(|https?:\/\/[^'"\s]+\.js|cdn/i);
  assert.match(ui, /quickInstall/);
  assert.match(ui, /signed-feed workflow/);
});

test('proxy ACL keeps status reads separate from lifecycle writes', () => {
  const read = new Set(acl.read.ubus['zapret2-manager']);
  const write = new Set(acl.write.ubus['zapret2-manager']);
  for (const method of ['proxy_status','proxy_config_get','proxy_logs_tail','proxy_health','proxy_link_info']) assert.ok(read.has(method), method);
  for (const method of ['proxy_start','proxy_stop','proxy_restart','proxy_config_apply','proxy_secret_rotate']) assert.ok(write.has(method), method);
});

test('proxy configuration backend validates bounded runtime fields', () => {
  assert.match(cfg, /port|maxConnections|poolSize|bufKb/);
  assert.match(cfg, /EINPUT|validate/i);
});

test('old HTMLCollection refresh crash is absent', () => {
  assert.doesNotMatch(ui, /children\.forEach/);
  assert.doesNotMatch(ui, /fresh\.children/);
});

test('proxy module exposes internal lifecycle contract', () => {
  assert.match(ui, /id:\s*['"]proxy['"]/);
  for (const name of ['load','render','mount','unmount']) assert.match(ui, new RegExp(`${name}:`));
});
