# Dashboard events transport timeout — 2026-08-22

## Root cause

The Dashboard critical load wave used the heavyweight `service.status()` together
with `events_tail`, Strategy preview/recommendations, and an optional
`tg_product_status()` request. On the router, `status_fast` completed in about
0.29 s while the full status exceeded a bounded 12 s probe. Under the same
initial-load contention, `events_tail` expanded to about 7 s and LuCI rendered
`XHR request timed out`.

## Fix

- Prefer `ctx.api.service.statusFast` with `status` as compatibility fallback.
- Remove optional Telegram status from the critical `Promise.allSettled` wave.
- Schedule Telegram status after the critical wave and rerender only its card.
- Add `tests/ui/dashboard-transport-contract.test.mjs`.

## Evidence

- Browser reproduction on `http://192.168.1.1`: error reproduced before deployment.
- After deployment via `scp -O`, the same Dashboard loaded the event journal and
  the Telegram card independently; no new browser error appeared.
- Router runtime was not restarted or mutated.
- Focused tests: 21/21 passed; Dashboard initial-load contract: 1/1 passed.
- Commit: `764b9e90cf091c8072cd96e1b351b7b18b4ee58b`.
