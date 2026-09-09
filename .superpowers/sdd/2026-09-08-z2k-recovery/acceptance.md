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

## Final source-first and clean-install candidate (2026-09-09)

The previous candidate sections are historical. The final production candidate
is `c6403068f9e59e1c75c631011c280ac08ede1dae`; only its production source was
deployed to the router first. The changed `apply.uc` matched locally and on
the router at SHA-256
`32a7c3accbbb0afac48d8a142ac899318517c9c357df4436bd614a1e2330ac26`.

The source-only gate passed before CI: recovery returned `state: none`, the
idempotent restore probe returned `alreadyRestored: true`, a mismatched digest
returned typed `EROLLBACK`, and the protected config digest stayed unchanged.
The service remained running with one `nfqws2`, NFQUEUE 300 owner parity,
Avatar active, and no warnings.

Only after that gate, CI run
[34341843538](https://github.com/t0fox/zapret2-manager/actions/runs/34341843538)
built the exact candidate successfully. Artifact
`z2m-full-apk-c6403068f9e59e1c75c631011c280ac08ede1dae` has digest
`sha256:aec88e01f21b610baa155f0ba962e191cb5e165bab0b01646220f26a3dad5999`.
The APK is `2,629,983` bytes with SHA-256
`2dc855df3ec9dac56a02154318f7e31ce611b079f15cf21a90c513299351a05c`.
No local APK build was used.

Before clean replacement, the router backup was written to
`C:\Temp\z2m-ci-c6403068-2\router-backup\z2m-c6403068-pre.tar.gz` with
SHA-256 `3367FA9CD9A365DF681627693F6EE57EBC2B6585F30E4C6209817246F9C3B5B0`.
The old package was removed and verified absent, then this exact CI APK was
installed successfully. Post-install recovery reported `state: none`, the
pending activation journal was absent, the package was `0.1.0-r156`, and the
installed production hashes matched the candidate. Runtime status remained
healthy.

The same-release `p-82.18` prepare/reinstall completed as
`z2k-1788953055-7e6f132f48ff989a`, with `targetCanApply: true` and no blocking
reasons; no pending activation journal remained afterward. LuCI hard reload of
`#/strategies` still showed Avatar selected/applied/current and the Scanner
route rendered typed controls without a stuck loading state.

The WSL/UCode focused coherent/lifecycle/async gate passed `53/53`; Detect
passed `44/45` with one safe symlink skip and no failures. The transient
Scanner suite passed `23/24`; its single failure is a pre-existing static
false-positive in the parent commit because the rule matches the existing
`${.../usr/libexec/...}` default path. It is recorded as baseline, not claimed
as a c640 regression. A live Discord Voice call was unavailable, so that
user-only condition remains explicitly unverified.

## Additional live lifecycle/discovery boundary (2026-09-09)

The router exposed `p-82.17` as an installable prior release. A real downgrade
prepare completed, and its real apply reached the pre-commit fetch gate but
failed closed with typed `EUNAVAILABLE` because the upstream asset source was
unavailable. The result reported `rollback.attempted: false` because no
mutation had begun, while lifecycle cleanup succeeded. Recovery afterward was
`state: none` and the installed p-82.18 runtime/LKG stayed healthy. Upgrade and
repair were not falsely reported after this external fetch failure; physical
injected rollback remains covered by the WSL/UCode transaction suite rather
than a live mutation injection.

Discovery was exercised further on the installed build: `enable(auto)` started
PID 11535, terminating that process produced a new procd PID 13393 with the
same four learned domains, and the final state was restored to
`auto/enabled/running`. A `dnsmasq` restart returned `running:false`, so that
source-specific path is recorded as externally unavailable rather than green.

## Registry-bound fix and exact current APK (2026-09-09)

The live source-first failure was diagnosed precisely. V3 activation receipts
carry the complete coherent runtime evidence, so six receipts made
`/etc/zapret2-manager/asset-registry.json` 1,332,618 bytes. The previous
`MAX_STATE_BYTES = 1024 * 1024` rejected this valid JSON during finalization,
which produced the observed `ERECOVERY_REQUIRED` / nested `ESTATE` and left a
`ROLLING_BACK` pending journal. Commit `84e6f791e428989d5c73c3302973f8c040efcad8`
raises the bounded registry limit to 4 MiB and adds a regression for a valid
state larger than 1 MiB. The focused WSL/UCode receipt suite is `12/12`
passed, `0` failed, `0` skipped.

The fixed source was deployed first to the router with exact local/remote
SHA-256 `c10abf4728f286d88e939a1573d991af2ff403f7a44d4bf703ae61c51d917117`.
Recovery then returned `state: rolled-back`, with runtime, registry, source,
catalog, strategy, config, autocircular, and Detect restored; the pending
journal was cleared. A fresh source-first upgrade `p-82.17 -> p-82.18`
completed with `42/42` downloaded, verified, staged, applied, and postflight
matched. The router then reported `p-82.18 / ready / verified / coherence
aligned`, one running `nfqws2`, NFQUEUE 300 owner parity, Avatar
`z2k_all_in_one`, and no pending journal.

Only after that source gate, CI run
[34354220544](https://github.com/t0fox/zapret2-manager/actions/runs/34354220544)
successfully built and verified artifact
`z2m-full-apk-84e6f791e428989d5c73c3302973f8c040efcad8` with artifact digest
`sha256:5a87bd2d73bfc1fc782c1ada6bd317de88c4cf0fda189b9b79fcddffaa9b6f0c`.
The manifest identifies commit `84e6f791e428989d5c73c3302973f8c040efcad8`,
release `r156`, and APK
`zapret2-manager-full-0.1.0-r156.apk`, 2,630,075 bytes, SHA-256
`31d4610d47e6d60aca6ba603d62b47bc2cdf55eea5d88ccccdd849dc81d0ccc7`.
No local APK build was performed.

Before clean replacement, the router state/package database backup was written
to `C:\Temp\z2m-ci-84e6f791\router-backup\z2m-84e6f791-pre.tar.gz` with
SHA-256 `30DF6219A9E976C8AA2BC939D6F87D451D88777A3C4358B6D1961442BE2801CA`.
The old package was removed and verified absent, then the exact CI APK was
installed successfully; its router-side SHA matched the manifest. Post-install
recovery returned `state: none`, package `0.1.0-r156` was present, the fixed
source hash matched, the 1,332,616-byte registry was accepted, and the pending
journal was absent. The same-release prepare/reinstall target was `p-82.18`,
operation `reinstall`, `targetCanApply: true`, with no blocking reasons; its
fresh apply left the runtime healthy and no pending journal.

After authentication in LuCI, Home showed `Работает`, the active Avatar
`z2k всё-в-одном`, and running `nfqws2`. Fresh post-install browser checks
showed `#/strategies` with Avatar 732 / Z2K 8 / User 0, the active strategy
marked selected/applied/current, and `#/scanner` with its typed diagnostic
controls and `Начать сканирование`; neither route remained stuck in loading.
The browser also exposes the existing root-password warning, which is an
environment condition and not a package failure.

Task 17 remains `WORKING/NOT_READY`: the registry-cap regression and exact
APK/router/browser gates are now evidenced, but the broader injected physical
rollback matrix, independent final whole-branch review, and user-only live
Discord Voice call remain explicitly unverified. No merge or branch/worktree
deletion has been performed.

## Latest source-first runtime-contract fix (2026-09-09)

The reported UI state `Неизвестно — Сервис не подтвердил процесс` was traced
to `z2m-components-model.js` dropping canonical Detect evidence when the
backend placed `coherence`/`local.compatibilityIdentity` beside the nested
`runtimeSummary`. The backend projection also did not expose
`compatibilityIdentity` inside `runtimeSummary`. Commit
`d4a233ff0b3f3a71838d18d1bb1bfdec4c2b7a89` fixes both boundaries and adds a
router-shaped UI regression test.

RED was reproduced before the production change (`actual degraded`, expected
`ready`). GREEN evidence is: the new regression `1/1`; focused model/page
tests `14/14`; runtime-summary suite `7` tests with `0` failures and `6`
environment skips; syntax and `git diff --check` clean. The two failures in
the larger coherent-UI fixture suite remain the pre-existing string-release
fixture mismatch and were not changed by this fix.

The exact commit was built only by GitHub Actions run
[34368745542](https://github.com/t0fox/zapret2-manager/actions/runs/34368745542).
Its artifact is `z2m-full-apk-d4a233ff0b3f3a71838d18d1bb1bfdec4c2b7a89`,
`zapret2-manager-full-0.1.0-r156.apk`, 2,630,232 bytes, SHA-256
`1c1c84e2517658affd7ce68469ca5d02f00674f0868f71557571fb989fd28e5b`, below
the 2,645,317-byte Task 1 baseline. No local APK build was used.

Before replacement, router backup
`C:\Temp\z2m-ci-d4a233ff-2\router-backup\z2m-d4a233ff-pre2.tar.gz` was
captured at 9,226,755 bytes with SHA-256
`ccd7eabc21455ea48d0b65c0055f8078c03059d7c04ba339c4457b26662e3f58`.
The old package was removed and verified absent, then the exact CI APK was
installed. Post-install package/recovery checks passed: package present,
`state: none`, pending activation journal absent, `status_fast` running with
one `nfqws2`, NFQUEUE 300 owner/rules parity, Avatar
`avatar:z2k_all_in_one`, and no current warnings. Installed source hashes are
`resource-update.uc=831257e8cf034f9aa1708ca0e4af46217504f479bda05f02ac1498481884726f`
and `z2m-components-model.js=62333c44501d503eb6c34f9c2ede5ef976b2187f9ccde1c3df2e64c48dee0c99`.

Fresh authenticated browser evidence after clean install and hard reload:
Home says `Работает`, `nfqws2` is running, and the strategy card says
`z2k всё-в-одном`; Components says `Система готова 2 / 2` and `Z2K Detect —
Работает · arm64`; Strategies shows Avatar `732`, Z2K `8`, User `0`, with
the Avatar All-in-One marked selected/applied/current. Existing root-password
warning and historical watchdog entries remain environment history, not the
current service state.

The broader Task 17 boundaries remain unchanged: injected physical rollback,
live Discord Voice, and independent whole-branch final review are not claimed;
merge and branch/worktree deletion were not performed.

## Current router-side validation correction (2026-09-09)

The current installed CI candidate was rechecked directly on the router. The
package is present; `status_fast` reports one running `nfqws2`, NFQUEUE 300
registered with matching owner/rules, Avatar `z2k_all_in_one`, and no current
warnings. `z2k_detect_status` reports coherent `p-82.18`, ready `arm64`, Detect
SHA `686ccfb6bd3138eace564f5416608bdd03e16ea59621ba589d6b2d7f4f694ed0`,
compatibility identity
`c7ab2eedf9dc2341fa503d4f1067bfaf49873e8bca6cb75672ff30dd27027b66`, and
runtime bundle digest
`222d32cbb508f23463e654dc3f0bfe0253d7495dd6ca5ba3e4314f2b1f244345`.

Direct typed Detect calls on that router returned: probe `ok:true` with an
upstream result; classify, QUIC, and TCP16 typed `EDETECT_TIMEOUT` rather than
`EINPUT`; voice `ok:true` with `verdict: clear`. Voice still had no active
Discord call, so it is not evidence of the required live-call path. The
current Scanner regression set is `27/27` passed, including the native
`modern/legacy/both` enum and valid IPv4/IPv6/single-label hosts.

The YouTube tab opened in the browser during investigation is explicitly
excluded from router/autocircular acceptance: the workstation is behind the
user's VPN, so that page proves only VPN reachability, not that traffic crossed
this router or `nfqws2`. The autocircular live-traffic arm transition therefore
remains `UNVERIFIED`; no false evidence is recorded. The Luna reviewer was
invoked on the existing agent thread, but returned no review message, so the
independent final review also remains open.
