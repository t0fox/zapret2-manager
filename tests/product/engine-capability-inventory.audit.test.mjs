import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Task 4 — capability dependency inventory guard (audit contract).
//
// Pins the executable-truth inventory behind the three historical engine
// patch capabilities so that any drift during the stock-engine migration
// (new z2k_* tls_mod consumers appearing / consumer surface silently
// shrinking) is caught by tests instead of only router inspection.
//
// Sources scanned (repo-owned truth):
//   * packaged avatar/forgejo strategy catalogs (*.txt under
//     zapret2-manager/files/usr/share/zapret2-manager/catalog)
//   * machine-readable stressozz corpus JSON
const ROOT = path.resolve();

function walkCatalog(dir, out) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkCatalog(p, out);
    else if (/\.txt$/.test(e)) out.push(p);
  }
  return out;
}

function collect() {
  const catDir = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog');
  const files = walkCatalog(catDir, []);
  let filesScanned = 0;
  let tlsModUses = 0;
  let z2kTlsTokens = [];
  let repPlusModLines = 0;
  let circularTotal = 0;
  let circularNoHostkey = 0;
  const hostkeyVals = {};
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const text = fs.readFileSync(f, 'utf8');
    filesScanned++;
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      // any tls_mod parameter occurrence
      const mods = line.match(/tls_mod=[^:"\s']+/g) || [];
      tlsModUses += mods.length;
      // Z2K_TLS_MOD patch tokens specifically
      if (/tls_mod=[^"'=\s]*z2k_(grease|alpn|psk|keyshare|earlydata|pha|sct|delegcred)/.test(line))
        z2kTlsTokens.push(`${rel}:${i + 1}`);
      // ANTIDPI_REPEATS_LOOP executable shape: fake + repeats>1 + tls_mod on one arg line
      if (/--lua-desync=fake/.test(line) && /repeats=[2-9]|repeats=\d\d/.test(line) && /tls_mod=/.test(line))
        repPlusModLines++;
      const hk = line.match(/hostkey=([A-Za-z0-9_]+)/);
      if (hk) hostkeyVals[hk[1]] = (hostkeyVals[hk[1]] || 0) + 1;
      if (/--lua-desync=circular/.test(line)) {
        circularTotal++;
        if (!/hostkey=/.test(line)) circularNoHostkey++;
      }
    }
  }

  // machine-readable corpus requirements truth
  const corpusPath = path.join(
    ROOT,
    'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json',
  );
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const strategies = corpus.strategies || [];
  let corpusZ2kTokenUsers = 0;
  let corpusFakeRepMod = 0;
  let declaredZ2kTlsMod = 0;
  let overDeclared = 0;
  for (const st of strategies) {
    const args = (st.profiles || []).map(p => p.args || '').join(' ');
    if (/tls_mod=[^\s"']*z2k_(grease|alpn|psk|keyshare|earlydata|pha|sct|delegcred)/.test(args))
      corpusZ2kTokenUsers++;
    if (/--lua-desync=fake/.test(args) && /repeats=[2-9]|repeats=\d\d/.test(args) && /tls_mod=/.test(args))
      corpusFakeRepMod++;
    const caps = st.requirements?.engineCapabilities || [];
    if (caps.includes('Z2K_TLS_MOD')) {
      declaredZ2kTlsMod++;
      // current rule declares Z2K_TLS_MOD for ANY tls_mod usage, including
      // stock-only rnd/dupsid/sni combos. Guard the known over-declaration so
      // the requirement-based mapping rework (Task 6) can assert progress.
      if (!/tls_mod=[^"'=\s]*z2k_/.test(args)) overDeclared++;
    }
  }

  return {
    filesScanned, tlsModUses, z2kTlsTokens, repPlusModLines,
    circularTotal, circularNoHostkey, hostkeyVals,
    corpusSize: strategies.length,
    corpusZ2kTokenUsers, corpusFakeRepMod,
    declaredZ2kTlsMod, overDeclared,
  };
}

let INV;
test('inventory scan is stable', () => {
  INV = collect();
  assert.ok(INV.filesScanned >= 20, `expected substantial catalog corpus, got ${INV.filesScanned} files`);
});

test('Z2K_TLS_MOD tokens are unused across the whole packaged corpus', () => {
  INV ||= collect();
  assert.deepEqual(INV.z2kTlsTokens, [],
    'no strategy may consume z2k_* tls_mod params while producer retirement is planned');
  assert.equal(INV.corpusZ2kTokenUsers, 0, 'machine corpus must have zero z2k tls_mod users too');
});

test('ANTIDPI_REPEATS_LOOP consumer surface stays visible for migration bookkeeping', () => {
  INV ||= collect();
  // stock-token combos only; presence floors document how many sites rely on
  // repeats>1 together with tls_mod (per-attempt rotation semantics).
  assert.ok(INV.repPlusModLines >= 50, `consumer floor dropped: ${INV.repPlusModLines}`);
  assert.ok(INV.corpusFakeRepMod >= 15, `json corpus floor dropped: ${INV.corpusFakeRepMod}`);
});

test('AUTO_FAMILY_SPLIT fallback surface (circular without explicit hostkey) stays tracked', () => {
  INV ||= collect();
  assert.ok(INV.circularTotal >= 20, `circular entries floor: ${INV.circularTotal}`);
  assert.ok(INV.circularNoHostkey >= 15, `no-hostkey fallback floor: ${INV.circularNoHostkey}`);
  assert.deepEqual(Object.keys(INV.hostkeyVals).sort(), ['z2k_nohost_key'],
    'only the whitelisted nohost override should appear today; add migrations here');
});

test('Z2K_TLS_MOD requirement mapping is per-token after Task-6 rework', () => {
  INV ||= collect();
  // requirement-based compatibility: stock tokens never require the native
  // delta; only actual z2k_* token users (currently zero in every corpus)
  // may declare it.
  assert.equal(INV.overDeclared, 0, 'stock-only tls_mod strategies must not declare Z2K_TLS_MOD');
});
