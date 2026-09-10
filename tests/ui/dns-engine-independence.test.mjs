import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const dnsPage = fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-page.js'), 'utf8');

test('DNS remains reachable when Zapret2 Engine is not installed', () => {
  assert.doesNotMatch(dnsPage, /z2m-engine-gate|EngineGate/, 'DNS must not be blocked by the Engine gate');
  assert.match(dnsPage, /return\s+baseclass\.extend\(/, 'DNS must remain a direct LuCI view');
  assert.match(dnsPage, /load:\s*function\s*\(ctx\)\s*\{\s*return\s+Dns\.load\(ctx\)/,
    'DNS load must call the DNS product facade directly');
});
