import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'G:/zapret2-manager/.codex-avatar-parity';
const avatarPath = `${root}/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-ui.js`;
const shellPath = `${root}/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`;

test('P01-T T05 reuses donor confirm lifecycle behind the Z2M dialog boundary', () => {
  const avatar = fs.readFileSync(avatarPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  assert.match(avatar, /Bounded adaptation of Avatar web\/js\/components\/confirm\.js/);
  assert.match(avatar, /data-confirm="cancel"/);
  assert.match(avatar, /data-confirm="ok"/);
  assert.match(avatar, /document\.addEventListener\('keydown', onKey\)/);
  assert.match(avatar, /document\.removeEventListener\('keydown', onKey\)/);
  assert.match(avatar, /focus\(\)/);
  assert.match(avatar, /z2m-avatar-confirm/);
  assert.match(shell, /role: 'dialog'/);
  assert.match(shell, /document\.removeEventListener\('keydown', modalKeyHandler\)/);
  assert.doesNotMatch(avatar, /innerHTML/);
});
