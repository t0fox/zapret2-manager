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
  artifact was promoted from this local attempt.

Two additional bounded package-only diagnostics used existing local SDK caches
and were not treated as release evidence. A minimal-config probe avoided the
device-wide `uboot-mediatek` graph but reached a missing `json-c` source and
the host DNS timeout. A second probe using the older cache's completed
dependency stamps reached virtual-kernel packaging and failed with
`libfakeroot: connect: Connection refused` in the relocated SDK environment.
No package artifact was promoted or claimed from either probe.

Supported GitHub Actions package build for implementation commit
`9464a59588f1ddb06df3ac8401dc9999915d6cbb`
=> run `33705550732` completed successfully. The workflow built and verified
three product APKs for OpenWrt `25.12.5`, target `mediatek/filogic`, and
uploaded the exact artifact `z2m-apk-9464a59588f1ddb06df3ac8401dc9999915d6cbb`.
The repository verifier returned `Verified 3 product APKs` for the downloaded
artifact. The recorded APK SHA-256 values are:

```text
zapret2-manager-0.1.0-r154.apk       767413f559440781183dea1cb93f959912fa6eb313c9156de1965872320f641d
luci-app-zapret2-manager-0.1.0-r154.apk 98e4e1b0f3eed893e1e8a8f77d61f25e374a6bf8fe9feb21784ddcb844c3a32d
zapret2-manager-full-0.1.0-r154.apk  168b52ee4656853e9e7505881c8a03e72cb73cfb27f9245240c0bf79732dd447
```

The rolling prerelease `main-latest` points to the same commit and exposes
the corresponding `0.1.0-r154` filogic bundle. The artifact is available in
the local ignored download directory for later deployment; it has not been
installed on the router.

The subsequent evidence-only `main` commit
`e65c32e487218269a52bfdc703a0115a5cb4f166` also completed the supported CI
workflow as run `33711268937`. Its manifest records that exact source SHA and
the same three verified product APKs (`0.1.0-r154`); the artifact verifier
again returned `Verified 3 product APKs`.

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
  `zapret2-manager-full` are installed at `0.1.0-r150` according to the
  target APK database.
- The target has official `zapret2` engine release `v1.0.4`; `nfqws2` is
  running and the nftables `inet zapret2` table has active queue rules for
  queue `300`.
- The target has `/usr/bin/ucode`, the current active catalog generation is
  `generation-446a1d7b95be7dc7ce3731bbf99b89c51c0fa19e8bc117fdf9ee23daf9f51d2d`,
  and the existing Z2K resource check reports `update-available` with
  `canApply: false`; these are baseline observations, not fresh checks from
  the new package.
- Read-only RPC baseline: active strategy is canonical ID
  `z2k:z2k_all_in_one` with `entryKind: all-in-one`, while the active catalog
  has `852` physical and `852` unique entries, source commit
  `8c44df2bed98872d1348db053623ee6bf2902408`, and digest
  `446a1d7b95be7dc7ce3731bbf99b89c51c0fa19e8bc117fdf9ee23daf9f51d2d`.
- Read-only Z2K version baseline: installed `r-80.3`; remote cache is stale,
  with `r-81.6` reported as latest and `r-81.6` installable. The current
  resource status still reports attention on `z2k-resources` and
  `canApply: false`; no refresh was started.
- Read-only DNS baseline: global mode is `system`; service DNS revision is
  draft/applied `3` with `chatgpt-openai` selected as
  `prof-chatgpt-openai-comss-dns`; the effective provider list contains the
  immutable built-in catalog and no custom provider was observed.

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
- `29cc34fc` — final scoped acceptance evidence refresh;
- `352d8abb` — package-only build boundary evidence.
- `9464a595` — delivery evidence alignment after the main push.
- `e65c32e4` — evidence-only commit whose exact CI artifact was verified.

The exact supported CI package build and artifact verification are complete
for the implementation source at `e65c32e487218269a52bfdc703a0115a5cb4f166`;
the pinned local build remains a separate diagnostic failure because OpenWrt
feeds could not resolve and `/mnt/g` failed the SDK case-sensitive-filesystem
prerequisite. The evidence-only commit is pushed to `origin/main`. No package
artifact has been installed on the router, and no GREEN/READY claim is made
for unexecuted router/browser gates.
