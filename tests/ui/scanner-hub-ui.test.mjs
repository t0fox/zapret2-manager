import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${root}/${name}`, 'utf8');

test('Scanner Hub UI: Multi-Engine Scanner Workspace Visual System Alignment', () => {
  const page = read('z2m-scanner-hub.js');
  const css = read('z2m-ui.css');

  // 1. Header with title and standard z2m-subtabs
  assert.match(page, /page-title/);
  assert.match(page, /page-description/);
  assert.match(page, /z2m-subtabs/);
  assert.match(page, /Движки сканирования/);
  assert.match(page, /История сканирований/);

  // 2. Engine Selector with 2 cards
  assert.match(page, /scanner-chooser-card/);
  assert.match(page, /engine-card/);
  assert.match(page, /blockcheckw/);
  assert.match(page, /BlockCheck2/);

  // 3. blockcheckw workspace components
  assert.match(page, /data-action="setBcwMode"/);
  assert.match(page, /data-action="setBcwStrategySource"/);
  assert.match(page, /bcw-workers/);
  assert.match(page, /bcw-dns/);

  // 4. BlockCheck2 workspace components
  assert.match(page, /data-action="setBc2Source"/);
  assert.match(page, /bc2-ipvs/);
  assert.match(page, /bc2-curl-get/);
  assert.match(page, /bc2-repeats/);
  assert.match(page, /bc2-parallel/);
  assert.match(page, /bc2-timeout/);

  // 5. Findings and live console
  assert.match(page, /findings-container/);
  assert.match(page, /finding-card/);
  assert.match(page, /terminal-container/);
  assert.match(page, /terminal-body/);

  // 6. CSS classes exist in z2m-ui.css
  assert.match(css, /\.engine-cards-grid/);
  assert.match(css, /\.scanner-workspace-layout/);
  assert.match(css, /\.finding-card/);
  assert.match(css, /\.terminal-container/);
});
