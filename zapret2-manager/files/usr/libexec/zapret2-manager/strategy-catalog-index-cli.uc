#!/usr/bin/ucode
'use strict';

import { strategy_catalog_write_read_index } from './strategy-catalog.uc';

let result = strategy_catalog_write_read_index(null);
print(sprintf('%J', result) + '\n');
if (!result || result.ok != true) exit(1);
