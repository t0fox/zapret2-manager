import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const PROXY = read('zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc');
const ENGINE = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc');
const BLOCKCHECKW = read('zapret2-manager/files/usr/libexec/zapret2-manager/blockcheckw-cli.uc');
const COORDINATOR = read('zapret2-manager/files/usr/libexec/zapret2-manager/update-source.uc');
const LEGACY_ENGINE = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-providers.uc');
const ENGINE_CLI = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc');
const ENGINE_RPC = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc');
const ENGINE_WORKER = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');
const PROXY_METADATA = PROXY.slice(PROXY.indexOf('function source_metadata'), PROXY.indexOf('// Map a release', PROXY.indexOf('function source_metadata')));
const PROXY_ARTIFACT = PROXY.slice(PROXY.indexOf('function download_verified_artifact'), PROXY.indexOf('// RustAdapter', PROXY.indexOf('function download_verified_artifact')));
const ENGINE_METADATA = ENGINE.slice(ENGINE.indexOf('function metadata_request'), ENGINE.indexOf('function random_token'));
const BLOCKCHECKW_METADATA = BLOCKCHECKW.slice(BLOCKCHECKW.indexOf('function metadata_request'), BLOCKCHECKW.indexOf('export const blockcheckw_provider_status'));

test('non-Z2K metadata consumers delegate to the shared update source', () => {
  assert.match(PROXY, /update_source\.update_source_browse/);
  assert.match(PROXY, /update_source\.update_source_refresh/);
  assert.match(PROXY, /update_source\.update_source_fresh/);
  assert.match(ENGINE, /update_source\.update_source_browse/);
  assert.match(ENGINE, /update_source\.update_source_fresh/);
  assert.match(BLOCKCHECKW, /update_source\.update_source_browse/);
  assert.match(BLOCKCHECKW, /update_source\.update_source_refresh/);
  assert.match(BLOCKCHECKW, /update_source\.update_source_fresh/);
});

test('legacy metadata fetch paths are removed while mutation content fetches stay owned', () => {
  assert.doesNotMatch(PROXY_METADATA, /uclient-fetch/);
  assert.doesNotMatch(ENGINE, /uclient-fetch/);
  assert.doesNotMatch(BLOCKCHECKW, /uclient-fetch/);
  assert.match(PROXY, /download_verified_artifact|uclient-fetch/);
  assert.match(ENGINE, /engine-operation-worker\.sh|downloadUrl/);
  assert.match(BLOCKCHECKW, /INSTALLER|blockcheckw-install\.sh/);
});

test('official Engine metadata cache is no longer persisted under /etc', () => {
  assert.doesNotMatch(ENGINE, /RELEASE_CACHE|release-catalog\.json/);
  assert.match(ENGINE, /sourceKey:\s*'engine:/);
});

test('fresh metadata is required at mutation boundaries', () => {
  assert.match(PROXY, /mode == 'fresh'[\s\S]*?update_source\.update_source_fresh/);
  assert.match(ENGINE, /function fetch_releases[\s\S]*?mode == 'fresh'[\s\S]*?update_source\.update_source_fresh/);
  assert.match(BLOCKCHECKW, /update_source\.update_source_fresh/);
});

test('direct-fetch audit leaves only intentional mutation content paths', () => {
  assert.doesNotMatch(PROXY_METADATA, /api\.github\.com[\s\S]*uclient-fetch|uclient-fetch[\s\S]*api\.github\.com/);
  assert.doesNotMatch(ENGINE_METADATA, /uclient-fetch/);
  assert.doesNotMatch(BLOCKCHECKW_METADATA, /uclient-fetch/);
  assert.match(PROXY_ARTIFACT, /uclient-fetch/);
  assert.match(ENGINE_WORKER, /uclient-fetch/);
  assert.match(BLOCKCHECKW, /blockcheckw-install\.sh/);
  // The old alternate-provider module is retained as legacy/non-production;
  // the official engine CLI/RPC path does not import or dispatch it.
  assert.match(LEGACY_ENGINE, /andrevich|remittor/);
  assert.doesNotMatch(ENGINE_CLI, /engine-providers\.uc/);
  assert.doesNotMatch(ENGINE_RPC, /engine-providers\.uc/);
});

test('browse metadata has no flash-backed write path', () => {
  assert.match(COORDINATOR, /CACHE_ROOT = getenv\('Z2M_UPDATE_SOURCE_CACHE_ROOT'\) \|\| '\/tmp\//);
  assert.doesNotMatch(COORDINATOR, /\/etc\/zapret2-manager/);
  assert.doesNotMatch(PROXY_METADATA, /writefile|atomic_json|\/etc\/zapret2-manager/);
  assert.doesNotMatch(ENGINE_METADATA, /writefile|atomic_json|\/etc\/zapret2-manager/);
  assert.doesNotMatch(BLOCKCHECKW_METADATA, /writefile|atomic_json|\/etc\/zapret2-manager/);
  assert.match(PROXY, /STATE_FILE = getenv\('Z2M_TGPROVIDER_STATE'\) \|\| '\/etc\/zapret2-manager\/proxy-provider\.json'/);
  assert.match(ENGINE, /STATE_FILE = '\/etc\/zapret2-manager\/engine-state\.json'/);
  assert.match(ENGINE, /CACHE = '\/etc\/zapret2-manager\/engine-cache'/);
  assert.doesNotMatch(ENGINE, /RELEASE_CACHE|release-catalog\.json/);
});
