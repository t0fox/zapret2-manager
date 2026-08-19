import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');

function loadModel() {
  assert.ok(fs.existsSync(modelPath), 'Strategies model must exist');
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

test('5-column state.tsv parsing & model representation', () => {
  const Model = loadModel();
  // Test auto mode
  const entryAuto = {
    key: 'rkn_tcp',
    host: 'discord.com',
    strategy: '1',
    ts: '1787133684',
    mode: 'auto'
  };
  const humanAuto = Model.humanizeLearnedEntry(entryAuto);
  assert.equal(humanAuto.host, 'discord.com');
  assert.equal(humanAuto.protocol, 'TLS');
  assert.equal(humanAuto.strategy, '1');
  assert.equal(humanAuto.mode, 'auto');
  assert.equal(humanAuto.frozen, false);

  // Test frozen mode
  const entryFrozen = {
    key: 'yt_quic',
    host: 'discord.com',
    strategy: '3',
    ts: '1787133685',
    mode: 'frozen'
  };
  const humanFrozen = Model.humanizeLearnedEntry(entryFrozen);
  assert.equal(humanFrozen.host, 'discord.com');
  assert.equal(humanFrozen.protocol, 'QUIC');
  assert.equal(humanFrozen.strategy, '3');
  assert.equal(humanFrozen.mode, 'frozen');
  assert.equal(humanFrozen.frozen, true);
});

test('backward compatibility: legacy 4-column state.tsv defaults to auto mode', () => {
  const Model = loadModel();
  const legacyEntry = {
    key: 'rkn_tcp',
    host: 'example.com',
    strategy: '2',
    ts: '1787133600'
    // mode omitted
  };
  const humanLegacy = Model.humanizeLearnedEntry(legacyEntry);
  assert.equal(humanLegacy.mode, 'auto');
  assert.equal(humanLegacy.frozen, false);
});

test('protocol isolation: TLS and QUIC pools on same domain remain distinct keys', () => {
  const Model = loadModel();
  const tlsEntry = Model.humanizeLearnedEntry({
    key: 'rkn_tcp',
    host: 'discord.com',
    strategy: '1',
    ts: '1787133684',
    mode: 'auto'
  });
  const quicEntry = Model.humanizeLearnedEntry({
    key: 'yt_quic',
    host: 'discord.com',
    strategy: '3',
    ts: '1787133685',
    mode: 'frozen'
  });

  assert.equal(tlsEntry.key, 'rkn_tcp');
  assert.equal(tlsEntry.protocol, 'TLS');
  assert.equal(tlsEntry.frozen, false);

  assert.equal(quicEntry.key, 'yt_quic');
  assert.equal(quicEntry.protocol, 'QUIC');
  assert.equal(quicEntry.frozen, true);

  assert.notEqual(tlsEntry.key, quicEntry.key);
  assert.notEqual(tlsEntry.mode, quicEntry.mode);
});

test('domain isolation: parent domain and subdomains remain distinct entries', () => {
  const Model = loadModel();
  const parent = Model.humanizeLearnedEntry({
    key: 'rkn_tcp',
    host: 'discord.com',
    strategy: '2',
    ts: '1787133684',
    mode: 'frozen'
  });
  const cdn = Model.humanizeLearnedEntry({
    key: 'rkn_tcp',
    host: 'cdn.discordapp.com',
    strategy: '1',
    ts: '1787133684',
    mode: 'auto'
  });

  assert.equal(parent.host, 'discord.com');
  assert.equal(parent.frozen, true);

  assert.equal(cdn.host, 'cdn.discordapp.com');
  assert.equal(cdn.frozen, false);
});

test('state.tsv TSV serialization and parsing logic', () => {
  const rows = [
    { key: 'rkn_tcp', host: 'discord.com', strategy: '2', ts: '1787133684', mode: 'frozen' },
    { key: 'yt_quic', host: 'discord.com', strategy: '3', ts: '1787133685', mode: 'auto' },
    { key: 'discord_udp', host: 'nohost', strategy: '4', ts: '1787133686', mode: 'frozen' }
  ];

  // Serialize to 5-column TSV
  const lines = [
    '# z2k autocircular state (persisted circular nstrategy)',
    '# key\thost\tstrategy\tts\tmode',
    ...rows.map(r => `${r.key}\t${r.host}\t${r.strategy}\t${r.ts}\t${r.mode}`)
  ];
  const tsvText = lines.join('\n') + '\n';

  // Parse back
  const parsedRows = [];
  for (const line of tsvText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.length || trimmed.startsWith('#')) continue;
    const fields = trimmed.split('\t');
    if (fields.length < 3) continue;
    const mode = (fields.length > 4 && fields[4].trim().length) ? fields[4].trim() : 'auto';
    parsedRows.push({
      key: fields[0],
      host: fields[1],
      strategy: fields[2],
      ts: fields[3] || '',
      mode: mode === 'frozen' ? 'frozen' : 'auto'
    });
  }

  assert.equal(parsedRows.length, 3);
  assert.deepEqual(parsedRows[0], rows[0]);
  assert.deepEqual(parsedRows[1], rows[1]);
  assert.deepEqual(parsedRows[2], rows[2]);
});
