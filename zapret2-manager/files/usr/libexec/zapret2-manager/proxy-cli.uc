#!/usr/bin/ucode
'use strict';
// proxy-cli.uc — CLI wrapper for proxy.uc (same idiom as the other *-cli.uc
// wrappers). READ-ONLY — nothing here mutates: no install, no service
// control, no config/secret/firewall operations.
//
//   ucode proxy-cli.uc capabilities   → proxy_capabilities()
//   ucode proxy-cli.uc status         → proxy_status()

import { proxy_capabilities, proxy_status } from './proxy.uc';

let mode = ARGV[0];

if (mode == 'capabilities') {
	print(sprintf("%J", proxy_capabilities()) + '\n');
} else if (mode == 'status') {
	print(sprintf("%J", proxy_status()) + '\n');
} else {
	print('usage: ucode proxy-cli.uc capabilities | status\n');
	exit(1);
}
