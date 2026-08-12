'use strict';

// Bounded I/O adapter for binding Scanner plans to the installed compiler bytes.
import { readlink, stat, popen } from 'fs';
import { strategy_compiler_authority, strategy_compiler_source_authority } from './strategy-compiler.uc';

const INSTALLED_COMPILER = '/usr/libexec/zapret2-manager/strategy-compiler.uc';
const MAX_COMPILER_BYTES = 1024 * 1024;

function safe_absolute_path(path) {
	return type(path) == 'string' && length(path) > 1 && length(path) <= 4096
		&& substr(path, 0, 1) == '/' && index(path, chr(0)) < 0
		&& index(path, '//') < 0 && index(path, '/../') < 0 && substr(path, -3) != '/..';
}

function compiler_path() {
	let override = getenv('Z2M_SCANNER_COMPILER_SOURCE');
	if (override != null && getenv('Z2M_SCANNER_SERVER_TEST') == '1') return override;
	return INSTALLED_COMPILER;
}

function shell_quote(value) {
	let out = "'";
	for (let i = 0; i < length(value); i++) out += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1);
	return out + "'";
}

function sha256_file(path) {
	let process = null;
	try { process = popen('sha256sum ' + shell_quote(path) + ' 2>/dev/null', 'r'); } catch (e) { return null; }
	if (process == null) return null;
	let output = process.read('all') || '', rc = process.close(), fields = split(trim(output), /[ \t]+/);
	return rc == 0 && length(fields) > 0 && match(fields[0], /^[a-f0-9]{64}$/) ? fields[0] : null;
}

export const scanner_compiler_authority = function() {
	let path = compiler_path(), metadata = null, link = null;
	if (!safe_absolute_path(path)) return null;
	try { metadata = stat(path); } catch (e) { return null; }
	try { link = readlink(path); } catch (e) { link = null; }
	if (link != null || metadata == null || metadata.type != 'file'
		|| type(metadata.size) != 'int' || metadata.size < 1 || metadata.size > MAX_COMPILER_BYTES) return null;
	let sourceSha256 = sha256_file(path);
	if (sourceSha256 == null) return null;
	let semantic = strategy_compiler_authority();
	if (semantic == null) return null;
	return strategy_compiler_source_authority(semantic, sourceSha256);
};
