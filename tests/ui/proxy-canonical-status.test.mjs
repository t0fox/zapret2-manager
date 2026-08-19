import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const APP = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js';
const ACL = 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json';
const CSS = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';

test('proxy status projection consumes canonical Telegram listener and outbound health', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const render = source.slice(source.indexOf('function render(ctx)'));

  assert.match(render, /canonicalProjection\(pstatus\)/);
  assert.match(render, /listener:\s*canonical\.listener/);
  assert.match(render, /outbound:\s*canonical\.outbound/);
});

test('DNS view has a canonical global-scope fallback when legacy API is absent', () => {
  const source = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', 'utf8');
  assert.match(source, /function globalRead\(api, productRead\)/);
  assert.match(source, /api\.dns\.global && api\.dns\.global\.get/);
  assert.match(source, /api\.dns\.product\.get\(\)/);
  assert.match(source, /globalRead\(ctx\.api, productRead\)/);
});

test('app header derives its chip from the canonical service status projection', () => {
  const source = fs.readFileSync(APP, 'utf8');
  const load = source.slice(source.indexOf('load: function ()'), source.indexOf('render: function (initial)'));

  assert.doesNotMatch(source, /canonicalAppStatus|Api\.dns\.product\.status|Api\.tg\.product\.status/);
  assert.match(source, /function statusState\(initial\)/);
  assert.match(source, /function updateHeaderStatus\(data\)/);
  assert.match(source, /statusState\(initial\)/);
  assert.match(load, /Api\.service\.status\(\)/);
  assert.doesNotMatch(load, /Api\.engine\.status\(\)/);
});

test('LuCI ACL exposes read-only engine status for engine-gated product views', () => {
  const acl = JSON.parse(fs.readFileSync(ACL, 'utf8'))['zapret2-manager'];
  assert.deepEqual(acl.read.ubus['zapret2-manager-engine'], ['engine_status']);
  assert.equal(acl.write.ubus['zapret2-manager-engine'], undefined);
});

test('DNS form collapses before the 768px tablet viewport', () => {
  const source = fs.readFileSync(CSS, 'utf8');
  assert.match(source, /@media\(max-width:800px\)\{\.z2m-global-dns-form/);
  assert.match(source, /@media\(max-width:800px\)\{\.z2m-global-dns-form[\s\S]*?\.z2m-dns-form-row\{grid-template-columns:1fr/);
});
