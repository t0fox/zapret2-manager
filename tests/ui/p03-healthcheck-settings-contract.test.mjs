import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('Healthcheck settings are an inline panel and never use native prompt UX', () => {
  const page = read('z2m-strategies.js');
  const handler = page.match(/function configureHealthcheck\(\)[\s\S]*?\n}\n/);
  assert.ok(handler, 'configureHealthcheck handler exists');
  assert.doesNotMatch(handler[0], /window\.prompt\s*\(/);
  for (const marker of [
    'healthcheck-settings-panel', 'saveHealthcheckSettings', 'cancelHealthcheckSettings',
    'healthcheck-settings-services', 'healthcheck-settings-custom'
  ]) assert.match(page, new RegExp(marker), marker);
});

test('Healthcheck settings read canonical catalog/config fields and render persisted results', () => {
  const page = read('z2m-strategies.js');
  const api = read('z2m-api.js');
  for (const marker of [
    'services.catalogList', 'custom_domains', 'interval_min', 'consecutive_failures',
    'outage_guard', 'control_domain', 'lastRun', 'results-table'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), marker);
  assert.match(api, /catalogList/);
});

test('Healthcheck model validates bounded custom targets and keeps cancel side-effect free', () => {
  const source = fs.readFileSync(path.join(viewRoot, 'z2m-healthcheck-model.js'), 'utf8');
  const model = vm.runInNewContext(`(function () { ${source}\n })()`, { baseclass: { extend: value => value } });
  assert.deepEqual(JSON.parse(JSON.stringify(model.config({ custom_domains: ' rutracker.org\n\nhttps://example.com/path ' }).custom_domains)), [
    'rutracker.org', 'example.com'
  ]);
  assert.equal(model.validateDraft({ services: ['youtube'], custom_domains: [], interval_min: 5, consecutive_failures: 2, outage_guard: true, control_domain: 'ya.ru' }).ok, true);
  assert.equal(model.validateDraft({ services: [], custom_domains: ['not a domain'], interval_min: 5, consecutive_failures: 2, outage_guard: true, control_domain: '' }).ok, false);
  const page = read('z2m-strategies.js');
  const cancel = page.match(/function cancelHealthcheckSettings\(\)[\s\S]*?\n}\n/);
  assert.ok(cancel, 'cancel handler exists');
  assert.match(cancel[0], /renderOperationalCards\(\);/);
  assert.doesNotMatch(cancel[0], /healthcheck\.config/);
});

test('Healthcheck backend keeps validation and custom targets on the canonical path', () => {
  const ops = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc'), 'utf8');
  const jobs = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc'), 'utf8');
  for (const marker of ['normalize_custom_domains', 'interval_min', 'consecutive_failures', 'control_domain', 'outage_guard']) {
    assert.match(ops, new RegExp(marker), marker);
  }
  assert.match(ops, /health_matrix_start\(\{ services: services, custom_domains: config\.custom_domains \}\)/);
  assert.match(jobs, /custom_domains/);
  assert.match(jobs, /'custom'\s*\+/);
});

test('Healthcheck persistence creates the state directory and reports success deterministically', () => {
  const ops = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc'), 'utf8');
  const ensureDir = ops.match(/function ensure_dir\(\)[\s\S]*?\n}\n/);
  assert.ok(ensureDir, 'ensure_dir helper exists');
  assert.match(ensureDir[0], /mkdir -p/, 'existing state directories must be accepted');
  assert.match(ensureDir[0], /return\s+rc\s*==\s*0/, 'save_json must receive the mkdir result');
});

test('Healthcheck job builder has its own bounded shell escaping primitive', () => {
  const jobs = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc'), 'utf8');
  assert.match(jobs, /function shell_escape\(value\)[\s\S]*?return out \+ "'";/,
    'healthcheck job construction must not call an undeclared shell helper');
});

test('Healthcheck job responses compute elapsed time through a local helper', () => {
  const jobs = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc'), 'utf8');
  assert.match(jobs, /function elapsed_sec\(job\)[\s\S]*?\n}/,
    'public job responses must not call an undeclared elapsed-time helper');
});

test('Healthcheck job lifecycle exposes bounded log helpers', () => {
  const jobs = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc'), 'utf8');
  assert.match(jobs, /function log_tail\(id, maxBytes\)[\s\S]*?readfile\(JDIR \+ '\/' \+ id \+ '\.log'\)/,
    'healthcheck status must read a bounded job log tail');
  assert.match(jobs, /function truncate_log_text\(raw, maxBytes\)[\s\S]*?substr\(/,
    'healthcheck completion must cap persisted job logs');
});

test('Healthcheck settings never report success for a structured RPC failure', () => {
  const page = read('z2m-strategies.js');
  const handler = page.match(/function saveHealthcheckSettings\(\)[\s\S]*?\n}\n/);
  assert.ok(handler, 'saveHealthcheckSettings handler exists');
  assert.match(handler[0], /answer\s*&&\s*answer\.ok\s*===\s*false/);
  assert.match(handler[0], /throw\s+answer/);
});

test('selected Healthcheck services are never skipped because catalog presence is false', () => {
  const jobs = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc'), 'utf8');
  const classifier = jobs.match(/function classify_service\(probes\) \{[\s\S]*?\n\}/);
  assert.ok(classifier, 'health matrix classifier exists');
  assert.doesNotMatch(classifier[0], /domainsPresent\s*==\s*false[\s\S]*class:\s*'skipped'/);
  assert.match(classifier[0], /catalog presence is diagnostic only/);
});
