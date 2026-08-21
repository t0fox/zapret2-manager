---
id: nfqueue-capability-recovery-2026-08-21
title: "NFQUEUE capability root cause and recovery"
type: report
status: current
authority: evidence
updated: 2026-08-21
publish: false
tags: [nfqueue, router, zapret2, recovery]
---

# NFQUEUE capability root cause and recovery

## Root cause

The router was running OpenWrt 25.12.5 on kernel `6.12.94`, but the installed
package set omitted `kmod-nfnetlink-queue` and `kmod-nft-queue`. The configured
official kmod feed matched the exact kernel ABI
`6.12.94~5a6c1f71be683ae9980b15d3ce73e24d-r1` and offered both packages at
`6.12.94-r1`; a dry-run install resolved only those two packages. This was a
router package-state/deployment problem, not an external blocker, ABI mismatch,
or missing OpenWrt feed.

The deployed runtime verifier had a second local defect: current nftables
renders the queue target as `queue ... to 300`, while the verifier accepted only
the older `queue num 300` spelling. This caused a false `ESTARTVERIFY` after
the kernel capability had been restored.

## Recovery evidence

- Before: `nfnetlink` loaded; `nfnetlink_queue` and `nft_queue` absent; the
  queue proc file was absent; `modprobe` failed without a module-load error;
  no queue kmods were installed.
- Feed proof: official matching feed returned `kmod-nfnetlink-queue-6.12.94-r1`
  and `kmod-nft-queue-6.12.94-r1`, with exact kernel dependency.
- Recovery: canonical `apk add` using
  `/etc/apk/repositories.d/distfeeds.list`; no raw APK upload and no reboot.
- After: both modules loaded, `/sys/module/nfnetlink_queue` and
  `/sys/module/nft_queue` present, and `/proc/net/netfilter/nfnetlink_queue`
  accessible.
- The collector fix was deployed with `scp -O`; local and router SHA-256:
  `a84f75a3eb3be62106538d211a6f2bc0b1419c2cc826e5254a751c298b65ab68`.

## Runtime acceptance

Canonical `ubus` lifecycle was used. Two STOP/START cycles and two RESTART
cycles passed. Each stopped state had no nfqws2, no queue 300 registration, and
no nft queue rules. Each running state had exactly one
`/opt/zapret2/nfq2/nfqws2`, queue 300 owned by the same PID, four nft queue
rules, and `status_fast` runtime summary
`running/process-and-nfqueue-confirmed`.

The selected strategy remained `z2k_all_in_one`; applied config SHA remained
`76fa571356fc25b703b4af06ae81d728cd7a1c0c825a2518f1b1fb523e291055` and
`drift.divergent` remained false. Router DNS resolution passed and HTTPS to
Cloudflare returned HTTP 200.

## Packaging and tests

`PKG_RELEASE` was bumped from 147 to 148 while retaining the explicit
`+kmod-nfnetlink-queue` and `+kmod-nft-queue` dependencies. Package tests now
assert both dependencies. The focused P0 tests passed 3/3, and the native gate
passed 35/36 before stopping on an unrelated pre-existing bootstrap-audit
failure in dirty files outside this task.

Code commit: `fa53a162026aeee6bfa70e0f7edbb09140b33d02`.
