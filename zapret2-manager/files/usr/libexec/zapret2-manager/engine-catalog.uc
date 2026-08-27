'use strict';
import { private_tempfile } from './core/private-temp.uc';
import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';

const CHECK_DIR = '/tmp/zapret2-manager/engine-checks';
const STATE_FILE = '/etc/zapret2-manager/engine-state.json';
const CACHE = '/etc/zapret2-manager/engine-cache';
// The root override is only used by the host regression harness. Production
// state remains fixed at STATE_FILE below.
const MANAGER_ROOT = getenv('Z2M_ENGINE_TEST_ROOT') || '/etc/zapret2-manager';
const RELEASE_CACHE = CACHE + '/release-catalog.json';
const RELEASE_CACHE_TTL = 600;
const API_URL = 'https://api.github.com/repos/bol-van/zapret2/releases?per_page=20';
const UPSTREAM = 'bol-van/zapret2';
const ENGINE_ARTIFACT_SCHEMA = 'zapret2-manager.engine-artifact.v1';
const VANILLA_ARTIFACT = 'vanilla-bol-van-release';
const CHECK_TTL = 600;
const MAX_METADATA = 4194304;
const MAX_ASSET_SIZE = 33554432;
const ARCHES = ['aarch64_cortex-a53','aarch64_cortex-a72','aarch64_cortex-a76','aarch64_generic','arm_arm1176jzf-s_vfp','arm_arm926ej-s','arm_cortex-a15_neon-vfpv4','arm_cortex-a5','arm_cortex-a5_vfpv4','arm_cortex-a7','arm_cortex-a7_neon-vfpv4','arm_cortex-a7_vfpv4','arm_cortex-a8','arm_cortex-a8_vfpv3','arm_cortex-a9','arm_cortex-a9_neon','arm_cortex-a9_vfpv3-d16','arm_fa526','arm_mpcore','arm_xscale','i386_pentium-mmx','i386_pentium4','mips64_octeonplus','mips_24kc','mips_4kec','mips_mips32','mipsel_24kc','mipsel_24kc_24kf','mipsel_74kc','mipsel_mips32','powerpc_464fp','powerpc_8540','riscv64_riscv64','riscv64_generic','x86_64','x86_geode'];

