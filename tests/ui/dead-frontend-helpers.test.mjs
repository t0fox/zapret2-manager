import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const files = {
  assets: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8'),
  log: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js'), 'utf8'),
  dns: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js'), 'utf8'),
  monitor: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js'), 'utf8'),
  overview: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js'), 'utf8'),
  maintenance: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8'),
  proxy: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js'), 'utf8'),
  resources: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js'), 'utf8'),
  scanner: fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js'), 'utf8'),
};

const deadHelpers = [
  ['assets', 'resourceCard'],
  ['assets', 'detailModal'],
  ['assets', 'metadata'],
  ['log', 'messageLabel'],
  ['dns', 'discardManualRules'],
  ['dns', 'discardGlobalForm'],
  ['monitor', 'booleanValue'],
  ['overview', 'envelopeValue'],
  ['overview', 'durationLabel'],
  ['maintenance', 'heroStatusMessage'],
  ['maintenance', 'z2kUpdateLabel'],
  ['maintenance', 'z2kNeedsIntegration'],
  ['maintenance', 'renderEngine'],
  ['proxy', 'truthLabel'],
  ['proxy', 'truthKind'],
  ['proxy', 'toggleAdvanced'],
  ['resources', 'releaseValue'],
  ['scanner', 'operationNeedsTarget'],
];

test('frontend production modules contain no helpers without a current caller', () => {
  for (const [file, name] of deadHelpers) {
    assert.doesNotMatch(files[file], new RegExp(`\\bfunction\\s+${name}\\s*\\(`), `${file}: ${name} must be removed`);
  }
});
