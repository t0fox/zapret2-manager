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

let proof = install_proof();
// A first Engine install necessarily runs before any Z2K release has been
// selected.  Defer composition-dependent Lua proof to the subsequent Z2K
// activation, while keeping candidate-declared native requirements strict.
if (proof && proof.ok !== true
    && getenv('Z2M_CLEAN_ENGINE_BOOTSTRAP') == '1'
    && proof.compositionStatus == 'unavailable'
    && length(proof.requiredCapabilities || []) == 0) {
  proof.ok = true;
  proof.cleanBootstrap = true;
  proof.compositionStatus = 'pending-z2k';
  proof.compositionError = 'Z2K runtime composition will be proven during activation.';
}
print(sprintf('%J', proof) + '\n');
exit(0);
