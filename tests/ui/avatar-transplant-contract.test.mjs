import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const productionFiles = fs.readdirSync(frontend).filter((name) => name.endsWith('.js') || name.endsWith('.css'));
const productionText = productionFiles.map((name) => fs.readFileSync(path.join(frontend, name), 'utf8')).join('\n');

test('records the current Avatar donor and preserves its MIT provenance', () => {
  const mapping = fs.readFileSync(path.join(root, 'docs/09-work/avatar-frontend-mapping.md'), 'utf8');
  const notice = fs.readFileSync(path.join(root, 'docs/third-party/avatarDD-zapret-gui.md'), 'utf8');
  assert.match(mapping, /7263810c2923bb70f30fe2c41de45dac0feef492/);
  assert.match(mapping, /947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c/);
  assert.match(notice, /Copyright \(c\) 2026 avatarDD/);
  assert.match(notice, /MIT/);
});

test('keeps the z2m top navigation and never ships a donor sidebar', () => {
  const app = fs.readFileSync(path.join(frontend, 'app.js'), 'utf8');
  for (const tab of ['overview', 'strategy', 'services', 'blockcheck', 'dns', 'proxy', 'monitor', 'maintenance']) {
    assert.match(app, new RegExp(`['"]${tab}['"]`), `missing top tab ${tab}`);
  }
  assert.doesNotMatch(productionText, /['"](?:require\s+)?(?:view\.)?sidebar|z2m-sidebar/);
});

test('production frontend contains no live Avatar HTTP API or donor-only product binding', () => {
  assert.doesNotMatch(productionText, /(?:fetch|XMLHttpRequest)\s*\([^)]*['"]\/api\//);
  assert.doesNotMatch(productionText, /['"]\/api\//);
  assert.doesNotMatch(productionText, /(?:AWG|Usque|Opera Proxy|sing-box|mihomo)/i);
});

test('ships a project-owned shared Avatar-derived UI boundary', () => {
  const shared = path.join(frontend, 'z2m-avatar-ui.js');
  assert.equal(fs.existsSync(shared), true, 'shared UI module is missing');
  const source = fs.readFileSync(shared, 'utf8');
  assert.match(source, /normalizeError/);
  assert.match(source, /statusBadge/);
  assert.match(source, /showErrorState/);
});

test('documents actual donor file-level reuse instead of only visual similarity', () => {
  const mapping = fs.readFileSync(path.join(root, 'docs/09-work/avatar-frontend-mapping.md'), 'utf8');
  for (const donorFile of ['components/confirm.js', 'components/list_ui.js', 'components/toast.js', 'pages/blockcheck.js']) {
    assert.match(mapping, new RegExp(donorFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(mapping, /COPIED\/ADAPTED CODE AREA/);
  assert.match(mapping, /MAJOR MODIFICATIONS/);
});
