import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCorpus, parsePoolFromLine } from '../../tools/z2k-corpus-importer.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const upstreamRoot = path.join(root, 'upstreams/z2k');
const stratsNew2Path = path.join(upstreamRoot, 'strats_new2.txt');
const quicStratsPath = path.join(upstreamRoot, 'quic_strats.ini');
const configShPath = path.join(upstreamRoot, 'lib/config_official.sh');

test('minimal CI upstream stubs exist and are readable', () => {
  for (const p of [stratsNew2Path, quicStratsPath, configShPath]) {
    assert.ok(fs.existsSync(p), `${p} must exist`);
    assert.doesNotThrow(() => fs.readFileSync(p, 'utf8'), `${p} must be readable`);
  }
});

test('strats_new2.txt CI stub exposes the three manual_autocircular pool markers read by the importer', () => {
  const content = fs.readFileSync(stratsNew2Path, 'utf8');
  const lines = content.split('\n');
  assert.ok(lines.some((l) => l.startsWith('manual_autocircular_rkn')), 'rkn marker must be present');
  assert.ok(lines.some((l) => l.startsWith('manual_autocircular_yt')), 'yt marker must be present');
  assert.ok(lines.some((l) => l.startsWith('manual_autocircular_gv')), 'gv marker must be present');
});

test('quic_strats.ini CI stub defines the yt_quic_autocircular and discord_voice_autocircular sections', () => {
  const content = fs.readFileSync(quicStratsPath, 'utf8');
  assert.match(content, /\[yt_quic_autocircular\]/);
  assert.match(content, /\[discord_voice_autocircular\]/);
});

test('config_official.sh CI stub is a minimal readable placeholder, not the real upstream config', () => {
  const content = fs.readFileSync(configShPath, 'utf8');
  assert.match(content, /^#!\/bin\/sh/);
  assert.match(content, /stub/i);
  // The real upstream defines a quic_udp="--filter-udp=443..." assignment consumed by the
  // importer's cold-start fallback pool; the CI stub intentionally omits it.
  assert.doesNotMatch(content, /quic_udp="--filter-udp=443/);
});

test('buildCorpus against the minimal CI stubs produces empty TCP pools without throwing', () => {
  const corpus = buildCorpus(upstreamRoot);

  assert.equal(corpus.schema, 'zapret2-manager.strategy-corpus.v2');
  assert.deepEqual(Object.keys(corpus.pools).sort(), ['gv_tcp', 'rkn_tcp', 'yt_tcp']);

  for (const poolKey of ['rkn_tcp', 'yt_tcp', 'gv_tcp']) {
    assert.equal(corpus.pools[poolKey].count, 0, `${poolKey} must be empty because the stub line has no --lua-desync= slots`);
    assert.deepEqual(corpus.pools[poolKey].strategies, []);
  }

  assert.equal(corpus.totalStrategies, 0);
  assert.deepEqual(corpus.strategies, []);
});

test('buildCorpus against the minimal CI stubs does not synthesize QUIC or Discord pools', () => {
  const corpus = buildCorpus(upstreamRoot);
  // The stub quic_strats.ini/config_official.sh intentionally lack the specific
  // "args=--in-range=a...", "args=--filter-udp=50000-50099..." and
  // 'quic_udp="--filter-udp=443...' markers the importer looks for, so these
  // pools must be entirely absent rather than present-but-empty.
  assert.equal(corpus.pools.yt_quic, undefined);
  assert.equal(corpus.pools.yt_quic_fallback, undefined);
  assert.equal(corpus.pools.discord_voice, undefined);
});

test('parsePoolFromLine returns no strategies for a stub manual_autocircular line lacking --lua-desync= slots', () => {
  const stratsNew2 = fs.readFileSync(stratsNew2Path, 'utf8');
  const rknLine = stratsNew2.split('\n').find((l) => l.startsWith('manual_autocircular_rkn'));
  assert.ok(rknLine, 'stub must contain an rkn line');
  const result = parsePoolFromLine(rknLine, 'rkn_tcp', '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello', 'strats_new2.txt:manual_autocircular_rkn');
  assert.deepEqual(result, []);
});

test('buildCorpus is stable and reproducible across repeated calls against the same CI stubs', () => {
  const first = buildCorpus(upstreamRoot);
  const second = buildCorpus(upstreamRoot);
  assert.equal(first.totalStrategies, second.totalStrategies);
  assert.deepEqual(Object.keys(first.pools).sort(), Object.keys(second.pools).sort());
  assert.deepEqual(first.strategies, second.strategies);
});