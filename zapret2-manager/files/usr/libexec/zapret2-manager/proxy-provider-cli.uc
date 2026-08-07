#!/usr/bin/ucode
'use strict';

import { readfile } from 'fs';
import {
	proxy_provider_catalog,
	proxy_provider_status,
	proxy_provider_check_updates,
	proxy_provider_install,
	proxy_provider_remove,
	proxy_provider_purge
} from './proxy-provider.uc';
import { proxy_provider_preflight } from './proxy-provider-preflight.uc';

function read_input(path) {
	if (!path) return {};
	let raw = readfile(path);
	if (!raw) return {};
	try {
		let parsed = json(raw);
		return type(parsed) == 'object' && parsed != null ? parsed : {};
	} catch (e) { return {}; }
}

function emit(value) {
	print(sprintf('%J', value) + '\n');
}

let action = ARGV[0];
if (action == 'catalog') emit(proxy_provider_catalog());
else if (action == 'status') emit(proxy_provider_status());
else if (action == 'preflight') emit(proxy_provider_preflight());
else if (action == 'check') emit(proxy_provider_check_updates(read_input(ARGV[1])));
else if (action == 'install') emit(proxy_provider_install(read_input(ARGV[1])));
else if (action == 'remove') emit(proxy_provider_remove(read_input(ARGV[1])));
else if (action == 'purge') emit(proxy_provider_purge(read_input(ARGV[1])));
else {
	print('usage: proxy-provider-cli.uc catalog | status | preflight | check <json-file> | install <json-file> | remove <json-file> | purge <json-file>\n');
	exit(1);
}
