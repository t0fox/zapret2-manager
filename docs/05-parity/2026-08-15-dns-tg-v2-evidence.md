---
id: dns-tg-v2-evidence-2026-08-15
title: "DNS и Telegram Proxy v2: acceptance evidence"
type: parity-evidence
status: partial
updated: 2026-08-15
---

# Acceptance evidence

`AVATAR_CURRENT_REF: avatarDD/zapret-gui@947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c`

Результат фиксирует реальное состояние после адаптации DNS и Telegram Proxy.
Полный Avatar parity не объявляется завершённым: матрица содержит backend-supported
`PARTIAL` строки, а часть target backend objects отсутствует.

## Required final fields

| Field | Result |
|---|---|
| `AVATAR_CURRENT_REF` | `avatarDD/zapret-gui@947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c` |
| `PARITY_ROWS_TOTAL` | `22` |
| `EXACT` | `0` |
| `ADAPTED` | `2` — DNS routing и TG interaction surface; обе строки остаются `PARTIAL` до полного backend/browser closure |
| `PARTIAL` | `17` |
| `MISSING` | `0` |
| `NOT_APPLICABLE` | `2` |
| `BACKEND_NOT_READY` | `3` |
| `BROWSER_DESKTOP` | `PARTIAL` — все главные tabs и TG subtabs открыты; DNS остановлен EngineGate, TG показывает provider-unavailable state |
| `BROWSER_TABLET` | `PASS for reachable TG surface` at `768x1024`; DNS product flow не достигается из-за EngineGate |
| `BROWSER_MOBILE` | `PASS for reachable TG surface` at `390x844`; DNS product flow не достигается из-за EngineGate |
| `CONSOLE_ERRORS` | `0` entries at `error` level |
| `NETWORK_404` | `NOT OBSERVED` in captured Browser developer logs |

## Implemented slice

- DNS has typed canonical facade `dns_product_get/providers/status/validate/preview/apply/rollback`.
- Global DNS, manual overrides and Service DNS adapters use the canonical product
  coordinator; the active Service DNS adapter no longer calls the legacy async
  writer path.
- DNS routing adapts the donor per-domain rule, delete and quick-preset behavior
  while writing only a Z2M draft. Resolver choices are converted to IPv4 values
  accepted by the existing DNS override writer.
- Telegram Proxy adapts donor-like install progress, connection details, QR/link
  reveal and clipboard interaction onto Z2M proxy/provider RPCs.
- No donor `/api/dns-routing/*` or `/api/tgproxy/*` calls were introduced.

## Router evidence

- Target: `root@192.168.1.1`.
- `ubus -v list zapret2-manager` exposes all seven `dns_product_*` methods with
  fixed `edit` transport on mutating/preview operations.
- Read-only `dns_product_get` returned `schema: dns-product.v2`, current desired,
  applied, observed, revision, ownership and rollback fields.
- Read-only DNS validate/preview checks were run without destructive Apply; the
  preview contract reports `zeroWrites: true`.
- Browser debug logs show `Object not found` for
  `zapret2-manager-engine/engine_*` and
  `zapret2-manager-proxy-provider/proxy_provider_*`. These are recorded as
  `BACKEND_NOT_READY`; they are not reclassified as frontend success.

## Verification commands

```text
node --check <changed frontend modules>
node --test tests/product/dns-v2-contract.test.mjs tests/product/dns-v2-delegation.test.mjs tests/product/dns-v2-rpc.test.mjs tests/ui/frontend-module-closure.test.mjs tests/ui/dns-tg-donor-adaptation.test.mjs tests/product/dns-tg-v2-characterization.test.mjs
git diff --check
```

Result: `21/21` tests passed; JavaScript syntax checks and whitespace checks passed.

## Remaining closure

The next acceptance step is to deploy/register the target engine and Telegram
provider RPC packages, then rerun the real Browser flows for DNS routing and TG
install/status/config interactions. Full product parity still requires donor
source evidence, adapted implementation, frontend automation and Browser
evidence for every applicable matrix row.
