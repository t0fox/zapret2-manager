#!/usr/bin/ucode
'use strict';

import { collect } from './core/status-collector.uc';

let status = collect();
if (length(ARGV) == 0 || ARGV[0] != '--no-print')
	print(sprintf('%J', status) + '\n');
