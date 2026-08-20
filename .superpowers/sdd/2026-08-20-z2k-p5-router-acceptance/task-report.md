---
id: z2k-p5-router-acceptance
title: "Z2K P5 router acceptance"
type: report
status: complete
authority: implementation-evidence
updated: 2026-08-20
publish: false
tags: [z2k, p5, scanner, router]
---

# Z2K P5 router acceptance

Implementation commit: c3f1295767abfda613549ba997bbc86a2481ed3e

## Changed files

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh`
- `zapret2-manager/src/z2m-scanner-firewall-helper.c`
- `zapret2-manager/tests/native/avatar-strategy-scanner-a1-protocol-integration.test.sh`

## Router evidence

Target: Cudy WBR3000UAX v1, OpenWrt 25.12.5, aarch64, kernel 6.12.94.

The final deployed lifecycle used session `p5success720820`, candidate `candidate1`, generation `14`:

- `activate`: `ok=true`, `activated=true`, `identityVerified=true`, `kernelReadBack=true`, `chainCreated=true`, `ruleCreated=true`, `active=true`; queue `301`, peer PID `18250`, start time `390683`.
- `stabilize`: `ok=true`, `stable=true`, identity and queue peer read back as PID `18250`.
- `cleanup`: all cleanup fields true, including `processRemoved`, `firewallRemoved`, `nfqueueRemoved`, `temporaryFilesRemoved`, `ownedOnly`, and `tableChecked`.
- `lock-release` and `session-cleanup`: `ok=true`, verified directory removal.
- Post-cleanup: only baseline queue `300` remains, peer PID `4917`; no scanner-owned `z2m_sc_*` table and no queue `301`.
- Post-cleanup connectivity probe: `ping 1.1.1.1` succeeded with 0% packet loss; DNS lookup for `openwrt.org` succeeded.

The matching `nfnetlink_queue` and `nft_queue` kernel modules were extracted from the official OpenWrt 25.12.5 kmod repository and loaded with `insmod` for this acceptance. They were not installed as APKs or made persistent. A post-reboot acceptance therefore still requires persistent firmware/package integration of those matching kmods.

## Host verification

- Matching aarch64 helper build succeeded with `-Wall -Wextra -Werror`; final helper SHA-256: `47a60e78802598ee2a6b5f6b39addfb98ea6d406371d2a888716c8bf6ecbf99e`.
- A1 protocol, canonical helper, and load-bearing native shell gates passed.
- `bash -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh` passed.
- `git diff --check` passed.
- Knowledge validator remains blocked by two pre-existing repository findings: `docs/05-parity/z2k-p5-parity-matrix.md` missing frontmatter and `docs/05-parity/z2k-parity.md` unreachable authority document.
- Full ucode-dependent parity tests were not claimable on this Windows/WSL host because `/opt/ucode/bin/ucode` is unavailable; router runtime evidence above is the authoritative deployment boundary for this acceptance.
