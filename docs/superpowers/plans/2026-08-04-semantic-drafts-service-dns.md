# Semantic Drafts and Service DNS Ownership Plan

> **Execution requirement:** implement on the single persistent branch `docs/video-found-ui-correctness-design`; do not create another feature branch. Use TDD and merge automatically only after exact-head GitHub Actions is fully green.

## Goal

Make `DNS → Доступ сервисов` the only owner of per-service DNS mappings, replace raw JSON draft previews with user-readable before/after changes, and ensure reverting a value to its baseline removes the draft entirely.

## Constraints

- Keep existing RPC names and payload formats.
- Keep asynchronous Service DNS apply/status/rollback in `z2m-dns.js`.
- Remove the alternate synchronous Service DNS workflow from `z2m-services.js`.
- Preserve service catalog enable/disable, domain viewing, bounded checks, preview and apply.
- No document reloads.
- No raw internal scope names in normal UI.
- Package release becomes `0.1.0-r140`; backend and meta-package releases remain unchanged.

## Task 1 — RED regression coverage

Create `tests/ui/video-drafts-service-dns-regressions.test.mjs` and add it to the single-view workflow. Assert:

- `z2m-services.js` has no `ctx.api.dns.serviceStatus`, `ctx.api.dns.serviceProviders`, `ctx.api.dns.serviceSet`, `ctx.api.dns.serviceApply`, per-service DNS select label, or `Применить DNS` button.
- Services draft stores only true enable/disable changes against a baseline and clears the scope when empty.
- DNS defines a Service DNS baseline and stores `{ changes: { id: { before, after } } }` rather than the full selections map.
- returning `after === before` deletes the item and eventually calls `ctx.clearDraft('service-dns')`.
- `app.js` maps `service-dns` to the label `DNS: доступ сервисов`, target tab `dns`, and pane `access`.
- draft preview renders before/after rows and does not use `safeDraft()`/raw JSON for known scopes.
- DNS subtab labels touched by the video are Russian.
- the apply bar action can focus an already-open changed section.

Run the focused workflow and retain the expected RED evidence.

## Task 2 — Services owns only catalog state

In `z2m-services.js`:

- remove DNS state, provider parsing, DNS RPC loads, per-row DNS selects, `applyDns()`, and DNS apply button;
- add `enabledBaseline` derived from catalog status;
- create `enabledChanges()` with entries `{ label, before, after }`;
- `updateDraft()` writes `services: { changes }` only while changes exist, otherwise clears the scope;
- keep `enabledIds()` as the full effective state for catalog preview/apply payloads;
- add `resetDraft()` to restore UI state from the next backend load after global discard;
- change page copy to describe service catalog and checks, not DNS profiles.

## Task 3 — DNS owns semantic Service DNS drafts

In `z2m-dns.js`:

- translate panes to `Настройка DNS`, `Проверка и выбор`, `Доступ сервисов`, `Дополнительно`, `История`;
- add `serviceBaseline` and a service label map;
- initialize current selections from the baseline;
- build `serviceDnsChanges()` containing only values that differ from baseline;
- write `service-dns: { changes }`; clear the scope when no changes remain;
- mark changed rows with a stable class/data attribute;
- keep apply payload as the full current selections map;
- after successful apply, clear current baseline/state before refresh;
- expose module methods `openDraft(scope)`, `focusDraft(ctx, scope)`, and `resetDraft()` so app-level draft actions can target `dns/access` and reset in-memory state;
- replace raw RPC-chain subtitles with user-facing descriptions in the touched pane.

## Task 4 — Semantic apply bar and navigation

In `app.js` and `z2m-shell.js`:

- define draft metadata for all known scopes, including `service-dns` → `DNS: доступ сервисов`, tab `dns`, pane `access`;
- implement `renderDraftDiff(scope, value)` for `value.changes`, showing label and `before → after` using readable on/off/disabled values;
- retain a redacted fallback only for legacy/unknown scopes, clearly labeled as technical data;
- rename the preview action to `Что изменено`;
- dynamically label the navigation action `Перейти к изменениям` or `Показать на странице`;
- invoke module `openDraft()` before navigation and `focusDraft()` after the target is mounted;
- during global discard call each module’s optional `resetDraft()` before the in-app refresh.

## Task 5 — Verification and merge

- bump LuCI release to r140 and update existing release assertions;
- focused tests must be zero red;
- `tools/run-all-tests.sh` must be zero red;
- JavaScript syntax, menu/ACL JSON, CSS/local assets and `git diff --check` must pass;
- review final diff for secrets and generated router trees;
- open PR #20 from the same persistent branch;
- require exact-head checks, mergeable state, no requested changes and no unresolved threads;
- merge with merge commit and fast-forward the same branch to the resulting `main` merge commit.
