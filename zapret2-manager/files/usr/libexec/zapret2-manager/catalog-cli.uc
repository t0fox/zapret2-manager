#!/usr/bin/ucode
'use strict';

// The visible DNS and Strategy pages use this only for the read-only catalog
// projection. Domain Hub owns catalog preview/apply in-process.
import { catalog_list } from './catalog.uc';

if (ARGV[0] != 'list') {
	print('usage: ucode catalog-cli.uc list\n');
	exit(1);
}

print(sprintf('%J', catalog_list()) + '\n');
