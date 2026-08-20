import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cli = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc', 'utf8');
const catalog = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc', 'utf8');

test('read-only Strategy RPCs use the prevalidated manifest index so events_tail is not starved', () => {
  assert.match(catalog, /strategy_catalog_read_index/,
    'catalog must expose a bounded read-only manifest index');
  assert.match(catalog, /strategy_catalog_write_read_index/,
    'catalog must persist the compact index after full validation');
  assert.match(cli, /strategy_catalog_read_index/,
    'Strategy list/recommendation reads must not parse the large derived catalog cache');
  assert.match(cli, /strategy_catalog_get_detail/,
    'Strategy detail reads must stay bounded to the selected source file');
  assert.match(cli, /function load_request_catalog\(\)[\s\S]*strategy_catalog_read_index/,
    'all current read-only Strategy RPCs must share the fast catalog path');
});

test('package postinst warms the persistent Strategy read index after catalog updates', () => {
  const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
  assert.match(makefile, /strategy-catalog-index\.json/);
  assert.match(makefile, /strategy-catalog-index-cli\.uc/);
});
