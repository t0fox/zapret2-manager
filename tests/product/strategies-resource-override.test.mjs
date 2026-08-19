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

test('UX: strategyOptionsForPool returns human readable labels while preserving runtime integer index values', () => {
  const Model = loadModel();
  const pools = {
    yt_quic: {
      key: 'yt_quic',
      protocol: 'QUIC',
      size: 3,
      strategies: [
        { index: 1, name: 'Default v2 (circular)' },
        { index: 2, name: 'Fake QUIC' },
        { index: 3, name: 'UDP Length Mod' }
      ]
    }
  };

  const options = Model.strategyOptionsForPool('yt_quic', '2', pools);
  assert.equal(options.length, 3);

  // Check Option 1
  assert.equal(options[0].value, '1');
  assert.equal(options[0].label, '1 — Default v2 (circular)');
  assert.equal(options[0].selected, false);

  // Check Option 2 (selected)
  assert.equal(options[1].value, '2');
  assert.equal(options[1].label, '2 — Fake QUIC');
  assert.equal(options[1].selected, true);

  // Runtime identity preserved
  assert.strictEqual(typeof options[1].value, 'string');
  assert.equal(options[1].value, '2');
});

test('UX: strategyOptionsForPool fallback label when strategy has no metadata name', () => {
  const Model = loadModel();
  const pools = {
    custom_test_pool: {
      key: 'custom_test_pool',
      protocol: 'TLS',
      size: 5,
      strategies: [
        { index: 1, name: 'Fake TLS (MD5)' }
        // indexes 2..5 have no explicit name
      ]
    }
  };

  const options = Model.strategyOptionsForPool('custom_test_pool', '5', pools);
  assert.equal(options.length, 5);

  assert.equal(options[0].value, '1');
  assert.equal(options[0].label, '1 — Fake TLS (MD5)');

  // Index 5 fallback
  assert.equal(options[4].value, '5');
  assert.equal(options[4].label, '5 — Стратегия #5');
  assert.equal(options[4].selected, true);
});

test('UX: strategyOptionsForPool handles invalid / out-of-bounds current index without silently remapping', () => {
  const Model = loadModel();
  const pools = {
    yt_quic: {
      key: 'yt_quic',
      protocol: 'QUIC',
      size: 4,
      strategies: [
        { index: 1, name: 'Fake QUIC 1' },
        { index: 2, name: 'Fake QUIC 2' },
        { index: 3, name: 'Fake QUIC 3' },
        { index: 4, name: 'Fake QUIC 4' }
      ]
    }
  };

  // Current persisted index is 9 (not in 1..4)
  const options = Model.strategyOptionsForPool('yt_quic', '9', pools);
  assert.equal(options.length, 5); // 4 normal + 1 unknown

  const unknownOpt = options.find(o => o.value === '9');
  assert.ok(unknownOpt, 'Must include option for out-of-bounds index 9');
  assert.equal(unknownOpt.value, '9');
  assert.equal(unknownOpt.selected, true);
  assert.ok(unknownOpt.label.includes('Неизвестная стратегия #9') || unknownOpt.label.includes('9 — Неизвестная стратегия #9'));
});

test('UX: modeBadge provides explicit accessible badges for auto and frozen states', () => {
  const Model = loadModel();

  const autoBadge = Model.modeBadge('auto');
  assert.equal(autoBadge.mode, 'auto');
  assert.equal(autoBadge.isFrozen, false);
  assert.equal(autoBadge.label, 'Авто');
  assert.equal(autoBadge.icon, 'unlock');
  assert.ok(autoBadge.tooltip.includes('autocircular'));
  assert.equal(autoBadge.ariaLabel, 'Зафиксировать текущую стратегию');

  const frozenBadge = Model.modeBadge('frozen');
  assert.equal(frozenBadge.mode, 'frozen');
  assert.equal(frozenBadge.isFrozen, true);
  assert.equal(frozenBadge.label, 'Зафиксировано');
  assert.equal(frozenBadge.icon, 'lock');
  assert.ok(frozenBadge.tooltip.includes('зафиксирована'));
  assert.equal(frozenBadge.ariaLabel, 'Вернуть автоматический режим');
});

