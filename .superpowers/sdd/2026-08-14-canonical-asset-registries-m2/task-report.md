# M2 — Canonical Asset Registries

BASE_HEAD: d8a833af4acae23d1b4a944deec0355960d1ceb7
CODE_COMMIT: a22d7ce8
BRANCH: codex/m2-assets
WORKTREE: G:\\zapret2-manager\\.worktrees\\z2m-m2-assets-work
SCOPE: local implementation only; no push, merge, PR, main, or M5 files touched

## Contract evidence

- ASSET_MODEL: PASS — manager-owned typed registry with stable `type:id`, owner, provenance, SHA-256, byte size, revision, safe canonical path, validation, and references.
- STABLE_IDENTITY: PASS — IDs are type-scoped and path-independent; update uses revision CAS and hash metadata.
- PATH_BOUNDARY: PASS — no arbitrary path CRUD; canonical paths are server-owned, regular non-symlink files; atomic staged writes and rollback are bounded.
- TYPES: PASS — Lua, blob, ipset, hostlist, and hosts have validators/limits; geosite and geoip are explicit schema types with no unapproved live consumer.
- PACKAGE: PASS — immutable package manifest, hash-bound reconciliation, conffile state, and postinst preservation are covered by static/package tests.
- PREFLIGHT: PASS — resolve/validate rejects missing, wrong-type, stale revision/hash, unsafe, symlinked, and unavailable assets.
- STRATEGY_INTEGRATION: PASS — compiler uses registry environment and retains stable asset IDs in dependency metadata.
- SCANNER_INTEGRATION: PASS (static) — scanner planner/candidate canonicalization receives the registry environment while preserving the existing Scanner handoff boundary.
- RPC_ACL: PASS (static/product) — typed list/get/import/update/delete/register/references/resolve/validate surface with separated ACL permissions.
- LUCI: PASS (syntax/static) — typed Assets view and API route added; browser verification not run.
- UPGRADE_PRESERVATION: PASS (focused) — `avatar-strategy-package.test.mjs` 14/14 under WSL; package asset reconciliation covered by product tests.
- NEW_NATIVE_CODE: NONE.
- LANGUAGE_JUSTIFICATION: ucode is the existing router-native production language; no new native code was required. Rust/C were not introduced.

## Verification

- M2 Windows product suite: 13 passed, 1 skipped (pinned ucode unavailable on Windows).
- M2 WSL registry suite: 11/11 passed.
- M2/package/helper combined Windows suite: 49 passed, 1 skipped.
- Pinned ucode Strategy compiler regression: 27/27 passed.
- Pinned ucode asset compiler integration: 1/1 passed.
- Avatar package preservation regression: 14/14 passed under WSL.
- Native package-helper: 36/36 passed.
- Production ucode imports: asset registry, Strategy compiler, and Scanner planner all loaded successfully with pinned ucode.
- Knowledge validation: PASS.
- Docs freshness against BASE_HEAD: PASS (21 changed paths).
- `git diff --cached --check`: PASS.

## Gate boundary and remaining work

- NATIVE_GATE: NOT COMPLETE — canonical `scripts/test/native.sh` was attempted with pinned ucode and a 300-second bound. The product phase emitted inherited long-running package/catalog suites and did not reach a fresh root-gate completion within the bound. The M2-specific failures exposed during that run were fixed and rerun with focused PASS evidence.
- ROOT_GATE: NOT AVAILABLE — standalone `scripts/test/native-root.sh` reported `root-required native tests must run as root` in the current non-root WSL environment.
- TARGET_ROUTER: NOT RUN — no target-router package install/upgrade/runtime evidence was available in this worktree.
- GEOSITE/GEOIP: NOT_REQUIRED_YET — no approved live consumer exists in the current scope; do not claim readiness for these types.
- STATUS: WORKING — local implementation is committed and verified, but the M2 completion gate still requires fresh target-router/package evidence and a root-capable native run.
