import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P1 honesty contract: a direct Rust TG Proxy install must NOT report
// success when the service owner (/etc/init.d/tg-ws-proxy) is absent.
// Binary-only installs leave an unmanageable daemon and previously passed
// as successful operations because service() silently no-ops without init.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PROVIDER = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'proxy-provider.uc');

const source = fs.readFileSync(PROVIDER, 'utf8');
const fnStart = source.indexOf('function install_direct_candidate');
const fnEnd = source.indexOf('\n}', fnStart);
const fn = source.slice(fnStart, fnEnd);

test('direct release install requires the init service owner before mutating anything', () => {
  assert.match(fn, /ETG_SERVICE_OWNER_MISSING/,
    'install must fail with an actionable owner-missing code');
  const ownerCheckAt = fn.indexOf('INIT_PATH');
  const downloadAt = fn.indexOf('uclient-fetch');
  assert.ok(ownerCheckAt !== -1 && downloadAt !== -1);
  assert.ok(ownerCheckAt < downloadAt,
    'owner presence must be checked BEFORE downloading/replacing the binary');
});

test('service actions stay silent no-ops for status paths but installs cannot rely on that', () => {
  // Keep documented behavior of service() (status paths), while the install
  // path carries its own explicit gate (asserted above).
  const serviceStart = source.indexOf('function service(action)');
  assert.notEqual(serviceStart, -1);
  const serviceBody = source.slice(serviceStart, source.indexOf('\n}', serviceStart));
  assert.match(serviceBody, /stat\(INIT_PATH\)/);
});
