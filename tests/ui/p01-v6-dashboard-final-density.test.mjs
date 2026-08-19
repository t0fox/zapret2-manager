import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P01-V6 removes Resource Check presentation while retaining its backend path', () => {
  const page = read('z2m-overview.js');
  const css = read('z2m-ui.css');
  assert.doesNotMatch(page, /resource-check-card/);
  assert.doesNotMatch(page, /Стратегия точечного правила/);
  assert.doesNotMatch(page, /Применить только к ресурсу/);
  assert.match(page, /ctx\.api\.orchestra\.runStart/);
  assert.doesNotMatch(css, /resource-check-/);
});

test('P01-V6 uses bounded canonical recommendations instead of the full Strategy catalog', () => {
  const page = read('z2m-overview.js');
  const api = read('z2m-api.js');
  const dashboard = read('z2m-avatar-dashboard.js');
  assert.match(api, /strategiesRecommendations:rpc\.declare\(\{object:'zapret2-manager',method:'strategies_recommendations'/);
  assert.match(api, /recommendations:calls\.strategiesRecommendations/);
  assert.match(page, /ctx\.api\.strategies\.recommendations\(\)/);
  assert.doesNotMatch(page, /ctx\.api\.strategies\.list\(\)/);
  assert.match(page, /slice\(0,\s*3\)/);
  assert.match(page, /upstreamRecommended/);
  assert.match(page, /Рекомендуется каталогом/);
  assert.match(page, /#\/strategies/);
  assert.match(dashboard, /options\.recommendations/);
});

test('P01-V6 keeps the Dashboard event journal compact and shared', () => {
  const page = read('z2m-overview.js');
  const css = read('z2m-ui.css');
  assert.match(page, /eventsTail, \{ limit: 8 \}/);
  assert.match(page, /AvatarLog\.renderNormalized/);
  assert.match(css, /#z2m-view-overview \.log-viewer\{[^}]*max-height:220px/);
  assert.match(page, /recentEvents: renderEvents\(\)/);
  assert.match(page, /recommendations: renderRecommendations\(\)/);
});

test('P01-V6 recommendation rows remain read-only and preserve explicit evidence', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /scannerEvidence/);
  assert.match(page, /learnedEvidence/);
  assert.match(page, /healthEvidence/);
  assert.doesNotMatch(page, /recommendation[\s\S]{0,140}strategies\.apply/);
  assert.doesNotMatch(page, /recommendation[\s\S]{0,140}stageOverride/);
});
