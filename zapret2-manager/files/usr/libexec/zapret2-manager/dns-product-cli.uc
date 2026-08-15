#!/usr/bin/ucode
'use strict';
// Canonical DNS product CLI. JSON request bodies are carried by a bounded
// request file and never become shell fragments or arbitrary paths.

import { readfile } from 'fs';
import { dns_product_get, dns_product_providers, dns_product_status, dns_product_preview, dns_product_validate, dns_product_apply, dns_product_rollback } from './dns-product.uc';

function read_request(file) {
	if (!file || type(file) != 'string' || length(file) > 240) return null;
	let raw = readfile(file);
	if (!raw || length(raw) > 65536) return null;
	try { let value = json(raw); return type(value) == 'object' && value != null ? value : null; } catch (e) { return null; }
}
function output(value) { print(sprintf('%J', value) + '\n'); }

let mode = ARGV[0], request = ARGV[1] ? read_request(ARGV[1]) : null, result = null;
if (mode == 'get') result = dns_product_get();
else if (mode == 'providers') result = dns_product_providers();
else if (mode == 'status') result = dns_product_status();
else if (mode == 'preview') result = request == null && ARGV[1] ? { ok: false, error: { code: 'invalid_request', message: 'request file is invalid' } } : dns_product_preview(request);
else if (mode == 'validate') result = request == null ? { ok: false, error: { code: 'invalid_request', message: 'request file is required' } } : dns_product_validate(request);
else if (mode == 'apply') result = request == null ? { ok: false, error: { code: 'invalid_request', message: 'request file is required' } } : dns_product_apply(request);
else if (mode == 'rollback') result = request == null ? { ok: false, error: { code: 'invalid_request', message: 'request file is required' } } : dns_product_rollback(request);
else result = { ok: false, error: { code: 'invalid_request', message: 'unknown DNS product operation' } };
output(result);
