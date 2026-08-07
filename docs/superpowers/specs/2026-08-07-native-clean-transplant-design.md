# Native Clean Transplant Design

## Status

Human-approved design for `feat/native-clean` built from
`origin/main@304728c4fb5e49252247d9f80c27becec89cfe41`. The donor is
`feat/native-fs-helper@76df521e61acc188be8d9f59fcb67be9da90af02`.

## History And Safety

The branch keeps normal `origin/main` ancestry and adds a new clean series of
logical commits. It never merges or bulk cherry-picks the donor. The donor and
the abandoned prune branch remain unchanged as recovery evidence. Recovery refs
`backup/native-clean-main-base` and `backup/native-clean-donor` pin both source
SHAs. No history rewrite or force push is allowed.

## Import Filter

`origin/main` is the architectural filter and default source of every existing
file. Donor content is imported only when it supplies reviewed Native Foundation
functionality absent from main and every imported path has a production, test,
build, contract, or migration purpose.

The clean import consists of:

1. `docs/contracts/native-backend-v1.md` and
   `docs/contracts/z2m-canonical-json-v1.md`.
2. The approved native filesystem-helper design and active implementation plan.
3. `zapret2-manager/src/z2m-core-helper/**` production C sources and protocol
   manifest.
4. Native helper, sanitizer, ownership, protocol, mutation-transport, result,
   baseline, and compile-gate tests required to prove those sources.
5. `core/errors.uc` and `core/result.uc` only because native result tests and
   future adapter contracts consume them.
6. Minimal compile/no-sugar gate changes and fixtures required by imported native
   sources.
7. Package/build changes required to compile and install the helper; this is
   implemented cleanly on main rather than copied from an incomplete donor
   package definition.

Historical reports, generated artifacts, APK output, screenshots, browser
fixtures, UI changes, old prototypes, `ratings-helper` prototype/test,
historical sanitizer repair plan, and unrelated runner/baseline churn are not
imported.

## DNS And Telegram

The main-to-donor production diff contains no DNS or Telegram backend changes.
Therefore main remains the source for `dns.uc`, `service-dns`, `dnsprov`,
`dns-global`, `proxycfg.uc`, proxy/procd/secret/health/recovery behavior,
packages, catalogs, and characterization tests. They are migration sources, not
native imports and not rewritten in this task.

Before delivery, semantic retention tests compare the clean branch to main for
these paths and run their existing characterization suites. Any later donor-only
DNS/TG need must be proven path-by-path and imported in its own commit.

## Import Sequence

1. Contracts and approved native design/plan.
2. Native helper production sources and production package build/install closure.
3. Native helper and sanitizer test harness plus only required gate fixtures.
4. Native result/error ucode modules and their focused tests.
5. DNS/TG preservation and dependency-closure verification.
6. Hygiene/provenance gate preventing dirty donor classes from entering.

Every import commit records donor path/SHA, consumer, and why the file is needed.
After each subsystem, `git diff --check` and focused tests run.

## Package Closure

The OpenWrt package must compile the helper from source using the target toolchain
and install it under a fixed libexec path. It must declare direct build/runtime
dependencies and must not rely on donor build outputs or worktree artifacts.
Production package tests assert source lists, compile flags, installation, and
absence of test-only instrumentation.

## Verification

The final branch runs imported native tests twice, helper and sanitizer suites,
shell syntax, ucode compile where available, package/install reference audits,
JSON parsing, and process/artifact checks. A fresh worktree at HEAD repeats the
full local gate without donor or old untracked state.

Whole-tree review verifies that no dirty donor artifacts/UI/history entered,
Native Foundation is complete, implementations are not duplicated, main DNS/TG
semantics remain, package references resolve, and each main-relative addition is
necessary.
