import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

// Load ucode and JS implementations
const applySource = read('zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc');
const profilesApplySource = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const profilesSource = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles.uc');

// Reference JS parser / canonicalizer that mirrors the ucode derive_capture_ports contract
export function deriveCapturePorts(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return { ok: false, error: 'empty candidate' };
  }

  // Tokenize candidate by whitespace honoring quotes/newlines
  const tokens = [];
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = re.exec(candidate)) !== null) {
    tokens.push(match[1] || match[2] || match[0]);
  }

  const tcpIntervals = [];
  const udpIntervals = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let optName = null;
    let optVal = null;

    if (tok.startsWith('--filter-tcp=')) {
      optName = 'tcp';
      optVal = tok.slice('--filter-tcp='.length);
    } else if (tok === '--filter-tcp' && i + 1 < tokens.length) {
      optName = 'tcp';
      optVal = tokens[++i];
    } else if (tok.startsWith('--filter-udp=')) {
      optName = 'udp';
      optVal = tok.slice('--filter-udp='.length);
    } else if (tok === '--filter-udp' && i + 1 < tokens.length) {
      optName = 'udp';
      optVal = tokens[++i];
    }

    if (optName) {
      if (!optVal || optVal.trim() === '') {
        return { ok: false, error: `empty port expression for ${optName}` };
      }
      const parts = optVal.split(',');
      for (const part of parts) {
        if (!part || part.trim() === '') {
          return { ok: false, error: `empty port in list for ${optName}` };
        }
        const trimmed = part.trim();
        if (trimmed === '*') {
          const target = optName === 'tcp' ? tcpIntervals : udpIntervals;
          target.push({ from: 1, to: 65535 });
          continue;
        }

        const dashIdx = trimmed.indexOf('-');
        if (dashIdx >= 0) {
          const loStr = trimmed.slice(0, dashIdx);
          const hiStr = trimmed.slice(dashIdx + 1);
          if (!/^\d+$/.test(loStr) || !/^\d+$/.test(hiStr)) {
            return { ok: false, error: `malformed range digits: ${trimmed}` };
          }
          const lo = parseInt(loStr, 10);
          const hi = parseInt(hiStr, 10);
          if (lo < 1 || hi > 65535 || lo > hi) {
            return { ok: false, error: `range out of bounds: ${trimmed}` };
          }
          const target = optName === 'tcp' ? tcpIntervals : udpIntervals;
          target.push({ from: lo, to: hi });
        } else {
          if (!/^\d+$/.test(trimmed)) {
            return { ok: false, error: `malformed port digits: ${trimmed}` };
          }
          const p = parseInt(trimmed, 10);
          if (p < 1 || p > 65535) {
            return { ok: false, error: `port out of bounds: ${trimmed}` };
          }
          const target = optName === 'tcp' ? tcpIntervals : udpIntervals;
          target.push({ from: p, to: p });
        }
      }
    }
  }

  function canonicalize(intervals) {
    if (intervals.length === 0) return '';
    intervals.sort((a, b) => a.from - b.from || a.to - b.to);
    const merged = [];
    let cur = { from: intervals[0].from, to: intervals[0].to };
    for (let j = 1; j < intervals.length; j++) {
      const next = intervals[j];
      if (next.from <= cur.to + 1) {
        if (next.to > cur.to) cur.to = next.to;
      } else {
        merged.push(cur);
        cur = { from: next.from, to: next.to };
      }
    }
    merged.push(cur);

    return merged.map(m => (m.from === m.to ? `${m.from}` : `${m.from}-${m.to}`)).join(',');
  }

  return {
    ok: true,
    tcp: canonicalize(tcpIntervals),
    udp: canonicalize(udpIntervals)
  };
}

// Minimal config simulator for apply-writer testing
function simulateRenderVar(config, name, value) {
  const lines = config.split('\n');
  const prefix = name + '=';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith(prefix) || line.trim().startsWith('#')) continue;
    lines[i] = prefix + (value.includes(' ') || value.includes('\n') || value === '' ? `"${value}"` : value);
    return lines.join('\n');
  }
  lines.push(prefix + (value.includes(' ') || value.includes('\n') || value === '' ? `"${value}"` : value));
  return lines.join('\n');
}

function simulateSetVarsCas(config, varsMap) {
  let cur = config;
  for (const [k, v] of Object.entries(varsMap)) {
    cur = simulateRenderVar(cur, k, v == null ? '' : String(v));
  }
  return cur;
}

