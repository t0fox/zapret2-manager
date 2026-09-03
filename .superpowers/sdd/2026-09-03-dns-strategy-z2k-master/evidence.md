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

DNS/product scoped suite
=> tests=25, pass=21, fail=0, skipped=4.
  The four skips are UCode-backed catalog persistence cases because the host
  has no /opt/ucode/bin/ucode.

Z2K static/lifecycle scoped suite
=> tests=29, pass=29, fail=0, skipped=0.

Exact revision / dependency / target-gate contracts
=> tests=20, pass=20, fail=0.

Release contract suite
=> tests=5, pass=5, fail=0.

Pinned APK build (`bash scripts/release/build-apk.sh`)
=> exit 1 after the script's 3 bounded feed attempts. The SDK archive was
  verified and extracted, but all three OpenWrt feeds failed with
  `Could not resolve host: git.openwrt.org`; the SDK prerequisite also failed
  `case-sensitive-fs` on `/mnt/g`. No `FORCE=1` override was used, so no APK
  artifact or artifact-verifier evidence was claimed.
```

## Known host boundary

The full official compiler / Strategy refresh suite was executed once after
the latest changes:

```text
node --test --test-concurrency=1 \
  tests/product/z2k-official-compiler.test.mjs \
  tests/product/z2k-official-semantic-parity.test.mjs \
  tests/product/strategy-source-z2k.test.mjs \
  tests/product/strategy-source-refresh.test.mjs
```

Result: `tests=29, pass=0, fail=29`. Every failure is the same environment
boundary: `spawnSync /opt/ucode/bin/ucode ENOENT`; no product assertion was
reached. A prior single bounded attempt to install the pinned runtime failed
with `curl: (6) Could not resolve host: github.com`; no retry or token/network
workaround was performed.

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

The implementation commit is `1b167426b3bda7b4657569ba9718fd88bc0daafa` on
`main`. It remains subject to the final review, successful package
build/artifact verification, and the router/browser acceptance boundary
above. No GREEN/READY claim is made for the blocked UCode, failed package
build, or unexecuted router gates.
