#!/usr/bin/ucode
'use strict';

// Thin Engine materialization adapter. The lifecycle coordinator remains the
// sole owner of Registry-to-runtime mapping; this command only asks that
// canonical bridge to re-materialize the confirmed release after an Engine
// payload install. A missing installed authority is an explicit blocked state,
// never a package-success fallback.
import { z2k_runtime_materialize_confirmed } from './resource-update.uc';

let result = z2k_runtime_materialize_confirmed();
print(sprintf('%J', result) + '\n');
exit(result && result.ok === true ? 0 : 1);
