# Task 3 Report

## Status

Implemented the Task 3 reorder RPC contract on the existing branch.

## Changes

- Added `profiles_reorder_method(req)` using `profiles_edit_action('reorder', req)`.
- Registered `profiles_reorder` with the exact `{ edit: 'string' }` signature.
- Granted `profiles_reorder` in the LuCI write ACL.
- Added `profilesReorder` and exposed it as `api.profiles.reorder`.
- Extended the product contract test across RPC, signature, ACL, and API surfaces.

## TDD Evidence

- RED: `node --test tests/product/profiles-contract.test.mjs` failed on the missing reorder method and registration.
- GREEN: `node --test tests/product/profiles-contract.test.mjs tests/product/profiles-model.test.mjs` passed 13/13 tests.

## Broader Verification

- `git diff --check`: passed.
- `scripts/test/native.sh` with a fresh `/tmp` `TMPDIR`: all non-root phases passed, including 42 broker, 35 helper, 30 package, and 111 aggregate tests.
- The final `native-root.sh` phase was not run because `sudo` requires interactive authentication in this environment.

## Concerns

- The default `/home/kirill/z2m-work/native-tmp` is owned by `root:root`, so the canonical gate requires a writable `TMPDIR` override for non-root runs.
- Privileged native-root verification remains unavailable without sudo authentication; Task 3 does not modify privileged or native-helper code.
