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
  const parity = fs.readFileSync(path.join(root, 'docs/01-project/avatar-parity.md'), 'utf8');
  const audit = fs.readFileSync(path.join(root, 'docs/05-parity/avatar-transplant-audit.md'), 'utf8');
  assert.match(mapping, /38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(parity, /38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(audit, /AVATAR_DONOR_HEAD.*38ed85ce487c6b3dbdf703a5be197795f7c0cad1/s);
  assert.match(parity, /исторические evidence/);
  assert.doesNotMatch(parity, /Current.*(?:60bc16a5|7263810c|947e213b)/s);
  assert.match(notice, /Copyright \(c\) 2026 avatarDD/);
  assert.match(notice, /MIT/);
});

test('durable transplant rule forbids donor-backed custom approximations', () => {
  const parity = fs.readFileSync(path.join(root, 'docs/01-project/avatar-parity.md'), 'utf8');
  const audit = fs.readFileSync(path.join(root, 'docs/05-parity/avatar-transplant-audit.md'), 'utf8');
  assert.match(parity, /AVATAR TRANSPLANT RULE/);
  assert.match(parity, /Custom Z2M approximation запрещена/);
  assert.match(audit, /CUSTOM_APPROXIMATION/);
  assert.match(audit, /CUSTOM_APPROXIMATION_REMAINING/);
});

test('keeps the z2m top navigation and never ships a donor sidebar', () => {
  const app = fs.readFileSync(path.join(frontend, 'app.js'), 'utf8');
  const navigation = fs.readFileSync(path.join(frontend, 'z2m-navigation.js'), 'utf8');
  for (const group of ['home', 'dpi', 'routing', 'data', 'diagnostics', 'system']) {
    assert.match(navigation, new RegExp(`id: '${group}'`), `missing navigation group ${group}`);
  }
  assert.match(app, /z2m-navigation as Navigation/);
  assert.match(app, /Shell\.primaryNavigation\(Navigation/);
  assert.doesNotMatch(productionText, /['"](?:require\s+)?(?:view\.)?sidebar|z2m-sidebar/);
});

test('production frontend contains no live Avatar HTTP API or donor-only product binding', () => {
  assert.doesNotMatch(productionText, /(?:fetch|XMLHttpRequest)\s*\([^)]*['"]\/api\//);
  assert.doesNotMatch(productionText, /['"]\/api\//);
  // P01 deliberately transplants the frozen donor's Dashboard card labels.
  // Keep the donor-only binding guard for every other production module.
  const nonDashboardText = productionFiles
    .filter((name) => name !== 'z2m-overview.js')
    .map((name) => fs.readFileSync(path.join(frontend, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(nonDashboardText, /(?:AWG|Usque|Opera Proxy|sing-box|mihomo)/i);
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
