---
task: z2k-preview-root-fix
status: delivered
implementation_commit: 07ff2e9e
---

# Z2K All-in-One Preview root fix

## Root causes

The incorrect `nfqws2` Preview had three independent causes:

1. `live_runtime_inputs()` copied process `--lua-init` arguments into
   `baseArgs` while the canonical installed runtime composition supplied the
   same Lua closure again. Process argv is now observation-only for Lua init;
   the installed runtime snapshot owns the canonical list.
2. The RPC projection capped `effectiveArgv` at 256 items. The official Z2K
   All-in-One composition has 267 effective argv items, so it was rejected as
   an oversized command even though the command itself is bounded. The safe
   projection bound is now 512 items and the complete command is retained.
3. LuCI's `rpc.declare()` ignores a per-declaration `timeout` option and uses
   the global 20-second deadline. Strategy `get`, `preview`, and `validate`
   now use an explicit `request.post()` transport with a 60-second deadline.

The Preview UI now treats a failed or empty answer as an error instead of
showing the error text as if it were a successful command. Successful large
responses show the complete server command in an open, read-only disclosure
while keeping the structured summary.

## Z2K source and flow evidence

- Official source: [`necronicle/z2k`](https://github.com/necronicle/z2k), branch
  `z2k-enhanced`, tip `8795675808d4ca2285b98c56220cf7bb731712bb`.
- Imported source files: [`strats_new2.txt`](https://raw.githubusercontent.com/necronicle/z2k/z2k-enhanced/strats_new2.txt)
  and [`quic_strats.ini`](https://raw.githubusercontent.com/necronicle/z2k/z2k-enhanced/quic_strats.ini).
- Raw SHA-256: `strats_new2.txt` =
  `ed7865148b3088d40e5bd42dc9d1cf0395128a8c7dd75c59f14e6740e3648085`;
  `quic_strats.ini` =
  `15e465a29b3bbe1dfbe602dea387abcbc45fc7c310231435385602ca85e66e82`.
- Catalog contains 5 Z2K pools, 115 fixed slots, and the generated
  `z2k:z2k_all_in_one` profile with pool order `rkn_tcp`, `yt_tcp`, `gv_tcp`,
  `yt_quic`, `discord_udp`.
- Router Preview returned `ok:true`, `profiles_count:5`, `effectiveArgv:267`,
  `effectiveCommand:26388` bytes, and a 59806-byte bounded response. The
  command contains one canonical Lua init for each of the 13 installed files,
  `--filter-udp=443`, and `--filter-l7=quic`.

## Verification

- `node --test tests/product/z2k-frontend-timeout-contract.test.mjs` — 3/3
  passed.
- `node --check` for `z2m-api.js` and `z2m-strategies.js` — passed.
- `git diff --check` — passed.
- Direct router `ubus call zapret2-manager strategies_preview` for
  `z2k:z2k_all_in_one` — passed with the evidence above.
- Codex in-app browser, cache-busted Strategies route — passed: Z2K source
  filter, All-in-One card, Preview modal, `Готово`, complete command visible,
  no `XHR request timed out`, and all five pools plus UDP/QUIC markers present.
- Router login was performed by pressing Login without entering credentials,
  as requested; the router retained its existing `No password set!` state.
- No Strategy Apply, service restart, or router reboot was performed.

The broad product suite was not repeated. Its known baseline failures remain
separate from this fix; the WSL-backed Ucode run is unavailable in this host
because WSL networking is `Nat` with `Network is unreachable`.

## Deployment

The final router installation was performed without reboot or `rpcd reload`.
Installed source hashes matched the local files for the changed runtime and UI
assets; pre-deployment copies were kept under
`/tmp/z2m-deploy-20260902-preview-root/backup` and
`/tmp/z2m-deploy-20260902-preview-final/backup` on the router.
