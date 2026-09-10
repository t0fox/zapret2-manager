#!/usr/bin/ucode
'use strict';
// proxy-cli.uc — CLI wrapper for proxy.uc (read-only capabilities/status) and
// proxycfg.uc (the functional slice: config, secret, health, link). Same idiom
// as the other *-cli.uc wrappers.
//
//   ucode proxy-cli.uc capabilities        → proxy_capabilities()
//   ucode proxy-cli.uc status              → proxy_status()
//   ucode proxy-cli.uc config_get          → proxycfg_get()
//   ucode proxy-cli.uc health [f]          → proxycfg_health(args|{})
//   ucode proxy-cli.uc link_info [f]       → proxycfg_link_info(args|{})
//   ucode proxy-cli.uc validate <f>        → proxycfg_validate(args)
//   ucode proxy-cli.uc preview <f>         → proxycfg_preview(args)
//   ucode proxy-cli.uc apply <f>           → proxycfg_apply(args)
//   ucode proxy-cli.uc secret_rotate       → proxycfg_secret_rotate()

import { readfile } from 'fs';
import { proxy_capabilities, proxy_status } from './proxy.uc';
import {
	proxycfg_get, proxycfg_validate, proxycfg_preview, proxycfg_apply,
	proxycfg_secret_rotate, proxycfg_health, proxycfg_link_info
} from './proxycfg.uc';

function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	let obj = null;
	try { obj = json(raw); } catch (e) { return null; }
	return obj;
}

function emit(result) {
	print(sprintf("%J", result) + '\n');
}

let mode = ARGV[0];

if (mode == 'capabilities') {
	emit(proxy_capabilities());
} else if (mode == 'status') {
	emit(proxy_status());
} else if (mode == 'config_get') {
	emit(proxycfg_get());
} else if (mode == 'health') {
	emit(proxycfg_health(read_args(ARGV[1])));
} else if (mode == 'link_info') {
	emit(proxycfg_link_info(read_args(ARGV[1])));
} else if (mode == 'validate') {
	emit(proxycfg_validate(read_args(ARGV[1])));
} else if (mode == 'preview') {
	emit(proxycfg_preview(read_args(ARGV[1])));
} else if (mode == 'apply') {
	emit(proxycfg_apply(read_args(ARGV[1])));
} else if (mode == 'secret_rotate') {
	emit(proxycfg_secret_rotate());
} else {
	print('usage: ucode proxy-cli.uc capabilities | status | config_get | health [f] | link_info [f] | validate <f> | preview <f> | apply <f> | secret_rotate\n');
	exit(1);
}