test('UX: resolveStrategyName resolves real strategy name and handles aliases', () => {
  const Model = loadModel();
  const pools = {
    circular_1_1: {
      key: 'circular_1_1',
      protocol: 'TLS',
      size: 3,
      strategies: [
        { index: 1, name: 'Fake TLS (MD5)' },
        { index: 2, name: 'Multidisorder (midsld) + Fake (Dynamic TTL)' },
        { index: 3, name: 'Multisplit (SeqOvl) + Multisplit (host)' }
      ]
    },
    yt_quic: {
      key: 'yt_quic',
      protocol: 'QUIC',
      size: 2,
      strategies: [
        { index: 1, name: 'Fake QUIC (google x11)' },
        { index: 2, name: 'Fake QUIC (google x8)' }
      ]
    }
  };

  assert.equal(Model.resolveStrategyName('circular_1_1', 1, pools), 'Fake TLS (MD5)');
  assert.equal(Model.resolveStrategyName('circular_1_1', 2, pools), 'Multidisorder (midsld) + Fake (Dynamic TTL)');
  // Alias lookup
  assert.equal(Model.resolveStrategyName('default', 1, pools), 'Fake TLS (MD5)');
  assert.equal(Model.resolveStrategyName('rkn_tcp', 3, pools), 'Multisplit (SeqOvl) + Multisplit (host)');
  assert.equal(Model.resolveStrategyName('yt_quic', 1, pools), 'Fake QUIC (google x11)');

  // Out of bounds fallback
  assert.equal(Model.resolveStrategyName('circular_1_1', 99, pools), 'Стратегия #99');
});

test('UX: No all-fallback regression on known named pools', () => {
  const Model = loadModel();
  const pools = {
    circular_1_1: {
      key: 'circular_1_1',
      protocol: 'TLS',
      size: 6,
      strategies: [
        { index: 1, name: 'Fake TLS (MD5)' },
        { index: 2, name: 'Multidisorder (midsld) + Fake (Dynamic TTL)' },
        { index: 3, name: 'Multisplit (SeqOvl) + Multisplit (host)' },
        { index: 4, name: 'Fake (Dynamic TTL) + Multidisorder (host)' },
        { index: 5, name: 'Fake TLS + Multisplit (midsld)' },
        { index: 6, name: 'Multisplit (host)' }
      ]
    }
  };

  const options = Model.strategyOptionsForPool('circular_1_1', 1, pools);
  assert.equal(options.length, 6);
  const genericFallbacks = options.filter(o => o.label.includes('Strategy #') || o.name.startsWith('Strategy #'));
  assert.equal(genericFallbacks.length, 0, 'Known named pool must have ZERO generic Strategy #N fallbacks');
});

test('API contract: z2m-api.js declares strategiesStateSet and strategiesPools and maps to strategies object', () => {
  const apiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  const apiCode = fs.readFileSync(apiPath, 'utf8');

  assert.match(apiCode, /calls\.strategiesStateSet\s*=\s*rpc\.declare/);
  assert.match(apiCode, /method:\s*'strategies_state_set'/);
  assert.match(apiCode, /calls\.strategiesPools\s*=\s*rpc\.declare/);
  assert.match(apiCode, /method:\s*'strategies_pools'/);
  assert.match(apiCode, /stateSet:\s*calls\.strategiesStateSet/);
  assert.match(apiCode, /pools:\s*calls\.strategiesPools/);
});

