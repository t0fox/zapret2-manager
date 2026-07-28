# Release / readiness checklist

State as of **production-accepted baseline: r19 @ 33e0133**
(see docs/acceptance.md for the full evidence).

## Canonical gates (must all be green before any commit/push)

- [ ] `tools/run-all-tests.sh` — full suite green, zero red
      (baseline arithmetic: backend 219, UI 67, strategy 117, shell 6 →
      **409 green / 0 red**; crashes and no-TAP files count as RED).
- [ ] Shell gates incl. ucode-no-sugar checks 1–9 (brackets, no-sugar,
      export-close, declaration order, binary tilde, ord-index,
      import completeness) all pass with their self-tests.
- [ ] Packaging gate: every shipped file installed; ACL grants every
      registered method (plugin↔ACL coherence).
- [ ] LF everywhere (.gitattributes `eol=lf`).
- [ ] No secrets in tree, logs or packages (redaction tests green).
- [ ] No `--allow-untrusted` anywhere in build/install flows.
- [ ] Both packages build + sign with the project key
      (`/etc/apk/keys/z2m-build.pub`, sha256 c885bf8f…); targeted install
      verifies without bypass; rollback package set preserved.

## Production acceptance status (r19)

- [x] Trusted signed install without bypass (Phase 1)
- [x] Backup preview/restore drill — ourState (Phase 2)
- [x] Strategy apply + rollback drill, baseline byte-restored (Phase 3)
- [x] DNS apply + rollback drill — z2m-smoke.test → 192.0.2.1 (Phase 4)
- [x] Blockcheck quick/custom end-to-end + cleanup (Phase 5)
- [x] Real reboot: autostart + 2.5 watchdog cycles (Phase 6)

## Remaining supervised gates (explicit approval required)

- [ ] Automatic 90-second rollback timer drill (timer stays DISABLED)
- [ ] Standard-set full blockcheck (15–20+ min scan)
- [ ] Service-catalog apply on production (after Phase B)
- [ ] DNS provider/resolver mutation (after Phase E)
- [ ] TG WS proxy installation + listener activation (after Phase F)
- [ ] Second reboot after r20+

## Commit-count / fix-vs-feature accounting (acceptance campaign)

- Overnight implementation: 8 commits (1 test-infra fix + 6 slice features
  + 1 install-fix series).
- Supervised acceptance: 14 commits total including that campaign:
  10 root-cause fixes, 1 feature (blockcheck test-set), 1 chore,
  1 acceptance docs commit, 1 Makefile series (folded into slice commits).
- This run: Phase A (this document) is the baseline-closure commit;
  subsequent phases land as independent green slices.
