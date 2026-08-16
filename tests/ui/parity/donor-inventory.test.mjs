import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryAvatarPage } from '../../../scripts/inventory-avatar-page.mjs';

test('donor inventory helper reports evidence without making parity claims', () => {
  const result = inventoryAvatarPage('G:/avatarDD/zapret-gui/web/js/pages/dashboard.js');
  assert.match(result.source_file, /dashboard\.js$/);
  assert.match(result.warning, /Evidence-only/);
  assert.ok(result.obvious_sections.includes('status-grid'));
  assert.ok(result.headings.length >= 0);
});
