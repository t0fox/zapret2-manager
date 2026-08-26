#!/usr/bin/ucode
'use strict';
import { catalog_refresh_start, catalog_refresh_status, catalog_refresh_worker_run } from './strategy-catalog-refresh.uc';
let mode = ARGV[0];
let res = null;
if (mode == 'start') res = catalog_refresh_start();
else if (mode == 'status') res = catalog_refresh_status();
else if (mode == 'run') res = catalog_refresh_worker_run();
else res = { ok: false, error: { code: 'EINPUT', message: 'unknown refresh operation' } };
print(sprintf('%J', res) + '\n');
// Always exit 0 so that the rpcd popen wrapper receives JSON even for logical
// errors (EBUSY/EIO/EVERIFY). A non-zero exit would be surfaced as a generic
// transport failure and then mis-classified as “RPC-компонент недоступен”.
/* exit code intentionally 0 */
