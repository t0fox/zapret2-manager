#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const MODULE_ROOT = path.resolve(import.meta.dirname, '..');
const UPSTREAM_ROOT = path.join(MODULE_ROOT, 'upstreams/z2k');
const STRATS_NEW2_PATH = path.join(UPSTREAM_ROOT, 'strats_new2.txt');
const QUIC_STRATS_PATH = path.join(UPSTREAM_ROOT, 'quic_strats.ini');
const CONFIG_SH_PATH = path.join(UPSTREAM_ROOT, 'lib/config_official.sh');
const TARGET_CORPUS_PATH = path.join(MODULE_ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');

export const PINNED_UPSTREAM = Object.freeze({
  upstream: 'necronicle/z2k@z2k-enhanced',
  commit: '99be613303e00d42ed027d5197f6e353995bb353',
  tag: 'r-77.2'
});

export function inferRequirements(strategyArgs) {
  const reqs = {
    engineCapabilities: [],
    luaFunctions: [],
    blobs: [],
    luaFiles: ['zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua']
  };

  // C engine flags check: tls_mod JA3 extensions require Z2K_TLS_MOD
  if (/tls_mod=/.test(strategyArgs)) {
    reqs.engineCapabilities.push('Z2K_TLS_MOD');
  }

  // Lua functions: ONLY explicit z2k Lua calls require Z2K Lua assets.
  // Note: ip_autottl and ip6_autottl are STOCK bol-van capabilities handled in zapret-antidpi.lua.
  if (/z2k_dynamic_ttl\b|fool=z2k_dynamic_ttl\b/.test(strategyArgs)) {
    reqs.luaFunctions.push('z2k_dynamic_ttl');
    reqs.luaFiles.push('z2k-fooling-ext.lua');
  }
  if (/z2k_quic_morph_v2\b/.test(strategyArgs)) {
    reqs.luaFunctions.push('z2k_quic_morph_v2');
    reqs.luaFiles.push('z2k-modern-core.lua');
  }
  if (/z2k_timing_morph\b/.test(strategyArgs)) {
    reqs.luaFunctions.push('z2k_timing_morph');
    reqs.luaFiles.push('z2k-modern-core.lua');
  }
  if (/z2k_range_rand\b/.test(strategyArgs)) {
    reqs.luaFunctions.push('z2k_range_rand');
    reqs.luaFiles.push('z2k-range-rand.lua');
  }
  if (/z2k_nohost_key\b/.test(strategyArgs)) {
    reqs.luaFunctions.push('z2k_nohost_key');
    reqs.luaFiles.push('z2k-modern-core.lua');
  }

  // Detect binary blobs (exclude inline hex literals 0x...)
  const blobMatches = strategyArgs.matchAll(/blob=([a-zA-Z0-9_]+)/g);
  for (const m of blobMatches) {
    const b = m[1];
    if (!b.startsWith('0x') && !reqs.blobs.includes(b)) {
      reqs.blobs.push(b);
    }
  }
  const seqovlMatches = strategyArgs.matchAll(/seqovl_pattern=([a-zA-Z0-9_]+)/g);
  for (const m of seqovlMatches) {
    const b = m[1];
    if (!b.startsWith('0x') && !reqs.blobs.includes(b)) {
      reqs.blobs.push(b);
    }
  }

  // Deduplicate arrays
  reqs.engineCapabilities = Array.from(new Set(reqs.engineCapabilities));
  reqs.luaFunctions = Array.from(new Set(reqs.luaFunctions));
  reqs.blobs = Array.from(new Set(reqs.blobs));
  reqs.luaFiles = Array.from(new Set(reqs.luaFiles));

  return reqs;
}

export function parsePoolFromLine(line, poolKey, filterPrefix, provenanceNote) {
  const parts = line.split(':');
  const cmd = parts.slice(1).join(':').trim();
  const desyncs = cmd.split('--lua-desync=').slice(1);
  const byNum = {};

  for (const d of desyncs) {
    const sm = d.match(/strategy=([0-9]+)/);
    if (sm) {
      const num = parseInt(sm[1], 10);
      if (!byNum[num]) byNum[num] = [];
      byNum[num].push('--lua-desync=' + d.trim());
    }
  }

  const result = [];
  const numbers = Object.keys(byNum).map(Number).sort((a, b) => a - b);
  for (const n of numbers) {
    const profileArgs = filterPrefix + ' ' + byNum[n].join(' ');
    const id = `${poolKey}_strat_${n}`;
    const name = `${poolKey.toUpperCase()} Slot ${n}`;
    const reqs = inferRequirements(profileArgs);

    result.push({
      id,
      pool: poolKey,
      slot: n,
      name,
      provenance: provenanceNote,
      profiles: [
        {
          id: `${id}_p1`,
          name: `${name} Profile`,
          args: profileArgs,
          enabled: true
        }
      ],
      requirements: reqs,
      // Safety invariant: imported strategies start unverified and non-usable until admission passes
      status: 'imported_unverified',
      usable: false
    });
  }

  return result;
}

export function buildCorpus(upstreamRoot = UPSTREAM_ROOT) {
  const stratsNew2Path = path.join(upstreamRoot, 'strats_new2.txt');
  const quicStratsPath = path.join(upstreamRoot, 'quic_strats.ini');
  const configShPath = path.join(upstreamRoot, 'lib/config_official.sh');

  const stratsNew2 = fs.readFileSync(stratsNew2Path, 'utf8');
  const quicIni = fs.readFileSync(quicStratsPath, 'utf8');
  const configSh = fs.readFileSync(configShPath, 'utf8');

  const corpus = {
    schema: 'zapret2-manager.strategy-corpus.v2',
    provenance: {
      ...PINNED_UPSTREAM,
      parsedAt: new Date().toISOString()
    },
    pools: {},
    totalStrategies: 0,
    strategies: []
  };

  // 1. RKN TCP (50 strats from strats_new2.txt)
  const rknLine = stratsNew2.split('\n').find(l => l.startsWith('manual_autocircular_rkn'));
  if (rknLine) {
    const rknStrats = parsePoolFromLine(rknLine, 'rkn_tcp', '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello', 'strats_new2.txt:manual_autocircular_rkn');
    corpus.pools.rkn_tcp = { name: 'RKN TCP Pool', count: rknStrats.length, strategies: rknStrats.map(s => s.id) };
    corpus.strategies.push(...rknStrats);
  }

  // 2. YT TCP (22 strats from strats_new2.txt)
  const ytLine = stratsNew2.split('\n').find(l => l.startsWith('manual_autocircular_yt'));
  if (ytLine) {
    const ytStrats = parsePoolFromLine(ytLine, 'yt_tcp', '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello', 'strats_new2.txt:manual_autocircular_yt');
    corpus.pools.yt_tcp = { name: 'YouTube TCP Pool', count: ytStrats.length, strategies: ytStrats.map(s => s.id) };
    corpus.strategies.push(...ytStrats);
  }

  // 3. GV TCP (22 strats from strats_new2.txt)
  const gvLine = stratsNew2.split('\n').find(l => l.startsWith('manual_autocircular_gv'));
  if (gvLine) {
    const gvStrats = parsePoolFromLine(gvLine, 'gv_tcp', '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello', 'strats_new2.txt:manual_autocircular_gv');
    corpus.pools.gv_tcp = { name: 'GoogleVideo TCP Pool', count: gvStrats.length, strategies: gvStrats.map(s => s.id) };
    corpus.strategies.push(...gvStrats);
  }

  // 4. YT QUIC Runtime (9 strats from quic_strats.ini [yt_quic_autocircular])
  const ytQuicLine = quicIni.split('\n').find(l => l.startsWith('args=--in-range=a'));
  if (ytQuicLine) {
    const ytQuicRaw = ytQuicLine.slice(5);
    const ytQuicStrats = parsePoolFromLine('yt_quic:' + ytQuicRaw, 'yt_quic', '--filter-udp=443 --filter-l7=quic --payload=quic_initial', 'quic_strats.ini:yt_quic_autocircular');
    corpus.pools.yt_quic = { name: 'YouTube QUIC Runtime Pool', count: ytQuicStrats.length, strategies: ytQuicStrats.map(s => s.id) };
    corpus.strategies.push(...ytQuicStrats);
  }

  // 5. YT QUIC Cold-Start Fallback (13 strats from config_official.sh:quic_udp)
  const quicUdpLine = configSh.split('\n').find(l => l.includes('quic_udp="--filter-udp=443'));
  if (quicUdpLine) {
    const quicRaw = quicUdpLine.substring(quicUdpLine.indexOf('quic_udp="') + 10, quicUdpLine.lastIndexOf('"'));
    const quicFallbackStrats = parsePoolFromLine('yt_quic_fallback:' + quicRaw, 'yt_quic_fallback', '--filter-udp=443 --filter-l7=quic --payload=quic_initial', 'config_official.sh:quic_udp_cold_start');
    corpus.pools.yt_quic_fallback = { name: 'YouTube QUIC Cold-Start Fallback Pool', count: quicFallbackStrats.length, strategies: quicFallbackStrats.map(s => s.id) };
    corpus.strategies.push(...quicFallbackStrats);
  }

  // 6. Discord Voice (12 strats from quic_strats.ini:discord_voice_autocircular)
  const discordLine = quicIni.split('\n').find(l => l.startsWith('args=--filter-udp=50000-50099'));
  if (discordLine) {
    const discordRaw = discordLine.slice(5);
    const discordStrats = parsePoolFromLine('discord_voice:' + discordRaw, 'discord_voice', '--filter-udp=50000-50099,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun --payload=quic_initial,discord_ip_discovery', 'quic_strats.ini:discord_voice_autocircular');
    corpus.pools.discord_voice = { name: 'Discord Voice STUN Pool', count: discordStrats.length, strategies: discordStrats.map(s => s.id) };
    corpus.strategies.push(...discordStrats);
  }

  corpus.totalStrategies = corpus.strategies.length;
  return corpus;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const corpus = buildCorpus();
  fs.writeFileSync(TARGET_CORPUS_PATH, JSON.stringify(corpus, null, 2) + '\n');
  console.log(`Successfully built corpus: ${corpus.totalStrategies} strategies across ${Object.keys(corpus.pools).length} pools.`);
  for (const [pk, pool] of Object.entries(corpus.pools)) {
    console.log(`  - ${pk}: ${pool.count} strategies (${pool.name})`);
  }
}
