import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const audit = fs.readFileSync('docs/05-parity/avatar-transplant-audit.md', 'utf8');
const overview = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js', 'utf8');
const log = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js', 'utf8');
const shell = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js', 'utf8');
const avatarUi = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-ui.js', 'utf8');

test('P01-T2 records the pre-correction source reality before transplant closure', () => {
  assert.match(audit, /P01-T2 source re-audit — pre-correction truth/);
  assert.match(audit, /AVATAR_DONOR_HEAD.*38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(audit, /P01_T_PREVIOUS_REALITY.*MOSTLY_AUDIT_WITH_CUSTOM_UI_RETAINED/);
  assert.match(audit, /Dashboard composition.*CUSTOM_APPROXIMATION/);
  assert.match(audit, /Quick Actions.*CUSTOM_APPROXIMATION/);
  assert.match(audit, /Dialogs.*CUSTOM_APPROXIMATION/);
  assert.match(audit, /Status cards.*ADAPTED_BOUNDARY_ONLY/);
  assert.match(audit, /Log viewer.*ADAPTED_BOUNDARY_ONLY/);
  assert.match(audit, /CUSTOM_APPROXIMATION_REMAINING.*3/);
});

test('P01-T2 source evidence names actual current structures', () => {
  assert.match(overview, /function statusCard\(/);
  assert.match(overview, /function lifecycleButton\(/);
  assert.match(overview, /function renderQuickActions\(/);
  assert.match(overview, /function renderEvents\(/);
  assert.match(log, /function createEntryElement\(/);
  assert.match(log, /function renderNormalized\(/);
  assert.match(shell, /function openModal\(/);
  assert.match(avatarUi, /function confirm\(/);
  assert.match(avatarUi, /z2m-avatar-confirm-panel/);
});
