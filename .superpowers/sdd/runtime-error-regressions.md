# Runtime error regressions

## Scope

Diagnose and repair the reported Strategies/DNS/Logs runtime failures without
changing unrelated Scanner or PERF/P5 work.

## Confirmed evidence before implementation

- The active DNS UI calls `dns_product_*`, but the source backend and the live
  router did not register those methods. The live `ubus` call returned
  `Method not found`.
- The Logs UI sends `limit` and `since_seq`, while `maintenance.uc` only read
  the legacy `n` field and returned no `last_seq`.
- `healthcheck_run` is registered and a live router call accepted a manual run;
  this path needs verification after the surrounding fixes, not a speculative
  replacement.
- The live router has `nfqws2 --qnum=300`, but its nftables ruleset currently
  has no forwarding zapret rules (only a raw input queue rule for 301). The UI
  report of missing redirect rules is therefore evidence-backed.

## RED tests

`tests/ui/runtime-error-regressions.test.mjs` asserts the missing DNS product
RPC/ACL contract and the missing Logs cursor contract. Both are expected to
fail against the baseline until the minimal implementation is added.

## GREEN and runtime evidence

- `node --test tests/ui/runtime-error-regressions.test.mjs`: 3/3 passed.
- `node --test tests/ui/dns-tg-donor-adaptation.test.mjs tests/ui/log-ux-runtime-acceptance.test.mjs`: 9/9 passed.
- `node --test tests/ui/log-ux-contract.test.mjs tests/ui/p02-control-model.test.mjs tests/ui/p02-control-lifecycle-contract.test.mjs tests/ui/p03-strategies-model.test.mjs`: 29/29 passed.
- `git diff --check` and ACL JSON parsing passed.
- Router deployment used SSH byte-stream transfer with SHA-256 parity for all
  four installed files. rpcd reload registered all seven `dns_product_*`
  methods; `dns_product_get` returned `ok: true` with overrides, global DNS,
  Service DNS and provider data.
- Router `events_tail` returned `last_seq: 1`, a sequenced event, and an empty
  delta for `since_seq: 1`.
- Router `healthcheck_run` accepted a manual Strategies healthcheck with
  operation `job-1787243551-2`, confirming the launch RPC remains callable.
- After the controlled `start_fw` recovery, runtime status is `running`,
  nfqws2 PID is `4917`, queue owner is registered on qnum `300` with no owner
  conflict, and nftables contains the postrouting/reply queue rules to `300`.
- The router retained a pre-deploy backup at
  `/tmp/z2m-errors-backup-20260820`.
