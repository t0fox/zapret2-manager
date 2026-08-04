# Strategy, Run State and Proxy Correctness Plan

> **Execution requirement:** implement on the single persistent branch `docs/video-found-ui-correctness-design`; do not create another feature branch. Use TDD and merge automatically only after exact-head GitHub Actions is fully green.

## Goal

Fix the remaining functional defects demonstrated in the router video:

1. a strategy shown as recommended can be rejected only at apply time;
2. `ENOENT: run not found` can coexist with an apparently active run and stale counters;
3. Telegram Proxy reveals its secret-bearing link during ordinary page load;
4. secret rotation can mutate the secret and restart the service, fail listener verification, and leave the UI/backend in an ambiguous partial state.

## Constraints

- Preserve all existing ubus/RPC method names and ACLs.
- Do not add a second frontend parser for zapret2 syntax.
- Backend candidate preflight is the source of truth and must be reused by both preview and apply.
- A missing run is terminal; polling must stop immediately.
- Secret-bearing links are revealed only after an explicit user action and confirmation.
- Secret rotation must be transactional: failure restores the previous secret and prior service state, or reports an explicit rollback failure.
- Secrets must never enter state JSON, browser store, drafts, logs, toasts, events, tests, or PR descriptions.
- Bump backend/meta releases together and LuCI independently.

## Task 1 — RED regression coverage

Create `tests/ui/video-strategy-proxy-regressions.test.mjs` and add it to the focused workflow. Require:

- `discord-profile-cli.uc` exposes one `candidate_preflight()` used by preview and apply;
- preview candidates contain `applicable` plus bounded validation reason/code;
- `z2m-strategy.js` disables Apply for non-applicable candidates and shows the backend reason;
- `z2m-runs.js` recognizes missing-run errors, terminalizes the snapshot as `stale`, clears `activeRun`, and stops polling without normal timeout backoff;
- the simple strategy run poll also clears `state.runId` on a missing run;
- `z2m-proxy.js` performs no guarded reveal in `load()` and exposes an explicit `revealLink()` action;
- proxy rotation UI distinguishes verified success, rolled-back failure, and rollback failure;
- `proxycfg_secret_rotate()` snapshots/restores the previous secret and service state.

Create `tests/proxy-secret-rotation.test.mjs` and a deterministic helper in `tests/lib/proxycfg-logic.mjs` that proves:

- stopped service + successful write is a success without restart;
- running service + successful restart/verification is verified success;
- write/restart/verification failure restores the previous secret;
- rollback failure is explicit and never reported as success;
- result objects contain stage metadata but no secret value.

Extend `tests/flowseal-combo-apply.test.mjs` and `tools/flowseal-combo-apply.mjs` so a single pure candidate preflight model covers syntax, wide acknowledgement, required files, and native validation.

Run the focused PR workflow and retain the expected RED evidence.

## Task 2 — One backend strategy preflight for preview and apply

In `discord-profile-cli.uc`:

- replace the opaque inline syntax condition with `candidate_syntax_errors(candidate)` returning bounded structured reasons;
- implement `candidate_preflight(candidate, input, checkRuntime)`;
- include final runtime overrides when computing the preview used by the single-view Strategy page;
- run the same syntax/files/native checks used by apply and attach only safe metadata:
  - `applicable`;
  - `validationCode`;
  - `validationMessage`;
- never include raw native command output, paths beyond existing safe metadata, or unbounded text;
- apply calls the same helper and returns its structured error instead of the generic `candidate syntax rejected`;
- a candidate that is not applicable cannot remain marked recommended in preview.

In `z2m-strategy.js`:

- show an `нельзя применить` status and backend reason;
- disable Apply when `selected.applicable !== true`;
- preserve explicit wide acknowledgement and digest checks.

## Task 3 — Terminalize missing runs

In `z2m-runs.js`:

- add `missingRunError(error)` for `ENOENT`, `run not found`, and equivalent normalized backend forms;
- add `terminalizeMissingRun(error)` which creates a historical `stale` snapshot from the last known run, sets a bounded error, clears `activeRun`, resets poll timers/in-flight state, and prevents further polling;
- render stale/missing as terminal, never as active/testing;
- retain old counters only under a clearly labeled historical snapshot.

In `z2m-strategy.js`:

- the simple targeted-run poll recognizes the same missing condition;
- clear `state.runId`, stop the timer, and show `Запуск больше не найден`;
- do not schedule another poll or retain an active phase.

## Task 4 — Explicit proxy reveal and transactional secret rotation

In `z2m-proxy.js`:

- ordinary `load()` requests metadata only;
- add `revealLink()` invoked only by `Показать ссылку / QR-код` after a confirmation modal;
- keep the revealed link only in the modal-local closure; do not assign it to module state or shared store;
- copy/open/QR actions use the explicit reveal flow;
- after secret rotation, refresh health/status and render one of:
  - verified success;
  - failure rolled back to previous secret;
  - rollback failed — manual recovery required;
- never display both a green running assertion and a failed verification assertion as equivalent success.

In `proxycfg.uc`:

- snapshot previous secret file existence/content/mode and prior running state before mutation;
- write the new secret, restart only if previously running, and verify the configured listener;
- on any post-write failure restore the previous secret (or remove the newly created file), restore prior service state, reread runtime, and return `rolledBack`, `rollbackFailed`, `rollbackFailures`, `stage`, and safe reread metadata;
- do not return old/new secret values;
- event log contains only stage/result metadata, never secret material.

Mirror the outcome planning in `tests/lib/proxycfg-logic.mjs`.

## Task 5 — Package, verification and merge

- bump `zapret2-manager` and `zapret2-manager-full` from their current backend release to the next release;
- bump `luci-app-zapret2-manager` from r140 to r141;
- update package/release assertions without weakening them;
- focused tests must be zero red;
- `tools/run-all-tests.sh` must be zero red;
- LuCI JavaScript syntax, ucode compile/no-sugar gates, menu/ACL JSON, CSS/local assets, source encoding and `git diff --check` must pass;
- review the final diff for secrets, router addresses and generated `etc/`, `usr/`, `www/` trees;
- open PR #21 from the same persistent branch;
- require exact-head checks, mergeable state, no requested changes and no unresolved threads;
- merge with a merge commit and fast-forward the same branch to the resulting `main` merge commit.

## Router acceptance after Stage 3

After merge, install the new backend and LuCI packages over the running router without a required reboot and repeat the original video scenario. Record only sanitized statuses/timings; never capture the revealed proxy URL or secret. The final router verdict remains PARTIAL unless strategy connectivity and proxy listener verification are both actually confirmed.