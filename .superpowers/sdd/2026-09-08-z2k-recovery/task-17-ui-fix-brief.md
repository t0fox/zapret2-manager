# Task 17 final-review fix brief — typed classify UI values and host validation

Read this brief first. It is the complete requirement for this fix.

The independent whole-branch review found two Important defects in the final
Scanner UI contract:

1. `z2m-scanner.js` renders classify hello options `both`, `client`, and
   `server`, but the typed Manager/native contract accepts exactly
   `modern`, `legacy`, and `both`. Selecting either non-default UI option
   sends a request the backend rejects.
2. `isValidHostname()` rejects IPv4, IPv6, and single-label hosts even though
   the supported Detect adapter accepts valid IP literals and valid DNS names.

Follow TDD strictly:

- Add focused behavior assertions first and run them RED against current code:
  rendered/descriptor classify hello values must be `modern`, `legacy`, `both`;
  valid IPv4 and IPv6 classify hosts must pass the UI validation path; invalid
  host input must still fail. Do not weaken unrelated URL/domain validation.
- Make the smallest UI-only fix in the existing Scanner file. Preserve the
  existing five operation descriptors, typed RPC API, bounded fields, and
  Russian labels. Do not add a generic Scanner/API or a new subsystem.
- Run the affected Scanner suites, JS syntax check, and `git diff --check`;
  append exact RED/GREEN evidence to the existing Task 17 report.
- Do not deploy, build an APK, push, merge, or delete anything in this task.

Write the report/update under `.superpowers/sdd/2026-09-08-z2k-recovery/` and
commit only this scoped fix with an attributable message. Return status, commit
SHA(s), one-line tests, and concerns.
