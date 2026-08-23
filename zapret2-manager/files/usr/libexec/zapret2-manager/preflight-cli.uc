#!/usr/bin/ucode
'use strict';
// preflight-cli.uc — standalone CLI for the install-proof gate.
// Library file (native-preflight.uc) is a module: running a file that
// contains `export` as a plain script is rejected by ucode, so this thin
// wrapper does the direct-run entry point instead.

import { install_proof } from './native-preflight.uc';

print(sprintf('%J', install_proof()) + '\n');
exit(0);
