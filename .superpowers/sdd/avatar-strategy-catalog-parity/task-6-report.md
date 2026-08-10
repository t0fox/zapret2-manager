# Task 6 Report: Compile Avatar Strategies Through Profiles

## Status

COMPLETE

## Scope

Implemented only the Task 6 compiler adapter, its focused product contract, and
the smallest pure round-trip hook needed to reuse the existing Profile renderer.
No plan, ledger, package asset, state, RPC, UI, or Apply transaction behavior
was changed.

## Compiler Contract

- Added `strategy_compile(strategy, environment)` to
  `strategy-compiler.uc`. It normalizes the Strategy through the existing
  Avatar model, keeps enabled Profiles in original order, and treats omitted
  `enabled` as true through the authoritative model.
- Disabled Profiles are removed before rendering. Adjacent enabled fragments
  are joined only by `profiles_render_candidate()` with the exact existing
  ` --new ` separator. Zero enabled Profiles return a successful empty
  structural result without invoking the non-empty Apply renderer.
- Avatar tokenizer values remain the source token stream. Canonical fragments
  are single-line, quote-preserving, and are checked with `z2m_parse()` and
  `z2m_validate()` before and after global declarations.
- Bare-trick autowrap matches the pinned cases: TLS client hello, HTTP request
  or reply, and QUIC initial payloads wrap only with Lua desync, no existing
  TCP/UDP/L7 filter, exact case-sensitive first payload, and no `all` or
  unknown payload wrapping.
- List injection is mode-driven and placed after the last filter and before
  the first payload. Existing hostlist/ipset/exclusion options suppress only
  their corresponding injected flags. Explicit missing paths do not invent a
  replacement.
- Catalog Blob declarations are added once before the first enabled fragment
  when metadata supplies a bounded native path. Repeated metadata or existing
  declarations do not duplicate the declaration.
- `@lua/`, `@bin/`, `lists/`, and `ipset` references resolve only through the
  supplied native roots. Missing roots preserve the original token instead of
  erasing it. Unknown options remain intact and Profile manager diagnostics are
  exposed.
- `dependencies` records bounded Blob/Lua availability and missing references.
  Missing dependencies keep the structural candidate inspectable and set
  `applicable: false`; they do not get silently removed or treated as native
  success.
- Added `strategy_candidate()` as the full candidate projection consumed by
  later server-side Apply work.
- Added `strategy_effective_argv()` as a pure composition path requiring the
  pinned engine and captured `source: 'live'` runtime inputs. It rejects
  client-composed `argv`/`command`, then combines live base args, Lua-init,
  hostlist inputs, and canonical Strategy tokens into one argv and shell command
  representation.

## Existing Renderer Boundary

`profiles-apply.uc` exports only `profiles_candidate_round_trip`, an alias of
its existing pure proof function. The compiler delegates full-set joining and
round-trip verification to that module. The transactional pipeline,
`profiles_apply_candidate`, CAS writes, preflight admission, restart, verify,
and rollback remain unchanged.

## Tests

RED evidence:

- `node --test tests/product/avatar-strategy-compiler.test.mjs` failed before
  implementation because `strategy-compiler.uc` was absent.

Focused GREEN command:

```text
node --test tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs tests/product/profiles-contract.test.mjs tests/product/avatar-strategy-model.test.mjs tests/product/avatar-strategy-catalog.test.mjs
```

Result: 64 tests passed, 0 failed.

Additional checks:

- `git diff --check`: clean.
- Duplicate-logic audit: compiler contains no `--new` join, filesystem write,
  Apply, or native-preflight call; only `profiles-apply.uc` owns full-set
  joining and transaction admission.

## Changed Files

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`
- `tests/product/avatar-strategy-compiler.test.mjs`
- `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc`

## Concerns

- The effective command adapter is pure and guarded by live-input provenance,
  but the repository does not contain the upstream `/etc/init.d/zapret2`
  implementation itself. Later Preview work must supply its captured runtime
  composition inputs from the authoritative live path; it must not let a UI or
  RPC caller construct them.
- The compiler candidate digest now uses the exact SHA-256 of the rendered
  candidate, matching the existing Apply CAS hash. The compiler invokes only
  the existing text hashing utility path and does not write config or state.
- Dependency probing is intentionally bounded metadata inspection. Native
  preflight remains the only execution validity gate.

## Fix Round 1

The review follow-up closed the Important findings without changing the
Profile renderer or Apply transaction boundary:

- List suppression is independent: explicit hostlists, auto hostlists,
  ipsets, and exclusion flags no longer suppress unrelated injections. List
  placement remains after the last filter and before the first payload.
- Dependency collection now scans explicit hostlist/ipset options as well as
  Blob and Lua metadata, preserving missing references and setting
  `applicable: false` instead of silently treating them as available.
- Relative descriptor paths resolve only below the supplied native roots.
  Traversal, unsafe-character, and symlink-marked Blob/Lua/list descriptors
  are rejected without generating unsafe declarations; absolute list paths
  are accepted only through bounded descriptor metadata.
- `strategy_candidate()` now carries the canonical candidate, SHA-256 digest,
  `candidateSha256`, `expectedHash`, dependencies, applicability, and the
  compiled strategy args needed by later Apply work.
- Effective argv inputs retain live-runtime provenance checks, reject client
  `argv`/`command` composition, validate captured argument types, and shell
  quote every rendered argument.
- Regression coverage was added for each of the above paths, including an
  absolute `listPath`, relative list descriptors, malformed Blob paths,
  unsafe Blob sources, and symlink-marked metadata.

## Fix Round 1 Verification

- RED focused run: 5 new regression cases failed against the pre-fix
  implementation, confirming the reported defects were exercised.
- Focused compiler suite: 15 passed, 0 failed.
- Profile model and contract suites: 30 passed, 0 failed.
- Full product suite: 92 passed, 0 failed.
- `git diff --check`: clean.
