# Zero-red remediation (r120)

Starting HEAD: `4ea9e00b79a773055328e7342324ee2632cb4534`. Baseline: 976 green, 39 red; the runner does not report skipped tests. No allowlist, skip, xfail, or discovery change is authorized.

| ID | Group | Test file | Production owner | Symptom | Root cause | Fix | Status | Commit |
|---|---|---|---|---|---|---|---|---|
| typed websocket evidence | service contract | discord-service-contract | discord/orchestra | typed-evidence assertion fails | contract drift | pending | open | — |
| provider test-all wiring | DNS contract | dns-regressions | dnsprov RPC/UI | setup wiring assertion fails | request contract drift | pending | open | — |
| bare APK negative control | provenance | release-provenance | build/deploy metadata | R16 negative control fails | provenance contract drift | pending | open | — |
| clear pending on denied/conflict | Service DNS | service-dns-contract | service-dns UI | pending operation remains | UI error contract drift | pending | open | — |
| ucode no-sugar | target ucode | ucode-no-sugar | shipped ucode | unsupported syntax report | target compatibility debt | pending | open | — |
| lists domain wire | UI/RPC | rpc-semantics | lists UI/RPC | domain payload mismatch | wire contract drift | pending | open | — |
| lists apply wire | UI/RPC | rpc-semantics | lists UI/RPC | edit payload mismatch | wire contract drift | pending | open | — |
| lists anti-wipe | UI/RPC | rpc-semantics | lists UI | unsafe error rendering | UI state contract drift | pending | open | — |
| monitor stale poll | UI/RPC | rpc-semantics | monitor UI | stale-state contract fails | UI state contract drift | pending | open | — |
| strategies profile list | UI/RPC | rpc-semantics | strategies UI/RPC | profile rendering mismatch | wire/render contract drift | pending | open | — |
| strategies create draft | UI/RPC | rpc-semantics | strategies UI/RPC | create payload mismatch | wire contract drift | pending | open | — |
| strategies edit save | UI/RPC | rpc-semantics | strategies UI/RPC | edit payload mismatch | wire contract drift | pending | open | — |
| strategies edit conflict | UI/RPC | rpc-semantics | strategies UI | conflict state mismatch | UI error contract drift | pending | open | — |
| strategies malformed draft | UI/RPC | rpc-semantics | strategies UI | preserved warning mismatch | UI state contract drift | pending | open | — |
| strategies guided option | UI/RPC | rpc-semantics | strategies UI | editor mutation mismatch | UI state contract drift | pending | open | — |
| strategies preview/apply | UI/RPC | rpc-semantics | strategies UI/RPC | preview presentation mismatch | async contract drift | pending | open | — |
| strategies refused preview | UI/RPC | rpc-semantics | strategies UI | refusal state mismatch | UI error contract drift | pending | open | — |
| strategies apply success | UI/RPC | rpc-semantics | strategies UI | verification rendering mismatch | UI render contract drift | pending | open | — |
| strategies apply rollback | UI/RPC | rpc-semantics | strategies UI | rollback rendering mismatch | UI render contract drift | pending | open | — |
| maintenance versions/events | UI/RPC | rpc-semantics | maintenance UI/RPC | event rendering mismatch | wire/render contract drift | pending | open | — |
| maintenance backup create | UI/RPC | rpc-semantics | maintenance UI/RPC | scope payload mismatch | wire contract drift | pending | open | — |
| maintenance restore | UI/RPC | rpc-semantics | maintenance UI | confirmation flow mismatch | UI state contract drift | pending | open | — |
| maintenance diagnostics | UI/RPC | rpc-semantics | maintenance UI/RPC | diagnostics action mismatch | wire contract drift | pending | open | — |
| DNS resolver summary | UI/RPC | rpc-semantics | dns UI/RPC | data rendering mismatch | wire/render contract drift | pending | open | — |
| DNS save draft | UI/RPC | rpc-semantics | dns UI/RPC | edit payload mismatch | wire contract drift | pending | open | — |
| DNS validate | UI/RPC | rpc-semantics | dns UI | error rendering mismatch | UI error contract drift | pending | open | — |
| DNS preview/apply | UI/RPC | rpc-semantics | dns UI/RPC | confirmation mismatch | async contract drift | pending | open | — |
| DNS check resolution | UI/RPC | rpc-semantics | dns UI/RPC | check response mismatch | wire contract drift | pending | open | — |
| catalog preview | UI/RPC | rpc-semantics | catalog UI/RPC | payload mismatch | wire contract drift | pending | open | — |
| catalog apply | UI/RPC | rpc-semantics | catalog UI/RPC | precondition mismatch | wire contract drift | pending | open | — |
| catalog invalid | UI/RPC | rpc-semantics | catalog UI | error state mismatch | UI error contract drift | pending | open | — |
| catalog health running | UI/RPC | rpc-semantics | catalog UI/RPC | start/render mismatch | async contract drift | pending | open | — |
| catalog health completed | UI/RPC | rpc-semantics | catalog UI | matrix rendering mismatch | UI render contract drift | pending | open | — |
| catalog health conflict | UI/RPC | rpc-semantics | catalog UI | conflict mapping mismatch | UI error contract drift | pending | open | — |
| DNS provider components | UI/RPC | rpc-semantics | dnsprov UI/RPC | component rendering mismatch | wire/render contract drift | pending | open | — |
| DNS provider diagnostics | UI/RPC | rpc-semantics | dnsprov UI/RPC | verdict rendering mismatch | wire/render contract drift | pending | open | — |
| DNS provider invalid | UI/RPC | rpc-semantics | dnsprov UI | blocked state mismatch | UI error contract drift | pending | open | — |
| proxy running | UI/RPC | rpc-semantics | proxy UI/RPC | status rendering mismatch | wire/render contract drift | pending | open | — |
| proxy log redaction | UI/RPC | rpc-semantics | proxy UI/RPC | redacted-tail rendering mismatch | wire/render contract drift | pending | open | — |

The 34 UI/RPC failures share an obsolete render-harness DOM model: its prior expectation assigned `style="..."` directly to `HTMLElement.style`, whereas browser DOM keeps `style` as a mutable CSSStyleDeclaration. The test adapter now models the canonical browser contract; this does not weaken any behaviour assertion or alter production UI/RPC code. The remaining five groups are independently focused before modification.
