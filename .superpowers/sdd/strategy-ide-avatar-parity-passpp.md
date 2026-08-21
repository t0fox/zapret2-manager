# Strategy IDE — Avatar Parity PASS++ audit

Date: 2026-08-21

Result: **PASS+ implementation; PASS++ live acceptance blocked by router verification/runtime state.**

## Authority preserved

The existing route remains canonical:

`strategy page → z2m-strategies → ctx.api.strategies.* → strategy-cli.uc → shared compiler/validation/persistence/apply`

The IDE does not add a compiler, persistence store, apply path, or runtime-test emulation. `strategies.test` is rendered only when the canonical backend exposes it; the current router does not expose that capability.

## Capability matrix

| Capability | Avatar reference | Z2M before | Z2M after | Evidence |
| --- | --- | --- | --- | --- |
| A. Contextual autocomplete | flag/function/value popup | textarea hint only | cursor-aware popup; keyboard and mouse selection; flag/function/subarg/value/asset categories | `strategy-ide-passpp.test.mjs`; live DOM `listbox → --filter-tcp`; Enter produced `--filter-tcp=` |
| B. Cursor help | token help | static hint | cursor-aware title/description for flags, functions, subargs and assets | `strategy-ide-passpp.test.mjs`; live `--filter-tcp / TCP target ports` |
| C. Asset picker | registry-backed assets | no picker | canonical `assets.list` picker with path, revision, digest metadata | `strategy-ide-passpp.test.mjs`; live `steam · rev 1` |
| D. Visual mode | structured strategy editor | raw-oriented editor | editable protocol/ports/L7/payload/hostlist/IPSet fields | `strategy-ide-passpp.test.mjs`; live DOM/screenshot |
| E. Raw mode | lossless raw editor | raw editor | explicit Raw-only fallback and byte-preserving round-trip | test: unknown syntax remains byte-for-byte |
| F. Circular builder | circular/autocircular controls | no visual builder | ordered editable Lua steps with add/remove | test plus live `strategy=autocircular`, `hostkey=z2k_nohost_key` |
| G. Workspace | resizable editor | fixed modal | bounded resize handle with local persistence | `clampWorkspace` test; live resize handle |
| H. Validation | local + server | backend-only presentation | local diagnostics plus canonical Validate; inline target warning updates after asset selection | test; live warning cleared after IPSet selection |
| I. Preview | effective argv/dependencies/diff | command preview | effective strategy, exact args, resolved-dependency area and active diff | test; live DOM showed all sections |
| J. Save/revision | existing Strategy lifecycle | existing lifecycle | existing create/update/revision guard retained | `strategy-ide-workflow.test.mjs` |
| K. Scanner handoff | scan → strategy editor | existing handoff | same IDE with transient provenance preserved | test: canonical Strategies route/provenance |
| L. Unknown syntax | safe fallback | partial | explicit Raw-only mode; unknown tokens are not rewritten | test: lossless round-trip |
| M. Browser evidence | — | not audited | live router browser evidence captured | clean fresh tab after source deployment, DOM and screenshot |
| N. Circular easier than raw | visual workflow | absent | visual circular workflow is shorter than manual Lua editing | live circular builder + test |

## Verification boundary

Focused PASS++ tests: **12 passed, 0 failed**.

Live router frontend hashes:

| File | SHA-256 |
| --- | --- |
| `z2m-nfqws2-ide.js` | `2ef471c0dc67f5121c4335e7ab1e667c981c01ee0b556417d4b457faca36e209` |
| `z2m-strategies.js` | `55e1a92008661071367eca919c074536ce71aac0b913a46ad7508487124396c4` |
| `z2m-ui.css` | `c769d042c0f42f06a5172da9181a3c68e0fe9bbc088d4036a8b5c43fbc8f4d12` |

The live Preview request reached the canonical RPC and returned a structured backend error, now shown with code and technical reason:

`EVERIFY: verified Strategy catalog is unavailable`

This is a router/backend verification gate, not a browser fallback. Therefore live canonical Preview/Validate success and Save/Apply were not claimed. The runtime also currently reports `stopped`, `generation:0`, and `nfnetlink_queue unavailable`; no production mutation was attempted.

The broader pre-existing UI suite still has unrelated failures outside this slice. They are not folded into the 12-test PASS++ result.
