import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const scanner = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js');
const page = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js');
const app = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');

function node() {
  return {
    children: [], value: '', checked: false, disabled: false,
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children.flat().filter(Boolean); },
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; },
  };
}

test('Scanner API exposes the exact ubus lifecycle and handoff calls', () => {
  for (const method of ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated'])
    assert.match(api, new RegExp(`method:'${method}'`), method);
  for (const method of ['scannerStart', 'scannerStatus', 'scannerResults', 'scannerStop', 'scannerResume', 'scannerSaveGenerated'])
    assert.match(api, new RegExp(`\\b${method}:rpc\\.declare`), method);
  assert.match(api, /scanner:{[s\S]*start:calls\.scannerStart/);
});

test('Scanner view exposes bounded controls, backend-owned evidence, handoff, and lifecycle cleanup', () => {
  for (const token of ['target', 'protocol', 'mode', 'resume', 'dpi_type', "call(ctx, 'start'", "call(ctx, 'stop'", "call(ctx, 'status'", "call(ctx, 'results'"])
    assert.ok(scanner.includes(token), token);
  for (const method of ['load', 'render', 'mount', 'unmount']) assert.match(scanner, new RegExp(`${method}:|function ${method}\\(`), method);
  for (const token of ['working', 'failed', 'counts', 'elapsed', 'baseline', 'best', 'saveGenerated', 'Preview', 'Validate', 'Apply'])
    assert.match(scanner, new RegExp(token, 'i'), token);
  assert.match(scanner, /disposed/);
  assert.match(scanner, /clearTimeout/);
  assert.match(scanner, /ignore|token|generation|late/i);
  assert.doesNotMatch(scanner, /NFQWS2_OPT|effectiveArgv|join\(['"] --new ['"]|rawCommand|exec\(/);
});

test('Scanner remains a separate navigation surface and is absent from Strategies', () => {
  assert.match(app, /require view\.zapret2-manager\.z2m-scanner as Scanner/);
  assert.match(app, /scan:\s*Scanner/);
  assert.doesNotMatch(page, /Scanner\.(load|render|mount|unmount)/);
});

test('Scanner unmount invalidates a pending poll generation', async () => {
  const timers = [];
  const loaded = vm.runInNewContext(`(function () {${scanner}\n})()`, {
    baseclass: { extend: value => value },
    E: () => node(), _: value => value,
    window: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} },
  });
  const ctx = {
    api: { scanner: { status: () => Promise.resolve({ status: 'running' }) } },
    shell: { button: () => node(), panel: () => node(), statePanel: () => node(), chip: () => node() },
    data: {},
  };
  await loaded.load({ ...ctx, data: { scanId: 'scan-test' } });
  loaded.mount(ctx);
  loaded.unmount();
  assert.equal(timers.length, 1);
});
