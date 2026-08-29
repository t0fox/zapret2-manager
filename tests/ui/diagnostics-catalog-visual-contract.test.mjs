import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const DIAGNOSTICS = fs.readFileSync(ROOT + 'z2m-diagnostics-page.js', 'utf8');
const SERVICES = fs.readFileSync(ROOT + 'z2m-services.js', 'utf8');
const DASHBOARD = fs.readFileSync(ROOT + 'z2m-avatar-dashboard.js', 'utf8');
const STRATEGIES = fs.readFileSync(ROOT + 'z2m-strategies.js', 'utf8');
const CSS = fs.readFileSync(ROOT + 'z2m-ui.css', 'utf8');

test('Monitoring has one navigation owner and no duplicate inner tab strip', () => {
  assert.match(DIAGNOSTICS, /z2m-monitoring-page/);
  assert.match(DIAGNOSTICS, /E\('h1', \{\}, _\('Мониторинг'\)\)/);
  assert.doesNotMatch(DIAGNOSTICS, /var tabs = ctx\.shell\.subTabs\(/);
  assert.match(DIAGNOSTICS, /журналы открываются через навигацию/);
});

test('Service catalog exposes labeled controls, live summary and one bulk action bar', () => {
  assert.match(SERVICES, /name: 'service-search'/);
  assert.match(SERVICES, /name: 'service-category'/);
  assert.match(SERVICES, /name: 'service-state'/);
  assert.match(SERVICES, /['"]aria-live['"]:\s*['"]polite['"]/);
  assert.match(SERVICES, /z2m-service-dns-bulkbar/);
  assert.match(SERVICES, /z2m-service-dns-field-label/);
});

test('Focused pages use compact Strategies geometry with accessible focus and motion fallbacks', () => {
  assert.match(CSS, /z2m-monitoring-page \.z2m-health-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(CSS, /z2m-services-page \.z2m-service-dns-search\{box-sizing:border-box;height:40px/);
  assert.match(CSS, /z2m-services-page input:focus-visible/);
  assert.match(CSS, /prefers-reduced-motion:reduce/);
});

test('Monitoring, Home and Strategies expose the visual hierarchy used by the browser review', () => {
  assert.match(DIAGNOSTICS, /var HEALTH_ICONS = \{/);
  assert.match(DIAGNOSTICS, /z2m-kpi-head/);
  assert.match(DASHBOARD, /dashboard-page-header/);
  assert.doesNotMatch(DASHBOARD, /dashboardSignal|dashboard-signal/);
  assert.match(DASHBOARD, /status-card-icon/);
  assert.match(DASHBOARD, /card-telegram/);
  assert.match(STRATEGIES, /strategies-workspace/);
  assert.match(CSS, /z2m-monitoring-page \.z2m-kpi-icon/);
  assert.match(CSS, /z2m-view#z2m-view-overview \.status-grid\{grid-template-columns:repeat\(3/);
  assert.match(CSS, /#card-telegram \.status-card-icon svg\.z2m-icon-brand[\s\S]*fill:currentColor!important[\s\S]*stroke:none!important/);
  assert.match(CSS, /#z2m-view-strategy \.strategies-workspace\{display:grid/);
  assert.match(CSS, /strategies-workspace>.strategy-ops-card\{grid-column:span 6/);
});
