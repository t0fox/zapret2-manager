---
id: sdd-2026-08-29-remote-metadata-parity-request-matrix
title: "Remote metadata request and consumer matrix"
type: evidence
status: complete
updated: 2026-08-29
publish: false
tags: [z2m, remote-metadata, performance, evidence]
---

# Request and consumer matrix

| Consumer | Initial read | Deferred read | Fresh authority | Failure projection |
| --- | --- | --- | --- | --- |
| Telegram Proxy | status, capabilities, config, operation | provider catalog, versions, events, optional health | `tg_product_check_updates` with `intent: mutation` | local status survives; empty/unavailable catalog is explicit |
| Components / Engine | manager versions, engine status, operation | Engine releases | Engine check token and candidate | installed identity survives; no remote latest when unavailable |
| Components / Z2K | local component status | Z2K release catalog | checked Z2K plan/target token | local receipt survives; stale browse is non-mutating |

## Request budget

The Components hydrator starts at most two remote metadata calls at a time and
stops publishing results for an old page generation. Telegram's provider
metadata is shared through the update-source cache, so warm browse does not
repeat an upstream request. Explicit refresh remains bounded to one request per
selected provider, and cooldown state prevents retry storms.

## Identity fields

The selected release is identified by provider, version, tag, release id,
published timestamp, release name, release body, release URL, compatible asset
name, digest, size, and artifact kind. The UI selects and renders changelog data
from that row rather than from a global latest blob.

## Verification map

- Source: focused JS syntax checks and UI contract tests.
- Product: UCode lifecycle, cache, cooldown, LKG, provider, Engine, and Z2K
  integration tests run under WSL because the Windows runner has no native
  `/opt/ucode/bin/ucode`.
- Router: source-only staged deployment, file hashes, `rpcd reload`, and live
  browser DOM checks.
- Browser: Components empty-state, Telegram no-crash state, real provider
  version list, and selected historical changelog identity.
