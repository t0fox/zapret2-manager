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
// A clean Engine install has no confirmed Z2K release yet.  That is an
// explicit, successful no-op for this bridge; the later Z2K lifecycle owns
// the first dynamic activation.  Keep all other failures non-zero.
let successful = result && (result.ok === true ||
    (result.state === 'blocked-unknown-authority' && result.skipped === true));
exit(successful ? 0 : 1);
