import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const file = relative => path.join(root, relative);
const proxy = fs.readFileSync(file('zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc'), 'utf8');
const tg = fs.readFileSync(file('zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc'), 'utf8');
const z2k = fs.readFileSync(file('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc'), 'utf8');
const engineCatalog = fs.readFileSync(file('zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc'), 'utf8');
const engineManager = fs.readFileSync(file('zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc'), 'utf8');
const enginePanel = fs.readFileSync(file('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js'), 'utf8');
const maintenance = fs.readFileSync(file('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const proxyPage = fs.readFileSync(file('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js'), 'utf8');
const componentsModelSource = fs.readFileSync(file('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');
const presentationSource = fs.readFileSync(file('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js'), 'utf8');

test('remote metadata keeps local truth separate from remote versions', () => {
  const versions = proxy.slice(proxy.indexOf('export const proxy_provider_versions'), proxy.indexOf('function check_input'));
  assert.match(versions, /installed:\s*installed/);
  assert.match(versions, /localFallback:\s*installed/);
  assert.match(versions, /versions:\s*versions/);
  assert.doesNotMatch(versions, /push\(versions,\s*installed/);
  assert.doesNotMatch(versions, /sourceId:\s*'installed-runtime'/);
  assert.match(proxy, /remoteState:\s*'empty'/);
  assert.match(tg, /localFallback:\s*row\.localFallback/);
  assert.match(z2k, /versions:\s*\[\]/);
  assert.match(z2k, /remoteState:\s*'unavailable'/);
  assert.doesNotMatch(z2k, /unavailable_catalog_row/);
});

test('valid empty upstream arrays are REMOTE_EMPTY and fulfilled ok:false is rejected', () => {
  assert.match(proxy, /validate: function\(value\)[\s\S]*?if \(type\(value\) != 'array'\) return false;/);
  assert.match(engineCatalog, /validate: function\(value\)[\s\S]*?if \(type\(value\) != 'array'\) return false;/);
  assert.match(proxyPage, /value && value\.ok === false/);
  assert.match(proxyPage, /var latestDisplay = latest \?/);
  assert.match(maintenance, /value && value\.ok === false/);
  assert.match(enginePanel, /answer\.ok === false/);
});

test('Go matcher remains explicit APK-only and does not silently accept IPK', () => {
  const matcher = proxy.slice(proxy.indexOf('function provider_asset'), proxy.indexOf('function parse_release'));
  assert.match(matcher, /\.apk/);
  assert.doesNotMatch(matcher, /\.ipk/);
});

test('Components defer remote catalogs after local bootstrap and keep stale browse non-mutating', () => {
  assert.match(engineManager, /remoteAvailable = false/);
  assert.match(engineManager, /releases = \[\]/);
  assert.match(enginePanel, /remoteState: 'not-loaded'/);
  assert.match(enginePanel, /function loadCatalog\(ctx, options\)/);
  assert.match(maintenance, /function scheduleComponentMetadata\(ctx\)/);
  assert.match(maintenance, /active < 2/);

  const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
  });
  const model = vm.runInNewContext(`(function () { ${componentsModelSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
    UpdatePresentation: presentation,
  });
  const local = { installed: true, installedRelease: { value: 'r-1', confidence: 'confirmed' }, lua: { ready: 7, total: 7 }, integrityOk: true };
  const unavailable = model.normalizeZ2k({
    local, catalog: [], remoteState: 'unavailable', remoteAvailable: false,
    availableRelease: 'r-99', updateState: 'update-available', canApply: true,
  }, true);
  assert.equal(unavailable.installedRelease.value, 'r-1');
  assert.equal(unavailable.latestRelease, null);
  assert.equal(unavailable.availableRelease, null);
  assert.equal(unavailable.canApply, false);

  const empty = model.normalizeZ2k({ local, catalog: [], remoteState: 'empty', remoteAvailable: true }, true);
  assert.equal(empty.latestRelease, null);
  assert.equal(empty.canApply, false);

  const stale = model.normalizeZ2k({
    local, catalog: [{ version: 'r-2', latest: true, installable: true }],
    remoteState: 'stale', remoteAvailable: true, updateState: 'update-available', canApply: true,
  }, true);
  assert.equal(stale.latestRelease, 'r-2');
  assert.equal(stale.canApply, false);
});
