import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VIEW = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(VIEW, name), 'utf8');

function loadIde() {
  const source = read('z2m-nfqws2-ide.js');
  return vm.runInNewContext(`(function () {${source}\n})()`, {
    baseclass: { extend: value => value },
    window: {},
    Event: function Event() {},
  });
}

test('IDE keeps unknown/Z2K syntax in explicit raw-only mode and round-trips byte-for-byte', () => {
  const ide = loadIde();
  const raw = '--filter-tcp=443 --hostlist=@lists/youtube.txt --lua-desync=fake:blob=fake_default_tls:z2k_future=on --z2k-new-flag=keep';
  const parsed = ide.parseProfile(raw);
  assert.equal(parsed.mode, 'raw-only');
  assert.equal(parsed.lossless, true);
  assert.equal(ide.serializeProfile(parsed), raw);
  assert.ok(parsed.unknown.some(item => item.flag === '--z2k-new-flag'));
});

test('bulk selection and merge use the new lossless IDE handler exactly once', () => {
  const page = read('z2m-strategies.js');
  assert.equal((page.match(/function mergeSelected\(\)/g) || []).length, 1,
    'a later legacy declaration must not shadow the new merge handler');
  const merge = page.match(/function mergeSelected\(\)\s*\{[\s\S]*?\n\}/)[0];
  assert.match(merge, /state\.pending\s*=\s*['"]combine['"]/);
  assert.match(merge, /strategies\.get/);
  assert.match(merge, /argsTruncated/);
  assert.match(merge, /renderEditorForm\(\)/);
  assert.doesNotMatch(page, /state\.editor\s*=\s*\{\s*mode:\s*['"]create['"],\s*strategy:\s*Model\.combineStrategies\(sources\)/);
});

test('IDE extracts structured TCP/QUIC semantics without rewriting the source text', () => {
  const ide = loadIde();
  const raw = '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --hostlist=lists/video.txt --lua-desync=fake:repeats=2';
  const parsed = ide.parseProfile(raw);
  assert.equal(parsed.mode, 'structured');
  assert.deepEqual([...parsed.fields.protocols], ['tcp']);
  assert.deepEqual([...parsed.fields.ports.tcp], ['443']);
  assert.deepEqual([...parsed.fields.hostlists], ['lists/video.txt']);
  assert.equal(parsed.fields.payloads[0], 'tls_client_hello');
  assert.equal(parsed.fields.desync[0].name, 'fake');
  assert.equal(parsed.fields.desync[0].options.repeats, '2');
  assert.equal(ide.serializeProfile(parsed), raw);

  const quic = ide.parseProfile('--filter-udp=443 --filter-l7=quic --payload=quic_initial --lua-desync=fake');
  assert.deepEqual([...quic.fields.protocols], ['quic']);
  assert.deepEqual([...quic.fields.ports.udp], ['443']);
});

test('IDE recognizes canonical desync fields and preserves autocircular/Z2K Lua semantics', () => {
  const ide = loadIde();
  const raw = '--filter-tcp=443 --filter-udp=443 --hostlist=lists/video.txt --dpi-desync=fake --dpi-desync-repeats=2 --dpi-desync-split-pos=1,midsld --lua-desync=z2k_dynamic_ttl:strategy=autocircular:hostkey=z2k_nohost_key';
  const parsed = ide.parseProfile(raw);
  assert.equal(parsed.mode, 'structured');
  assert.deepEqual([...parsed.fields.protocols], ['tcp', 'udp']);
  assert.equal(parsed.fields.desync[0].name, 'fake');
  assert.equal(parsed.fields.desync[0].options.repeats, '2');
  assert.equal(parsed.fields.desync[0].options.splits, '1,midsld');
  assert.equal(parsed.fields.z2k[0].name, 'z2k_dynamic_ttl');
  assert.equal(parsed.fields.z2k[0].options.strategy, 'autocircular');
  assert.equal(ide.serializeProfile(parsed), raw);
});

test('IDE exposes bounded diagnostics and draft request identity without a fake runtime test', () => {
  const ide = loadIde();
  const diagnostics = ide.diagnostics('--filter-tcp=bad --lua-desync=fake');
  assert.ok(diagnostics.some(item => item.path === 'fields.ports.tcp'));
  assert.ok(diagnostics.some(item => item.path === 'fields.hostlists'));

  const page = read('z2m-strategies.js');
  const api = read('z2m-api.js');
  assert.match(page, /strategy_data/);
  assert.match(page, /expectedRevision/);
  assert.match(page, /temporary|Test unavailable|Тест недоступен/i);
  assert.match(api, /strategiesPreview/);
  assert.doesNotMatch(api, /strategiesTest/);
});

test('Scanner handoff targets the existing Strategies route and preserves provenance as transient draft', () => {
  const scanner = read('z2m-scanner-hub.js');
  const page = read('z2m-strategies.js');
  assert.match(scanner, /ctx\.navigate\(['"]strategy['"]\)/);
  assert.match(scanner, /source|scan|catalog|provenance/i);
  assert.match(scanner, /Open in Strategies|Открыть.*Стратег/);
  assert.match(page, /scanner_handoff|scannerDraft|provenance/);
  assert.doesNotMatch(scanner, /scanner-orchestrator/);
});

test('Strategy IDE exposes the complete product workflow and dirty navigation guard', () => {
  const page = read('z2m-strategies.js');
  for (const marker of ['VIEW', 'CLONE', 'CREATE', 'EDIT', 'VALIDATE', 'PREVIEW', 'TEST', 'SAVE', 'APPLY'])
    assert.match(page, new RegExp(marker, 'i'), marker);
  assert.match(page, /beforeunload|unsaved|dirty|несохран/i);
  assert.match(page, /provenance|source|catalogDigest/i);
  assert.match(page, /effectiveArgv|dependencies/);
});
