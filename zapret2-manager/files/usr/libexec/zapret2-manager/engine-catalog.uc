'use strict';
import { private_tempfile } from './core/private-temp.uc';
import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';

const CHECK_DIR = '/tmp/zapret2-manager/engine-checks';
const STATE_FILE = '/etc/zapret2-manager/engine-state.json';
const CACHE = '/etc/zapret2-manager/engine-cache';
const RELEASE_CACHE = CACHE + '/release-catalog.json';
const RELEASE_CACHE_TTL = 600;
const API_URL = 'https://api.github.com/repos/bol-van/zapret2/releases?per_page=20';
const UPSTREAM = 'bol-van/zapret2';
const CHECK_TTL = 600;
const MAX_METADATA = 4194304;
const MAX_ASSET_SIZE = 33554432;
const ARCHES = ['aarch64_cortex-a53','aarch64_cortex-a72','aarch64_cortex-a76','aarch64_generic','arm_arm1176jzf-s_vfp','arm_arm926ej-s','arm_cortex-a15_neon-vfpv4','arm_cortex-a5','arm_cortex-a5_vfpv4','arm_cortex-a7','arm_cortex-a7_neon-vfpv4','arm_cortex-a7_vfpv4','arm_cortex-a8','arm_cortex-a8_vfpv3','arm_cortex-a9','arm_cortex-a9_neon','arm_cortex-a9_vfpv3-d16','arm_fa526','arm_mpcore','arm_xscale','i386_pentium-mmx','i386_pentium4','mips64_octeonplus','mips_24kc','mips_4kec','mips_mips32','mipsel_24kc','mipsel_24kc_24kf','mipsel_74kc','mipsel_mips32','powerpc_464fp','powerpc_8540','riscv64_riscv64','riscv64_generic','x86_64','x86_geode'];

