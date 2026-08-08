import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const app = fs.readFileSync(`${root}/app.js`, 'utf8');
const shell = fs.readFileSync(`${root}/z2m-shell.js`, 'utf8');
const css = fs.readFileSync(`${root}/z2m-holyversion.css`, 'utf8');
const pages = [
  'z2m-overview.js', 'z2m-strategy-page.js', 'z2m-services.js',
  'z2m-dns.js', 'z2m-proxy-page.js', 'z2m-monitor.js', 'z2m-maintenance.js'
].map((name) => fs.readFileSync(`${root}/${name}`, 'utf8')).join('\n');

test('root keeps one LuCI view and exactly seven primary sections', () => {
  assert.equal((app.match(/L\.view\.extend\s*\(/g) || []).length, 1);
  assert.match(app, /TAB_IDS\s*=\s*\['overview','strategy','services','dns','proxy','monitor','maintenance'\]/);
  assert.doesNotMatch(app, /TAB_IDS[^\n]*'lists'/);
});

test('responsive contract covers desktop tablet and mobile widths', () => {
  for (const width of ['1920', '1366', '1024', '390'])
    assert.match(css, new RegExp(`viewport-${width}|${width}px`));
  assert.match(css, /max-width:\s*1024px/);
  assert.match(css, /max-width:\s*640px/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /min-width:\s*0/);
});

test('mobile layout keeps primary action visible and cards single-column', () => {
  assert.match(css, /\.z2m-phead[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.z2m-phead \.sp[^}]*width:\s*100%/s);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.z2m-applybar[^}]*position:\s*sticky|\.z2m-applybar[^}]*position:\s*fixed/s);
});

test('keyboard focus and dialog tab semantics remain visible', () => {
  assert.match(css, /:focus-visible/);
  assert.match(shell, /role:\s*'dialog'/);
  assert.match(shell, /aria-modal/);
  assert.match(shell, /role:\s*'tab'/);
  assert.match(shell, /aria-selected/);
  assert.match(shell, /ArrowLeft/);
  assert.match(shell, /ArrowRight/);
});

test('pages use human state panels instead of raw null-like output', () => {
  assert.doesNotMatch(pages, /String\(null\)|String\(undefined\)/);
  assert.doesNotMatch(pages, /\[object Object\]|\[object HTMLDivElement\]/);
  assert.match(shell, /Format\.text/);
  assert.match(shell, /statePanel/);
});

test('technical JSON is advanced or disclosure-only', () => {
  const primaryRaw = pages.match(/E\('pre'[^\n]*JSON\.stringify/g) || [];
  assert.ok(primaryRaw.length <= 4);
  assert.match(pages, /details|z2m-tech|advanced/);
});

test('interactive switches and tabs expose ARIA state', () => {
  assert.match(shell, /role:\s*'switch'/);
  assert.match(shell, /aria-checked/);
  assert.match(shell, /aria-pressed/);
  assert.match(shell, /tabindex/);
});
