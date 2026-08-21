'use strict';
// Typed canonical asset registry. Paths are server-owned implementation
// details; consumers bind to {type,id,revision,contentSha256} references.

import { readfile, writefile, stat, readlink, unlink, mkdir, lsdir, popen } from 'fs';

const STATE = '/etc/zapret2-manager/asset-registry.json';
const USER_ROOT = '/etc/zapret2-manager/assets';
const STAGE_ROOT = '/tmp/z2m-resource-update';
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_BUNDLE_ASSETS = 64;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const RESOURCE_MANIFEST = '/usr/share/zapret2-manager/resources/manifest.json';
const MAX_REMOTE_URL_BYTES = 2048;
const MAX_ASN_PREFIXES = 4096;
const LIMITS = { lua: 4 * 1024 * 1024, blob: 16 * 1024 * 1024, ipset: 1024 * 1024,
	hostlist: 1024 * 1024, geosite: 32 * 1024 * 1024, geoip: 32 * 1024 * 1024, hosts: 1024 * 1024 };
const EXT = { lua: 'lua', blob: 'bin', ipset: 'txt', hostlist: 'txt', geosite: 'db', geoip: 'db', hosts: 'txt' };
const TYPES = ['lua', 'blob', 'ipset', 'hostlist', 'geosite', 'geoip', 'hosts'];
const LEGACY_ROOTS = { lua: ['/opt/zapret2/lua'], blob: ['/opt/zapret2/files/fake', '/opt/zapret2/bin'], ipset: ['/opt/zapret2/ipset', '/etc/zapret2-manager/ipset'], hostlist: ['/opt/zapret2/lists', '/opt/zapret2/ipset'], geosite: ['/opt/zapret2'], geoip: ['/opt/zapret2'], hosts: ['/opt/zapret2/ipset'] };
const PROVENANCE = ['builtin/package', 'imported', 'user-created', 'generated', 'catalog/upstream'];
const LEGACY_LUA_FILES = ['zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua',
	'zapret-obfs.lua', 'zapret-pcap.lua', 'zapret-tests.lua'];

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function ok(value) { return { ok: true, asset: value }; }
function fail(code, message, extra) { let out = { ok: false, error: { code: code, message: message } }; for (let k in extra || {}) out.error[k] = extra[k]; return out; }
function valid_type(value) { for (let i = 0; i < length(TYPES); i++) if (TYPES[i] == value) return true; return false; }
function valid_slug(value) { return string(value) && length(value) > 0 && length(value) <= 96 && match(value, /^[a-z][a-z0-9._-]*$/); }
function valid_id(kind, value) { return string(value) && substr(value, 0, length(kind) + 1) == kind + ':' && valid_slug(substr(value, length(kind) + 1)); }
function copy(value) { let out = {}; for (let k in value || {}) out[k] = value[k]; return out; }
function copy_array(value) { let out = []; for (let i = 0; type(value) == 'array' && i < length(value); i++) push(out, value[i]); return out; }
function lower_ascii(value) { let out = ''; for (let i = 0; i < length(value); i++) { let c = substr(value, i, 1), n = ord(c); out += n >= 65 && n <= 90 ? chr(n + 32) : c; } return out; }
function trim_line(value) { return trim('' + value); }
function shell_quote(value) { let out = "'", text = '' + value; for (let i = 0; i < length(text); i++) out += substr(text, i, 1) == "'" ? "'\\''" : substr(text, i, 1); return out + "'"; }
function command(command_text) { let p = popen(command_text + ' 2>&1', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function regular(path) { let s = null, link = null; try { s = stat(path); link = readlink(path); } catch (e) { return false; } return object(s) && s.type == 'file' && link == null && type(s.size) == 'int' && s.size >= 0; }
function directory(path) { let s = null, link = null; try { s = stat(path); link = readlink(path); } catch (e) { return false; } return object(s) && s.type == 'directory' && link == null; }
function legacy_function_names(raw) {
	let names = [], seen = {};
	for (let line in split(raw || '', '\n')) {
		line = trim(line);
		if (substr(line, 0, 9) != 'function ') continue;
		let name = trim(substr(line, 9)), end = index(name, '(');
		if (end <= 0) continue;
		name = trim(substr(name, 0, end));
		if (match(name, /^[A-Za-z_][A-Za-z0-9_]*$/) != null && !seen[name]) { seen[name] = true; push(names, name); }
	}
	return names;
}
function add_legacy_environment(environment) {
		environment.paths = { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/files/fake',
		listRoot: '/opt/zapret2/lists', ipsetRoot: '/opt/zapret2/ipset' };
	for (let filename in LEGACY_LUA_FILES) {
		let path = environment.paths.luaRoot + '/' + filename;
		if (!regular(path)) continue;
		let descriptor = { path, available: true, present: true, safe: true, symlink: false };
		environment.lua[filename] = descriptor;
		for (let name in legacy_function_names(readfile(path))) environment.functions[name] = descriptor;
	}
	// Package-supplied Avatar/z2k extensions are synchronized into the same
	// trusted roots as the official runtime. Register their actual files in
	// the compiler environment without making them mutable registry objects.
	for (let filename in (lsdir(environment.paths.luaRoot) || [])) {
		if (substr(filename, -4) != '.lua') continue;
		let path = environment.paths.luaRoot + '/' + filename;
		if (!regular(path)) continue;
		let descriptor = { path: path, available: true, present: true, safe: true, symlink: false };
		environment.lua[filename] = descriptor;
		for (let name in legacy_function_names(readfile(path))) environment.functions[name] = descriptor;
	}
	let blobFiles = {};
	for (let filename in (lsdir(environment.paths.blobRoot) || [])) {
		if (substr(filename, -4) != '.bin') continue;
		let path = environment.paths.blobRoot + '/' + filename;
		if (!regular(path)) continue;
		let descriptor = { path: path, available: true, present: true, safe: true, symlink: false };
		let stem = substr(filename, 0, length(filename) - 4);
		environment.blobs[stem] = descriptor;
		blobFiles[filename] = descriptor;
	}
	let aliases = {
		quic_google: 'quic_initial_www_google_com.bin', quic5: 'quic_5.bin',
		quic4: 'quic_4.bin', quic1: 'quic_1.bin', quic6: 'quic_6.bin',
		fake_default_tls: 'fake_tls_1.bin', fake_default_http: 'http_iana_org.bin',
		// The canonical z2k catalog names this payload tls_max_ru while the
		// package-owned binary keeps the upstream descriptive filename.
		tls_max_ru: 'tls_clienthello_max_ru.bin',
		fake_default_quic: 'fake_quic.bin'
	};
	for (let alias in aliases) if (blobFiles[aliases[alias]] != null) environment.blobs[alias] = blobFiles[aliases[alias]];
}
function link_target(path) { try { return readlink(path); } catch (e) { return null; } }
function asset_parent_safe(kind) { let base = '/etc/zapret2-manager'; if (link_target(base) != null || (stat(base) != null && !directory(base))) return false; if (link_target(USER_ROOT) != null || (stat(USER_ROOT) != null && !directory(USER_ROOT))) return false; let typed = USER_ROOT + '/' + kind; return link_target(typed) == null && (stat(typed) == null || directory(typed)); }
function under(path, root) { if (!string(path) || !string(root) || path == root || substr(path, 0, length(root) + 1) != root + '/') return false; let parts = split(substr(path, length(root) + 1), '/'); for (let i = 0; i < length(parts); i++) if (!length(parts[i]) || parts[i] == '.' || parts[i] == '..') return false; return true; }
function legacy_path(kind, value) { if (!string(value) || substr(value, 0, 1) != '/' || index(value, '..') >= 0) return null; let roots = LEGACY_ROOTS[kind] || []; for (let i = 0; i < length(roots); i++) if (under(value, roots[i])) return value; return null; }
function state_load() {
	let raw = readfile(STATE), value = null;
	if (!raw) return { schema: 1, revision: 0, assets: [] };
	if (length(raw) > MAX_STATE_BYTES) return null;
	try { value = json(raw); } catch (e) { return null; }
	if (!object(value) || value.schema != 1 || type(value.revision) != 'int' || type(value.assets) != 'array') return null;
	return value;
}
function atomic_write(path, content) {
	let slash = rindex(path, '/'), parent = slash > 0 ? substr(path, 0, slash) : null;
	if (parent) { try { mkdir(parent); } catch (e) { } if (!directory(parent)) return false; }
	let tmp = path + '.tmp.' + time();
	try { writefile(tmp, content); } catch (e) { return false; }
	if (!regular(tmp)) { try { unlink(tmp); } catch (e) {} return false; }
	let moved = command('mv -f ' + shell_quote(tmp) + ' ' + shell_quote(path));
	if (moved.rc != 0 || !regular(path)) { try { unlink(tmp); } catch (e) {} return false; }
	return readfile(path) == content;
}
function state_save(state) { return atomic_write(STATE, sprintf('%J', state) + '\n'); }
function sha256_file(path) { if (!regular(path)) return null; let r = command("sha256sum " + shell_quote(path) + " | awk '{print $1}'"), digest = trim(r.out); return r.rc == 0 && match(digest, /^[a-f0-9]{64}$/) ? digest : null; }
function base64_decode(value) {
	if (!string(value) || length(value) > 32 * 1024 * 1024 || !match(value, /^[A-Za-z0-9+\/=]*$/)) return null;
	let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', buffer = 0, bits = 0;
	for (let i = 0; i < length(value); i++) { let c = substr(value, i, 1); if (c == '=') break; let n = index(alphabet, c); if (n < 0) return null; buffer = buffer * 64 + n; bits += 6; if (bits >= 8) { bits -= 8; out += chr((buffer >> bits) & 255); buffer = buffer & ((1 << bits) - 1); } }
	return out;
}
function base64_encode(value, max_bytes) {
	max_bytes = type(max_bytes) == 'int' ? max_bytes : MAX_IMPORT_BYTES;
	if (!string(value) || length(value) > max_bytes) return null;
	let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', i = 0;
	while (i < length(value)) {
		let a = ord(substr(value, i++, 1)), haveB = i < length(value), b = haveB ? ord(substr(value, i++, 1)) : 0;
		let haveC = i < length(value), c = haveC ? ord(substr(value, i++, 1)) : 0;
		out += substr(alphabet, (a >> 2) & 63, 1);
		out += substr(alphabet, ((a & 3) << 4) | (b >> 4), 1);
		out += haveB ? substr(alphabet, ((b & 15) << 2) | (c >> 6), 1) : '=';
		out += haveC ? substr(alphabet, c & 63, 1) : '=';
	}
	return out;
}
function valid_utf8_text(value) {
	for (let i = 0; i < length(value); i++) {
		let byte = ord(substr(value, i, 1)); if (byte == 0) return false;
		if (byte < 128) continue;
		let need = byte >= 194 && byte <= 223 ? 1 : (byte >= 224 && byte <= 239 ? 2 : (byte >= 240 && byte <= 244 ? 3 : 0));
		if (!need || i + need >= length(value)) return false;
		for (let j = 1; j <= need; j++) { let next = ord(substr(value, i + j, 1)); if (next < 128 || next > 191) return false; if (j == 1 && byte == 224 && next < 160) return false; if (j == 1 && byte == 237 && next > 159) return false; if (j == 1 && byte == 240 && next < 144) return false; if (j == 1 && byte == 244 && next > 143) return false; }
		i += need;
	}
	return true;
}
function decimal(value, max) { if (!match(value, /^[0-9]+$/) || +value > max) return null; return +value; }
function ipv4(value) { let parts = split(value, '.'); if (length(parts) != 4) return false; for (let i = 0; i < 4; i++) if (decimal(parts[i], 255) == null) return false; return true; }
function hextet(value) { return length(value) >= 1 && length(value) <= 4 && match(value, /^[0-9A-Fa-f]+$/); }
function ipv6(value) { let compressed = index(value, '::') >= 0, chunks = split(value, ':'), count = 0; if (index(value, '::') >= 0 && index(substr(value, index(value, '::') + 2), '::') >= 0) return false; for (let i = 0; i < length(chunks); i++) if (length(chunks[i])) { if (!hextet(chunks[i])) return false; count++; } return compressed ? count < 8 : count == 8; }
function normalized_ip(line) {
	let slash = index(line, '/'), address = slash >= 0 ? substr(line, 0, slash) : line, prefix = slash >= 0 ? substr(line, slash + 1) : null, family = ipv4(address) ? 4 : (ipv6(address) ? 6 : 0);
	if (!family || (prefix != null && decimal(prefix, family == 4 ? 32 : 128) == null)) return null;
	return lower_ascii(address) + (prefix == null ? '' : '/' + (+prefix));
}
function hostname(value) { let s = lower_ascii(value); for (let i = 0; i < 3; i++) { let prefix = ['https://', 'http://', '//'][i]; if (substr(s, 0, length(prefix)) == prefix) s = substr(s, length(prefix)); } s = split(s, '/')[0]; s = split(s, '?')[0]; s = split(s, '#')[0]; if (index(s, ':') >= 0 && substr(s, 0, 1) != '[') s = substr(s, 0, rindex(s, ':')); if (substr(s, 0, 4) == 'www.') s = substr(s, 4); while (substr(s, 0, 1) == '.') s = substr(s, 1); while (substr(s, length(s) - 1, 1) == '.') s = substr(s, 0, length(s) - 1); if (!length(s) || length(s) > 253 || !match(s, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/)) return null; return s; }
function normalize_content(kind, content) {
	if (!string(content)) return fail('EINPUT', 'decoded content is unavailable');
	if (kind == 'blob' || kind == 'geosite' || kind == 'geoip') return { ok: true, content: content };
	if (!valid_utf8_text(content)) return fail('EVALIDATION', 'text asset contains NUL bytes');
	if (kind == 'lua') return { ok: true, content: content };
	let lines = split(content, '\n'), out = [], seen = {};
	for (let i = 0; i < length(lines); i++) { let line = trim_line(lines[i]); if (substr(line, length(line) - 1, 1) == '\r') line = substr(line, 0, length(line) - 1); if (!length(line)) continue; if (substr(line, 0, 1) == '#') { push(out, line); continue; }
		let normalized = kind == 'ipset' ? normalized_ip(line) : hostname(line); if (normalized == null) return fail('EVALIDATION', 'invalid ' + kind + ' entry', { entry: line }); if (!seen[normalized]) { seen[normalized] = true; push(out, normalized); }
	}
	return { ok: true, content: length(out) ? join('\n', out) + '\n' : '' };
}
function provenance_valid(provenance) {
	if (!object(provenance) || !string(provenance.kind)) return false; let known = false; for (let i = 0; i < length(PROVENANCE); i++) if (PROVENANCE[i] == provenance.kind) known = true; if (!known) return false;
	if (provenance.kind == 'builtin/package' && (!string(provenance.source) || !match(provenance.expectedSha256 || '', /^[a-f0-9]{64}$/))) return false;
	return true;
}
function find_asset(state, id) { for (let i = 0; i < length(state.assets); i++) if (state.assets[i].id == id) return state.assets[i]; return null; }
function server_asset_path(kind, slug) { return USER_ROOT + '/' + kind + '/' + slug + '.' + EXT[kind]; }
function mutable_asset_path_safe(asset) { let slug = substr(asset.id, length(asset.type) + 1); return asset.mutable == true && asset.path == server_asset_path(asset.type, slug) && under(asset.path, USER_ROOT); }
function references_copy(asset) { return copy_array(asset.references); }
function content_size(path) { let s = stat(path); return object(s) && type(s.size) == 'int' ? s.size : -1; }
function staged_path_safe(path) { return string(path) && under(path, STAGE_ROOT) && regular(path); }
function valid_sha(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function package_manifest_asset(id) {
	let raw = readfile(RESOURCE_MANIFEST), manifest = null; if (raw == null || length(raw) > 256 * 1024) return null;
	try { manifest = json(raw); } catch (e) { return null; }
	if (!object(manifest) || type(manifest.bundles) != 'array') return null;
	for (let i = 0; i < length(manifest.bundles); i++) for (let j = 0; j < length(manifest.bundles[i].assets || []); j++) {
		let item = manifest.bundles[i].assets[j]; if (!object(item) || item.id != id || !string(item.packagePath) || !regular(item.packagePath)) continue;
		let actual = sha256_file(item.packagePath); if (!valid_sha(item.sha256) || actual != item.sha256 || content_size(item.packagePath) != item.byteSize) return null;
		return { schema: 1, type: item.type, id: item.id, name: item.name, ownership: 'package', mutable: false,
			provenance: { kind: 'builtin/package', source: 'package baseline', expectedSha256: item.sha256 }, contentSha256: actual,
			byteSize: content_size(item.packagePath), revision: 0, path: item.packagePath, legacyPath: null, references: [], validation: { status: 'passed', errors: [] } };
	}
	return null;
}
function validate_request(request) {
	if (!object(request) || !valid_type(request.type) || !valid_id(request.type, request.id)) return fail('EINPUT', 'typed stable asset ID is required');
	if (!provenance_valid(request.provenance || { kind: 'imported' })) return fail('EINPUT', 'asset provenance is invalid');
	return { ok: true };
}

export const asset_registry_list = function(kind) { let state = state_load(); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); let assets = []; for (let i = 0; i < length(state.assets); i++) if (kind == null || state.assets[i].type == kind) { let a = copy(state.assets[i]); a.references = references_copy(a); push(assets, a); } return { ok: true, schema: 1, revision: state.revision, assets: assets }; };
export const asset_registry_get = function(id) { let state = state_load(); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); let asset = find_asset(state, id); return asset == null ? fail('EDEPENDENCY', 'asset dependency is missing') : ok(copy(asset)); };
export const asset_registry_import = function(request) {
	let checked = validate_request(request); if (!checked.ok) return checked; let provenance = request.provenance || { kind: 'imported' }; let content = base64_decode(request.contentBase64); if (content == null) return fail('EINPUT', 'contentBase64 is invalid');
	let normalized = normalize_content(request.type, content); if (!normalized.ok) return normalized; if (length(normalized.content) > LIMITS[request.type]) return fail('ESIZE', 'asset exceeds bounded size'); let state = state_load(); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); if (find_asset(state, request.id) != null) return fail('ECONFLICT', 'asset ID already exists');
	let slug = substr(request.id, length(request.type) + 1), path = server_asset_path(request.type, slug); if (!asset_parent_safe(request.type)) return fail('ESAFETY', 'asset parent is not a safe directory'); if (stat(path) != null) return regular(path) ? fail('ECONFLICT', 'canonical asset path already exists') : fail('ESAFETY', 'canonical asset path is not a regular file'); let text = normalized.content; if (!atomic_write(path, text)) return fail('EWRITE', 'asset atomic write failed');
	let asset = { schema: 1, type: request.type, id: request.id, name: string(request.name) && length(request.name) ? request.name : slug, ownership: provenance.kind == 'builtin/package' ? 'package' : 'manager', mutable: provenance.kind != 'builtin/package', provenance: copy(provenance), contentSha256: sha256_file(path), byteSize: content_size(path), revision: 1, path: path, legacyPath: null, references: [], validation: { status: request.type == 'lua' ? 'passed-structural-only' : 'passed', errors: [] } };
	if (asset.contentSha256 == null || asset.byteSize < 0) { try { unlink(path); } catch (e) {} return fail('EWRITE', 'asset evidence could not be read back'); } if (provenance.kind == 'builtin/package' && asset.contentSha256 != provenance.expectedSha256) { try { unlink(path); } catch (e) {} return fail('EVERIFY', 'package hash does not match provenance'); } push(state.assets, asset); state.revision++; if (!state_save(state)) { try { unlink(path); } catch (e) {} return fail('EWRITE', 'asset registry metadata atomic write failed'); } return ok(asset);
};
function remote_url_safe(url) {
	if (!string(url) || length(url) > MAX_REMOTE_URL_BYTES || !match(url, /^https?:\/\/[^\/?#]+(?:[\/?#].*)?$/i)) return false;
	let authority = match(url, /^https?:\/\/([^\/?#]+)/i);
	if (!authority || !string(authority[1]) || index(authority[1], '@') >= 0) return false;
	let authority_host = authority[1];
	if (substr(authority_host, 0, 1) == '[') return false;
	let host = lower_ascii(split(authority_host, ':')[0]);
	if (!length(host) || host == 'localhost' || host == 'localhost.localdomain' || substr(host, -6) == '.local' || substr(host, -9) == '.internal' || substr(host, 0, 4) == '127.' || substr(host, 0, 3) == '10.' || substr(host, 0, 8) == '192.168.') return false;
	if (match(host, /^172\.(1[6-9]|2[0-9]|3[0-1])\./) || match(host, /^169\.254\./) || match(host, /^0\./) || host == '::1' || substr(host, 0, 1) == '[') return false;
	return true;
}
function remote_url_host(url) { let authority = match(url, /^https?:\/\/([^\/?#]+)/i); if (!authority) return null; let host = authority[1]; if (substr(host, 0, 1) == '[') return null; return lower_ascii(split(host, ':')[0]); }
function remote_host_public(host) {
	if (!string(host) || !length(host)) return false;
	if (ipv4(host) || ipv6(host)) return !match(host, /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.)/) && host != '::1';
	let lookup = command('getent ahosts ' + shell_quote(host)), seen = false;
	if (lookup.rc != 0 || !string(lookup.out)) return false;
	let rows = split(lookup.out, '\n');
	for (let i = 0; i < length(rows); i++) { let address_match = match(trim(rows[i]), /^([^ \t]+)/), address = address_match ? address_match[1] : null; if (!string(address) || !length(address)) continue; if (match(address, /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.)/) || address == '::1' || substr(address, 0, 5) == 'fc00:' || substr(address, 0, 4) == 'fd00:') return false; seen = true; }
	return seen;
}
function remote_fetch(url, target, max_bytes) {
	if (!remote_url_safe(url)) return fail('EPOLICY', 'only public http/https URLs are allowed');
	let host = remote_url_host(url); if (!remote_host_public(host)) return fail('EPOLICY', 'remote host does not resolve to a public address');
	let command_result = command('curl -fsSL --proto "=http,https" --proto-redir "=http,https" --max-redirs 0 --connect-timeout 10 --max-time 30 --max-filesize ' + max_bytes + ' -o ' + shell_quote(target) + ' ' + shell_quote(url));
	if (command_result.rc != 0 || !regular(target)) return fail('EUNAVAILABLE', 'remote source is unavailable');
	let size = content_size(target);
	if (size < 0 || size > max_bytes) { try { unlink(target); } catch (e) {} return fail('ESIZE', 'remote source exceeds bounded size'); }
	return { ok: true, size: size };
}
function lua_validate_content(content) {
	let path = '/tmp/z2m-lua-validate.' + time(), result = null;
	try { writefile(path, content); } catch (e) { return { status: 'unavailable', errors: [], message: 'Синтаксическая проверка недоступна' }; }
	let probe = command('if command -v luac >/dev/null 2>&1; then luac -p ' + shell_quote(path) + '; else exit 127; fi');
	try { unlink(path); } catch (e) {}
	if (probe.rc == 127) return { status: 'unavailable', errors: [], message: 'Синтаксическая проверка недоступна' };
	if (probe.rc == 0) return { status: 'passed', errors: [], checker: 'luac' };
	let match_line = match(probe.out || '', /:(\d+):\s*(.*)/);
	return { status: 'failed', errors: [{ line: match_line ? +match_line[1] : null, message: match_line ? match_line[2] : trim(probe.out || 'Lua syntax error') }], checker: 'luac' };
}
export const asset_registry_get_content = function(id) {
	let result = asset_registry_get(id); if (!result.ok && result.error && result.error.code == 'EDEPENDENCY') { let packageAsset = package_manifest_asset(id); if (packageAsset != null) result = ok(packageAsset); }
	if (!result.ok) return result;
	let content = readfile(result.asset.path);
	if (content == null || length(content) > LIMITS[result.asset.type]) return fail('ESAFETY', 'asset content is unavailable or exceeds its type limit');
	let encoded = base64_encode(content, LIMITS[result.asset.type]); if (encoded == null) return fail('EIO', 'asset content could not be encoded');
	return { ok: true, asset: result.asset, contentBase64: encoded };
};
export const asset_registry_validate_content = function(id, contentBase64) {
	let result = asset_registry_get(id); if (!result.ok) return result;
	let content = base64_decode(contentBase64); if (content == null) return fail('EINPUT', 'contentBase64 is invalid');
	if (length(content) > LIMITS[result.asset.type]) return fail('ESIZE', 'asset exceeds bounded size');
	if (result.asset.type == 'lua') { let lua = lua_validate_content(content); return { ok: true, asset: result.asset, validation: lua }; }
	let normalized = normalize_content(result.asset.type, content); if (!normalized.ok) return normalized;
	return { ok: true, asset: result.asset, validation: { status: 'passed', errors: [], canonicalContentBase64: base64_encode(normalized.content, LIMITS[result.asset.type]) } };
};
export const asset_registry_import_url = function(request) {
	let checked = validate_request(request); if (!checked.ok) return checked;
	if (!remote_url_safe(request.url)) return fail('EPOLICY', 'only public http/https URLs are allowed');
	let path = '/tmp/z2m-asset-import.' + time(), fetched = remote_fetch(request.url, path, LIMITS[request.type]);
	if (!fetched.ok) return fetched;
	let content = readfile(path); try { unlink(path); } catch (e) {}
	if (content == null) return fail('EIO', 'remote content could not be read');
	let normalized = normalize_content(request.type, content); if (!normalized.ok) return normalized;
	let validation = request.type == 'lua' ? lua_validate_content(normalized.content) : { status: 'passed', errors: [] };
	return { ok: true, preview: true, type: request.type, id: request.id, url: request.url,
		contentBase64: base64_encode(normalized.content, LIMITS[request.type]), byteSize: length(normalized.content),
		validation: validation, provenance: copy(request.provenance || { kind: 'imported', source: request.url }) };
};
export const asset_registry_asn = function(request) {
	if (!object(request) || !string(request.asn) || !match(request.asn, /^AS?[0-9]{1,10}$/i)) return fail('EINPUT', 'ASN must be numeric or AS<number>');
	let number = lower_ascii(request.asn), asn = substr(number, 0, 2) == 'as' ? substr(number, 2) : number;
	if (+asn < 1 || +asn > 4294967295) return fail('EINPUT', 'ASN is out of range');
	let path = '/tmp/z2m-asn.' + time(), url = 'https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS' + asn, fetched = remote_fetch(url, path, 2 * 1024 * 1024);
	if (!fetched.ok) return fetched;
	let raw = readfile(path); try { unlink(path); } catch (e) {}
	let payload = null; try { payload = json(raw); } catch (e) { return fail('EVALIDATION', 'RIPE response is not valid JSON'); }
	if (!object(payload) || !object(payload.data) || type(payload.data.prefixes) != 'array' || length(payload.data.prefixes) > MAX_ASN_PREFIXES) return fail('EVALIDATION', 'RIPE response schema or prefix count is invalid');
	let prefixes = [], seen = {};
	for (let i = 0; i < length(payload.data.prefixes); i++) { let prefix = object(payload.data.prefixes[i]) ? normalized_ip(payload.data.prefixes[i].prefix) : null; if (prefix == null) return fail('EVALIDATION', 'RIPE response contains an invalid prefix'); if (!seen[prefix]) { seen[prefix] = true; push(prefixes, prefix); } }
	for (let i = 0; i < length(prefixes); i++) for (let j = i + 1; j < length(prefixes); j++) { let ai = index(prefixes[i], ':') >= 0 ? 1 : 0, aj = index(prefixes[j], ':') >= 0 ? 1 : 0, swap = ai > aj || (ai == aj && prefixes[i] > prefixes[j]); if (swap) { let tmp = prefixes[i]; prefixes[i] = prefixes[j]; prefixes[j] = tmp; } }
	let counts = { ipv4: 0, ipv6: 0 };
	for (let i = 0; i < length(prefixes); i++) counts[index(prefixes[i], ':') >= 0 ? 'ipv6' : 'ipv4']++;
	return { ok: true, source: 'RIPE', asn: 'AS' + asn, prefixes: prefixes, counts: counts };
};
export const asset_registry_register_builtin = function(request) {
	if (!object(request) || !valid_type(request.type) || !valid_id(request.type, request.id) || !provenance_valid(request.provenance) || request.provenance.kind != 'builtin/package') return fail('EINPUT', 'builtin registration is invalid'); let path = legacy_path(request.type, request.canonicalPath); if (path == null || !regular(path)) return fail('EINPUT', 'builtin path is not a trusted canonical regular file'); let actual = sha256_file(path); if (actual == null || actual != request.provenance.expectedSha256) return fail('EVERIFY', 'builtin hash does not match provenance'); let state = state_load(); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); if (find_asset(state, request.id) != null) return fail('ECONFLICT', 'asset ID already exists'); let asset = { schema: 1, type: request.type, id: request.id, name: request.name || substr(path, rindex(path, '/') + 1), ownership: 'package', mutable: false, provenance: copy(request.provenance), contentSha256: actual, byteSize: content_size(path), revision: 1, path: path, legacyPath: path, references: [], validation: { status: 'passed', errors: [] } }; push(state.assets, asset); state.revision++; if (!state_save(state)) return fail('EWRITE', 'asset registry metadata atomic write failed'); return ok(asset); };
export const asset_registry_reconcile_builtin = function(request) {
	let initial = asset_registry_register_builtin(request); if (initial.ok || initial.error.code != 'ECONFLICT') return initial;
	let state = state_load(), asset = state == null ? null : find_asset(state, request.id); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); if (asset == null) return fail('EDEPENDENCY', 'builtin asset disappeared during reconciliation'); let path = legacy_path(request.type, request.canonicalPath), actual = path == null ? null : sha256_file(path); if (asset.ownership != 'package' || asset.mutable == true || asset.type != request.type || asset.path != path) return fail('ECONFLICT', 'package identity collides with a non-package asset'); if (actual == null || actual != request.provenance.expectedSha256) return fail('EVERIFY', 'builtin hash does not match package manifest'); if (asset.contentSha256 == actual && asset.provenance.expectedSha256 == request.provenance.expectedSha256) return ok(copy(asset)); let old = copy(asset), next = copy(request.provenance); asset.provenance = next; asset.contentSha256 = actual; asset.byteSize = content_size(path); asset.revision++; state.revision++; if (!state_save(state)) { for (let k in old) asset[k] = old[k]; return fail('EWRITE', 'builtin registry update failed'); } return ok(copy(asset)); };
export const asset_registry_update = function(id, request) {
	let state = state_load(), asset = state == null ? null : find_asset(state, id); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); if (asset == null) return fail('EDEPENDENCY', 'asset dependency is missing'); if (!object(request)) return fail('EINPUT', 'asset update request is invalid'); if (asset.mutable != true) return fail('EPOLICY', 'builtin/package asset is read-only'); if (!mutable_asset_path_safe(asset) || !asset_parent_safe(asset.type)) return fail('ESAFETY', 'asset path is not manager-owned'); if (request.expectedRevision != asset.revision) return fail('ECONFLICT', 'asset revision is stale'); let content = base64_decode(request.contentBase64); if (content == null) return fail('EINPUT', 'contentBase64 is invalid'); let normalized = normalize_content(asset.type, content); if (!normalized.ok) return normalized; if (length(normalized.content) > LIMITS[asset.type]) return fail('ESIZE', 'asset exceeds bounded size'); let oldContent = readfile(asset.path); if (oldContent == null) return fail('ESAFETY', 'asset content could not be read before update'); if (!atomic_write(asset.path, normalized.content)) return fail('EWRITE', 'asset atomic update failed'); let oldSha = asset.contentSha256, oldSize = asset.byteSize, oldRevision = asset.revision; asset.contentSha256 = sha256_file(asset.path); asset.byteSize = content_size(asset.path); asset.revision++; state.revision++; if (!asset.contentSha256 || asset.byteSize < 0 || !state_save(state)) { atomic_write(asset.path, oldContent); asset.contentSha256 = oldSha; asset.byteSize = oldSize; asset.revision = oldRevision; return fail('EWRITE', 'asset registry metadata atomic write failed'); } return ok(copy(asset));
};
export const asset_registry_apply_bundle = function(request) {
	if (!object(request) || !string(request.bundleId) || !string(request.version) || !string(request.source)
		|| !string(request.sourceCommit)
		|| type(request.assets) != 'array' || !length(request.assets) || length(request.assets) > MAX_BUNDLE_ASSETS)
		return fail('EINPUT', 'resource bundle manifest is incomplete');
	let state = state_load(), oldStateRaw = readfile(STATE), total = 0, seen = {}, prepared = [];
	if (state == null) return fail('ESTATE', 'asset registry metadata is invalid');
	for (let i = 0; i < length(request.assets); i++) {
		let item = request.assets[i];
		if (!object(item) || !valid_type(item.type) || !valid_id(item.type, item.id) || seen[item.id]
			|| !staged_path_safe(item.stagedPath) || !valid_sha(item.sha256) || type(item.byteSize) != 'int'
			|| item.byteSize < 1 || item.byteSize > LIMITS[item.type]) return fail('EINPUT', 'resource bundle asset declaration is invalid');
		seen[item.id] = true;
		let actualSize = content_size(item.stagedPath), actualSha = sha256_file(item.stagedPath);
		if (actualSize != item.byteSize || actualSha == null || actualSha != item.sha256) return fail('EVERIFY', 'resource bundle asset hash or size mismatch', { id: item.id });
		total += actualSize; if (total > MAX_BUNDLE_BYTES) return fail('ESIZE', 'resource bundle exceeds bounded size');
		let content = readfile(item.stagedPath), normalized = normalize_content(item.type, content);
		if (!normalized.ok) return normalized;
		if (normalized.content != content) return fail('EVALIDATION', 'resource bundle asset is not canonical', { id: item.id });
		let old = find_asset(state, item.id);
		if (old != null) {
			if (old.ownership == 'package' || old.mutable != true || !old.provenance || old.provenance.kind != 'catalog/upstream') return fail('EPOLICY', 'package or user resource cannot be replaced by upstream', { id: item.id });
			if (item.expectedRevision == null || item.expectedRevision != old.revision) return fail('ECONFLICT', 'resource revision is stale', { id: item.id, expectedRevision: old.revision });
		} else if (find_asset(state, item.id) != null) return fail('ECONFLICT', 'resource asset ID already exists', { id: item.id });
		let provenance = item.provenance;
		if (!object(provenance) || provenance.kind != 'catalog/upstream' || !string(provenance.source) || !string(provenance.sourceCommit)
			|| !string(provenance.sourcePath) || !string(provenance.bundleId) || !string(provenance.version)) return fail('EINPUT', 'upstream provenance is incomplete', { id: item.id });
		push(prepared, { item: item, old: old, content: content, provenance: provenance });
	}
	for (let i = 0; i < length(prepared); i++) {
		let item = prepared[i].item;
		for (let j = 0; j < length(item.dependencies || []); j++) {
			let dependency = item.dependencies[j], dependencyId = object(dependency) ? dependency.id : dependency;
			if (!string(dependencyId) || (!seen[dependencyId] && find_asset(state, dependencyId) == null)) return fail('EDEPENDENCY', 'resource dependency is missing', { id: item.id, dependency: dependencyId });
		}
	}
	let changed = [], result = null;
	for (let i = 0; i < length(prepared); i++) {
		let entry = prepared[i], item = entry.item, old = entry.old, path = old != null ? old.path : server_asset_path(item.type, substr(item.id, length(item.type) + 1));
		if (old == null && (!asset_parent_safe(item.type) || stat(path) != null)) { result = fail('ESAFETY', 'resource target path is not safe', { id: item.id }); break; }
		if (old != null && (!mutable_asset_path_safe(old) || old.path != path)) { result = fail('ESAFETY', 'resource target path is not manager-owned', { id: item.id }); break; }
		let previous = stat(path) != null && regular(path) ? readfile(path) : null;
		if (previous == null && stat(path) != null) { result = fail('ESAFETY', 'resource target is not a regular file', { id: item.id }); break; }
		push(changed, { path: path, previous: previous });
		if (!atomic_write(path, entry.content)) { result = fail('EWRITE', 'resource activation failed', { id: item.id }); break; }
		if (old == null) {
			push(state.assets, { schema: 1, type: item.type, id: item.id, name: item.name || substr(item.id, length(item.type) + 1), ownership: 'manager', mutable: true, provenance: copy(entry.provenance), contentSha256: item.sha256, byteSize: item.byteSize, revision: 1, lastChecked: time(), lastUpdated: time(), path: path, legacyPath: null, references: [], validation: { status: 'passed', errors: [] } });
		} else {
			old.provenance = copy(entry.provenance); old.contentSha256 = item.sha256; old.byteSize = item.byteSize; old.revision++; old.lastChecked = time(); old.lastUpdated = time(); if (item.name) old.name = item.name;
		}
	}
	if (result == null) { state.revision++; if (!state_save(state)) result = fail('EWRITE', 'resource registry metadata write failed'); }
	if (result != null) {
		for (let i = length(changed) - 1; i >= 0; i--) { let item = changed[i]; if (item.previous == null) { try { unlink(item.path); } catch (e) {} } else atomic_write(item.path, item.previous); }
		if (oldStateRaw == null) { try { unlink(STATE); } catch (e) {} } else atomic_write(STATE, oldStateRaw);
		return result;
	}
	return { ok: true, bundleId: request.bundleId, version: request.version, updated: length(prepared), revision: state.revision };
};
export const asset_registry_delete = function(id) { let state = state_load(), asset = state == null ? null : find_asset(state, id); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); if (asset == null) return fail('EDEPENDENCY', 'asset dependency is missing'); if (length(asset.references)) return fail('EREFERENCED', 'asset is referenced', { references: references_copy(asset) }); if (asset.mutable != true) return fail('EPOLICY', 'builtin/package asset is read-only'); if (!mutable_asset_path_safe(asset) || !regular(asset.path)) return fail('ESAFETY', 'asset path is not a manager-owned regular file'); let oldContent = readfile(asset.path); if (oldContent == null) return fail('ESAFETY', 'asset content could not be read before delete'); try { unlink(asset.path); } catch (e) { return fail('EWRITE', 'asset delete failed'); } let kept = []; for (let i = 0; i < length(state.assets); i++) if (state.assets[i].id != id) push(kept, state.assets[i]); state.assets = kept; state.revision++; if (state_save(state)) return { ok: true, deleted: id }; atomic_write(asset.path, oldContent); return fail('EWRITE', 'asset registry metadata atomic write failed'); };
export const asset_registry_set_references = function(consumer, references) { if (!string(consumer) || type(references) != 'array' || length(consumer) > 128) return fail('EINPUT', 'consumer references are invalid'); let state = state_load(); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); for (let i = 0; i < length(references); i++) { let ref = references[i], asset = object(ref) ? find_asset(state, ref.id) : null; if (!object(ref) || !valid_type(ref.type) || !valid_id(ref.type, ref.id) || asset == null) return fail('EDEPENDENCY', 'referenced asset is missing'); if (asset.type != ref.type) return fail('ETYPE', 'referenced asset type is wrong'); } for (let i = 0; i < length(state.assets); i++) { let kept = []; for (let j = 0; j < length(state.assets[i].references); j++) if (state.assets[i].references[j].consumer != consumer) push(kept, state.assets[i].references[j]); state.assets[i].references = kept; } for (let i = 0; i < length(references); i++) { let ref = references[i], asset = find_asset(state, ref.id); push(asset.references, { consumer: consumer, type: ref.type, id: ref.id, revision: ref.revision == null ? null : ref.revision, contentSha256: ref.contentSha256 == null ? null : ref.contentSha256 }); } state.revision++; return state_save(state) ? { ok: true } : fail('EWRITE', 'asset registry metadata atomic write failed'); };
export const asset_registry_resolve = function(reference) { if (!object(reference) || !valid_type(reference.type)) return fail('EINPUT', 'asset type is required'); let state = state_load(), asset = state == null ? null : find_asset(state, reference.id); if (state == null) return fail('ESTATE', 'asset registry metadata is invalid'); if (asset == null && string(reference.legacyPath)) { let legacy = legacy_path(reference.type, reference.legacyPath); if (legacy == null) return fail('EINPUT', 'legacy path is outside the trusted canonical root'); for (let i = 0; i < length(state.assets); i++) if (state.assets[i].type == reference.type && state.assets[i].legacyPath == legacy) { asset = state.assets[i]; break; } } if (asset == null) return fail('EDEPENDENCY', 'asset dependency is missing'); if (asset.type != reference.type) return fail('ETYPE', 'asset type does not match reference'); if (reference.revision != null && reference.revision != asset.revision) return fail('ECONFLICT', 'asset revision is stale'); if (reference.contentSha256 != null && reference.contentSha256 != asset.contentSha256) return fail('ECONFLICT', 'asset hash is stale'); if (!regular(asset.path)) return fail('ESAFETY', 'asset path is not a regular non-symlink file'); let actual = sha256_file(asset.path); if (actual == null || actual != asset.contentSha256) return fail('EVERIFY', 'asset content hash does not match registry metadata'); return ok(copy(asset)); };
export const asset_registry_validate = function(id) { let resolved = asset_registry_get(id); if (!resolved.ok) return resolved; let asset = resolved.asset, result = asset_registry_resolve({ type: asset.type, id: asset.id, revision: asset.revision, contentSha256: asset.contentSha256 }); if (!result.ok) return result; return { ok: true, asset: asset, validation: asset.validation }; };

// Server-only compiler environment. It deliberately exposes metadata and
// resolved paths produced here, never caller-supplied paths. Empty/unavailable
// registry remains an empty compatibility environment for old catalog tests.
export const asset_registry_environment = function() {
	let listed = asset_registry_list(null), environment = { assetRefs: {}, lua: {}, blobs: {}, lists: {}, functions: {} };
	add_legacy_environment(environment);
	if (!listed.ok) return {};
	for (let i = 0; i < length(listed.assets); i++) {
		let asset = listed.assets[i], descriptor = { id: asset.id, type: asset.type, path: asset.path,
			available: regular(asset.path), revision: asset.revision, contentSha256: asset.contentSha256,
			present: regular(asset.path), safe: regular(asset.path), symlink: link_target(asset.path) != null };
		environment.assetRefs[asset.id] = descriptor;
		if (asset.type == 'lua') { environment.lua[asset.id] = descriptor; environment.lua[asset.path] = descriptor; }
		if (asset.type == 'blob') environment.blobs[asset.id] = descriptor;
		if (asset.type == 'hostlist' || asset.type == 'hosts') environment.lists[asset.id] = descriptor;
		if (asset.type == 'ipset') environment.lists[asset.id] = descriptor;
	}
	return environment;
};
