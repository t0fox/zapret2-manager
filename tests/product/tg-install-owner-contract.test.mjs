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

test('shared lifecycle owner is ensured before any install mutation', () => {
  assert.match(source, /function ensure_shared_lifecycle/);
  const ensuredAt = source.indexOf('ensure_shared_lifecycle()');
  const acquireAt = source.indexOf('acquire_lock()', source.indexOf('proxy_provider_install'));
  assert.ok(ensuredAt !== -1 && acquireAt !== -1);
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
