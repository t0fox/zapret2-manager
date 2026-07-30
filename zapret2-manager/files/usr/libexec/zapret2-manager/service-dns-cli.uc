#!/usr/bin/ucode
'use strict';
// service-dns-cli.uc — CLI wrapper for the service-dns.uc library.
//
// service-dns.uc is a PURE importable library: `export const service_dns_*`,
// no shebang, no ARGV, no CLI entry. This file is the executable entry
// point — shebang, NO `export` (script mode), imports the library
// functions, dispatches ARGV. It is NEVER imported (same idiom as
// lists-cli.uc, apply-cli.uc, status.uc, service.uc). Run via
// `ucode service-dns-cli.uc <subcommand>`.
//
//   ucode service-dns-cli.uc providers            → JSON provider dataset
//   ucode service-dns-cli.uc status                → JSON full state + preview
//   ucode service-dns-cli.uc check                 → JSON bounded resolution check
//   ucode service-dns-cli.uc preview               → JSON zero-write diff
//   ucode service-dns-cli.uc set  <edit-file>      → JSON {ok, ...}; file holds
//                                                    the `edit` JSON STRING
//                                                    (selections + revision)
//   ucode service-dns-cli.uc apply                 → JSON apply result
//   ucode service-dns-cli.uc rollback              → JSON rollback result

import { readfile } from 'fs';
import {
	service_dns_providers,
	service_dns_status,
	service_dns_check,
	service_dns_preview,
	service_dns_set,
	service_dns_apply,
	service_dns_rollback
} from './service-dns.uc';

let cmd = ARGV[0];

if (cmd == 'providers') {
	print(sprintf("%J", service_dns_providers()) + '\n');
} else if (cmd == 'status') {
	print(sprintf("%J", service_dns_status()) + '\n');
} else if (cmd == 'check') {
	print(sprintf("%J", service_dns_check()) + '\n');
} else if (cmd == 'preview') {
	print(sprintf("%J", service_dns_preview()) + '\n');
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
} else if (cmd == 'rollback') {
	print(sprintf("%J", service_dns_rollback()) + '\n');
} else {
	print('usage: ucode service-dns-cli.uc providers | status | check | preview | set <edit-file> | apply | rollback\n');
	exit(1);
}
