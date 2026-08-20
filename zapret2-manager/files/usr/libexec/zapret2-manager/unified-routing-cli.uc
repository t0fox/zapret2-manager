#!/usr/bin/ucode
'use strict';

import { readfile, stat, readlink } from 'fs';
import {
	route_list, route_get, route_create, route_update, route_preview, route_validate,
	route_apply, route_status, route_remove, route_reconcile
} from './unified-routing.uc';

function emit(value) { print(sprintf('%J', value) + '\n'); }
function request_path(path) {
	if (type(path) != 'string' || substr(path, 0, length('/tmp/z2m-route-edit.')) != '/tmp/z2m-route-edit.') return false;
	let meta = null; try { meta = stat(path); } catch (e) { return false; }
	return type(meta) == 'object' && meta != null && meta.type == 'file' && readlink(path) == null && type(meta.size) == 'int' && meta.size <= 256 * 1024;
}
function request(index) {
	let path = ARGV[index], raw = request_path(path) ? readfile(path) : null;
	if (raw == null || length(raw) > 256 * 1024) return null;
	try { let value = json(raw); return type(value) == 'object' && value != null ? value : null; } catch (e) { return null; }
}

let mode = ARGV[0], input = null, result = null;
if (mode == 'list') result = route_list();
else if (mode == 'reconcile') result = route_reconcile();
else {
	input = request(1);
	if (input == null) result = { ok: false, error: { code: 'EINPUT', message: 'bounded route request is required' } };
	else if (mode == 'get') result = route_get(input);
	else if (mode == 'create') result = route_create(input);
	else if (mode == 'update') result = route_update(input);
	else if (mode == 'preview') result = route_preview(input);
	else if (mode == 'validate') result = route_validate(input);
	else if (mode == 'apply') result = route_apply(input);
	else if (mode == 'status') result = route_status(input);
	else if (mode == 'remove') result = route_remove(input);
	else result = { ok: false, error: { code: 'EINPUT', message: 'unsupported route operation' } };
}
emit(result);
if (!result || result.ok != true) exit(1);
