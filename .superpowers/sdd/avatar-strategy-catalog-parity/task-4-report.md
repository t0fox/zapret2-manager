# Task 4 Report: Avatar Strategy Catalog Parser

## Scope

Implemented `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc`
and `tests/product/avatar-strategy-catalog.test.mjs`.

The production source contract is `/usr/share/zapret2-manager/catalog/avatar/`.
Tests inject the bounded package checkout root
`zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/` so the same
parser can be exercised without changing the production constant. Task 1
evidence is consumed from
`tests/fixtures/avatar-strategy/manifest.expected.json`; its regeneration
logic is in `tests/fixtures/avatar-strategy/generate.mjs`.

No characterization test adjustment was necessary.

## Parser Behavior

- Reads `manifest.json`, verifies schema 1, pinned repository
  `avatarDD/zapret-gui`, pinned commit
  `f9dd3ea47a2239514f396a843b475c92c33f0b4c`, aggregate digest declaration,
  manifest-listed paths, file levels, filename-derived protocol, file size,
  file SHA-256, source-order IDs, physical ordinals, and aggregate digest.
- Reads only manifest-listed files. Paths are restricted to the four catalog
  levels and `.txt` basenames; lexical root escapes, duplicate paths, symlinked
  manifests/files, non-files, oversized files, digest mismatches, and ordinal
  mismatches fail closed.
- Parses section headers, metadata, and argument lines. It preserves `rawArgs`
  and removes `--wf-*` options only from the catalog-facing `args` value.
  `avatar_tokenize` from `strategy-model.uc` is used for option filtering.
- Infers only `tcp` or `udp` from the pinned filename keyword rules.
- Traverses sorted file paths, appends entries to `level/protocol` caches, sorts
  cache keys, assigns `cacheOrdinal`, and chooses the first unseen ID as the
  winner. Entries retain `sourceFile`, `sourceOrdinal`, `cacheKey`,
  `cacheOrdinal`, `effectiveOrdinal`, `duplicateGroup`, and `winner`.
- Builds exact quick, standard, and full TCP/UDP sets and exposes load, list,
  get, status, and reload interfaces. The module has no state-store, compiler,
  Apply, Scanner, UI, service-catalog, or Orchestra integration.

## Evidence

The parsed installed snapshot matches Task 1 and Task 3 evidence:

- 23 physical files and 1,836 physical entries.
- 732 unique Strategy IDs and 503 duplicate groups.
- Level counts: advanced 565, basic 496, builtin 100, direct 675.
- Protocol counts: TCP 1,402 and UDP 434.
- Winner order begins `http_domcase`, `http_unixeol`,
  `multisplit_seqovl700` and matches the complete audited order.
- `z2k_all_in_one` is a winner.
- Duplicate-group digest:
  `ab90abdeb9f5168a7858e9ed5d0e25fe7b2af0368b6676063b2cd1a2364433f4`.
- Winner-order digest:
  `596cc2ea5d4f1752f900cf54de869da73bdfda356775005aa844f6dafe452fd3`.
- Physical-entry digest:
  `481a20145e5750f54e9409de2d58463884ff58dfa9ddd4f752a73b94354a9c05`.
- Set digest:
  `f43ca59e617f3e8d2f7f3e2edf71c76066a36f9b4a97f2610be7e3f8c1e80e66`.
- Set sizes: TCP quick 30, standard 80, full 630; UDP quick 30, standard
  80, full 104.
- Featured IDs remain `z2k_all_in_one` and `z2k_tls_circular_smart`.

## Commands

- RED: `node --test tests/product/avatar-strategy-catalog.test.mjs`
  failed as expected before the module existed because ucode could not resolve
  `strategy-catalog.uc`.
- GREEN and characterization:
  `node --test tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-characterization.test.mjs`
  passed, 11 tests.
- Adjacent model check:
  `node --test tests/product/avatar-strategy-model.test.mjs` passed, 7 tests.
