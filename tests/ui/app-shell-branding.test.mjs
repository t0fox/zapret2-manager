import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const UI = path.join(ROOT, 'luci-app-zapret2-manager', 'files', 'www',
  'luci-static', 'resources', 'view', 'zapret2-manager');
const APP = path.join(UI, 'app.js');
const SHELL = path.join(UI, 'z2m-shell.js');
const CSS = path.join(UI, 'z2m-ui.css');
const CANONICAL_MARK = path.join(ROOT, 'assets', 'brand', 'zapret2-manager-mark.svg');
const PACKAGED_MARK = path.join(UI, 'icons', 'zapret2-manager-mark.svg');

const app = fs.readFileSync(APP, 'utf8');
const shell = fs.readFileSync(SHELL, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

test('app shell renders the canonical product identity and packaged mark', () => {
  assert.match(app, /zapret2\.manager/);
  assert.match(app, /zapret2-manager-mark\.svg/);
  assert.match(app, /E\('img'/);
  assert.match(app, /alt:\s*''/);
  assert.match(app, /['"]aria-hidden['"]:\s*'true'/);
  assert.doesNotMatch(app, /'class': 'mark'[^\n]*'z2'/,
    'the production mark must not be a textual z2 placeholder');
  assert.doesNotMatch(app, /zapret2·manager/);
});

test('packaged mark stays byte-identical to the repository canonical asset', () => {
  assert.ok(fs.existsSync(PACKAGED_MARK), 'the LuCI package must ship the mark');
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(digest(PACKAGED_MARK), digest(CANONICAL_MARK));
});

test('header keeps host and runtime status dynamic', () => {
  assert.match(app, /window\.location\.hostname\s*\|\|\s*'OpenWrt'/);
  assert.match(app, /statusState\(initial\)/);
  assert.match(app, /statusState\(raw\)/);
  assert.doesNotMatch(app, /192\.168\.1\.1/);
  assert.match(app, /Работает/);
  assert.match(app, /Остановлено/);
  assert.match(app, /Недоступно/);
});

test('header styling uses the README brand tokens and preserves narrow-screen priority', () => {
  assert.match(css, /\.z2m-apptop\{[^}]*#0b1120/);
  assert.match(css, /\.z2m-brand \.mark\{[^}]*width:32px[^}]*height:32px/);
  assert.match(css, /\.z2m-apptop \.in\{[^}]*width:100%/);
  assert.match(css, /\.z2m-brand \.nm\{[^}]*color:#f8fafc/);
  assert.match(css, /\.z2m-apptop \.z2m-chip\.g\{[^}]*#22c55e/);
  assert.match(css, /\.z2m-brand\{[^}]*min-width:0/);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*?\.z2m-apptop-right \.host\{display:none\}/);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*?\.z2m-brand \.ver\{display:none\}/);
  assert.match(shell, /header-branding-20260903-r1/);
});

test('header continues to delegate navigation to the existing shell owner', () => {
  assert.match(app, /Shell\.primaryNavigation\(Navigation, tabFromHash\(\), navigateTo\)/);
  assert.match(shell, /'class': 'z2m-navigation-shell'/);
});
