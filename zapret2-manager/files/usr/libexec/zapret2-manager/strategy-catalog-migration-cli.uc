#!/usr/bin/ucode
'use strict';

import { strategy_catalog_migrate } from './strategy-catalog-migration.uc';

let result = null;
try { result = strategy_catalog_migrate(); }
catch (e) { result = { ok: false, migrated: false, error: { code: 'EUNAVAILABLE', message: 'Strategy catalog migration raised an exception' } }; }
print(sprintf('%J', result) + '\n');
// Logical migration failures are reported as JSON so postinst can preserve
// the verified legacy catalog and leave an explicit repair marker.
