# Z2K recovery acceptance evidence

Date: 2026-09-09
Candidate: `7dd27e084fc670e7c4d54ae31150b430dc11d692`
Execution branch: `codex/z2k-recovery-v3`
Router: Cudy WBR3000UAX v1 (`mediatek/filogic`, ARMv8), OpenWrt 25.12.5

## Automated gates

- Focused recovery harness: `216` tests, `212` passed, `3` pre-existing
  `package-helper` environment/worktree failures, `1` safe-control-directory
  skip. The three failures are the documented bootstrap-order, managed-root,
  and WSL `git show` baseline failures; none is owned by this recovery diff.
- Discovery focused suite: `14` tests, `13` passed, `1` safe-control-directory
  skip.
- Scanner current UI suite: `44/44` passed.
- Components/Resources/lifecycle affected suite: `107/107` passed.
- Task 15 canonical UCode/closure suite: `53/53` passed.
- Knowledge suite: `24/24` passed; `scripts/validate-knowledge.mjs` passed;
  `scripts/docs.mjs verify` passed.
- Release contract suite: `11/11` passed.
- JavaScript syntax, shell syntax under WSL, and `git diff --check` passed.
- The repository-wide host harness was run separately and remains red on
  pre-existing public-leak, Lua load-order, native bootstrap, and WSL
  privilege/environment failures. It is not reported as green.

## CI APK gate

The exact current candidate was built by the existing GitHub Actions workflow;
no APK was built locally. The previous `962ef345` artifact is an ancestor and
is retained only as historical evidence, not as final-candidate proof.

- Run: [34323028746](https://github.com/t0fox/zapret2-manager/actions/runs/34323028746) (`success`, exact HEAD `7dd27e084fc670e7c4d54ae31150b430dc11d692`).
- Artifact: `z2m-full-apk-7dd27e084fc670e7c4d54ae31150b430dc11d692`;
  digest `sha256:cfcde2da845723678497b745d6595e6f50fc1940da6246f2a52309ea60a7f9bf`.
- APK: `zapret2-manager-full-0.1.0-r156.apk`, `2,629,285` bytes,
  SHA-256 `43be72e71c069a8b9dc257788ca2f0b2f91d40aa9ef13e223509346b6a3c399c`.
- Baseline APK: `2,645,317` bytes; current delta: `-16,032` bytes.
- Historical ancestor artifact: [34296321727](https://github.com/t0fox/zapret2-manager/actions/runs/34296321727), not valid for the current candidate.

## Source and router evidence

Before the APK became available, the reviewed six-path source deployment was
verified on the router against candidate `962ef345`. The source deployment
included `z2k-detect.uc`, the typed RPC/maintenance frontend, lifecycle
coordinator/CLI, and rpcd object. The earlier live browser Apply proof showed
Avatar `z2k всё-в-одном` transition to `Выбрана Применена Используется сейчас`
and survive hard reload.

Before destructive replacement, the router LKG/config archive was exported to:

`C:\Temp\z2m-ci-962ef345\router-backup\z2m-recovery-lkg-20260909-0426.tar.gz`

Local backup SHA-256:
`BD64AE5C740148480F63C2DBEB35455A6A12D8DDC6B4A7465437DE2491970A2D`.

The old `zapret2-manager-full` package was removed and verified absent, then
the exact CI APK was installed with `apk add --allow-untrusted`. The package
manager restored its dependencies, installed `zapret2-manager-full-0.1.0-r156`,
and manager restart returned healthy `helperd` and `watchdog` instances.

Post-install router `status_fast` proves:

- `serviceState: running`;
- exactly one `nfqws2` instance;
- NFQUEUE `300` registered with matching owner and rules present;
- active strategy `avatar:z2k_all_in_one`, origin `avatar_builtin`;
- no status warnings.

## Browser evidence after clean install

Authenticated LuCI in the Codex browser as `root` with the existing empty root
password. The final hard-loaded Strategies route rendered the installed build,
not the authorization page, and showed:

- active card `z2k всё-в-одном (TLS/HTTP + QUIC + Discord)`;
- `Выбрана Применена Используется сейчас`;
- `Источник: Avatar`;
- filtered Avatar catalog card with the same selected/applied/current state;
- catalog summary `Avatar 732`, `Z2K 8`, `User 0`;
- no stuck `Loading view…` state.

The router still reports the pre-existing LuCI warning `No password set!`; no
root password was changed.

## Exact current APK installation

Before replacing the package, the router LKG/config archive was exported to:

`C:\Temp\z2m-ci-7dd27e08\router-backup\z2m-lkg-7dd27e08.tar.gz`

Local backup SHA-256:
`5563A0C098083E2A9CE0E90282CA5AC41C62D9B0CDD1AF01B53A3F47394D76D7`.

The old package was removed and verified absent, then the exact CI APK above
was copied to the router and installed with `apk add --allow-untrusted`.
The remote APK SHA-256 matched the CI manifest. The installed package is
`zapret2-manager-full-0.1.0-r156`; its packaged runtime file hashes are:

- `resource-update.uc`: `7e5bf5ed65d221c45488222318c58c15d71200595b9001e72243d9db843ab4cb`;
- `z2m-scanner.js`: `6f41317a0d214407296e99a35e0d0337edf15169775bb800af079ce7292b2800`;
- `zapret2-manager.uc`: `3582dc0bf8c8add544cbd1f560aa31f648f667fbc9d9fcfa231a24adefde1853`;
- native helper: `65523` bytes, SHA-256
  `7618e3bd7a5f0ff05da2ce61ddc30571bef590292aa6534f9ef45442cb86ba81`.

Post-install status remains healthy: one `nfqws2`, NFQUEUE 300 registered with
matching owner and rules, active `avatar:z2k_all_in_one`, and no warnings.

The exact current APK Detect boundary returned typed results: probe and voice
completed successfully; classify, QUIC, and TCP16 returned bounded
`EDETECT_TIMEOUT` rather than an input/contract error. Discovery returned
disabled before, enabled/running after `enable`, and disabled/not running after
`disable`, with four discovered domains retained.

## Current candidate source/lifecycle evidence

The current branch source was then deployed only as source for bounded runtime
verification. Remote SHA-256 matched local SHA-256 for:

- `resource-update.uc`: `7e5bf5ed65d221c45488222318c58c15d71200595b9001e72243d9db843ab4cb`
- `z2m-scanner.js`: `6f41317a0d214407296e99a35e0d0337edf15169775bb800af079ce7292b2800`

After archiving the prior failed prepare-job record, the current source passed
same-release `p-82.18` prepare/reinstall with operation
`z2k-1788937721-2165d294002081c1`, terminal `completed`,
`targetCanApply: true`, and no blocking reasons. Runtime remained one healthy
`nfqws2` process with Avatar `z2k_all_in_one`, NFQUEUE 300, and matching rules.
This source run is not a substitute for the pending exact-current-APK gate.

## Explicit boundaries

- No local APK build was performed.
- No second Core owner, generic executable/argv RPC, independent Z2K Resource
  mutation path, or legacy native Scanner production authority was introduced.
- Full failure/rollback/discovery matrix and live Discord Voice require more
  external runtime conditions than the Avatar regression and are not silently
  claimed by this report. In particular, a live Discord call was not fabricated.
