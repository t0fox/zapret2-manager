# Task 13 report: integrate Z2K data and diagnostics

Status: IMPLEMENTED; focused Task 13 gates pass. Router deployment, live
rpcd/OpenWrt acceptance, browser acceptance, merge and push were not run.

## Scope delivered

- Added `z2k-data-refresh.uc` with bounded release-owned and dynamic dataset
  validation, semantic identity projection, fixed publication roots, internal
  staging, atomic per-file publication and compensation on a partial publish.
  Release-owned data contributes `coreIdentity`; schema-1 dynamic datasets
  have a separate `dynamicIdentity`, so a dynamic revision does not change Core
  identity. Refresh rejects unsafe names, malformed dynamic rows, stale Core
  identity, incoherent authority and Detect source-commit mismatch before
  staging.
- Added `z2k-diagnostics.uc` as a read-only projection of existing receipt,
  runtime composition, Asset Registry, strategy catalog, Detect,
  autodiscovery and autocircular authorities. It returns exactly the required
  18 IDs, each as `{id,status,evidence,error}`, with bounded evidence and
  `ESCHEMA` on malformed projections. `tcp16`, `nfqueue`, `firewall`, and
  `nfqws2` remain explicitly unavailable when no existing runtime authority
  supplies evidence; no second lifecycle truth or database was introduced.
- Wired typed `z2k_diagnostics` and `z2k_data_refresh` methods into the
  canonical rpcd object and ACL. Data refresh accepts only bounded JSON through
  the existing edit adapter; executable names, raw commands, caller paths and
  environment are not accepted.
- Added `tests/product/z2k-data-diagnostics.test.mjs` covering release/dynamic
  identity separation, malformed data, unsafe paths, failed publish, exact
  diagnostics IDs/shape, malformed authority projection, RPC registration and
  ACL exposure.

## TDD evidence

RED before production modules existed:

```text
node --test tests/product/z2k-data-diagnostics.test.mjs
1 failed, 0 passed, 4 skipped
Failure: Task 13 production module was absent.
```

GREEN focused UCode gate:

```text
wsl.exe -e bash -lc "... export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/product/z2k-data-diagnostics.test.mjs"
6 passed, 0 failed, 0 skipped
```

The focused suite exercises real UCode imports and includes identity, schema,
path, staging/publish failure, diagnostics and canonical RPC/ACL assertions.

## Bounded verification

- `node --check tests/product/z2k-data-diagnostics.test.mjs`: passed.
- `node scripts/validate-knowledge.mjs`: passed.
- `node scripts/docs.mjs verify`: passed; Quartz SHA
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- `git diff --check`: passed.
- `node --test tests/product/z2k-data-diagnostics.test.mjs tests/product/*resource*.test.mjs`:
  82 passed, 1 failed. The single failure is the pre-existing resource
  manifest count expectation (`expected 7`, observed `6`); all six Task 13
  tests and the remaining resource tests passed.
- Direct UCode no-seam diagnostics projection completed and returned all 18
  IDs; unavailable runtime evidence was reported explicitly rather than
  inferred.

## Boundaries

Not run: OpenWrt/router deployment, real atomic rename/permissions on router,
live rpcd/ubus calls, upstream data download/generation, live Detect/NFQUEUE/
firewall evidence, browser acceptance, package E2E, full regression, merge,
push, or delegation/other model. Existing lifecycle, receipt, Registry,
runtime, Detect and autocircular modules remain the authorities.

## Commit

Implementation and this report are committed together as:

```text
feat: integrate Z2K data and diagnostics
```
