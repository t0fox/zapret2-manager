import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/combo-presets.js';

test('combo presets page uses existing safe profile RPCs', () => {
  const src = readFileSync(path, 'utf8');
  assert.match(src, /method: 'discord_profile_preview'/);
  assert.match(src, /method: 'discord_profile_apply'/);
  assert.match(src, /method: 'discord_profile_rollback'/);
  assert.doesNotMatch(src, /profiles_apply/);
});

test('wide capture is explicitly acknowledged and never auto-applied', () => {
  const src = readFileSync(path, 'utf8');
  assert.match(src, /wideAcknowledged/);
  assert.match(src, /captureMode === 'wide'/);
  assert.match(src, /window\.confirm/);
  assert.match(src, /function applyCandidate/);
  assert.match(src, /addEventListener\('click'/);
  assert.doesNotMatch(src, /load:[\s\S]{0,500}callApply/);
});
