import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.resolve(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ucodeArgs = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS_JSON
  ? JSON.parse(process.env.UCODE_ARGS_JSON)
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const modulePattern = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const libraryArgs = modulePattern ? ['-L', modulePattern] : [];
const hasUcode = fs.existsSync(ucodeBin);

function invokeCases() {
  const source = `
import * as mod from ${JSON.stringify(modulePath)};

function run_case(name, states, stage) {
  let cursor = 0, now = 0, waits = 0;
  let result = mod.z2k_runtime_readiness({
    stage: stage,
    expectedEnabled: true,
    timeoutMs: 12000,
    pollIntervalMs: 1000,
    now: function() { return now; },
    wait: function(ms) { waits++; now = now + ms; },
    observe: function() {
      let item = states[cursor < length(states) ? cursor : length(states) - 1];
      cursor++;
      return item;
    }
  });
  return { name: name, result: result, observations: cursor, waits: waits, now: now };
}

let ready = { enabled: true, pids: [42], queue: { registered: true, peerPid: 42, row: '300 42 0 2 65531 0 0 0' }, nft: { ready: true, output: 'table inet zapret2' } };
let absent = { enabled: true, pids: [], queue: { registered: false, peerPid: null, row: null, reason: 'queue 300 not registered in kernel' }, nft: { ready: false, output: 'nft: table missing' } };
let daemonNoQueue = { enabled: true, pids: [42], queue: { registered: false, peerPid: null, row: null, reason: 'queue 300 not registered in kernel' }, nft: { ready: true, output: 'table inet zapret2' } };

print(sprintf('%J', [
  run_case('immediate', [ready], 'activation'),
  run_case('delayed', [absent, absent, ready], 'activation'),
  run_case('never-daemon', [absent], 'activation'),
  run_case('daemon-without-queue', [daemonNoQueue], 'activation'),
  run_case('rollback-delayed', [absent, ready], 'rollback'),
  run_case('bounded-deadline', [absent], 'activation')
]));`;
  const result = spawnSync(ucodeBin, [...ucodeArgs, ...libraryArgs, '-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([ucodeBin, ...ucodeArgs, ...libraryArgs, '-e', source], modulePattern)}`);
  return JSON.parse(result.stdout);
}

function cases() {
  return invokeCases();
}

test('runtime readiness accepts an already healthy daemon and queue', { skip: !hasUcode }, () => {
  const item = cases()[0];
  assert.equal(item.result.ok, true, JSON.stringify(item));
  assert.equal(item.result.attempts, 1, JSON.stringify(item));
  assert.equal(item.waits, 0, JSON.stringify(item));
});

test('runtime readiness waits for delayed daemon, queue listener, and nft table', { skip: !hasUcode }, () => {
  const item = cases()[1];
  assert.equal(item.result.ok, true, JSON.stringify(item));
  assert.equal(item.result.attempts, 3, JSON.stringify(item));
  assert.equal(item.waits, 2, JSON.stringify(item));
  assert.equal(item.result.stage, 'activation', JSON.stringify(item));
});

test('runtime readiness returns ERUNTIME with daemon-not-spawned diagnostics', { skip: !hasUcode }, () => {
  const item = cases()[2];
  assert.equal(item.result.ok, false, JSON.stringify(item));
  assert.equal(item.result.error.code, 'ERUNTIME', JSON.stringify(item));
  assert.equal(item.result.error.reason, 'daemon-not-spawned', JSON.stringify(item));
  assert.ok(item.result.error.readiness.attempts <= 13, JSON.stringify(item));
});

test('runtime readiness distinguishes a daemon without queue 300', { skip: !hasUcode }, () => {
  const item = cases()[3];
  assert.equal(item.result.ok, false, JSON.stringify(item));
  assert.equal(item.result.error.reason, 'queue-300-listener-missing', JSON.stringify(item));
  assert.match(item.result.error.message, /queue 300/i);
  assert.deepEqual(item.result.error.readiness.pids, [42], JSON.stringify(item));
});

test('rollback uses the same readiness contract and tolerates delayed recovery', { skip: !hasUcode }, () => {
  const item = cases()[4];
  assert.equal(item.result.ok, true, JSON.stringify(item));
  assert.equal(item.result.stage, 'rollback', JSON.stringify(item));
  assert.equal(item.result.attempts, 2, JSON.stringify(item));
});

test('runtime readiness has a hard bounded attempt deadline', { skip: !hasUcode }, () => {
  const item = cases()[5];
  assert.equal(item.result.ok, false, JSON.stringify(item));
  assert.equal(item.result.error.reason, 'daemon-not-spawned', JSON.stringify(item));
  assert.equal(item.waits, 12, JSON.stringify(item));
  assert.equal(item.now, 12000, JSON.stringify(item));
});