test('Integration: Real production router RPC payload resolves exact strategy names and modes', () => {
  const Model = loadModel();
  const routerPoolsPayload = {
    circular_1_1: {
      key: 'circular_1_1',
      protocol: 'TLS',
      size: 6,
      strategies: [
        { index: 1, name: 'Fake TLS (MD5)' },
        { index: 2, name: 'Multidisorder (midsld) + Fake (Dynamic TTL)' },
        { index: 3, name: 'Multisplit (SeqOvl) + Multisplit (host)' },
        { index: 4, name: 'Fake (Dynamic TTL) + Multidisorder (host)' },
        { index: 5, name: 'Fake TLS + Multisplit (midsld)' },
        { index: 6, name: 'Multisplit (host)' }
      ]
    },
    yt_quic: {
      key: 'yt_quic',
      protocol: 'QUIC',
      size: 9,
      strategies: [
        { index: 1, name: 'Fake QUIC (google x11)' },
        { index: 2, name: 'Fake QUIC (google x8)' },
        { index: 3, name: 'Fake QUIC (google x6)' },
        { index: 4, name: 'Fake QUIC (x3) + IPFrag' },
        { index: 5, name: 'UDPLen (+4) + Fake QUIC (x2)' },
        { index: 6, name: 'UDPLen (+8) + Fake QUIC (x2)' },
        { index: 7, name: 'UDPLen (+25) + Fake QUIC (x2)' },
        { index: 8, name: 'Fake QUIC (x6)' },
        { index: 9, name: 'UDPLen (+8) + Fake QUIC (x2)' }
      ]
    },
    discord_voice: {
      key: 'discord_voice',
      protocol: 'QUIC',
      size: 12,
      strategies: [
        { index: 1, name: 'QUIC Morph v2' },
        { index: 2, name: 'Timing Morph + Fake QUIC (x2) + IPFrag' },
        { index: 3, name: 'QUIC Morph (p2)' },
        { index: 4, name: 'Fake (Dynamic TTL)' },
        { index: 5, name: 'Fake (Dynamic TTL)' },
        { index: 6, name: 'Fake (Dynamic TTL)' },
        { index: 7, name: 'Fake (Dynamic TTL)' },
        { index: 8, name: 'IPFrag' },
        { index: 9, name: 'UDPLen (+4) + Fake QUIC (x2)' },
        { index: 10, name: 'UDPLen (+8) + Fake QUIC (x2)' },
        { index: 11, name: 'Fake QUIC (x2) + IPFrag' },
        { index: 12, name: 'Fake QUIC (x3)' }
      ]
    }
  };

  const routerStateRow = {
    key: 'circular_1_1',
    host: 'kws4.pclead.co.uk',
    strategy: '1',
    ts: '1787143957',
    mode: 'frozen'
  };

  const humanized = Model.humanizeLearnedEntry(routerStateRow);
  assert.equal(humanized.host, 'kws4.pclead.co.uk');
  assert.equal(humanized.protocol, 'TLS');
  assert.equal(humanized.strategy, '1');
  assert.equal(humanized.mode, 'frozen');
  assert.equal(humanized.frozen, true);

  const stratName = Model.resolveStrategyName(routerStateRow.key, routerStateRow.strategy, routerPoolsPayload);
  assert.equal(stratName, 'Fake TLS (MD5)');

  const badge = Model.modeBadge(routerStateRow.mode);
  assert.equal(badge.label, 'Зафиксировано');
  assert.equal(badge.icon, 'lock');
  assert.equal(badge.isFrozen, true);

  const pickerOptions = Model.strategyOptionsForPool(routerStateRow.key, routerStateRow.strategy, routerPoolsPayload);
  assert.equal(pickerOptions.length, 6);
  assert.equal(pickerOptions[0].name, 'Fake TLS (MD5)');
  assert.equal(pickerOptions[0].selected, true);
  assert.equal(pickerOptions[1].name, 'Multidisorder (midsld) + Fake (Dynamic TTL)');
  assert.equal(pickerOptions[1].selected, false);
});

test('Regression: Runtime strategy names vs parent catalog name substitution', () => {
  const Model = loadModel();

  // Test 1: circular_1_1 #1 -> Fake TLS (MD5), even with empty pools object
  assert.equal(Model.resolveStrategyName('circular_1_1', 1, {}), 'Fake TLS (MD5)');
  assert.notEqual(Model.resolveStrategyName('circular_1_1', 1, {}), 'Default v2 (circular)');

  // Test 2: circular_1_1 picker contains exactly 6 options
  const tlsOptions = Model.strategyOptionsForPool('circular_1_1', 1, {});
  assert.equal(tlsOptions.length, 6);
  assert.equal(tlsOptions[0].name, 'Fake TLS (MD5)');
  assert.equal(tlsOptions[5].name, 'Multisplit (host)');
  assert.equal(Model.resolveStrategyName('circular_1_1', 6, {}), 'Multisplit (host)');

  // Test 3: yt_quic #1 -> Fake QUIC (google x11), picker contains exactly 9 options
  assert.equal(Model.resolveStrategyName('yt_quic', 1, {}), 'Fake QUIC (google x11)');
  assert.notEqual(Model.resolveStrategyName('yt_quic', 1, {}), 'Default v2 (circular)');
  const quicOptions = Model.strategyOptionsForPool('yt_quic', 1, {});
  assert.equal(quicOptions.length, 9);
  assert.equal(quicOptions[0].name, 'Fake QUIC (google x11)');
  assert.equal(quicOptions[8].name, 'UDPLen (+8) + Fake QUIC (x2)');

  // Test 4: discord_voice picker contains exactly 12 options
  const voiceOptions = Model.strategyOptionsForPool('discord_voice', 1, {});
  assert.equal(voiceOptions.length, 12);
  assert.equal(voiceOptions[0].name, 'QUIC Morph v2');

  // Test 5: TLS and QUIC names do not cross contaminate
  assert.notEqual(Model.resolveStrategyName('circular_1_1', 1, {}), Model.resolveStrategyName('yt_quic', 1, {}));

  // Test 6: Zero options in any pool have parent catalog name 'Default v2 (circular)'
  const allGenerated = [...tlsOptions, ...quicOptions, ...voiceOptions];
  for (const opt of allGenerated) {
    assert.notEqual(opt.name, 'Default v2 (circular)', `Option ${opt.value} in pool must not be named Default v2 (circular)`);
  }
});
