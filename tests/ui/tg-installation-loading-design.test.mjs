import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const UI = fs.readFileSync(`${ROOT}/z2m-proxy-page-core.js`, 'utf8');
const CSS = fs.readFileSync(`${ROOT}/z2m-components.css`, 'utf8');

test('provider install paints an honest pending state before the synchronous RPC', () => {
  const card = UI.slice(UI.indexOf('function providerCard('), UI.indexOf('\nfunction installPane('));
  const start = card.slice(card.indexOf('function start()'), card.indexOf('\n      tgTransactionConfirm('));
  assert.match(start, /state\.busy\s*=\s*['"]provider-install['"]/);
  assert.match(start, /state\.tgLifecycle\s*=\s*\{[^}]*status:\s*['"]pending['"]/);
  assert.match(start, /rerenderProxy\(ctx\)/);
  assert.match(start, /Promise\.resolve\(\)\.then\(/);
  assert.match(start, /boundedLoad\(ctx\.api\.tg\.product\.checkUpdates/);
  assert.match(start, /boundedLoad\(ctx\.api\.tg\.product\.switch/);
  assert.ok(start.indexOf('rerenderProxy(ctx)') < start.indexOf('Promise.resolve().then('),
    'the pending state must be painted before starting the RPC chain');
});

test('operation progress is backend-owned and accessible', () => {
  assert.doesNotMatch(UI, /startProgressTicker|setInterval\(/,
    'the client must not invent progress while the backend is on one stage');
  assert.match(UI, /role:\s*['"]progressbar['"][^}]*aria-valuemin/);
  assert.match(UI, /aria-valuemax/);
  assert.match(UI, /aria-valuenow/);
  assert.match(UI, /operation && operation\.progress/);
});

test('operation polling has a bounded honest terminal state', () => {
  assert.match(UI, /TG_OPERATION_MAX_WAIT_MS/);
  assert.match(UI, /status:\s*['"]UNKNOWN['"]/);
  assert.match(UI, /Результат операции не подтверждён|итог операции/);
  assert.match(UI, /showOperationFailure[\s\S]*operationStatus/);
});

test('operation progress motion is short and disabled for reduced motion', () => {
  assert.match(CSS, /\.z2m-progress-bar\{[^}]*transition:width\s+\.24s/);
  assert.match(CSS, /prefers-reduced-motion:reduce\)[^{]*\{[\s\S]*?\.z2m-progress-bar\{[^}]*transition:none/);
});
