import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const overview = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js', 'utf8');
const dashboard = fs.existsSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-dashboard.js')
  ? fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-dashboard.js', 'utf8') : '';
const shell = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js', 'utf8');
const avatarUi = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-ui.js', 'utf8');
const css = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css', 'utf8');

test('P01-T2 Dashboard composition is a donor-derived component boundary', () => {
  assert.match(dashboard, /DONOR TRANSPLANT: web\/js\/pages\/dashboard\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(dashboard, /class.*page-header/);
  assert.match(dashboard, /class.*status-grid/);
  assert.match(dashboard, /class.*status-card/);
  assert.match(dashboard, /class.*card-title/);
  assert.match(dashboard, /class.*actions-row/);
  assert.match(dashboard, /class.*log-viewer/);
  assert.match(overview, /AvatarDashboard\.render\(/);
  assert.match(css, /\.z2m-view#z2m-view-overview \.card/);
});

test('P01-T2 Quick Actions keep the donor button and pending-state hierarchy', () => {
  const combined = dashboard + '\n' + avatarUi;
  assert.match(dashboard, /function renderAction\(/);
  assert.match(combined, /class.*btn/);
  assert.match(combined, /spinner-inline/);
  assert.match(combined, /aria-busy/);
  assert.match(combined, /data-lifecycle-action/);
  assert.match(overview, /action: action/);
  assert.match(overview, /AvatarDashboard\.render\(/);
});

test('P01-T2 dialogs and toasts use the donor component DOM boundary', () => {
  assert.match(shell, /DONOR TRANSPLANT: web\/js\/components\/confirm\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  for (const marker of ['modal-overlay', 'modal-content', 'modal-header', 'modal-body', 'modal-footer'])
    assert.match(shell, new RegExp(marker));
  assert.match(avatarUi, /DONOR TRANSPLANT: web\/js\/components\/toast\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  for (const marker of ['toast-icon', 'toast-text']) assert.match(avatarUi, new RegExp(marker));
  assert.match(avatarUi, /role: normalizedKind === 'err' \? 'alert' : 'status'/);
  assert.match(avatarUi, /DONOR TRANSPLANT: web\/js\/components\/confirm\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(avatarUi, /modal-overlay/);
});
