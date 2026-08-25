import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROVIDER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc');
const RUST_INIT = path.join(ROOT, 'tg-ws-proxy-rs/files/etc/init.d/tg-ws-proxy');
const MANAGER_INIT = path.join(ROOT, 'zapret2-manager/files/etc/init.d/tg-ws-proxy');

const providerSrc = fs.readFileSync(PROVIDER, 'utf8');
const rustInit = fs.readFileSync(RUST_INIT, 'utf8');
let managerInit = '';
try { managerInit = fs.readFileSync(MANAGER_INIT, 'utf8'); } catch { managerInit = ''; }

// Extract DEFAULT_INIT_BODY string literal block
function extractDefaultInitBody(src) {
  const start = src.indexOf('const DEFAULT_INIT_BODY');
  if (start < 0) return null;
  const eq = src.indexOf('=', start);
  // find the terminating semicolon after closing quote
  // naive: look for "';\n" after start
  const slice = src.slice(start, src.indexOf('const PROVIDERS', start));
  return slice;
}

test('RED 1: ensure_shared_lifecycle must propagate Recommended profile to runtime (TG_DEFAULT_DOMAINS, TG_CF_PRIORITY, TG_POOL_SIZE)', () => {
  const body = extractDefaultInitBody(providerSrc);
  assert.ok(body != null, 'DEFAULT_INIT_BODY must exist');
  // Recommended profile requires:
  // DEFAULT_DOMAINS=1 -> TG_DEFAULT_DOMAINS=true
  // CF_PRIORITY=1 -> TG_CF_PRIORITY=true
  // POOL_SIZE=4 -> TG_POOL_SIZE
  // Also DC_IPS, CF_DOMAINS etc should be handled
  assert.match(body, /TG_DEFAULT_DOMAINS/, 'DEFAULT_INIT_BODY must map DEFAULT_DOMAINS -> TG_DEFAULT_DOMAINS');
  assert.match(body, /TG_CF_PRIORITY/, 'DEFAULT_INIT_BODY must map CF_PRIORITY -> TG_CF_PRIORITY');
  assert.match(body, /TG_POOL_SIZE/, 'DEFAULT_INIT_BODY must map POOL_SIZE -> TG_POOL_SIZE');
  assert.match(body, /TG_CF_DOMAIN|TG_CF_WORKER_DOMAIN/, 'DEFAULT_INIT_BODY must map CF domains');
  assert.match(body, /TG_MTPROTO_PROXY|TG_OUTBOUND_PROXY|TG_NO_PROXY/, 'DEFAULT_INIT_BODY must handle MTProto/outbound/no_proxy');
  assert.match(body, /TG_LINK_IP/, 'DEFAULT_INIT_BODY must handle LINK_IP');
  assert.match(body, /TG_BUF_KB|TG_MAX_CONNECTIONS/, 'DEFAULT_INIT_BODY must handle BUF_KB/MAX_CONNECTIONS');
  assert.match(body, /TG_QUIET|TG_VERBOSE/, 'DEFAULT_INIT_BODY must handle quiet/verbose');
  assert.match(body, /TG_LISTEN_FAKETLS_DOMAIN|FAKETLS/, 'DEFAULT_INIT_BODY must handle FAKETLS_DOMAIN');
  assert.match(body, /--dc-ip/, 'DEFAULT_INIT_BODY must pass DC_IPS via --dc-ip argv (no env alias)');
});

test('RED 1b: DEFAULT_INIT_BODY must equal canonical full adapter (rust init) not minimal downgrade', () => {
  const body = extractDefaultInitBody(providerSrc);
  // The canonical full init starts with procd handling and reads all env vars
  // Minimal body only handled TG_SECRET/HOST/PORT. Full body must contain config.conf handling for DC_IPS etc.
  // Ensure that body contains at least the same mapping logic as rustInit
  // Check that rustInit's key env mappings are present in DEFAULT_INIT_BODY
  const requiredEnvMappings = [
    'TG_DEFAULT_DOMAINS',
    'TG_CF_PRIORITY',
    'TG_CF_BALANCE',
    'TG_POOL_SIZE',
    'TG_BUF_KB',
    'TG_LINK_IP',
  ];
  for (const env of requiredEnvMappings) {
    assert.match(body, new RegExp(env), `DEFAULT_INIT_BODY must contain ${env} (from canonical rust init)`);
  }
  // Also ensure manager minimal init (zapret2-manager/files/etc/init.d/tg-ws-proxy) is not the old 28-line minimal
  if (managerInit) {
    // Old minimal only had TG_SECRET, no HOST handling for DC etc.
    // New canonical must be > 1000 chars (full) or contain DC_IPS/CF_PRIORITY
    const isMinimal = managerInit.length < 1000 && !managerInit.includes('TG_DEFAULT_DOMAINS');
    assert.equal(isMinimal, false, 'manager-owned /etc/init.d/tg-ws-proxy must be full canonical, not minimal (strip duplicated minimal)');
  }
});

test('RED 2: DC coverage - all configured DC mappings must be present in effective provider runtime', () => {
  const body = extractDefaultInitBody(providerSrc);
  // DC_IPS must be iterated and passed as --dc-ip $pair for each entry
  // Check that body handles comma-separated DC_IPS loop
  assert.match(body, /DC_IPS/, 'init must read DC_IPS from config');
  assert.match(body, /for pair in \$DC_IPS|for pair in/, 'init must loop over DC_IPS pairs');
  assert.match(body, /--dc-ip/, 'init must append --dc-ip for each DC pair');
  // Ensure rustInit indeed covers this correctly (our canonical should match)
  assert.match(rustInit, /--dc-ip/, 'rust canonical must handle DC_IPS');
  // Ensure DEFAULT_INIT_BODY handles DC_IPS similarly to rustInit (not missing)
  // A minimal init that only handled HOST/PORT would lack this, causing media DC loss
  const hasDcLoop = body.includes('DC_IPS') && body.includes('--dc-ip');
  assert.equal(hasDcLoop, true, 'DEFAULT_INIT_BODY must propagate DC_IPS to runtime, otherwise DC1/DC3/DC5 media will fail (only DC2+DC4 default remains)');
});

test('RED: manager init and provider DEFAULT_INIT_BODY must not diverge (single canonical)', () => {
  const body = extractDefaultInitBody(providerSrc);
  // Ensure that the two inits (manager file and DEFAULT_INIT_BODY) are either identical or the manager file is the canonical full
  // If manager file exists, it should contain the same full mapping as body
  if (managerInit && managerInit.length > 0) {
    // Check that managerInit also contains the full env set
    const managerHasFull = managerInit.includes('TG_DEFAULT_DOMAINS') && managerInit.includes('--dc-ip');
    const bodyHasFull = body.includes('TG_DEFAULT_DOMAINS') && body.includes('--dc-ip');
    // Both should be full, or manager file should be removed (no duplication)
    // For now we assert that manager file is full if it exists
    if (managerHasFull !== bodyHasFull) {
      assert.fail(`manager init full=${managerHasFull} but DEFAULT_INIT_BODY full=${bodyHasFull} -> divergent adapters (must be single canonical)`);
    }
    // Also ensure rust init is the source of truth: body should be at least as comprehensive as rustInit
    // Do not allow body to be smaller than rustInit
    const rustHasDc = rustInit.includes('--dc-ip');
    const bodyHasDc = body.includes('--dc-ip');
    assert.equal(rustHasDc, bodyHasDc, 'DEFAULT_INIT_BODY and rust canonical must agree on DC_IPS handling');
  }
});
