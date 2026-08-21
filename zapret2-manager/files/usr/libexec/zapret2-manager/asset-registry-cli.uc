#!/usr/bin/ucode
'use strict';

import { readfile, stat, readlink } from 'fs';
import { asset_registry_list, asset_registry_get, asset_registry_import,
	asset_registry_register_builtin, asset_registry_update, asset_registry_delete,
	asset_registry_set_references, asset_registry_resolve, asset_registry_validate,
	asset_registry_apply_bundle, asset_registry_get_content, asset_registry_validate_content,
	asset_registry_import_url, asset_registry_asn } from './asset-registry.uc';

function emit(value) { print(sprintf('%J', value) + '\n'); }
function private_request_path(path) {
	if (type(path) != 'string' || substr(path, 0, length('/tmp/z2m-assets-edit.')) != '/tmp/z2m-assets-edit.') return false;
	let s = null, link = null; try { s = stat(path); link = readlink(path); } catch (e) { return false; }
	return type(s) == 'object' && s != null && s.type == 'file' && link == null && type(s.size) == 'int' && s.size <= 32 * 1024 * 1024;
}
function request_file(index) {
	let path = ARGV[index], raw = path != null && private_request_path(path) ? readfile(path) : null, value = null;
	if (raw == null || length(raw) > 32 * 1024 * 1024) return null;
	try { value = json(raw); } catch (e) { return null; }
	return value;
}

let mode = ARGV[0], result = null;
if (mode == 'list') result = asset_registry_list(ARGV[1] || null);
else if (mode == 'get') result = asset_registry_get(ARGV[1]);
else if (mode == 'content') result = asset_registry_get_content(ARGV[1]);
else if (mode == 'import') result = asset_registry_import(request_file(1));
else if (mode == 'import-url') result = asset_registry_import_url(request_file(1));
else if (mode == 'register-builtin') result = asset_registry_register_builtin(request_file(1));
else if (mode == 'update') { let input = request_file(2); result = asset_registry_update(ARGV[1], input); }
else if (mode == 'delete') result = asset_registry_delete(ARGV[1]);
else if (mode == 'references') { let input = request_file(1); result = input == null ? { ok: false, error: { code: 'EINPUT', message: 'invalid references request' } } : asset_registry_set_references(input.consumer, input.references); }
else if (mode == 'resolve') result = asset_registry_resolve(request_file(1));
else if (mode == 'validate') result = asset_registry_validate(ARGV[1]);
else if (mode == 'validate-content') { let request = request_file(2); result = request == null ? { ok: false, error: { code: 'EINPUT', message: 'invalid validation request' } } : asset_registry_validate_content(ARGV[1], request.contentBase64); }
else if (mode == 'asn') result = asset_registry_asn(request_file(1));
else if (mode == 'update-bundle') result = asset_registry_apply_bundle(request_file(1));
else result = { ok: false, error: { code: 'EINPUT', message: 'unsupported asset registry operation' } };
emit(result);
if (!result || result.ok != true) exit(1);
