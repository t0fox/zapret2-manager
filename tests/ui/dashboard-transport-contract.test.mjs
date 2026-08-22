import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js',
  'utf8'
);
const loading = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-loading.js',
  'utf8'
);
const fastStatus = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/status-fast.uc',
  'utf8'
);

test('Dashboard keeps the critical transport wave bounded', () => {
  // The critical wave lives in the staged loader and prefers status_fast.
  assert.match(loading, /\(ctx\.api\.service\.statusFast \|\| ctx\.api\.service\.status\)\(\)/,
    'Главная must prefer the bounded status_fast RPC');
  const secondary = loading.slice(loading.indexOf('function loadSecondary()'),
    loading.indexOf(']);', loading.indexOf('function loadSecondary()')));
  assert.doesNotMatch(secondary, /ctx\.api\.tg\.product\.status\(\)/,
    'optional Telegram status must not share the secondary events wave');
  assert.match(loading, /timer\(function \(\)[\s\S]*ctx\.api\.tg\.product\.status\(\)/,
    'optional Telegram status must be scheduled behind a timer');
});

test('Dashboard RPC waves are strictly staged: critical settles before secondary starts', () => {
  const continuation = loading.slice(loading.indexOf('.then(function (data) {'));
  assert.match(continuation, /loadSecondary\(\)/,
    'phase 2 must be invoked from the phase-1 continuation');
  const secondaryBody = loading.slice(loading.indexOf('function loadSecondary()'),
    loading.indexOf('PHASE 1'));
  assert.doesNotMatch(secondaryBody, /^\s*var\s+\w+\s*=\s*Promise\.allSettled/,
    'secondary batch must not be created at module/load scope');
});

test('status_fast supplies the autostart evidence used by the Dashboard', () => {
  assert.match(fastStatus, /function autostart_observation\(\)/,
    'fast status must collect the cheap init-link observation');
  assert.match(fastStatus, /system:\s*\{\s*autostart:\s*autostart_observation\(\)/,
    'fast status must expose system.autostart for the Dashboard card');
});
