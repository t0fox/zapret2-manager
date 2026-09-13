import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(root, '.superpowers/sdd/2026-09-12-mega-autocircular/source-ledger.json');

const itemIds = (ledger) => new Set((ledger.items || []).map((item) => item.id));

test('Mega AutoCircular source ledger is complete and machine-readable', () => {
  assert.ok(fs.existsSync(ledgerPath), 'source ledger must be created before source mutation');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.schema, 'z2m.source-ledger.v1');
  assert.deepEqual(ledger.unaccounted, []);
  assert.deepEqual(ledger.coverage, {
    stressozzZapret2NonLegacy: '24/24',
    stressozzLegacyExcluded: '10/10',
    discordDv: '17/17',
    youtubeYv: '27/27',
    flowsealGeneralFiles: '22/22',
    bolvan50: '4/4',
    stressozzDiscordMediaScript: '1/1'
  });
  assert.deepEqual(ledger.liveEvidence.poolIdentityReconcile, {
    changed: false,
    reset: [],
    resetAllLegacy: false
  });
  assert.equal(ledger.liveEvidence.runtime.canonicalPoolCount, 26);
  assert.equal(ledger.liveEvidence.runtime.circularProfiles, 26);
  assert.equal(ledger.liveEvidence.realTrafficLearning.afterStrategy, 3);

  const ids = itemIds(ledger);
  for (const name of [
    'Discord_circular', 'discord_media', 'discord_udp', 'Youtube_UDP', 'Yv08',
    'V_circular', 'games_tcp', 'games_udp', 'Youtube_circular', 'Yv_circular',
    'Routerich_circular', 'DoH_DNS', 'DoH_TLS', 'alt11',
    'Yv01', 'Yv02', 'Yv03', 'Yv04', 'Yv05', 'Yv06', 'Yv07', 'Yv09', 'Yv10', 'Yv11'
  ]) assert.ok(ids.has(`stressozz-zapret2:${name}`), `missing Zapret2 section ${name}`);
  for (let i = 1; i <= 10; i++) assert.ok(ids.has(`stressozz-legacy:v${i}`), `missing legacy exclusion v${i}`);
  for (let i = 1; i <= 17; i++) assert.ok(ids.has(`stressozz-dv:Dv${i}`), `missing Dv${i}`);
  for (let i = 1; i <= 27; i++) assert.ok(ids.has(`stressozz-yv:Yv${String(i).padStart(2, '0')}`), `missing Yv${i}`);

  const flowseal = (ledger.flowseal || {}).files || [];
  assert.equal(flowseal.length, 22);
  assert.ok(flowseal.some((file) => file.name === 'general (ALT5).bat'));
  for (const file of flowseal) {
    const expectedBlockCount = file.name === 'general (ALT5).bat' ? 6 : 8;
    assert.equal(file.blockCount, expectedBlockCount, `${file.name} must expose every command block`);
    assert.equal(file.blocks.length, expectedBlockCount, `${file.name} block ledger is incomplete`);
    for (const block of file.blocks) {
      assert.match(block.id, new RegExp(`^flowseal:[^#]+#block-[1-${expectedBlockCount}]$`));
      assert.ok(block.status, `${block.id} needs a disposition`);
    }
  }

  const statuses = ledger.items.map((item) => item.status).concat(
    flowseal.flatMap((file) => file.blocks.map((block) => block.status))
  );
  for (const status of statuses) {
    assert.match(status, /^(present|DEDUP -> |EXCLUDED_LEGACY|NOT_STRATEGY|UNSUPPORTED_WITH_REASON)/,
      `unknown source disposition: ${status}`);
  }
  assert.equal(statuses.some((status) => status === 'IMPORTED'), false,
    'source ledger must use final dispositions, not transient import status');
  assert.ok((ledger.items || []).some((item) => item.id === 'bolvan-master:50-stun4all'));
  assert.ok((ledger.items || []).some((item) => item.id === 'bolvan-master:50-quic4all'));
  assert.ok((ledger.items || []).some((item) => item.id === 'bolvan-master:50-discord-media'));
  assert.ok((ledger.items || []).some((item) => item.id === 'bolvan-v70.5:50-discord'));
  assert.ok((ledger.items || []).some((item) => item.id === 'stressozz:50-discord_media.sh'));
});
