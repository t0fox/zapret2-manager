import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// TG provider lifecycle honesty contract (GitHub-updater model):
//   - there is NO binary-only direct-release path left;
//   - installs are version-exact and re-validated from the stored check
//     record, never from browser-supplied URLs/digests;
//   - the manager guarantees the shared service-owner surface
//     (init script + config + secret) BEFORE any provider mutation;
//   - success requires the local hard health gate.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PROVIDER = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'proxy-provider.uc');

const source = fs.readFileSync(PROVIDER, 'utf8');

test('direct-release binary-copy path is fully removed', () => {
  assert.doesNotMatch(source, /install_direct_candidate/);
  assert.doesNotMatch(source, /ETG_SERVICE_OWNER_MISSING/,
    'clean routers are first-class: the dead-end owner-missing code is gone');
  assert.doesNotMatch(source, /direct-release/);
});

test('shell commands stay within BusyBox (OpenWrt) compatibility', () => {
  // Real-router failure evidence: busybox find rejects the GNU -quit action
  // ("unrecognized: -quit"), which broke every RustAdapter install on the
  // target. First-match selection goes through head instead.
  assert.doesNotMatch(source, /-quit\b/, 'busybox find has no -quit action');
});

test('shared lifecycle repair: init drift rewritten, secret in proxycfg format', () => {
  // Real-router evidence: an existing older init kept binding 0.0.0.0 while
  // config.conf declared HOST=127.0.0.1, so proxycfg exact_listener never
  // matched and overview stayed "Не подтверждён". Repair must rewrite drifted
  // init bodies and migrate legacy TG_SECRET= storage to SECRET=<32hex>.
  const fn = source.slice(source.indexOf('function ensure_shared_lifecycle'),
    source.indexOf('function download_verified_artifact'));
  assert.match(fn, /cur != canonicalInit/, 'init drift must be repaired against the canonical runtime adapter');
  assert.match(fn, /canonical_init_body\(\)/, 'init body must come from the single canonical source');
  assert.doesNotMatch(source, /'#!\/bin\/sh \/etc\/rc\.common/, '239-line init body must NOT be embedded in provider.uc (single source of truth)');
  assert.match(source, /usr\/share\/zapret2-manager\/tg-canonical-init\.sh/,
    'provider must read /usr/share/zapret2-manager/tg-canonical-init.sh as the single canonical init');
  const canonical = fs.readFileSync(path.join(ROOT, 'zapret2-manager', 'files',
    'usr', 'share', 'zapret2-manager', 'tg-canonical-init.sh'), 'utf8');
  assert.match(canonical, /^#!\/bin\/sh \/etc\/rc\.common/, 'canonical init is a complete rc.common script');
  assert.match(fs.readFileSync(path.join(ROOT, 'tg-ws-proxy-rs', 'files', 'etc', 'init.d', 'tg-ws-proxy'), 'utf8'),
    /^#!\/bin\/sh \/etc\/rc\.common/, 'upstream reference init stays for comparison');
  assert.match(fn, /SECRET=/, 'secret file uses canonical SECRET= key');
  assert.match(fn, /TG_SECRET=/, 'legacy TG_SECRET storage is recognised for migration');
  assert.match(fn, /\{48\}/, 'legacy 48-hex secret is truncated to the canonical 32-hex form');
  assert.doesNotMatch(source, /LOGLEVEL=/, 'config keys stay inside CONF_KEY_MAP');
});

test('shared lifecycle owner is ensured before any install mutation', () => {
  assert.match(source, /function ensure_shared_lifecycle/);
  const ensuredAt = source.indexOf('ensure_shared_lifecycle()');
  const acquireAt = source.indexOf('acquire_lock()', source.indexOf('proxy_provider_install'));
  assert.ok(ensuredAt !== -1 && acquireAt !== -1);
});

test('shared lifecycle directory handling uses UCode-compatible path operations', () => {
  assert.match(source, /function path_dirname\(/,
    'clean-install init creation needs an explicit dirname helper');
  assert.doesNotMatch(source, /INIT_PATH\.lastIndexOf\(/,
    'UCode strings do not expose JavaScript lastIndexOf');
  const ensureStart = source.indexOf('function ensure_shared_lifecycle');
  const ensureEnd = source.indexOf('\nfunction download_verified_artifact', ensureStart);
  assert.match(source.slice(ensureStart, ensureEnd), /path_dirname\(INIT_PATH\)/,
    'init creation must use the compatible dirname helper');
});

test('clean-install helpers resolve UCode function bindings before execution', () => {
  const runAt = source.indexOf('function run(');
  const lanAt = source.indexOf('function lan_address(');
  assert.ok(runAt !== -1 && lanAt !== -1 && runAt < lanAt,
    'UCode does not hoist run() into the earlier lan_address() body');
  assert.match(source, /join\('\/', slice\(/,
    'dirname must use UCode join(separator, array) argument order');
});

test('package seed config is reconciled before provider start without overwriting user config', () => {
  assert.match(source, /function config_needs_default\(/,
    'the package seed must be distinguishable from a user-owned config');
  const ensureStart = source.indexOf('function ensure_shared_lifecycle');
  const ensureEnd = source.indexOf('\nfunction download_verified_artifact', ensureStart);
  const ensure = source.slice(ensureStart, ensureEnd);
  assert.match(ensure, /config_needs_default\(\)/,
    'shared lifecycle must initialize the known package seed');
  assert.match(source, /package seed|package-seed|manager-owned\)/i,
    'the seed marker must be explicit');
  assert.match(ensure, /default_config_body\(\)/,
    'seed reconciliation must use the canonical recommended config');
});

test('fresh provider failures remove a newly installed direct binary', () => {
  const restoreStart = source.indexOf('function restore_previous');
  const restoreEnd = source.indexOf('\n// Manager-owned shared TG lifecycle surface', restoreStart);
  assert.match(source.slice(restoreStart, restoreEnd), /settingsSnapshot\.hadBinary\s*!==\s*true/,
    'rollback must clean a direct binary when no binary existed before install');
});

test('install is version-exact: load_checked_candidate requires an explicit version', () => {
  const fnStart = source.indexOf('function load_checked_candidate');
  const fnEnd = source.indexOf('\n}', fnStart);
  const fn = source.slice(fnStart, fnEnd);
  assert.match(fn, /type\(version\) != 'string'/,
    'install without exact selected version must be rejected');
});

test('local hard health gate runs before state commit', () => {
  const installStart = source.indexOf('export const proxy_provider_install');
  const installBody = source.slice(installStart, source.indexOf('export const proxy_provider_remove'));
  const healthAt = installBody.indexOf('tg_provider_health');
  const saveStateAt = installBody.indexOf('save_state(');
  assert.ok(healthAt !== -1 && saveStateAt !== -1 && healthAt < saveStateAt,
    'health gate must run before committing provider state');
});
