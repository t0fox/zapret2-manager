# Task 17 report — final-review Scanner UI fix

Date: 2026-09-09
Branch/worktree: `codex/z2k-recovery-v3` / `G:\zapret2-manager\.worktrees\z2k-recovery-v3`

## Scope

Implemented the smallest UI-only fix in `z2m-scanner.js`:

- classify hello options now render the typed native values `modern`, `legacy`,
  and `both`, while preserving the existing `both` default and Russian labels;
- classify host validation now accepts valid IPv4, IPv6, and single-label DNS
  hosts while retaining bounded DNS-label and whitespace validation.

Added focused behavioral coverage in
`tests/ui/scanner-final-review.test.mjs` for rendered hello values, valid host
submit behavior, and invalid host rejection.

## TDD evidence

RED was run before the production change:

```text
node --test tests/ui/scanner-final-review.test.mjs
```

After the harness-only context fix, the current Scanner implementation failed
all 3 focused assertions: rendered values were `both/client/server` instead of
`modern/legacy/both`; IPv6 was marked `aria-invalid=true`; and the initial
numeric-invalid fixture was accepted as a DNS-shaped hostname. The fixture was
then tightened to the existing invalid-input case `not a host`; the unchanged
production code still failed the hello enum assertion while the host cases
passed, proving the remaining production defect.

GREEN:

```text
node --test tests/ui/scanner-final-review.test.mjs
3 tests, 3 pass, 0 fail
```

## Verification

```text
node --test tests/ui/scanner-final-review.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/ui/scanner-p1-regressions.test.mjs tests/ui/scanner-product-lifecycle.test.mjs
21 tests, 21 pass, 0 fail

node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
exit 0

node --check tests/ui/scanner-final-review.test.mjs
exit 0

git diff --check
exit 0
```

Implementation commit: `8738b645` (`fix(scanner): align classify UI with typed host contract`)

Committed files:

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `tests/ui/scanner-final-review.test.mjs`

No router deploy, APK build, push, merge, or worktree deletion was performed.

## Concerns / boundaries

This is host-side focused verification only. Router deployment, live LuCI
browser acceptance, APK packaging, and visual final approval were not run by
request.
