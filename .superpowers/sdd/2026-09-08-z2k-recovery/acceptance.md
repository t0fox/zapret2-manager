# Z2K recovery acceptance evidence

Date: 2026-09-09
Candidate: `962ef345ce77e2dc796ac81263b7e9273fa5dd98`
Execution branch: `codex/z2k-recovery-v2`
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

The existing GitHub Actions workflow built the exact candidate; no APK was
built locally.

- Run: [34296321727](https://github.com/t0fox/zapret2-manager/actions/runs/34296321727)
- Result: `success`, run `#325`, duration `32m19s`.
- Artifact: `z2m-full-apk-962ef345ce77e2dc796ac81263b7e9273fa5dd98`
- Artifact digest: `sha256:c6e367cff05264f2812963232d47536083595bd22b5fa26e942252c039033965`
- APK: `zapret2-manager-full-0.1.0-r156.apk`
- APK bytes: `2628596` (baseline `2645317`, reduction `16721` bytes)
- APK SHA-256: `91957adad6cf5df516f46a1c5324770ce7bb820f33601c8505e03020b6fd9895`
- `build-manifest.json` records the same candidate SHA and OpenWrt
  25.12.5 mediatek/filogic target. `SHA256SUMS` matches the downloaded APK.
- Native helper after package build: `65523` bytes;
  router SHA-256 `7618e3bd7a5f0ff05da2ce61ddc30571bef590292aa6534f9ef45442cb86ba81`.

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

## Explicit boundaries

- No local APK build was performed.
- No second Core owner, generic executable/argv RPC, independent Z2K Resource
  mutation path, or legacy native Scanner production authority was introduced.
- Full failure/rollback/discovery matrix and live Discord Voice require more
  external runtime conditions than the Avatar regression and are not silently
  claimed by this report. In particular, a live Discord call was not fabricated.
