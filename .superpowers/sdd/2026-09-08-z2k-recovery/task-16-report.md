# Task 16 report — CI-backed APK and focused verification

Date: 2026-09-09

Candidate `962ef345ce77e2dc796ac81263b7e9273fa5dd98` was pushed only to the
dedicated execution branch `codex/z2k-recovery-v2` for the existing APK
workflow. GitHub Actions run `34296321727` completed successfully in `32m19s`.

The downloaded artifact `z2m-full-apk-962ef345ce77e2dc796ac81263b7e9273fa5dd98`
contains one APK, `SHA256SUMS`, and `build-manifest.json`. The manifest points
to the exact candidate SHA and OpenWrt 25.12.5 mediatek/filogic target.

| Measurement | Before | After | Result |
| --- | ---: | ---: | --- |
| Full APK bytes | 2645317 | 2628596 | PASS, 16721 bytes smaller |
| Native helper bytes | 81915 | 65523 | PASS, smaller |
| Production file count | 469 | 461 | PASS, smaller |

APK SHA-256:
`91957adad6cf5df516f46a1c5324770ce7bb820f33601c8505e03020b6fd9895`.

Focused recovery, knowledge, release, syntax, shell, and diff results plus
the repository-wide baseline/environment boundary are recorded in
`acceptance.md`. No local APK build was performed.

Task 16: `VERIFIED`.
