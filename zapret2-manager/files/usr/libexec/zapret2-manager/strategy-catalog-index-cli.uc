#!/usr/bin/ucode
'use strict';

// Catalog read-index lifecycle CLI.
//
//   strategy-catalog-index-cli.uc            build/refresh the compact read index
//   strategy-catalog-index-cli.uc --repair   full catalog verification first, then write
//
// Exit codes are load-bearing: postinst and maintenance gates treat a zero
// exit as "index materialized". ok:true with written:false is a FAILURE and
// must exit non-zero — a missing index silently starves every ordinary read.

import { strategy_catalog_write_read_index, strategy_catalog_resolve } from './strategy-catalog.uc';

let repair = false;
for (let arg in (ARGV != null ? ARGV : []))
	if (arg == '--repair') repair = true;

if (repair) {
	let resolved = strategy_catalog_resolve({ forceVerify: true });
	if (!resolved || resolved.ok != true) {
		print(sprintf('%J', resolved) + '\n');
		exit(1);
	}
}

let result = strategy_catalog_write_read_index(null);
print(sprintf('%J', result) + '\n');
if (!result || result.ok != true || result.written != true) exit(1);
