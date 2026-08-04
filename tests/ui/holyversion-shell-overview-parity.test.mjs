// Exact-head CI trigger: the contracts below remain authoritative.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

test('shell exports segmented and skeleton primitives', () => {
  const shell = evaluateLuciModule(`${root}/z2m-shell.js`);
  assert.equal(typeof shell.segmented, 'function');
  assert.equal(typeof shell.renderLoadingState, 'function');
  assert.match(source('z2m-shell.js'), /z2m-seg/);
  assert.match(source('z2m-shell.js'), /z2m-skeleton/);
});

test('app never presents a hard-coded package version as runtime truth', () => {
  const app = source('app.js');
  assert.match(app, /function\s+detectedVersion\s*\(/);
  assert.match(app, /managerVersion|packageVersion/);
  assert.doesNotMatch(app, /['"]v0\.1\.0['"]/);
});

test('first load uses a skeleton and refresh remains non-destructive', () => {
  const app = source('app.js');
  assert.match(app, /Shell\.renderLoadingState\(TAB_LABELS\[tab\]\)/);
  assert.match(app, /setContentBusy\(true\)/);
  assert.match(app, /setContentBusy\(false\)/);
  assert.match(app, /z2m-refreshing/);
  assert.doesNotMatch(app, /z2m-app-placeholder[^\n]+Загрузка данных/);
});

test('reference shell and Overview classes stay local and responsive', () => {
  const css = source('z2m-ui.css') + '\n' + source('z2m-components.css');
  for (const cls of [
    '.z2m-seg', '.z2m-skeleton', '.z2m-refreshing', '.z2m-hero',
    '.z2m-hero-left', '.z2m-hero-right', '.z2m-overview-failures',
    '.z2m-advice', '.z2m-advice-row'
  ]) assert.match(css, new RegExp(cls.replace('.', '\\.')));
  assert.match(css, /@media\s*\(max-width:900px\)/);
  assert.match(css, /@media\s*\(max-width:560px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
});
