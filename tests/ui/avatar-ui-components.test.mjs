import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = (name) => fs.readFileSync(path.join(frontend, name), 'utf8');

test('normalizes optional and transport failures into typed user-facing states', () => {
  const api = read('z2m-api.js');
  assert.match(api, /component_not_installed/);
  assert.match(api, /provider_unavailable/);
  assert.match(api, /rpc_unavailable/);
  assert.match(api, /dependency_unavailable/);
  assert.match(api, /session_failure/);
  assert.match(api, /malformed_response/);
});

test('shared state components cover loading, empty, unavailable, failed, and retry states', () => {
  const shared = read('z2m-avatar-ui.js');
  for (const state of ['loading', 'empty', 'unavailable', 'error', 'retry']) {
    assert.match(shared, new RegExp(state));
  }
  assert.match(shared, /<details|details/);
});

test('shared CSS defines graphite tokens and responsive top rails', () => {
  const css = read('z2m-avatar-ui.css');
  for (const token of ['--z2m-bg', '--z2m-surface', '--z2m-border', '--z2m-text', '--z2m-accent', '--z2m-danger']) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /overflow-x\s*:\s*auto/);
  assert.match(css, /focus-visible/);
  assert.match(css, /390px|480px|600px/);
});

test('Telegram Proxy uses the shared confirm lifecycle instead of a page-local modal', () => {
  const proxy = read('z2m-proxy-page-core.js');
  assert.match(proxy, /shell\.avatar\.confirm/);
});

test('Telegram Proxy distinguishes provider RPC failure from a successful not-installed state', () => {
  const proxy = read('z2m-proxy-page-core.js');
  assert.match(proxy, /data\.providerStatus\s*&&\s*data\.providerStatus\.error/);
  assert.match(proxy, /showErrorState/);
});
