import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('P02-V3 uses one visibility-aware bounded Control poller', () => {
  const page = read('z2m-avatar-control.js');
  assert.match(page, /POLL_INTERVAL_MS/);
  assert.match(page, /document\.addEventListener\('visibilitychange'/);
  assert.match(page, /document\.hidden/);
  assert.match(page, /lastKnownState/);
  assert.match(page, /lastKnownAt/);
  assert.match(page, /lastKnownStatus/);
  assert.match(page, /runtime\.refreshing \|\|/);
  assert.equal((page.match(/window\.setInterval/g) || []).length, 1);
  assert.match(page, /removeEventListener\('visibilitychange'/);
});

test('P02-V3 Control has semantic hero and action icon states', () => {
  const page = read('z2m-avatar-control.js');
  for (const marker of ['activity:', "'stop-square':", 'warning:', 'help:', "'scroll-text':"]) assert.match(page, new RegExp(marker));
  assert.match(page, /kind === 'running'/);
  assert.match(page, /kind === 'stopped'/);
  assert.match(page, /kind === 'pending'/);
  assert.doesNotMatch(page, /kind === 'stopped' \? '×' : '\?'/);
});

test('P02-V3 Control log uses the shared bounded renderer with dedupe and smart follow state', () => {
  const page = read('z2m-avatar-control.js');
  const log = read('z2m-avatar-log.js');
  const css = read('z2m-ui.css');
  assert.match(page, /captureLogViewport/);
  assert.match(page, /restoreLogViewport/);
  assert.match(page, /logFollow/);
  assert.match(log, /data-event-id/);
  assert.match(log, /seen\[/);
  assert.match(css, /z2m-view#z2m-view-control \.log-entry\{display:grid/);
  assert.match(css, /z2m-view#z2m-view-control \.severity-badge/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
