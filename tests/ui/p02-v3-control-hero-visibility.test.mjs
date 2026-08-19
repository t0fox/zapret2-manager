import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const cssPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css');
const css = fs.readFileSync(cssPath, 'utf8');
const page = fs.readFileSync(path.join(viewRoot, 'z2m-avatar-control.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(viewRoot, 'z2m-avatar-dashboard.js'), 'utf8');
const icons = fs.readFileSync(path.join(viewRoot, 'z2m-icons.js'), 'utf8');

function hasIconKey(name) {
  return new RegExp(`(?:^|\\n)\\s*(?:['"]${name}['"]|${name})\\s*:`).test(icons);
}

test('P02 Control hero keeps status SVG strokes visible and animation legible', () => {
  assert.match(css, /control-status-icon svg\{[^}]*stroke:currentColor !important/);
  assert.match(css, /control-status-icon svg\{[^}]*fill:none !important/);
  assert.match(css, /control-status-icon svg\{[^}]*width:30px;height:30px[^}]*stroke-width:2\.2/);
  assert.match(css, /control-status-icon svg\{[^}]*stroke-linecap:round/);
  assert.match(css, /control-status-icon svg\{[^}]*stroke-linejoin:round/);
  assert.match(css, /control-button-icon-slot svg\{[^}]*width:14px;height:14px[^}]*stroke:currentColor !important/);
  assert.match(css, /control-button-icon-slot svg\{[^}]*stroke:currentColor !important/);
  assert.match(css, /control-button-icon-slot svg\{[^}]*stroke-width:2;/);
  assert.match(css, /card-title svg\{[^}]*width:var\(--icon-sm\)[^}]*height:var\(--icon-sm\)[^}]*stroke:currentColor !important/);
  assert.match(css, /status-card-icon svg\{[^}]*width:var\(--icon-md\)[^}]*height:var\(--icon-md\)[^}]*stroke:currentColor !important/);
  assert.match(css, /control-status-indicator\.running \.control-status-icon\{color:#d6ffe6\}/);
  assert.match(css, /control-status-indicator\.stopped\{[^}]*color:var\(--tx\)/);
  assert.match(css, /control-status-indicator\.running \.control-status-ring\{[^}]*opacity:\.72[^}]*animation:z2m-control-ring-pulse 1\.8s/);
  assert.match(css, /@keyframes z2m-control-ring-pulse\{0%,100%\{transform:scale\(1\);opacity:\.72\}50%\{transform:scale\(1\.1\);opacity:\.24\}\}/);
});

test('P02 Control uses the canonical shared SVG registry', () => {
  assert.match(page, /z2m-icons as Icons/);
  assert.match(page, /Icons\.node\(name/);
  assert.doesNotMatch(page, /createElementNS|function svgNode|var paths = \{/);
  for (const name of ['workflow', 'cpu', 'shield-check', 'network', 'circle-check', 'circle-alert']) {
    assert.equal(hasIconKey(name), true, `missing shared Control glyph: ${name}`);
  }
});

test('P02 Control status cards consume the shared dashboard icon registry', () => {
  assert.match(dashboard, /z2m-icons as Icons/);
  assert.match(dashboard, /Icons\.wrappedNode/);
  for (const name of ['strategy', 'nfqws', 'system']) assert.equal(hasIconKey(name), true, `missing shared icon glyph: ${name}`);
  assert.match(page, /card\('card-strategy',[\s\S]*'workflow'\)/);
  assert.match(page, /card\('card-process',[\s\S]*'cpu'\)/);
  assert.match(page, /card\('card-firewall',[\s\S]*'shield-check'\)/);
  assert.match(page, /status-card-icon/);
  assert.doesNotMatch(page, /AvatarDashboard\.statusCard/);
  assert.match(css, /z2m-view#z2m-view-control \.status-card-header\{display:flex;align-items:center;gap:var\(--icon-gap\)/);
  assert.match(css, /z2m-view#z2m-view-control \.status-card-icon svg\{display:block;width:var\(--icon-md\);height:var\(--icon-md\)[^}]*stroke-width:1\.8/);
});

test('P02 Control hero keeps the 50px medallion at narrow widths', () => {
  assert.match(css, /@media\s*\(max-width:700px\)[^\n]*control-status-indicator\{width:50px;height:50px\}/);
  assert.doesNotMatch(css, /@media\s*\(max-width:700px\)[^\n]*control-status-indicator\{width:58px;height:58px\}/);
});
