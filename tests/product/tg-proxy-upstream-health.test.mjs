import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-upstream-evidence.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const SOURCE = fs.readFileSync(MODULE, 'utf8');

function invoke(input) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.proxy_upstream_log_evidence(${JSON.stringify(input)})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function logLine(epoch, message) {
  return `${new Date(epoch * 1000).toISOString().replace('Z', '123Z')}  INFO tg_ws_proxy_rs::proxy: ${message}`;
}

test('Telegram health wires bounded, fresh CF fallback evidence into the route probe', () => {
  const proxycfg = fs.readFileSync(
    path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc'), 'utf8');
  assert.match(SOURCE, /proxy_upstream_log_evidence/);
  assert.match(SOURCE, /maxAgeSec/);
  assert.match(proxycfg, /tail -c .*MAX_LOG_BYTES .*LOG_FILE/);
  assert.match(proxycfg, /configured_cf_route/);
});

test('Telegram health accepts only fresh, actual CF fallback success evidence', (t) => {
  if (!fs.existsSync(UCODE_BIN)) {
    t.skip(`ucode runtime is not available at ${UCODE_BIN}`);
    return;
  }
  const now = Math.floor(Date.parse('2026-09-06T00:00:00Z') / 1000);
  const result = invoke({
    now,
    maxAgeSec: 300,
    lines: [
      logLine(now - 301, '[192.168.1.203:1] DC2 cf-priority → CF proxy pool hit (kws2.example)'),
      logLine(now - 30, '[192.168.1.203:2] DC203 not in --dc-ip config → CF proxy connected'),
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.method, 'cf-log');
  assert.equal(result.ageSec, 30);
  assert.equal(result.target, 'CF fallback');
  assert.equal(result.raw, undefined, 'client/log line must not be returned');
});

test('Telegram health remains degraded when CF success evidence is stale or absent', (t) => {
  if (!fs.existsSync(UCODE_BIN)) {
    t.skip(`ucode runtime is not available at ${UCODE_BIN}`);
    return;
  }
  const now = Math.floor(Date.parse('2026-09-06T00:00:00Z') / 1000);
  const result = invoke({
    now,
    maxAgeSec: 300,
    lines: [
      logLine(now - 301, '[192.168.1.203:1] DC2 cf-priority → CF proxy pool hit (kws2.example)'),
      logLine(now - 10, '[192.168.1.203:2] CF WS DC2 failed on kws2.example'),
    ],
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.method, 'cf-log');
  assert.equal(result.target, null);
  assert.match(result.detail, /no recent CF proxy success/i);
});
