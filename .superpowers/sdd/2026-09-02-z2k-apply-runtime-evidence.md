# Z2K All-in-One Apply and runtime evidence

Date: 2026-09-02
Scope: `z2k:z2k_all_in_one` in the LuCI Strategies flow.

## Root causes fixed

- `rpc.declare({ timeout: ... })` did not change the actual LuCI transport
  deadline. The large `strategies_list` response therefore degraded to an
  empty catalog, and the long `strategies_apply` operation could be reported
  as failed before its runtime transaction completed.
- Strategy list, preview, and apply now use explicit JSON-RPC requests with
  `nobatch`, credentials, and operation-specific bounded timeouts.

## Local gates

- `node --test tests/product/z2k-frontend-timeout-contract.test.mjs tests/product/avatar-strategy-ui.test.mjs`
  — 32/32 passed.
- `node --check` for `z2m-api.js` — passed.
- `git diff --check` — passed.

## Router/browser evidence

- In the Codex in-app browser, LuCI login was submitted without entering a
  username or password, as requested.
- After the RPC service reload (reload only; no router reboot), the catalog
  rendered 855 strategies: Avatar 732, Z2K 121, user 2. The type filter axis
  contained no duplicate user-source filter.
- A control Apply changed the active strategy to
  `z2k:discord_udp_strat_1`; the final UI Apply changed it back to
  `z2k:z2k_all_in_one`. Both confirmations completed without a UI error.
- The All-in-One card showed `Выбрана`, `Применена`, and `Используется сейчас`,
  and expanded to the five expected pools: `rkn_tcp`, `yt_tcp`, `gv_tcp`,
  `yt_quic`, `discord_udp`.

## Native validation and runtime postflight

The router-side All-in-One validation returned `ok: true`, five profiles, and
`validation.status: verified`; CLI syntax, Lua load/compatibility, function and
blob existence, runtime arguments, and execution plan all passed.

After the final Apply, `status_fast` reported:

- `strategyStatus.id=z2k:z2k_all_in_one`, `origin=z2k_builtin`, `revision=0`;
- `runtimeSummary.status=running`, reason `process-and-nfqueue-confirmed`;
- final stability sample: exactly one `nfqws2` process, PID 10400,
  `identityVerified=true`;
- NFQUEUE 300 registered, owner matches PID 15912, no owner conflict, rules present;
- 13 Lua-init arguments loaded;
- active argv contains all five Z2K pool filters, including UDP/443 QUIC and
  Discord `discord,stun`.

This proves the Validate -> Apply -> runtime verification path and the
installed All-in-One composition. No end-to-end traffic success claim is made
because no external client traffic test was run in this pass.
