#!/usr/bin/ucode
'use strict';
// service-dns-cli.uc — CLI wrapper for the service-dns.uc library.
//
// service-dns.uc is a PURE importable library: `export const service_dns_*`,
// no shebang, no ARGV, no CLI entry. This file is the executable entry
// point — shebang, NO `export` (script mode), imports the library
// functions, dispatches ARGV. It is NEVER imported (same idiom as
// apply-cli.uc, status.uc, service.uc). Run via
// `ucode service-dns-cli.uc <subcommand>`.
//
//   ucode service-dns-cli.uc status                → JSON full state + preview
//   ucode service-dns-cli.uc set  <edit-file>      → JSON {ok, ...}; file holds
//                                                    the `edit` JSON STRING
//                                                    (selections + revision)
//   ucode service-dns-cli.uc apply                 → JSON apply result
//   ucode service-dns-cli.uc rollback              → JSON rollback result

import { readfile } from 'fs';
import {
	service_dns_status,
	service_dns_set,
	service_dns_apply,
	service_dns_rollback,
	service_dns_apply_status,
	service_dns_tiktok_set_async, service_dns_tiktok_status, service_dns_tiktok_check
} from './service-dns.uc';

let cmd = ARGV[0];

if (cmd == 'status') {
	print(sprintf("%J", service_dns_status()) + '\n');
} else if (cmd == 'set') {
	let file = ARGV[1];
	if (!file) { print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'no edit file' } }) + '\n'); exit(1); }
	let raw = readfile(file);
	if (!raw) { print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'empty edit file' } }) + '\n'); exit(1); }
	let edit = null;
	try { edit = json(raw); } catch (e) { edit = null; }
	if (!edit || type(edit) != 'object') { print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON object' } }) + '\n'); exit(1); }
	print(sprintf("%J", service_dns_set({ args: edit })) + '\n');
} else if (cmd == 'apply') {
	print(sprintf("%J", service_dns_apply({ args: { revision: null } })) + '\n');
} else if (cmd == 'apply-status') {
	let file = ARGV[1];
	let obj = null;
	if (file) { let raw = readfile(file); if (raw) { try { obj = json(raw); } catch (e) {} } }
	print(sprintf("%J", service_dns_apply_status({ args: obj || {} })) + '\n');
} else if (cmd == 'tiktok-status') {
	print(sprintf("%J", service_dns_tiktok_status()) + '\n');
} else if (cmd == 'tiktok-check') {
	print(sprintf("%J", service_dns_tiktok_check()) + '\n');
} else if (cmd == 'tiktok-set-async') {
	let file = ARGV[1], raw = file ? readfile(file) : null, obj = null;
	if (raw) { try { obj = json(raw); } catch (e) {} }
	print(sprintf("%J", service_dns_tiktok_set_async({ args: obj || {} })) + '\n');
} else if (cmd == 'rollback') {
	print(sprintf("%J", service_dns_rollback()) + '\n');
} else {
	print('usage: ucode service-dns-cli.uc status | set <edit-file> | apply | apply-status | tiktok-status | tiktok-check | tiktok-set-async | rollback\n');
	exit(1);
}
