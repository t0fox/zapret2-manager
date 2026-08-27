#!/usr/bin/ucode
'use strict';
// preflight-cli.uc — standalone CLI for the install-proof gate.
// Library file (native-preflight.uc) is a module: running a file that
// contains `export` as a plain script is rejected by ucode, so this thin
// wrapper does the direct-run entry point instead.
//
// The required-capability list arrives via env Z2M_REQUIRED_CAPABILITIES
// (space-separated names), supplied by the worker from the checked
// candidate. Empty/unset means: no native capability requirements.

import { install_proof } from './native-preflight.uc';

print(sprintf('%J', install_proof()) + '\n');
exit(0);
