---
id: dns-strategy-z2k-master-evidence
title: "DNS / Strategy / Z2K master-plan implementation evidence"
type: work
status: current
authority: evidence
updated: 2026-09-03
publish: false
tags: [dns, strategy, z2k, evidence]
---

# Implementation evidence

This record covers the implementation slices performed directly on `main` in
`G:\\zapret2-manager` under the user-requested DNS / Strategy / Z2K plan.
The attached plan and pasted Agent Prompt are project guidance; the direct
request to work on `main` is the governing checkout instruction.

## Implemented boundaries

- DNS now has one effective provider catalog owner: immutable package baseline
  plus revision-bound persistent overrides/custom providers. DNS diagnostics,
  global DNS, service DNS, product RPC, and LuCI consume the same provider
  identity. CRUD is explicit and dependency-safe; edits do not Apply resolver
  state.
- Strategy Z2K uses the official compiler output. The snapshot publishes one
  All-in-One entry plus every structurally valid standalone profile from the
  complete compiler model, with semantic dedupe, exact source provenance, and
  native-preflight evidence. Legacy hand-composed/pool-allowlist authority is
  not used.
- Z2K update planning now has an explicit dependency graph. Runtime-exact
  assets remain actionable; compiler-input changes require compile and native
  validation; adapted and consumed-unknown paths block; unconsumed unknown
  paths are advisory; unavailable Registry ownership fails closed.
- Branch checks resolve one exact commit before fetching `UPDATES.json` and
  content-bound candidates. Release preparation and Strategy refresh retain
  the selected immutable source revision. Resource status exposes runtime,
  available-upstream, current-Strategy, candidate-Strategy, and coherence
  fields without refreshing or applying automatically.
- The package postinst now verifies that a successful source migration really
  left `/etc/zapret2-manager/catalog/strategy-catalog-index.json`; otherwise it
  falls back to the bounded legacy index repair path.
- Maintenance UI preserves the existing dense visual language and surfaces the
  dependency/coherence facts in an explicit technical disclosure. The four
  required design skills were applied before UI edits: Emil design engineering,
  design consultation, design review, and Web Interface Guidelines review.

## Host verification

All commands below were run after the latest implementation changes unless
explicitly marked as blocked.

```text
node scripts/validate-knowledge.mjs
=> Knowledge validation passed.

git diff --check
=> exit 0, no output.

UI scoped suite (10 files, including DNS catalog and Components coherence)
=> tests=78, pass=78, fail=0, skipped=0.

DNS provider catalog UCode suite (WSL `/home/kirill/ucode/bin/ucode`)
=> tests=13, pass=13, fail=0, skipped=0.

The earlier Windows-only DNS/product run had four expected UCode skips; the
same UCode-backed catalog cases are now covered by the WSL run above.

Z2K static/lifecycle scoped suite
=> tests=29, pass=29, fail=0, skipped=0 (official compiler and source adapters).

Z2K catalog generation / authority / migration / refresh suite (WSL UCode)
=> tests=29, pass=29, fail=0, skipped=0.

Exact revision / dependency / target-gate contracts
=> tests=38, pass=38, fail=0.

Release contract suite
=> tests=8, pass=8, fail=0.

Package postinst / read-index contract
=> tests=2, pass=2, fail=0.

Pinned APK build (`bash scripts/release/build-apk.sh`)
=> exit 1 after the script's 3 bounded feed attempts. The SDK archive was
  verified and extracted, but all three OpenWrt feeds failed with
  `Could not resolve host: git.openwrt.org`; the SDK prerequisite also failed
  `case-sensitive-fs` on `/mnt/g`. No `FORCE=1` override was used, so no APK
  artifact or artifact-verifier evidence was claimed.

Two additional bounded package-only diagnostics used existing local SDK caches
and were not treated as release evidence. A minimal-config probe avoided the
device-wide `uboot-mediatek` graph but reached a missing `json-c` source and
the host DNS timeout. A second probe using the older cache's completed
dependency stamps reached virtual-kernel packaging and failed with
`libfakeroot: connect: Connection refused` in the relocated SDK environment.
No package artifact was promoted or claimed from either probe.
```

The full all-tests WSL run was completed before the final Z2K validator and
fixture follow-up and is therefore retained as a diagnostic, not as the final
gate: `tests=2366, pass=2054, fail=304, skipped=4, todo=4, RC=1`. Its failures
included WSL/native baseline failures, three UI files unable to import the
uninstalled `vitest` package, and the Z2K catalog fixture/validator mismatch
that the affected-scope rerun above subsequently corrected. The complete suite
was not rerun after those follow-up changes; affected-scope evidence is green,
but the full-suite status remains `NOT_GREEN`.

## Known host boundary

The full official compiler / Strategy refresh suite was executed in WSL with
the locally available UCode runtime:

```text
node --test --test-concurrency=1 \
  tests/product/z2k-official-compiler.test.mjs \
  tests/product/z2k-official-semantic-parity.test.mjs \
  tests/product/strategy-source-z2k.test.mjs \
  tests/product/strategy-source-refresh.test.mjs
```

Result: `tests=29, pass=29, fail=0, skipped=0`.

The Windows-native invocation still has no `/opt/ucode/bin/ucode`; it is not
used as evidence against the implementation when the equivalent WSL runtime
run is available. A prior single bounded attempt to install the pinned runtime
failed with `curl: (6) Could not resolve host: github.com`; no retry or
token/network workaround was performed.

## Router boundary

Read-only discovery succeeded on `root@192.168.1.1`:

- ICMP reachable.
- OpenWrt `25.12.5`, revision `r33051-f5dae5ece4`, target
  `mediatek/filogic`, board `cudy,wbr3000uax-v1-ubootmod`.
- `zapret2-manager`, `luci-app-zapret2-manager`, and
  `zapret2-manager-full` are installed.
- `/usr/bin/ucode` exists on the target.

No current worktree file was deployed, no package was installed, no RPC reload
or service restart was run, no Strategy/DNS Apply was run, and no reboot was
run. Therefore current router/browser acceptance remains `NOT_RUN`; the
project contract requires explicit approval for physical-router mutation.

## Delivery state

The implementation commits on `main` are:

- `1b167426b3bda7b4657569ba9718fd88bc0daafa` — DNS / Strategy / Z2K slices;
- `ca251453` — UCode-compatible DNS catalog fix;
- `0e7aefa1` — scoped OpenWrt feed package installation and release contract;
- `1cf6f0be` — Z2K test-only native gate alignment and package index warm-up
  verification;
- `ed502342` — acceptance evidence refresh.

They remain subject to final package build/artifact verification and the
router/browser acceptance boundary above. The pinned build's last observed
result was exit 1 after the three bounded feed attempts because OpenWrt feeds
could not resolve and `/mnt/g` failed the SDK case-sensitive-filesystem
prerequisite; the later feed-scope patch has only static contract evidence so
far. No GREEN/READY claim is made for package artifacts or unexecuted router
gates. The current branch also has no push or package artifact delivery yet.