function run(command) { let p = popen(command + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all'), rc = p.close(); return { rc: rc, out: out ? out : '' }; }
function fail(code, message, details) { let r = { ok: false, error: { code: code, message: message } }; if (details != null) r.error.details = details; return r; }
function literal(value) { return type(value) == 'string' && index(value, "'") < 0 && index(value, '\n') < 0 && index(value, '\r') < 0 ? "'" + value + "'" : null; }
function read_json(path, fallback) { try { let raw = readfile(path); return raw ? json(raw) : fallback; } catch (e) { return fallback; } }
function ensure_dir(path) { try { mkdir(path); } catch (e) {} let q = literal(path); if (q != null) run('chmod 700 ' + q); }
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
	let compatible = supported(version) ? true : false;
	return { version: version, releaseTag: 'v' + version, installedRelease: 'v' + version, upstream: UPSTREAM, architecture: architecture_value, assetName: name, downloadUrl: asset.browser_download_url, sha256: sha256(asset.digest), size: +asset.size, releaseId: '' + release.id, publishedAt: release.published_at, releaseUrl: type(release.html_url) == 'string' ? release.html_url : 'https://github.com/' + UPSTREAM + '/releases/tag/v' + version, releaseNotes: type(release.body) == 'string' ? release.body : '', prerelease: false, container: 'tar.gz', checksumName: 'sha256sum.txt', checksumUrl: checksum.browser_download_url, checksumSha256: sha256(checksum.digest), compatible: compatible, compatibilityMessage: compatible ? 'Официальный embedded release bol-van/zapret2.' : 'Релиз не подтверждён для manager.' };
}
function metadata_allowed(url) { return url == API_URL; }
function fetch_releases() { if (!metadata_allowed(API_URL)) return fail('ESECURITY', 'Official release URL не входит в allowlist.'); let file = private_tempfile(); if (file == null) return fail('EIO', 'Private metadata staging is unavailable.'); let qf = literal(file), qu = literal(API_URL); if (qf == null || qu == null) return fail('ESECURITY', 'Official release URL не прошёл shell boundary.'); let r = run('ulimit -f 8192; uclient-fetch -q -T 20 --user-agent zapret2-manager/engine -O ' + qf + ' ' + qu), s = stat(file); if (r.rc != 0 || s == null) { try { unlink(file); } catch (e) {} return fail('ENETWORK', 'Не удалось получить official release catalog.'); } if (s.size < 2 || s.size > MAX_METADATA) { try { unlink(file); } catch (e) {} return fail('EMETADATA', 'Official release catalog имеет недопустимый размер.'); } let doc = read_json(file, null); try { unlink(file); } catch (e) {} return type(doc) == 'array' ? { ok: true, releases: doc } : fail('EMETADATA', 'Official release catalog повреждён.'); }
function random_token() { return trim(run("cat /proc/sys/kernel/random/uuid /proc/sys/kernel/random/uuid | tr -d '\\n-' | cut -c1-48").out); }
function runtime_version() { return stat('/opt/zapret2/nfq2/nfqws2') != null ? trim(run('/opt/zapret2/nfq2/nfqws2 --version | head -n 1').out) : ''; }
function package_version() { let s = trim(run('apk info -e -v zapret2 | head -n 1').out); return substr(s, 0, 8) == 'zapret2-' ? substr(s, 8) : s; }
function description(raw) { let lines = split(raw, '\n'); for (let i = 0; i < length(lines); i++) { let l = lc(trim(lines[i])); if ((l == 'description:' || l == 'description') && i + 1 < length(lines)) return trim(lines[i + 1]); if (substr(l, 0, 12) == 'description:') return trim(substr(lines[i], 12)); let marker = ' description:'; let at = index(l, marker); if (at >= 0) return trim(substr(lines[i], at + length(marker))); } return ''; }
function file_sha(path) { let q = literal(path); if (q == null || stat(path) == null) return null; let h = trim(run("sha256sum " + q + " | awk '{print $1}'").out); return match(h, /^[a-f0-9]{64}$/) ? h : null; }
function saved_digest(saved) { if (type(saved) != 'object' || saved == null) return null; let path = saved.container == 'tar.gz' ? CACHE + '/current.tar.gz' : CACHE + '/current.apk'; let digest = file_sha(path); return digest == saved.assetSha256 ? digest : null; }
function package_meta(saved) { let packageInstalled = run('apk info -e zapret2').rc == 0, runtimeContract = stat('/opt/zapret2/config') != null && stat('/opt/zapret2/nfq2/nfqws2') != null && stat('/etc/init.d/zapret2') != null, runtime = runtime_version(), officialRuntime = runtimeContract && index(lc(runtime), 'github version v') >= 0; if (!packageInstalled && !officialRuntime && !(runtimeContract && type(saved) == 'object' && saved != null && saved.installedOrigin == 'OFFICIAL')) return null; let raw = packageInstalled ? run('apk info -a zapret2').out : '', d = packageInstalled ? description(raw) : ''; if (packageInstalled && !length(d)) d = trim(run("apk info -a zapret2 | sed -n '2p'").out); return { name: packageInstalled ? 'zapret2' : null, version: packageInstalled ? package_version() : null, description: d, runtimeVersion: runtime, managedAssetSha256: saved_digest(saved), runtimeContract: runtimeContract, officialRuntime: officialRuntime }; }
function valid_state(value) { return type(value) == 'object' && value != null && value.schema == 'engine-state.v2' && value.installedOrigin == 'OFFICIAL'; }
function saved_state() { let current = read_json(STATE_FILE, null); return valid_state(current) ? current : null; }
function public_candidate(c) { return { version: c.version, releaseTag: c.releaseTag, installedRelease: c.installedRelease, upstream: c.upstream, architecture: c.architecture, assetName: c.assetName, sha256: c.sha256, size: c.size, releaseId: c.releaseId, publishedAt: c.publishedAt, releaseUrl: c.releaseUrl, releaseNotes: c.releaseNotes, prerelease: c.prerelease, container: c.container, checksumName: c.checksumName, checksumUrl: c.checksumUrl, checksumSha256: c.checksumSha256, compatible: c.compatible, compatibilityMessage: c.compatibilityMessage }; }

function release_cache_read() {
	let value = read_json(RELEASE_CACHE, null);
	if (type(value) != 'object' || value == null || type(value.fetchedAt) != 'int' || type(value.releases) != 'array') return null;
	return value;
}
function release_cache_write(releases) {
	try { ensure_dir(CACHE); } catch (e) { return false; }
	return atomic_json(RELEASE_CACHE, { schema: 'engine-release-catalog.v1', fetchedAt: time(), releases: releases });
}
function catalog(architecture_value, options) {
	options = options || {};
	let cached = release_cache_read(), age = cached ? time() - cached.fetchedAt : null;
	if (options.cache === true && cached != null && age >= 0 && age <= RELEASE_CACHE_TTL) {
		let fresh = [], raw = cached.releases;
		for (let i = 0; i < length(raw); i++) { let candidate = release_record(raw[i], architecture_value); if (candidate != null) push(fresh, candidate); }
		return { ok: true, releases: fresh, cacheHit: true, stale: false, fetchedAt: cached.fetchedAt };
	}
	let fetched = fetch_releases();
	if (!fetched.ok) {
		if (options.allowStale === true && cached != null) {
			let stale = [], staleRaw = cached.releases;
			for (let i = 0; i < length(staleRaw); i++) { let candidate = release_record(staleRaw[i], architecture_value); if (candidate != null) push(stale, candidate); }
			return { ok: true, releases: stale, cacheHit: true, stale: true, fetchedAt: cached.fetchedAt, networkError: fetched.error };
		}
		return fetched;
	}
	let releases = [];
	for (let i = 0; i < length(fetched.releases); i++) { let candidate = release_record(fetched.releases[i], architecture_value); if (candidate != null) push(releases, candidate); }
	release_cache_write(fetched.releases);
	return { ok: true, releases: releases, cacheHit: false, stale: false, fetchedAt: time() };
}

export const engine_releases = function () { let a = architecture(); if (a == null) return fail('EARCH', 'Архитектура устройства не поддерживается.'); let result = catalog(a, { cache: true, allowStale: true }); if (!result.ok) return result; let releases = []; for (let i = 0; i < length(result.releases); i++) push(releases, public_candidate(result.releases[i])); return { ok: true, upstream: UPSTREAM, architecture: a, releases: releases, cacheHit: result.cacheHit === true, stale: result.stale === true, fetchedAt: result.fetchedAt || null, networkError: result.networkError || null }; };
export const installed_engine = function () { let saved = saved_state(), meta = package_meta(saved); if (meta == null) return { installed: false, packageName: null, packageVersion: null, installedOrigin: null, originConfidence: null, originEvidence: null, savedState: saved, architecture: architecture(), runtimeBuild: null, installedRelease: null, runtimeContract: false }; let evidence = meta.officialRuntime ? { origin: 'OFFICIAL', confidence: 'high', evidence: 'official-runtime-contract' } : { origin: 'UNKNOWN', confidence: 'none', evidence: 'official-runtime-not-proven' }, release = saved != null ? saved.installedRelease : null; return { installed: true, packageName: meta.name, packageVersion: meta.version, packageDescription: meta.description, installedOrigin: evidence.origin, originConfidence: evidence.confidence, originEvidence: evidence.evidence, savedState: saved, architecture: architecture(), runtimeBuild: meta.runtimeVersion, installedRelease: release, runtimeContract: meta.runtimeContract }; };
export const engine_check = function (input) { let version = type(input) == 'object' && input != null && input.version != null ? input.version : null; if (version != null && safe_version(version) == null) return fail('EINPUT', 'Некорректная версия release.'); let arch = architecture(); if (arch == null) return fail('EARCH', 'Архитектура устройства не поддерживается.'); let result = catalog(arch, { cache: true, allowStale: false }); if (!result.ok) return result; let candidate = null, public_releases = []; for (let i = 0; i < length(result.releases); i++) { if (version == null || result.releases[i].version == version) candidate = result.releases[i]; push(public_releases, public_candidate(result.releases[i])); if (candidate != null && version != null) break; } if (candidate == null) return fail('ENOASSET', 'Официальный release asset для этой версии не найден.'); if (!candidate.compatible) return fail('EINCOMPATIBLE', candidate.compatibilityMessage); let token = random_token(); if (safe_token(token) == null) return fail('EINTERNAL', 'Не удалось создать check token.'); ensure_dir(CHECK_DIR); let now = time(), record = { schema: 'engine-check.v2', token: token, checkedAt: now, expiresAt: now + CHECK_TTL, candidate: candidate }; if (!atomic_json(CHECK_DIR + '/' + token + '.json', record)) return fail('EINTERNAL', 'Не удалось сохранить checked candidate.'); let installed = installed_engine(), latest = result.releases[0]; return { ok: true, checkToken: token, checkedAt: now, expiresAt: now + CHECK_TTL, installedRelease: installed.installedRelease, latestRelease: latest != null ? latest.installedRelease : null, updateAvailable: installed.installedOrigin == 'OFFICIAL' && installed.installedRelease != null && latest != null && installed.installedRelease != latest.installedRelease, candidate: public_candidate(candidate), releases: public_releases, compatible: true, compatibilityMessage: candidate.compatibilityMessage }; };
export const load_checked_candidate = function (token) { if (safe_token(token) == null) return fail('EINPUT', 'Некорректный check token.'); let path = CHECK_DIR + '/' + token + '.json', record = read_json(path, null); if (record == null || record.token != token) return fail('ECHECKTOKEN', 'Проверенный candidate не найден.'); if (+record.expiresAt < time()) { try { unlink(path); } catch (e) {} return fail('ECHECKEXPIRED', 'Результат проверки устарел.'); } if (type(record.candidate) != 'object' || record.candidate == null || record.candidate.upstream != UPSTREAM || record.candidate.container != 'tar.gz') return fail('EMETADATA', 'Проверенный candidate повреждён.'); if (!record.candidate.compatible) return fail('EINCOMPATIBLE', 'Совместимость версии не подтверждена.'); try { unlink(path); } catch (e) {} return { ok: true, record: record }; };
export const save_engine_state = function (value) { ensure_dir('/etc/zapret2-manager'); return atomic_json(STATE_FILE, value); };
export const clear_engine_state = function () { try { unlink(STATE_FILE); } catch (e) {} return stat(STATE_FILE) == null; };