- Combined catalog/characterization/model check passed, 18 tests.
- Profile checks:
  `node --test tests/product/profiles-model.test.mjs tests/product/profiles-contract.test.mjs tests/product/profiles-ui.test.mjs`
  passed, 47 tests.
- Installed package/manifest check:
  `node --test tests/native/avatar-strategy-package.test.mjs` passed, 11 tests.
- Formatting check: `git diff --check` passed.

## Concerns

Aggregate SHA-256 verification invokes the target's existing `sha256sum`
utility through a shell-quoted pipeline, matching repository conventions. The
parser remains fail-closed if that utility is unavailable or returns an invalid
digest.

## Round 1 Fixes

The scoped review findings were addressed without changing pinned package bytes,
Task 1/2 files, the plan, ledger, or unrelated production modules.

- Catalog roots are now checked as real directories with no symlink component;
  every level directory is checked before manifest reads, and manifest-listed
  files are rejected if symlinked or outside the bounded lexical path.
- Recomputed counts, level/protocol counts, featured IDs, physical entries,
  duplicate groups, winner order, set arrays, file evidence, ordinals, and
  aggregate hashes are compared to manifest declarations. Any mismatch returns
  `EDECLARATION` or the specific fail-closed evidence error; failed loads and
  reloads clear the previous in-memory catalog.
- WinDivert matching follows the pinned case-insensitive prefixes and tokenizes
  multi-option lines. Only WinDivert tokens are removed from `args`; `rawArgs`
  and all non-WinDivert options remain preserved.
- Duplicate groups are emitted from an explicit source/traversal-ordered ID
  list, not object-property enumeration.

Round 1 regression coverage uses temporary local copies only. It covers
symlinked roots/levels, malformed and oversized manifests/files, path escape,
file hash mismatch, physical ordinal mismatch, every tampered declaration
category, multi-option case-insensitive WinDivert filtering, raw/non-WinDivert
preservation, failed-load isolation, and failed-reload isolation.

## Round 1 Verification

- RED before fixes: the new temporary-fixture suite failed on symlink roots,
  declaration tampering, and multi-option WinDivert preservation.
- Focused catalog suite after fixes:
  `node --test tests/product/avatar-strategy-catalog.test.mjs` passed, 11 tests.
- Catalog plus characterization and model checks passed, 18 tests.
- Profile checks passed, 47 tests.
- Installed package/manifest checks passed, 11 tests.
- `git diff --check` passed.

Remaining concern: aggregate SHA-256 verification still depends on the target's
existing `sha256sum` utility; unavailable or malformed utility output fails
closed rather than reporting a catalog.

## Round 2 Fixes

Round 2 corrected the remaining WinDivert semantic mismatch against the pinned
reference at `tests/fixtures/avatar-strategy/generate.mjs:62-74`. Catalog
normalization now lowercases each complete argument line and discards the whole
line only when it starts with one of the pinned prefixes: `--wf-tcp`,
`--wf-udp`, `--wf-raw`, `--wf-l3`, or `--wf-ip`. It preserves `rawArgs` and
leaves non-prefixed lines byte-for-byte intact, including inline `--wf-*`
tokens and other options on those lines.

This resolves the apparent wording tension explicitly: Task 4 catalog parsing
matches the pinned line-prefix normalization exactly; later tokenizer/compiler
semantics may interpret individual tokens, but they are outside this parser's
catalog-facing normalization boundary.

The regression fixture now verifies both a case-insensitive prefixed line with
multiple options being discarded wholesale and a non-prefixed multi-option line
retaining its inline `--wf-tcp=inline` token. All prior temporary-fixture
security, declaration, duplicate-order, and reload-isolation coverage remains.

## Round 2 Verification

- RED before the parser fix: the exact-prefix test failed with
  `EDECLARATION` because inline filtering diverged from the manifest evidence.
- Catalog, characterization, and model checks passed, 23 tests.
- Profile checks passed, 47 tests.
- Installed package/manifest checks passed, 11 tests.
- `git diff --check` passed.
