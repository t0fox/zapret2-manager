---
id: strategy-ide-product-workflow-evidence
title: "Strategy IDE product workflow evidence"
type: evidence
status: verified-with-runtime-gaps
authority: z2m-strategies
updated: 2026-08-21
publish: true
tags: [strategy, ide, scanner, avatar, verification]
---

# Strategy IDE product workflow evidence

## Scope and authority

The canonical route remains `strategy` → `z2m-strategy-page.js` →
`z2m-strategies.js` → `ctx.api.strategies.*`. The existing server compiler and
Strategy RPCs remain authoritative for effective arguments, dependencies,
validation, persistence and Apply. No `scanner-orchestrator` reference was
introduced and Scanner does not create or apply a Strategy on the IDE path.

## Implemented

- `z2m-nfqws2-ide.js` now exposes lossless tokenization, structured extraction
  for TCP/UDP/QUIC, ports, hostlists/ipsets, payloads, desync,
  repeats/splits/fake/template and Z2K/autocircular Lua markers.
- Unknown syntax is explicit `raw-only`; serialization returns the original
  profile text byte-for-byte. Unknown flags are warnings, not data loss.
- Existing Strategy editor shows structured fields only when safe, retains the
  raw textarea as source of truth, renders local diagnostics, provenance,
  effective preview data, resolved dependencies and active-strategy diff.
- Draft Preview/Validate use existing inline `strategy_data`; persisted Apply
  still uses the existing `{ strategy_id, revision, catalog_digest }` identity.
- Dirty editor state is guarded by close and `beforeunload`; updates retain
  `expectedRevision`.
- Scanner findings can be bounded into transient
  `z2m.strategy.scanner-handoff.v1` storage and navigated through the existing
  `ctx.navigate('strategy')` route. Provenance includes source, scan, scan id,
  catalog, finding and revision.

## Capability matrix

| Capability | Avatar reference | Z2M before | Z2M after |
|---|---|---|---|
| View / clone / create / edit | present | partial editor | existing page extended |
| Structured + advanced raw editor | donor reference | raw editor only | structured-or-raw-only, lossless |
| TCP/QUIC, hostlists, Lua/Z2K semantics | donor/server split | limited display | safe client projection; server remains authority |
| Validation | inline diagnostics | RPC available | local + canonical RPC diagnostics |
| Preview | effective command | RPC available | draft and persisted preview details |
| Test before Apply | donor capability | no Strategy temporary-test RPC | explicit unavailable gap; no fake Apply |
| Save / Apply | product flow | canonical RPCs | same canonical RPCs and identity guards |
| Scanner handoff | same editor concept | direct save handoff | transient Scanner → existing IDE route |

## Verification evidence

Passing fresh command:

```text
node --test tests/ui/strategy-ide-workflow.test.mjs \
  tests/ui/scanner-workspace-history-handoff.test.mjs \
  tests/ui/scanner-workspace-multi-engine.test.mjs \
  tests/ui/p03-strategies-lifecycle-contract.test.mjs \
  tests/ui/strategy-rpc-regression.test.mjs
17 tests, 17 pass, 0 fail
```

The focused IDE contract also passes independently: 6/6. JavaScript syntax
checks pass for the IDE helper, Strategies page and Scanner hub. `git diff
--check` passes.

The knowledge validator runs after each edit and reports only the existing
repository issues:

```text
docs/05-parity/z2k-p5-parity-matrix.md: missing frontmatter
docs/05-parity/z2k-parity.md: unreachable authority document
```

The backend ucode product tests were attempted but are not runnable in this
Windows checkout: their harness reports `UCODE_BIN: null` and no native ucode
exit status. This is an environment boundary, not a changed Strategy failure.
The Avatar UI baseline also retains unrelated failures around the pre-existing
Advanced Orchestra adapter contract and the missing
`docs/03-products/strategy/source-provenance.md` file.

## Evidence boundary

No router/browser deployment session was available in this worktree, so there
is no claimed live LuCI click trace. The Test capability remains intentionally
explicitly unavailable because `z2m-api.js` exposes no canonical temporary
Strategy test RPC. The UI does not emulate Test with Preview or Apply.

The live acceptance chain to execute on a deployed router is:

```text
Scanner finding
  → Open in Стратегии / Strategies IDE
  → inspect provenance and raw/structured mode
  → Validate (canonical strategies_validate)
  → Test (only after a canonical temporary-test RPC is added)
  → Save (canonical strategies_create/update)
  → Apply (canonical strategies_apply identity)
```
