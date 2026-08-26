#!/usr/bin/ucode
'use strict';
import { catalog_refresh_start, catalog_refresh_status } from './strategy-catalog-refresh.uc';
let mode = ARGV[0];
let res = null;
if (mode == 'start') res = catalog_refresh_start();
else if (mode == 'status') res = catalog_refresh_status();
else res = { ok: false, error: { code: 'EINPUT', message: 'unknown refresh operation' } };
print(sprintf('%J', res) + '\n');
if (!res || res.ok != true) exit(1);
