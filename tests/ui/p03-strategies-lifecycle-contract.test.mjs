import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.existsSync(`${root}/${name}`) ? fs.readFileSync(`${root}/${name}`, 'utf8') : '';

test('P03 Strategies has one bounded poller and complete page cleanup', () => {
  const page = read('z2m-strategies.js');
  for (const marker of ['setTimeout', 'clearTimeout', 'boundedRead', 'ETIMEDOUT', 'function unmount', 'removeEventListener',
    'detachAll', 'selectedIds.clear', 'modalResize']) assert.match(page, new RegExp(marker));
  assert.doesNotMatch(page, /setInterval\([^)]*\)/);
});

test('P03 Strategies keeps pending mutation controls disabled and refreshes after confirmation', () => {
  const page = read('z2m-strategies.js');
  for (const marker of ['pending', 'disabled', 'refresh', 'strategies.create', 'strategies.update',
    'strategies.delete', 'strategies.apply']) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(page, /confirm|openModal/);
});

test('P03 Strategies uses donor active and selected visual states without raw enums', () => {
  const page = read('z2m-strategies.js');
  const css = read('z2m-ui.css');
  for (const marker of ['active', 'selected', 'strategy-card', 'profile-badge', 'strategy-args-preview']) {
    assert.match(`${page}\n${css}`, new RegExp(marker));
  }
  assert.doesNotMatch(page, /reasonCode|candidate-invalid|runtime-evidence-incomplete/);
});
