import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Clean-install postinst lifecycle contract.
//
// The Manager APK must leave a freshly installed router in a verified running
// state WITHOUT reboot:
//   persistent bootstrap -> strategy state seed -> source-generation migration
//   -> legacy compact catalog index fallback (idempotent, written-checked,
//   never silently swallowed) -> rpcd reload ->
//   enable AND restart -> procd/helperd/socket evidence -> bounded status_fast proof.
//
// This is a static source contract test: it parses the actual postinst recipe
// shipped to the target (Makefile heredoc), so drift fails CI before any flash.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = path.join(ROOT, 'zapret2-manager', 'Makefile');
const LUCI_MAKEFILE = path.join(ROOT, 'luci-app-zapret2-manager', 'Makefile');

function postinstRecipe(makefile, packageName) {
  const source = readFileSync(makefile, 'utf8');
  const start = source.indexOf(`define Package/${packageName}/postinst`);
  assert.notEqual(start, -1, `postinst define missing for ${packageName}`);
  const end = source.indexOf('\nendef', start);
  assert.notEqual(end, -1, 'postinst endef missing');
  let body = source.slice(start, end);
  // unescape make shell heredoc $${var} -> ${var}
  body = body.replaceAll('$$', '$');
  return body;
}

function ordered(re, steps) {
  const positions = steps.map(([label, pattern]) => {
    const match = re.exec(pattern);
    return { label, at: match == null ? -1 : re.lastIndex === 0 ? pattern.length : match.index };
  });
  return positions;
}

function assertOrder(body, steps) {
  let cursor = -1;
  for (const [label, needle] of steps) {
    const at = body.indexOf(needle);
    assert.notEqual(at, -1, `postinst step missing: ${label} (${needle})`);
    assert.ok(at > cursor, `postinst step out of order: ${label} at ${at}, previous ended at ${cursor}`);
    cursor = at;
  }
}

test('manager postinst builds the catalog index idempotently without pre-deletion', () => {
  const body = postinstRecipe(MAKEFILE, 'zapret2-manager');
  assert.doesNotMatch(body, /rm\s+-f[^\n]*strategy-catalog-index\.json/,
    'postinst must not destroy an existing read index before rebuilding it');
  assert.match(body, /strategy-catalog-index-cli\.uc/,
    'index CLI must be invoked during install');
  assert.match(body, /written/, 'CLI output written flag must be checked (ok:true+written:false is failure)');
  assert.doesNotMatch(body, /index-cli\.uc[^\n]*\|\|[[:space:]]*true/,
    'swallowing index build failure with || true is forbidden');
  assertOrder(body, [
    ['source-generation migration', 'strategy-catalog-migration-cli.uc'],
    ['legacy index fallback', 'strategy-catalog-index-cli.uc'],
  ]);
  assert.match(body, /migration-required/, 'migration failure must remain explicitly observable');
});

test('manager postinst enables AND restarts the service with runtime verification', () => {
  const body = postinstRecipe(MAKEFILE, 'zapret2-manager');
  assertOrder(body, [
    ['persistent bootstrap', 'z2m-root-bootstrap persistent'],
    ['rpcd plugin reload', 'kill -HUP'],
    ['service enable', '/etc/init.d/zapret2-manager enable'],
    ['service restart', '/etc/init.d/zapret2-manager restart']
  ]);
  assert.match(body, /rpcd_pid=.*pidof rpcd/,
    'postinst must discover the live rpcd process before reloading plugins');
  assert.match(body, /\/etc\/init\.d\/rpcd start/,
    'postinst must have a checked fallback when rpcd is not running');
  assert.match(body, /pidof[^\n]*z2m-helperd/, 'helper daemon process evidence required');
  assert.match(body, /z2m-helperd\.sock/, 'helper socket evidence required');
  assert.match(body, /status_fast/, 'bounded bounded status_fast proof required');
});

test('manager postinst materializes the package runtime bridge when Engine is already installed', () => {
  const body = postinstRecipe(MAKEFILE, 'zapret2-manager');
  const sync = body.indexOf('strategy-runtime-assets-sync.sh');
  const rpcd = body.indexOf('rpcd_pid=');
  assert.ok(sync >= 0, 'clean install must invoke the canonical runtime asset sync');
  assert.ok(sync < rpcd, 'runtime asset sync must run before rpcd/service restart');
  assert.match(body, /-x\s+\/opt\/zapret2\/nfq2\/nfqws2/,
    'manager-only install must not fabricate an Engine runtime tree');
  assert.match(body, /strategy-runtime-assets-sync\.sh[^\n]*2>&1/,
    'runtime sync failure must remain visible during package installation');
});

test('manager postinst seeds state with factory-image base utilities only', () => {
  const body = postinstRecipe(MAKEFILE, 'zapret2-manager');
  assert.doesNotMatch(body, /\binstall\s+-d\b/,
    'postinst must not require the optional install utility for directory creation');
  assert.doesNotMatch(body, /\|\s*install\s+-o\b/,
    'postinst must not require the optional install utility for state-file creation');
  assert.match(body, /mkdir\s+-p\s+\/etc\/zapret2-manager\/strategies/,
    'strategy directory must be created with base mkdir');
  assert.match(body, /chown\s+root:root/,
    'created persistent state must retain root ownership');
  assert.match(body, /chmod\s+0(?:600|700)/,
    'created persistent state must retain restrictive permissions');
});

test('manager postinst records an explicit repair marker when the index cannot be built', () => {
  const body = postinstRecipe(MAKEFILE, 'zapret2-manager');
  assert.match(body, /repair-required/, 'repair-required marker must be persisted on unrecoverable index failure');
  assert.match(body, /logger[^\n]*zapret2-manager/, 'failure must be logged, not silent');
});

test('luci app postinst keeps LuCI cache invalidation for immediate availability', () => {
  const body = postinstRecipe(LUCI_MAKEFILE, 'luci-app-zapret2-manager');
  assert.match(body, /luci-indexcache/, 'LuCI index cache purge retained');
  assert.match(body, /rpcd reload|kill -HUP/, 'rpcd reload/HUP retained');
});
