# Single APK release evidence

Date: 2026-09-04
Repository: `t0fox/zapret2-manager`
Branch at discovery: `main`
HEAD at discovery: `e62fcd7a6e594793c44e3299271a566a4dfeeec0`

## Scope

The release contract now has one user-facing artifact:
`zapret2-manager-full-<version>.apk`. The canonical full package builds the
four Z2M native helpers and installs the backend, UCode RPC, runtime assets,
LuCI, ACL and menu directly. `zapret2-manager` and
`luci-app-zapret2-manager` remain source/development compatibility definitions;
they are not release artifacts. Engine/Z2K downloaded lifecycle and Telegram
Proxy remain outside this package.

## RED → GREEN evidence

- Initial release-contract run against the split/meta implementation: 13 tests,
  4 passed, 9 failed (expected RED).
- `node --test tests/release/*.test.mjs`: 13 passed, 0 failed.
- `node --test tests/product/clean-install-contract.test.mjs tests/native/package-helper.test.mjs tests/product/cross-view-z2k-contract.test.mjs tests/product/discord-voice-autocircular.test.mjs tests/product/autocircular-runtime-persistence.test.mjs`:
  71 passed, 1 failed. The failure is the pre-existing native managed-root
  scanner baseline in `tests/native/package-helper.test.mjs`; it reports source
  call-site false positives and is unrelated to release packaging.
- `node --test tests/knowledge/public-projection.test.mjs tests/knowledge/validator.test.mjs tests/knowledge/docs-cli.test.mjs`:
  24 passed, 0 failed.
- `node scripts/validate-knowledge.mjs`: passed.
- `node scripts/docs.mjs verify`: passed; pinned Quartz SHA
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- `node scripts/docs.mjs build public`: passed; 46 input files, 227 emitted.
- `node scripts/docs.mjs build internal`: passed; 125 input files, 518 emitted.
- `git diff --check`, `bash -n scripts/release/build-apk.sh`, and Node syntax
  checks for changed JS/MJS files: passed.

The broad strategy/RPC UI run was also executed, but it is not a clean gate in
this host: 125 tests had 89 passes and 36 failures because the configured
`/opt/ucode/bin/ucode` harness is absent on Windows, plus existing UI fixture
drift. No such failure was converted into a success claim.

## SDK build attempts

Pinned SDK contract:

- OpenWrt `25.12.5`
- target `mediatek`, subtarget `filogic`
- SDK:
  `openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst`
- SHA-256:
  `ff4a38a397caa2cfe1c39e18f84ddede14878221b3593c3f2c4cfe24e3ec4c25`

1. `bash scripts/release/build-apk.sh` from the NTFS checkout reached the
   OpenWrt prerequisite check and stopped with:
   `Build dependency: OpenWrt can only be built on a case-sensitive filesystem`.
   Enabling case sensitivity with `fsutil` was denied by the host.
2. The checkout and cached SDK were copied to ext4 WSL at
   `/tmp/z2m-manager-build`, where the case-sensitive prerequisite passed.
   The same build then stopped after bounded upstream download retries with:
   `curl: (28) Resolving timed out after 5001 milliseconds`, followed by
   `Download failed` for `lua-5.1.5.tar.gz` and `ncurses-6.4.tar.gz`.

No APK, manifest, checksum set, or router installation is claimed from these
failed attempts. The pinned GitHub Actions build remains the authoritative
fresh SDK build gate after this main push.

## Not yet proven

- Fresh CI build and verifier result for the pushed commit.
- SDK-native APK metadata/content/mode inspection from a produced artifact.
- Clean-install and split-to-single upgrade transaction on a real router.
- Published `main-latest` release files.

The workflow publishes only after the one full APK, manifest, checksum and
verifier steps succeed. It does not publish a partial artifact set.
