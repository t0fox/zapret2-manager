#!/usr/bin/ucode
'use strict';
// dnsprov-cli.uc — CLI wrapper for dnsprov.uc (same idiom as other *-cli.uc).
// READ-ONLY diagnostics — no resolver changes, ever.
//
//   ucode dnsprov-cli.uc components      → dnsprov_components()
//   ucode dnsprov-cli.uc providers       → dnsprov_providers()
//   ucode dnsprov-cli.uc diagnose <file> → {"domain"?,"provider"?}

import { readfile } from 'fs';
import { dnsprov_components, dnsprov_providers, dnsprov_diagnose } from './dnsprov.uc';

function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	let obj = null;
	try { obj = json(raw); } catch (e) { return null; }
	return obj;
}

let mode = ARGV[0];

if (mode == 'components') {
	print(sprintf("%J", dnsprov_components()) + '\n');
} else if (mode == 'providers') {
	print(sprintf("%J", dnsprov_providers()) + '\n');
} else if (mode == 'diagnose') {
	print(sprintf("%J", dnsprov_diagnose(read_args(ARGV[1]))) + '\n');
} else {
	print('usage: ucode dnsprov-cli.uc components | providers | diagnose <f>\n');
	exit(1);
}