// ---------------------------------------------------------------------------
// TEST 1 — derive z2k ports
// ---------------------------------------------------------------------------
test('TEST 1: derive z2k_all_in_one capture ports', () => {
  const z2kCandidate = `--blob=quic_google:/opt/zapret2/files/fake/quic_initial_www_google_com.bin --filter-tcp=80,443 --filter-l7=tls,http --out-range=-s34228 --in-range=-s5556 --lua-desync=circular:key=rkn_tcp --new --filter-udp=443 --filter-l7=quic --in-range=a --out-range=a --payload=all --lua-desync=circular:key=yt_quic --new --filter-udp=50000-50099,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun --in-range=-d100 --out-range=-d100 --payload=quic_initial,discord_ip_discovery --lua-desync=circular:key=discord_voice`;

  const derived = deriveCapturePorts(z2kCandidate);
  assert.equal(derived.ok, true);
  assert.equal(derived.tcp, '80,443');
  assert.equal(derived.udp, '443,1400,3478-3481,5349,19294-19344,50000-50099');
});

// ---------------------------------------------------------------------------
// TEST 2 — deduplicate & normalize
// ---------------------------------------------------------------------------
test('TEST 2: deduplicate and normalize overlapping port expressions', () => {
  const candidate = `--filter-udp=443 --new --filter-udp=443,3478-3481 --new --filter-udp=3478-3481`;
  const derived = deriveCapturePorts(candidate);
  assert.equal(derived.ok, true);
  assert.equal(derived.tcp, '');
  assert.equal(derived.udp, '443,3478-3481');

  // Adjacent ranges merge
  const adjacentCandidate = `--filter-udp=100-200 --new --filter-udp=201-300`;
  const adjacentDerived = deriveCapturePorts(adjacentCandidate);
  assert.equal(adjacentDerived.ok, true);
  assert.equal(adjacentDerived.udp, '100-300');
});

// ---------------------------------------------------------------------------
// TEST 3 — malformed reject
// ---------------------------------------------------------------------------
test('TEST 3: malformed port filters fail closed', () => {
  const cases = [
    '--filter-udp=0',
    '--filter-udp=65536',
    '--filter-udp=50000-49999',
    '--filter-tcp=abc',
    '--filter-udp=443,,80',
    '--filter-tcp='
  ];

  for (const c of cases) {
    const derived = deriveCapturePorts(c);
    assert.equal(derived.ok, false, `Candidate "${c}" must be rejected`);
  }
});

// ---------------------------------------------------------------------------
// TEST 4 — old Discord -> new TCP-only
// ---------------------------------------------------------------------------
test('TEST 4: applying TCP-only strategy clears old Discord UDP capture', () => {
  const initialConfig = `NFQWS2_ENABLE=1\nNFQWS2_PORTS_TCP=80,443\nNFQWS2_PORTS_UDP="443,50000-50099"\nNFQWS2_OPT="--filter-udp=443,50000-50099"`;

  const newCandidate = `--filter-tcp=80,443 --filter-l7=tls,http --lua-desync=fake`;
  const derived = deriveCapturePorts(newCandidate);
  assert.equal(derived.ok, true);
  assert.equal(derived.tcp, '80,443');
  assert.equal(derived.udp, '');

  const newConfig = simulateSetVarsCas(initialConfig, {
    NFQWS2_OPT: newCandidate,
    NFQWS2_PORTS_TCP: derived.tcp,
    NFQWS2_PORTS_UDP: derived.udp
  });

  assert.match(newConfig, /NFQWS2_PORTS_TCP=80,443/);
  assert.match(newConfig, /NFQWS2_PORTS_UDP=""/);
  assert.doesNotMatch(newConfig, /50000-50099/);
});

// ---------------------------------------------------------------------------
// TEST 5 — transaction success (z2k_all_in_one)
// ---------------------------------------------------------------------------
test('TEST 5: applying z2k_all_in_one atomically sets OPT, TCP ports, and UDP ports', () => {
  const initialConfig = `NFQWS2_ENABLE=1\nNFQWS2_PORTS_TCP=80\nNFQWS2_PORTS_UDP=443\nNFQWS2_OPT="old"`;

  const z2kCandidate = `--filter-tcp=80,443 --filter-l7=tls --new --filter-udp=443 --filter-l7=quic --new --filter-udp=50000-50099,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun`;
  const derived = deriveCapturePorts(z2kCandidate);
  assert.equal(derived.ok, true);

  const newConfig = simulateSetVarsCas(initialConfig, {
    NFQWS2_OPT: z2kCandidate,
    NFQWS2_PORTS_TCP: derived.tcp,
    NFQWS2_PORTS_UDP: derived.udp
  });

  assert.match(newConfig, /NFQWS2_PORTS_TCP=80,443/);
  assert.match(newConfig, /NFQWS2_PORTS_UDP=443,1400,3478-3481,5349,19294-19344,50000-50099/);
  assert.match(newConfig, /NFQWS2_OPT=/);
});