function run(command) { let p = popen(command + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all'), rc = p.close(); return { rc: rc, out: out ? out : '' }; }
function is_object(value) { return type(value) == 'object' && value != null; }
function fail(code, message, details) { let r = { ok: false, error: { code: code, message: message } }; if (details != null) r.error.details = details; return r; }
function literal(value) { return type(value) == 'string' && index(value, "'") < 0 && index(value, '\n') < 0 && index(value, '\r') < 0 ? "'" + value + "'" : null; }
function read_json(path, fallback) { try { let raw = readfile(path); return raw ? json(raw) : fallback; } catch (e) { return fallback; } }
function ensure_dir(path) { try { mkdir(path); } catch (e) {} let q = literal(path); if (q != null) run('chmod 700 ' + q); }
function state_path() { return MANAGER_ROOT == '/etc/zapret2-manager' ? STATE_FILE : MANAGER_ROOT + '/engine-state.json'; }
function ensure_manager_root() { try { mkdir(MANAGER_ROOT); } catch (e) {} let q = literal(MANAGER_ROOT); return q != null && run('chmod 0701 ' + q).rc == 0; }
function atomic_json(path, value) { let tmp = path + '.tmp.' + time() + '-' + length(sprintf('%J', value)); if (!writefile(tmp, sprintf('%J', value) + '\n')) return false; let a = literal(tmp), b = literal(path); if (a == null || b == null) return false; let r = run('chmod 600 ' + a + ' && mv -f ' + a + ' ' + b); if (r.rc != 0) { try { unlink(tmp); } catch (e) {} return false; } return stat(path) != null; }
function safe_arch(value) { for (let i = 0; i < length(ARCHES); i++) if (ARCHES[i] == value) return value; return null; }
function safe_token(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{48}$/) ? value : null; }
function safe_version(value) { return type(value) == 'string' && match(value, /^[0-9][0-9A-Za-z._+~-]{0,95}$/) ? value : null; }
function architecture() { let a = trim(run('apk --print-arch').out); if (safe_arch(a) != null) return a; a = trim(run(". /etc/openwrt_release 2>/dev/null; printf '%s' \"$DISTRIB_ARCH\"").out); return safe_arch(a); }
function sha256(value) { let m = type(value) == 'string' ? match(value, /^sha256:([a-fA-F0-9]{64})$/) : null; return m ? lc(m[1]) : null; }
function release_version(tag) { return type(tag) == 'string' && match(tag, /^v[0-9][0-9A-Za-z._-]*$/) ? substr(tag, 1) : null; }
function release_url(version, name) { return 'https://github.com/bol-van/zapret2/releases/download/v' + version + '/' + name; }
function exact_asset(assets, name) { if (type(assets) != 'array') return null; for (let i = 0; i < length(assets); i++) { let a = assets[i]; if (type(a) == 'object' && a != null && a.name == name) return a; } return null; }
function valid_asset(asset, name, version, min_size) { return type(asset) == 'object' && asset != null && asset.name == name && asset.state == 'uploaded' && +asset.size >= min_size && +asset.size <= MAX_ASSET_SIZE && sha256(asset.digest) != null && asset.browser_download_url == release_url(version, name); }
function supported(version) { return match(version || '', /^1\.[0-9]+(\.[0-9]+)?$/); }
function release_record(release, architecture_value) {
	if (type(release) != 'object' || release == null || release.draft !== false || release.prerelease !== false || release.published_at == null) return null;
	let version = release_version(release.tag_name); if (version == null) return null;
	let name = 'zapret2-v' + version + '-openwrt-embedded.tar.gz';
	let asset = exact_asset(release.assets, name), checksum = exact_asset(release.assets, 'sha256sum.txt');
	if (!valid_asset(asset, name, version, 1024) || !valid_asset(checksum, 'sha256sum.txt', version, 64)) return null;
	return { schema: ENGINE_ARTIFACT_SCHEMA, artifactKind: VANILLA_ARTIFACT, version: version, releaseTag: 'v' + version, installedRelease: 'v' + version, upstream: UPSTREAM, architecture: architecture_value, assetName: name, downloadUrl: asset.browser_download_url, sha256: sha256(asset.digest), size: +asset.size, releaseId: '' + release.id, publishedAt: release.published_at, releaseUrl: type(release.html_url) == 'string' ? release.html_url : 'https://github.com/' + UPSTREAM + '/releases/tag/v' + version, releaseNotes: type(release.body) == 'string' ? release.body : '', prerelease: false, container: 'tar.gz', checksumName: 'sha256sum.txt', checksumUrl: checksum.browser_download_url, checksumSha256: sha256(checksum.digest), compatible: true, compatibilityState: 'compatible', compatibilityCode: null, compatibilityMessage: '', requiredCapabilities: [], baseRepository: UPSTREAM };
}
function metadata_allowed(url) { return url == API_URL; }
function fetch_json_feed(url) {
	if (!metadata_allowed(url)) return fail('ESECURITY', 'Release URL РЅРµ РІС…РѕРґРёС‚ РІ allowlist.');
	let file = private_tempfile();
	if (file == null) return fail('EIO', 'Private metadata staging is unavailable.');
	let qf = literal(file), qu = literal(url);
	if (qf == null || qu == null) return fail('ESECURITY', 'Release URL РЅРµ РїСЂРѕС€С‘Р» shell boundary.');
	let r = run('ulimit -f 8192; uclient-fetch -q -T 20 --user-agent zapret2-manager/engine -O ' + qf + ' ' + qu), s = stat(file);
	if (r.rc != 0 || s == null) { try { unlink(file); } catch (e) {} return fail('ENETWORK', 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ release catalog.'); }
	if (s.size < 2 || s.size > MAX_METADATA) { try { unlink(file); } catch (e) {} return fail('EMETADATA', 'Release catalog РёРјРµРµС‚ РЅРµРґРѕРїСѓСЃС‚РёРјС‹Р№ СЂР°Р·РјРµСЂ.'); }
	let doc = read_json(file, null);
	try { unlink(file); } catch (e) {}
	return type(doc) == 'array' ? { ok: true, releases: doc } : fail('EMETADATA', 'Release catalog РїРѕРІСЂРµР¶РґС‘РЅ.');
}
function fetch_releases() { return fetch_json_feed(API_URL); }
function random_token() { return trim(run("cat /proc/sys/kernel/random/uuid /proc/sys/kernel/random/uuid | tr -d '\\n-' | cut -c1-48").out); }
function runtime_version() { return stat('/opt/zapret2/nfq2/nfqws2') != null ? trim(run('/opt/zapret2/nfq2/nfqws2 --version | head -n 1').out) : ''; }
function package_version() { let s = trim(run('apk info -e -v zapret2 | head -n 1').out); return substr(s, 0, 8) == 'zapret2-' ? substr(s, 8) : s; }
function description(raw) { let lines = split(raw, '\n'); for (let i = 0; i < length(lines); i++) { let l = lc(trim(lines[i])); if ((l == 'description:' || l == 'description') && i + 1 < length(lines)) return trim(lines[i + 1]); if (substr(l, 0, 12) == 'description:') return trim(substr(lines[i], 12)); let marker = ' description:'; let at = index(l, marker); if (at >= 0) return trim(substr(lines[i], at + length(marker))); } return ''; }
function file_sha(path) { let q = literal(path); if (q == null || stat(path) == null) return null; let h = trim(run("sha256sum " + q + " | awk '{print $1}'").out); return match(h, /^[a-f0-9]{64}$/) ? h : null; }
function saved_digest(saved) { if (type(saved) != 'object' || saved == null) return null; let path = saved.container == 'tar.gz' ? CACHE + '/current.tar.gz' : CACHE + '/current.apk'; let digest = file_sha(path); return digest == saved.assetSha256 ? digest : null; }
function package_meta(saved) { let packageInstalled = run('apk info -e zapret2').rc == 0, runtimeContract = stat('/opt/zapret2/config') != null && stat('/opt/zapret2/nfq2/nfqws2') != null && stat('/etc/init.d/zapret2') != null, runtime = runtime_version(), officialRuntime = runtimeContract && index(lc(runtime), 'github version v') >= 0; if (!packageInstalled && !officialRuntime && !(runtimeContract && type(saved) == 'object' && saved != null && saved.installedOrigin == 'OFFICIAL')) return null; let raw = packageInstalled ? run('apk info -a zapret2').out : '', d = packageInstalled ? description(raw) : ''; if (packageInstalled && !length(d)) d = trim(run("apk info -a zapret2 | sed -n '2p'").out); return { name: packageInstalled ? 'zapret2' : null, version: packageInstalled ? package_version() : null, description: d, runtimeVersion: runtime, managedAssetSha256: saved_digest(saved), runtimeContract: runtimeContract, officialRuntime: officialRuntime }; }
function valid_state(value) { return type(value) == 'object' && value != null && value.schema == 'engine-state.v2' && value.installedOrigin == 'OFFICIAL'; }
function saved_state() { let current = read_json(state_path(), null); return valid_state(current) ? current : null; }
function public_candidate(c) { return { schema: c.schema, artifactKind: c.artifactKind, version: c.version, releaseTag: c.releaseTag, installedRelease: c.installedRelease, upstream: c.upstream, architecture: c.architecture, assetName: c.assetName, sha256: c.sha256, size: c.size, releaseId: c.releaseId, publishedAt: c.publishedAt, releaseUrl: c.releaseUrl, releaseNotes: c.releaseNotes, prerelease: c.prerelease, container: c.container, checksumName: c.checksumName, checksumUrl: c.checksumUrl, checksumSha256: c.checksumSha256, compatible: c.compatible, compatibilityState: c.compatibilityState, compatibilityCode: c.compatibilityCode, compatibilityMessage: c.compatibilityMessage, requiredCapabilities: c.requiredCapabilities || [] }; }

function release_cache_read() {
	let value = read_json(RELEASE_CACHE, null);
	// Schema bump invalidates pre-z2m caches: a v1 entry has no canonical
	// records and would shadow the compatible feed for its whole TTL.
	if (type(value) != 'object' || value == null || value.schema != 'engine-release-catalog.v2'
		|| type(value.fetchedAt) != 'int' || type(value.releases) != 'array') return null;
	return value;
}
function release_cache_write(releases, z2mReleases) {
	try { ensure_dir(CACHE); } catch (e) { return false; }
	return atomic_json(RELEASE_CACHE, { schema: 'engine-release-catalog.v2', fetchedAt: time(),
		releases: releases, z2mReleases: z2mReleases != null ? z2mReleases : [] });
}

// Validate the canonical z2m-compatible feed. Every release carrying a
// *.tar.gz plus a sibling machine-readable manifest is checked against the
// pinned integration identity for THIS device architecture; only survivors
// become installable candidates. Vanilla bol-van records are produced
// separately and stay visible-but-not-installable.


function catalog(architecture_value, options) {
	options = options || {};
	let cached = release_cache_read(), age = cached ? time() - cached.fetchedAt : null;
	if (options.cache === true && cached != null && age >= 0 && age <= RELEASE_CACHE_TTL) {
		let fresh = [], raw = cached.releases;
		for (let i = 0; i < length(raw); i++) { let candidate = release_record(raw[i], architecture_value); if (candidate != null) push(fresh, candidate); }
		return { ok: true, releases: fresh,
			z2mReleases: cached.z2mReleases != null ? cached.z2mReleases : [],
			cacheHit: true, stale: false, fetchedAt: cached.fetchedAt };
	}
	let fetched = fetch_releases();
	if (!fetched.ok) {
		if (options.allowStale === true && cached != null) {
			let stale = [], staleRaw = cached.releases;
			for (let i = 0; i < length(staleRaw); i++) { let candidate = release_record(staleRaw[i], architecture_value); if (candidate != null) push(stale, candidate); }
			return { ok: true, releases: stale,
				z2mReleases: cached.z2mReleases != null ? cached.z2mReleases : [],
				cacheHit: true, stale: true, fetchedAt: cached.fetchedAt, networkError: fetched.error };
		}
		return fetched;
	}
	let releases = [];
	for (let i = 0; i < length(fetched.releases); i++) { let candidate = release_record(fetched.releases[i], architecture_value); if (candidate != null) push(releases, candidate); }
	release_cache_write(fetched.releases, []);
	return { ok: true, releases: releases, z2mReleases: [], cacheHit: false, stale: false, fetchedAt: time() };
}

// Canonical ordering: official upstream (vanilla) records come first вЂ”
// they are the production authority since requirement-based compatibility.
// Legacy z2m-compatible entries trail behind for migration compatibility
// until the producer is retired post-cutover.
function merged_candidates(result) {
	let combined = [];
	for (let i = 0; i < length(result.releases || []); i++)
		if (is_object(result.releases[i])) push(combined, result.releases[i]);
	for (let i = 0; i < length(result.z2mReleases || []); i++)
		if (is_object(result.z2mReleases[i])) push(combined, result.z2mReleases[i]);
	return combined;
}

export const engine_releases = function () { let a = architecture(); if (a == null) return fail('EARCH', 'РђСЂС…РёС‚РµРєС‚СѓСЂР° СѓСЃС‚СЂРѕР№СЃС‚РІР° РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ.'); let result = catalog(a, { cache: true, allowStale: true }); if (!result.ok) return result; let releases = [], combined = merged_candidates(result); for (let i = 0; i < length(combined); i++) push(releases, public_candidate(combined[i])); return { ok: true, upstream: UPSTREAM, architecture: a, releases: releases, cacheHit: result.cacheHit === true, stale: result.stale === true, fetchedAt: result.fetchedAt || null, networkError: result.networkError || null }; };
export const installed_engine = function () { let saved = saved_state(), meta = package_meta(saved); if (meta == null) return { installed: false, packageName: null, packageVersion: null, installedOrigin: null, originConfidence: null, originEvidence: null, savedState: saved, architecture: architecture(), runtimeBuild: null, installedRelease: null, runtimeContract: false }; let evidence = meta.officialRuntime ? { origin: 'OFFICIAL', confidence: 'high', evidence: 'official-runtime-contract' } : { origin: 'UNKNOWN', confidence: 'none', evidence: 'official-runtime-not-proven' }, release = saved != null ? saved.installedRelease : null; return { installed: true, packageName: meta.name, packageVersion: meta.version, packageDescription: meta.description, installedOrigin: evidence.origin, originConfidence: evidence.confidence, originEvidence: evidence.evidence, savedState: saved, architecture: architecture(), runtimeBuild: meta.runtimeVersion, installedRelease: release, runtimeContract: meta.runtimeContract }; };
// Legacy manager-built compatibility builds are identified by their
// r*-z2m-* artifactVersion plus a non-empty patch series attached to the
// historical engine-state.v2 record.
function legacy_compatibility_state(state) {
	if (!is_object(state) || state == null || state.schema != 'engine-state.v2') return null;
	if (type(state.installedRelease) != 'string' || !match(state.installedRelease, /-z2m-[0-9]{8,}/)) return null;
	if (type(state.patchSeries) != 'array' || length(state.patchSeries) == 0) return null;
	return {
		schema: 'engine-truth.v1',
		artifactKind: 'legacy-compatibility-build',
		producer: 'zapret2-manager',
		artifactVersion: state.installedRelease,
		upstreamRepository: type(state.upstreamRepository) == 'string' && state.upstreamRepository != '' ? state.upstreamRepository : UPSTREAM,
		baseCommit: type(state.baseCommit) == 'string' ? state.baseCommit : null,
		patchSeries: state.patchSeries,
		upstreamRelease: null
	};
}
// Truth projection for ANY persisted engine-state record вЂ” never lies about
// a build id being an upstream release and never invents an upstream version
// from remote metadata.
export const normalize_state_record = function (state) {
	if (!is_object(state) || state == null || state.schema != 'engine-state.v2') return null;
	let legacy = legacy_compatibility_state(state);
	if (legacy != null) return legacy;
	let upstream = null;
	if (type(state.artifactKind) == 'string' && state.artifactKind == VANILLA_ARTIFACT
		&& type(state.installedRelease) == 'string' && match(state.installedRelease, /^v[0-9]/))
		upstream = state.installedRelease;
	return {
		schema: 'engine-truth.v1',
		artifactKind: upstream != null ? VANILLA_ARTIFACT : null,
		producer: null,
		artifactVersion: type(state.installedRelease) == 'string' ? state.installedRelease : null,
		upstreamRepository: UPSTREAM,
		baseCommit: type(state.baseCommit) == 'string' ? state.baseCommit : null,
		patchSeries: [],
		upstreamRelease: upstream
	};
};
export const update_required = function (installedRelease, legacyBuild, availableVersion) {
	if (availableVersion == null) return false;
	if (legacyBuild === true) return true;
	if (type(installedRelease) != 'string' || length(installedRelease) == 0) return true;
	let expected = 'v' + availableVersion;
	if (substr(expected, 0, 2) == 'vv') expected = substr(expected, 1);
	return installedRelease != expected;
};
export const engine_check = function (input) { let version = type(input) == 'object' && input != null && input.version != null ? input.version : null; let forceRefresh = type(input) == 'object' && input != null && input.forceRefresh === true; if (version != null && safe_version(version) == null && !match(version, /^[a-zA-Z0-9._-]+$/)) return fail('EINPUT', 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РІРµСЂСЃРёСЏ release.'); let arch = architecture(); if (arch == null) return fail('EARCH', 'РђСЂС…РёС‚РµРєС‚СѓСЂР° СѓСЃС‚СЂРѕР№СЃС‚РІР° РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ.'); let result = catalog(arch, { cache: forceRefresh !== true, allowStale: false, forceRefresh: forceRefresh }); if (!result.ok) return result; let combined = merged_candidates(result); let candidate = null, public_releases = [];
if (version == null) {
	// Default target: merged order puts newest compatible candidates first;
	// vanilla (visible-but-not-installable) records trail after them.
	candidate = length(combined) ? combined[0] : null;
} else {
	for (let i = 0; i < length(combined); i++)
		if (combined[i].version == version) { candidate = combined[i]; break; }
}
for (let i = 0; i < length(combined); i++) push(public_releases, public_candidate(combined[i])); if (candidate == null) return fail('ENOASSET', 'РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРјС‹Р№ release РґР»СЏ СЌС‚РѕР№ РІРµСЂСЃРёРё РЅРµ РЅР°Р№РґРµРЅ.'); if (!candidate.compatible) return fail(candidate.compatibilityCode || 'EENGINE_INTEGRATION_REQUIRED', candidate.compatibilityMessage, { candidate: public_candidate(candidate) }); let token = random_token(); if (safe_token(token) == null) return fail('EINTERNAL', 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ check token.'); ensure_dir(CHECK_DIR); let now = time(), record = { schema: 'engine-check.v2', token: token, checkedAt: now, expiresAt: now + CHECK_TTL, candidate: candidate }; if (!atomic_json(CHECK_DIR + '/' + token + '.json', record)) return fail('EINTERNAL', 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ checked candidate.'); let installed = installed_engine(); let latestUpstream = null; for (let i = 0; i < length(combined); i++) if (combined[i].artifactKind == VANILLA_ARTIFACT) { latestUpstream = combined[i]; break; } if (latestUpstream == null) latestUpstream = combined[0]; let legacyState = legacy_compatibility_state(installed.savedState); return { ok: true, checkToken: token, checkedAt: now, expiresAt: now + CHECK_TTL, installedRelease: installed.installedRelease, latestRelease: latestUpstream.installedRelease, availableArtifactKind: latestUpstream.artifactKind, updateAvailable: update_required(installed.installedRelease, legacyState == null ? false : true, latestUpstream == null ? null : latestUpstream.version), candidate: public_candidate(candidate), releases: public_releases, compatible: true, compatibilityMessage: candidate.compatibilityMessage }; };
export const load_checked_candidate = function (token) { if (safe_token(token) == null) return fail('EINPUT', 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ check token.'); let path = CHECK_DIR + '/' + token + '.json', record = read_json(path, null); if (record == null || record.token != token) return fail('ECHECKTOKEN', 'РџСЂРѕРІРµСЂРµРЅРЅС‹Р№ candidate РЅРµ РЅР°Р№РґРµРЅ.'); if (+record.expiresAt < time()) { try { unlink(path); } catch (e) {} return fail('ECHECKEXPIRED', 'Р РµР·СѓР»СЊС‚Р°С‚ РїСЂРѕРІРµСЂРєРё СѓСЃС‚Р°СЂРµР».'); } if (type(record.candidate) != 'object' || record.candidate == null || record.candidate.upstream != UPSTREAM || record.candidate.container != 'tar.gz') return fail('EMETADATA', 'РџСЂРѕРІРµСЂРµРЅРЅС‹Р№ candidate РїРѕРІСЂРµР¶РґС‘РЅ.'); if ((record.candidate.artifactKind != VANILLA_ARTIFACT) || record.candidate.schema != ENGINE_ARTIFACT_SCHEMA || record.candidate.compatible !== true) return fail('EENGINE_INTEGRATION_REQUIRED', 'РџСЂРѕРІРµСЂРµРЅРЅС‹Р№ candidate РЅРµ СЏРІР»СЏРµС‚СЃСЏ РєР°РЅРѕРЅРёС‡РµСЃРєРёРј РёСЃС‚РѕС‡РЅРёРєРѕРј Engine.'); try { unlink(path); } catch (e) {} return { ok: true, record: record }; };
export const save_engine_state = function (value) { if (!ensure_manager_root()) return false; return atomic_json(state_path(), value); };
export const clear_engine_state = function () { let path = state_path(); try { unlink(path); } catch (e) {} return stat(path) == null; };

// Producer retired: the manager-built z2m-compatible feed is no longer a
// production source. Official bol-van releases are the sole install/update
// candidates; z2mReleases stays in payloads/cache only as an empty list for
// client-shape compatibility.
// Public seam for tests/tools; impl is a hoisted-safe declaration above.
