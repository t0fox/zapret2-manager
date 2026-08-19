import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const UI_DIR = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = (name) => fs.readFileSync(path.join(UI_DIR, name), 'utf8');

test('UI: Scanner Hub contains no legacy Smart Scanner abstraction and exposes 2 primary engines', () => {
  const code = read('z2m-scanner-hub.js');
  
  // No "Умный подбор" or Smart Scanner tabs
  assert.doesNotMatch(code, /Умный подбор/);
  assert.doesNotMatch(code, /smart_scanner/i);
  assert.doesNotMatch(code, /tab-smart/);

  // Exactly two primary engines in selector
  assert.match(code, /blockcheckw/);
  assert.match(code, /BlockCheck2/);
  assert.match(code, /Чем сканировать\?/);
});

test('UI: blockcheckw form exposes mode segmented control, strategy_source for scan, sample for universal, and DNS', () => {
  const code = read('z2m-scanner-hub.js');

  // Mode tabs for blockcheckw
  assert.match(code, /engine:\s*['"]scan['"]/);
  assert.match(code, /engine:\s*['"]universal['"]/);
  assert.match(code, /engine:\s*['"]status['"]/);
  assert.match(code, /engine:\s*['"]check['"]/);

  // strategy_source options in scan mode
  assert.match(code, /catalog_quick/);
  assert.match(code, /catalog_standard/);
  assert.match(code, /Встроенный набор/);

  // Universal domain sample
  assert.match(code, /sample/);
  assert.match(code, /Количество доменов для выборки/);

  // DNS control
  assert.match(code, /dns:\s*['"]auto['"]|dnsMode/);
});

test('UI: BlockCheck2 form exposes standard vs Avatar catalog, IPVS, CURL_HTTPS_GET, independent numeric inputs', () => {
  const code = read('z2m-scanner-hub.js');

  // BlockCheck2 strategy source / mode
  assert.match(code, /TEST:\s*['"]custom['"]|strategy_source/);
  assert.match(code, /IPVS/);
  assert.match(code, /CURL_HTTPS_GET/);
  assert.match(code, /REPEATS/);
  assert.match(code, /PARALLEL/);
  assert.match(code, /TIMEOUT/);
});

test('UI: Findings cards trigger canonical Strategy handoff (preview -> validate -> save)', () => {
  const code = read('z2m-scanner-hub.js');

  assert.match(code, /strategy-handoff|strategy_from_found|strategy_from_entry/);
  assert.match(code, /Применить стратегию|Использовать стратегию/);
});
