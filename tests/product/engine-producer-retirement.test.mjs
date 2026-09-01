import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Producer-retirement authority contract:
//   * official bol-van releases are the ONLY normal Engine install/update
//     candidates — catalog, checked-candidate loader and worker admit
//     nothing else;
//   * the manager-built z2m-compatible Engine producer has no remaining
//     production/reachability surface (scripts, patches, CI, manifest
//     tooling, integration identity file all removed);
//   * historical r77-z2m-* state stays readable through normalize_state_record
//     but can never become an upstream release or an installable candidate.
//
// Needle-absence scans deliberately exclude documentation/evidence trees so
// that history remains auditable while production paths stay clean.

const ROOT = path.resolve();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CATALOG = 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc';
const WORKER = 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh';

test('catalog no longer consumes the t0fox compatibility feed', () => {
	const src = read(CATALOG);
	assert.doesNotMatch(src, /t0fox\/zapret2-manager\/releases\/download/,
		'compat feed URL must be gone');
	assert.doesNotMatch(src, /Z2M_RELEASES_API|Z2M_RELEASE_URL_PREFIX/,
		'feed consts retired');
	assert.doesNotMatch(src, /z2m_compatible_candidate|z2m_compatible_records|z2m_records_from_payload/,
		'compat candidate machinery retired');
	assert.doesNotMatch(src, /integration_identity|manifest_matches_integration/,
		'pinned producer identity machinery retired');
});

test('checked-candidate loader and worker accept official stock releases only', () => {
	const cat = read(CATALOG);
	assert.match(cat,
		/if \(\(record\.candidate\.artifactKind != VANILLA_ARTIFACT\) \|\| record\.candidate\.schema != ENGINE_ARTIFACT_SCHEMA \|\| record\.candidate\.compatible !== true\)/);
	const worker = read(WORKER);
	assert.doesNotMatch(worker, /z2m-compatible-engine/, 'legacy kind gate is gone');
	assert.match(worker, /\[ "\$ARTIFACT_KIND" = 'vanilla-bol-van-release' \]/);
	const urlIdx = worker.indexOf('https://github.com/bol-van/zapret2/releases/download/v*');
	assert.ok(urlIdx > -1, 'bol-van allowlist case present');
	assert.equal(worker.indexOf('t0fox'), -1, 'no compat download URLs remain');
	// admission gate must fire BEFORE any download/mutation phase
	const gateIdx = worker.indexOf('EENGINE_INTEGRATION_REQUIRED');
	const dlIdx = worker.indexOf('phase downloading 28');
	assert.ok(gateIdx > -1 && dlIdx > -1 && gateIdx < dlIdx,
		'rejected kinds never reach the download phase');
});

test('producer implementation surfaces are physically deleted', () => {
	for (const gone of [
		'scripts/engine/build-compatible-engine.sh',
		'scripts/engine/write-manifest.mjs',
		'scripts/engine/validate-engine-manifest.mjs',
		'scripts/engine/acceptance-router.sh',
		'.github/workflows/engine-build.yml',
		'patches/engine/001-z2k-tls-mod.patch',
		'patches/engine/002-z2k-antidpi-repeats-loop.patch',
		'patches/engine/003-z2k-auto-family-split.patch',
		'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json',
	]) {
		assert.equal(fs.existsSync(path.join(ROOT, gone)), false, `${gone} must not exist`);
	}
});

test('the repository has no workflow surface for the retired producer', () => {
	assert.equal(fs.existsSync(path.join(ROOT, '.github/workflows/engine-build.yml')), false);
});

function walk(dir, skip) {
	const out = [];
	for (const e of fs.readdirSync(dir)) {
		if (skip.some(s => e === s)) continue;
		const p = path.join(dir, e);
		let st;
		try { st = fs.statSync(p); } catch { continue; }
		if (st.isDirectory()) out.push(...walk(p, skip));
		else out.push(p);
	}
	return out;
}

test('repo-wide reachability sweep: producer needles exist only in docs/evidence/self', () => {
	const needles = [
		'z2m-compatible-engine',
		'build-compatible-engine',
		'validate-engine-manifest.mjs',
		'write-manifest.mjs',
	];
	const roots = ['zapret2-manager/files', 'luci-app-zapret2-manager/files', 'tests', '.github', 'scripts', 'tools', 'lib', 'src', 'usr'];
	const SKIP_DIRS = new Set(['node_modules', '.git']);
	const offenders = [];
	for (const base of roots) {
		const abs = path.join(ROOT, base);
		if (!fs.existsSync(abs)) continue;
		for (const f of walk(abs, [...SKIP_DIRS])) {
			if (!/\.(uc|mjs|js|sh|json|jsonc)$/.test(f)) continue;
			if (f.includes('engine-producer-retirement.test.mjs') || f.includes('engine-stock-authority.test.mjs')) continue; // this file pins the absence
			let text = '';
			try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
			for (const n of needles)
				if (text.includes(n))
					offenders.push(`${path.relative(ROOT, f)} :: ${n}`);
		}
	}
	assert.deepEqual(offenders, [], `production-reachable producer references found:\n${offenders.join('\n')}`);
});