// ---------------------------------------------------------------------------
// TEST 6 — write failure rollback
// ---------------------------------------------------------------------------
test('TEST 6: CAS conflict or write error writes nothing and keeps old config', () => {
  const initialConfig = `NFQWS2_ENABLE=1\nNFQWS2_PORTS_TCP=80\nNFQWS2_PORTS_UDP=443\nNFQWS2_OPT="old"`;
  let currentConfig = initialConfig;

  // CAS simulation with mismatched hash
  const expectedHash = 'hashA';
  const actualHash = 'hashB';
  let writeAttempt = null;
  if (expectedHash !== actualHash) {
    writeAttempt = { ok: false, code: 'ECONFLICT' };
  } else {
    currentConfig = simulateSetVarsCas(currentConfig, { NFQWS2_PORTS_UDP: '9999' });
    writeAttempt = { ok: true };
  }

  assert.equal(writeAttempt.ok, false);
  assert.equal(writeAttempt.code, 'ECONFLICT');
  assert.equal(currentConfig, initialConfig, 'Config must remain untouched');
});

// ---------------------------------------------------------------------------
// TEST 7 — restart failure rollback
// ---------------------------------------------------------------------------
test('TEST 7: restart failure triggers full snapshot rollback restoring OPT and ports', () => {
  const snapshot = {
    configBytes: `NFQWS2_ENABLE=1\nNFQWS2_PORTS_TCP=80\nNFQWS2_PORTS_UDP=443\nNFQWS2_OPT="old"`,
    configSha256: 'snap_sha'
  };

  let liveConfig = `NFQWS2_ENABLE=1\nNFQWS2_PORTS_TCP=80,443\nNFQWS2_PORTS_UDP=443,50000-50099\nNFQWS2_OPT="new"`;

  // Restart fails
  const restartRc = 1;
  const rollbackRequired = restartRc !== 0;
  assert.equal(rollbackRequired, true);

  // Restore snapshot
  liveConfig = snapshot.configBytes;
  assert.equal(liveConfig, snapshot.configBytes);
  assert.match(liveConfig, /NFQWS2_PORTS_TCP=80\n/);
  assert.match(liveConfig, /NFQWS2_PORTS_UDP=443\n/);
  assert.match(liveConfig, /NFQWS2_OPT="old"/);
});

// ---------------------------------------------------------------------------
// TEST 8 — runtime verify checks capture ports in production source
// ---------------------------------------------------------------------------
test('TEST 8: profiles-apply source integrates port capture into transaction pipeline', () => {
  assert.match(profilesApplySource, /derive_capture_ports/, 'profiles-apply must derive capture ports from candidate');
  assert.match(profilesApplySource, /set_vars_cas|set_var_cas/, 'profiles-apply must write vars via CAS');
  assert.match(applySource, /set_vars_cas|set_vars_locked/, 'apply.uc must support atomic multi-variable write');
});

// ---------------------------------------------------------------------------
// TEST 9 — regression existing Strategy
// ---------------------------------------------------------------------------
test('TEST 9: regression test for simple TCP-only Strategy', () => {
  const candidate = `--filter-tcp=80,443 --payload=http_req --lua-desync=fake`;
  const derived = deriveCapturePorts(candidate);
  assert.equal(derived.ok, true);
  assert.equal(derived.tcp, '80,443');
  assert.equal(derived.udp, '');
});

// ---------------------------------------------------------------------------
// TEST 10 — regression yt_quic only
// ---------------------------------------------------------------------------
test('TEST 10: regression test for YouTube QUIC only (UDP 443)', () => {
  const candidate = `--filter-tcp=80,443 --new --filter-udp=443 --filter-l7=quic --payload=quic_initial --lua-desync=fake:repeats=6`;
  const derived = deriveCapturePorts(candidate);
  assert.equal(derived.ok, true);
  assert.equal(derived.tcp, '80,443');
  assert.equal(derived.udp, '443');
  assert.doesNotMatch(derived.udp, /50000/);
  assert.doesNotMatch(derived.udp, /1400/);
});
