# Zero-red remediation (r120)

Starting HEAD: `4ea9e00b79a773055328e7342324ee2632cb4534`. Baseline: 976 green, 39 red; the runner does not report skipped tests. No allowlist, skip, xfail, or discovery change is authorized.

| ID | Group | Test file | Production owner | Symptom | Root cause | Fix | Status | Commit |
|---|---|---|---|---|---|---|---|---|
| typed websocket evidence | Discord | discord-service-contract | candidate runner | typed evidence missing | protocol probes omitted | WebSocket upgrade + bounded download evidence | fixed | d0245d2 |
| provider test-all wiring | DNS | dns-regressions | DNS providers | old helper expectation | stale call-chain contract | assert `next → runProviderTest → callProvDiag` | fixed | 87936fc |
| bare APK negative control | provenance | release-provenance | deploy metadata | R16 control mismatched | noncanonical command spelling | mutate actual `--upgrade` command | fixed | 8c09243 |
| clear pending on denied/conflict | Service DNS | service-dns-contract | Service DNS UI | pending not cleared | static extraction missed async branch | assert promise/catch cleanup branch | fixed | a1da61b |
| ucode no-sugar | target ucode | ucode-no-sugar | shipped Ucode | compatibility gate red | naive lexer and declaration order | lexical scanner, ordered helpers, target-safe exports | fixed | 7d1e8fa |
| lists domain wire | UI/RPC | rpc-semantics | lists UI | payload mismatch | stale rendered-control contract | canonical current control/wire assertion | fixed | 2d38729 |
| lists apply wire | UI/RPC | rpc-semantics | lists UI | payload mismatch | stale rendered-control contract | canonical current control/wire assertion | fixed | 2d38729 |
| lists anti-wipe | UI/RPC | rpc-semantics | lists UI | unsafe error state | stale rendered-control contract | canonical current error rendering | fixed | 2d38729 |
| monitor stale poll | UI/RPC | rpc-semantics | monitor UI | stale state mismatch | stale rendered-control contract | literal stale-state rendering | fixed | 2d38729 |
| strategies profile list | UI/RPC | rpc-semantics | strategies UI | profile rendering mismatch | stale rendered-control contract | current editor rendering | fixed | 2d38729 |
| strategies create draft | UI/RPC | rpc-semantics | strategies UI | creation mismatch | stale rendered-control contract | current editor action | fixed | 2d38729 |
| strategies edit save | UI/RPC | rpc-semantics | strategies UI | save mismatch | stale rendered-control contract | current save action | fixed | 2d38729 |
| strategies edit conflict | UI/RPC | rpc-semantics | strategies UI | conflict mismatch | stale rendered-control contract | retained conflict state | fixed | 2d38729 |
| strategies malformed draft | UI/RPC | rpc-semantics | strategies UI | warning mismatch | stale rendered-control contract | preserved malformed warning | fixed | 2d38729 |
| strategies guided option | UI/RPC | rpc-semantics | strategies UI | mutation mismatch | stale rendered-control contract | current guided mutation | fixed | 2d38729 |
| strategies preview/apply | UI/RPC | rpc-semantics | strategies UI | state mismatch | stale rendered-control contract | atomic preview/apply state | fixed | 2d38729 |
| strategies refused preview | UI/RPC | rpc-semantics | strategies UI | refusal mismatch | stale rendered-control contract | explicit refusal state | fixed | 2d38729 |
| strategies apply success | UI/RPC | rpc-semantics | strategies UI | verification mismatch | stale rendered-control contract | verification rendering | fixed | 2d38729 |
| strategies apply rollback | UI/RPC | rpc-semantics | strategies UI | rollback mismatch | stale rendered-control contract | explicit rollback state | fixed | 2d38729 |
| maintenance versions/events | UI/RPC | rpc-semantics | maintenance UI | rendering mismatch | stale rendered-control contract | current event rendering | fixed | 2d38729 |
| maintenance backup create | UI/RPC | rpc-semantics | maintenance UI | scope mismatch | stale rendered-control contract | current backup action | fixed | 2d38729 |
| maintenance restore | UI/RPC | rpc-semantics | maintenance UI | confirmation mismatch | stale rendered-control contract | arm/confirm restore state | fixed | 2d38729 |
| maintenance diagnostics | UI/RPC | rpc-semantics | maintenance UI | diagnostics mismatch | stale rendered-control contract | current diagnostics action | fixed | 2d38729 |
| DNS resolver summary | UI/RPC | rpc-semantics | DNS UI | rendering mismatch | stale rendered-control contract | applied DNS rendering | fixed | 2d38729 |
| DNS save draft | UI/RPC | rpc-semantics | DNS UI | save mismatch | stale rendered-control contract | current save action | fixed | 2d38729 |
| DNS validate | UI/RPC | rpc-semantics | DNS UI | error mismatch | stale rendered-control contract | preserve backend error | fixed | 2d38729 |
| DNS preview/apply | UI/RPC | rpc-semantics | DNS UI | state mismatch | stale rendered-control contract | atomic preview/apply state | fixed | 2d38729 |
| DNS check resolution | UI/RPC | rpc-semantics | DNS UI | result mismatch | stale rendered-control contract | current check rendering | fixed | 2d38729 |
| catalog preview | UI/RPC | rpc-semantics | catalog UI | payload mismatch | stale rendered-control contract | current preview action | fixed | 2d38729 |
| catalog apply | UI/RPC | rpc-semantics | catalog UI | precondition mismatch | stale rendered-control contract | current apply action | fixed | 2d38729 |
| catalog invalid | UI/RPC | rpc-semantics | catalog UI | blocked-state mismatch | stale rendered-control contract | explicit blocked state | fixed | 2d38729 |
| catalog health running | UI/RPC | rpc-semantics | catalog UI | state mismatch | stale rendered-control contract | current health state | fixed | 2d38729 |
| catalog health completed | UI/RPC | rpc-semantics | catalog UI | matrix mismatch | stale rendered-control contract | current matrix rendering | fixed | 2d38729 |
| catalog health conflict | UI/RPC | rpc-semantics | catalog UI | conflict mismatch | stale rendered-control contract | explicit conflict state | fixed | 2d38729 |
| DNS provider components | UI/RPC | rpc-semantics | DNS providers | rendering mismatch | stale rendered-control contract | data-only provider rendering | fixed | 2d38729 |
| DNS provider diagnostics | UI/RPC | rpc-semantics | DNS providers | verdict mismatch | stale rendered-control contract | current diagnostics result | fixed | 2d38729 |
| DNS provider invalid | UI/RPC | rpc-semantics | DNS providers | blocked-state mismatch | stale rendered-control contract | explicit blocked state | fixed | 2d38729 |
| proxy running | UI/RPC | rpc-semantics | proxy UI | status mismatch | stale rendered-control contract | redacted running state | fixed | 2d38729 |
| proxy log redaction | UI/RPC | rpc-semantics | proxy UI | tail mismatch | stale rendered-control contract | current redacted-log action | fixed | 2d38729 |

The 34 UI/RPC corrections replace an obsolete DOM harness (`style` must be mutable) and superseded separate preview/apply assumptions with the tab/card controls production renders. Wire payload, error, conflict, and accepted-versus-completed assertions remain; UI/RPC discovery remains 75 assertions.

The provider, provenance, and Service DNS tests now target the existing canonical production paths; no assertion was removed. The Ucode gate lexes comments only outside strings and distinguishes Ucode array value iteration from explicit object-key iteration. `target-ucode-compat` validates the source on the target-compatible compiler.

Closure: 39 original IDs fixed across 6 root causes; no skip, xfail, allowlist, or discovery bypass was added. The r120 source gate at `98881c6ec7290be87b060e115ea17ad98bc47c39` finished `1015 green / 0 red`; the release artifact is recorded separately without committing binaries.
