import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('P02-V3 skips Control rerender when the status and bounded log snapshot are unchanged', () => {
  const page = read('z2m-avatar-control.js');
  assert.match(page, /function dataSignature/);
  assert.match(page, /renderSignature/);
  assert.match(page, /if \(!changed\) return/);
});

test('P02-V3 restores the log viewport without smooth-scroll animation', () => {
  const css = read('z2m-ui.css');
  assert.match(css, /z2m-view#z2m-view-control \.log-viewer\{[^}]*scroll-behavior:auto/);
  assert.doesNotMatch(css, /z2m-view#z2m-view-control \.log-viewer\{[^}]*scroll-behavior:smooth/);
});
