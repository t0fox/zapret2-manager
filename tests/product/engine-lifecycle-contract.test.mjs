import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const catalog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-legacy-detect.uc'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh'), 'utf8');
const cli = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc'), 'utf8');
const rpc = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc'), 'utf8');
const statusCollector = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc'), 'utf8');
const makefile = fs.readFileSync(path.join(root, 'zapret2-manager/Makefile'), 'utf8');
const api = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js'), 'utf8');
const enginePanel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js'), 'utf8');
const overviewModel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js'), 'utf8');
const engineModel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-model.js'), 'utf8');
const acl = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager-engine.json'), 'utf8');
const engineApi = api.split('\n').find((line) => line.includes('engine:{')) || '';

test('the engine has exactly one normal upstream and no provider registry', () => {
  assert.match(catalog, /const UPSTREAM = 'bol-van\/zapret2'/);
  assert.match(catalog, /const API_URL = 'https:\/\/api\.github\.com\/repos\/bol-van\/zapret2\/releases\?per_page=20'/);
  assert.doesNotMatch(catalog, /https?:\/\/[^'\"]*(?:andrevich|remittor)|adapter\(/i);
  assert.doesNotMatch(manager, /provider|channel|switch/i);
  assert.doesNotMatch(rpc, /provider|channel/i);
});

test('legacy recognition is isolated and read-only', () => {
  assert.match(legacy, /detect_origin/);
  assert.match(legacy, /LEGACY_REMITTOR/);
  assert.match(legacy, /LEGACY_ANDREVICH/);
  assert.doesNotMatch(legacy, /uclient-fetch|apk add|apk del|releases\?/i);
});

test('official catalog exposes release facts and official checksum metadata', () => {
  assert.match(catalog, /releaseNotes/);
  assert.match(catalog, /checksumName/);
  assert.match(catalog, /sha256sum\.txt/);
  assert.match(catalog, /installedRelease: 'v'/);
  assert.match(catalog, /input\.version/);
  assert.doesNotMatch(catalog, /\.map\(/);
});

test('state migration removes the old state file after atomic engine-state creation', () => {
  assert.match(catalog, /engine-state\.json/);
  assert.match(catalog, /engine-provider\.json/);
  assert.match(catalog, /atomic_json\(STATE_FILE, migrated\)/);
  assert.match(catalog, /unlink\(LEGACY_STATE_FILE\)/);
  assert.doesNotMatch(manager, /engine-provider\.v1|save_engine_provider_state/);
});

test('public engine contract has no source argument', () => {
  for (const name of ['engine_releases', 'engine_status', 'engine_check', 'engine_install', 'engine_update', 'engine_downgrade', 'engine_reinstall', 'engine_uninstall', 'engine_operation_status']) assert.match(rpc, new RegExp(name));
  assert.doesNotMatch(rpc, /engine_providers|engine_check_updates|provider|channel/);
  assert.doesNotMatch(engineApi, /engine_providers|engine_check_updates|provider|channel/);
  assert.match(acl, /engine_releases/);
  assert.doesNotMatch(acl, /engine_providers|engine_check_updates/);
});

test('maintenance can select the engine pane without a render-time missing export failure', () => {
  assert.match(enginePanel, /function missing\(data\)/);
  assert.match(enginePanel, /missing:missing/);
});

test('release checks use the catalog version token instead of the display tag', () => {
  assert.match(enginePanel, /String\(state\.status\.installedRelease\)\.replace\(\/\^v\/,''\)/);
  assert.match(enginePanel, /selected:c\.version===state\.selectedVersion/);
});

test('release notes are sanitized before rendering', () => {
  assert.match(enginePanel, /function releaseNotes\(value\)/);
  assert.match(enginePanel, /releaseNotes\(candidate\.releaseNotes\)/);
});

test('same release is exposed as reinstall rather than update', () => {
  assert.match(engineModel, /replace\(\/\^v\/,''\)/);
});

test('engine actions use the shell modal API', () => {
  assert.match(enginePanel, /ctx\.shell\.openModal/);
  assert.doesNotMatch(enginePanel, /ctx\.shell\.showModal/);
});

test('worker is official tar-only and retains transactional rollback checks', () => {
  assert.match(worker, /bol-van\/zapret2/);
  assert.match(worker, /tar\.gz/);
  assert.match(worker, /DISTRIB_ARCH/);
  assert.match(worker, /OLD_TREE/);
  assert.match(worker, /RUNTIME_SHA/);
  assert.match(worker, /linux-arm64\/nfqws2/);
  assert.match(worker, /engine-state\.json/);
  assert.match(worker, /chmod 755 \/opt\/zapret2/);
  assert.match(worker, /\[\[:space:\]\]\*300\[\[:space:\]\]/);
  assert.match(worker, /NFQWS2_ENABLE/);
  assert.match(worker, /if \[ \"\$NFQWS2_ENABLE\"[\s\S]*nfnetlink_queue[\s\S]*else/);
  assert.match(worker, /PAUSE_FILE/);
  assert.match(worker, /pause_watchdog/);
  assert.match(worker, /resume_watchdog/);
  assert.doesNotMatch(worker, /1andrevich|remittor|\.apk|\.zip/);
});

test('official runtime can commit state without a legacy APK package', () => {
  assert.match(catalog, /runtimeContract/);
  assert.match(catalog, /packageVersion: null/);
  assert.match(manager, /installed\.packageVersion == null/);
  assert.match(manager, /installedOrigin == 'OFFICIAL'/);
});

test('status authority accepts the detached official runtime without APK metadata', () => {
  assert.match(statusCollector, /officialRuntime/);
  assert.match(statusCollector, /installedOrigin == 'OFFICIAL'/);
  assert.match(statusCollector, /packagePresent \|\| officialRuntime/);
});

test('Dashboard accepts direct status RPC payloads as well as wrapped envelopes', () => {
  assert.match(overview, /function payload/);
  assert.match(overview, /payload\(data\.status\)/);
  assert.match(overviewModel, /function payload/);
  assert.match(overviewModel, /payload\(data\.status\)/);
});

test('Dashboard version card has an authoritative engine-status fallback', () => {
  assert.match(overview, /ctx\.api\.engine\.status\(\)/);
  assert.match(overview, /engineStatus/);
  assert.match(overview, /engine\.installedRelease/);
  assert.match(overview, /nfqws2Version/);
});

test('official migration replaces the complete embedded runtime and bumps the manager package', () => {
  assert.match(worker, /binaries\/linux-arm64\/(nfqws2|ip2net|mdig)/);
  assert.match(worker, /gzip -dc|gunzip/);
  for (const directory of ['common', 'ipset', 'files', 'blockcheck2.d']) assert.match(worker, new RegExp(directory));
  assert.match(makefile, /PKG_RELEASE:=147/);
  assert.doesNotMatch(makefile, /DEPENDS:=[^\n]*\+zapret2/);
});

test('CLI does not expose provider or source commands', () => {
  assert.match(cli, /mode=='releases'/);
  assert.match(cli, /mode=='downgrade'/);
  assert.doesNotMatch(cli, /providers|check_updates|provider|channel/);
  assert.doesNotMatch(cli, /Z2M_ENGINE_LOCKED|flock -n .*engine-operation\.lock/);
  assert.match(manager, /kernel\/random\/uuid/);
});
