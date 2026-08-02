# Auto Strategy M8 target acceptance

## Evidence

- Tested source HEAD: `6c901c33a2bb52829d0e5104b620cca34a2a193e` with the documented M8 dirty tree.
- APK: `zapret2-manager-0.1.0-r119.apk`, SHA-256 `a48f09ab6ea0b76c248163ce47efd1c47d41b777d218476c0002c8251fdb2eef`.
- Target: Cudy WBR3000UAX v1, OpenWrt 25.12.5, `aarch64`.
- Install: PASS from the signed `packages.adb` repository with `apk add --upgrade`; no force or trust-bypass option was used.
- Compatibility regression: PASS.  The imported ucode module uses supported export-list syntax, has no shebang, and status guards an absent `lastGood.record` before nested access.
- Local focused suite: PASS, 66/66.  Full gate: 976 green, 39 red, matching `docs/test-baseline.json`; no new failures.
- Watchdog, `nfqws2`, and NFQUEUE: PASS after r119 installation.  The init service reports `running`; the NFQUEUE table has 99 lines.
- RPC status: PASS.  `orchestra_auto_status` returned a bounded disabled-state response with revision 384, no active run, no last-good record, and no null-access error.
- LuCI endpoint: previously reachable after the signed install; no browser-authenticated visual session was available for a stronger UI claim.

## Uncompleted acceptance

Controlled three-failure scan, winner/apply, rollback, and reboot persistence were not run: this target had no pre-existing safe acceptance fixture for inducing those transitions without changing live service behaviour.  They are not inferred from unit tests or a zero exit status.

## Verdict

**PARTIAL** — r119 package installation, target ucode compatibility, read-only RPC status, watchdog, and baseline-safe runtime are confirmed.  Release remains blocked on the four unexercised destructive/long-running acceptance paths above.
