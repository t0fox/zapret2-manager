# Holyversion UI/UX Reference Parity Design

**Date:** 2026-08-04  
**Repository:** `t0fox/zapret2-manager`  
**Reference:** user-supplied `holyversion.html`  
**Status:** approved design  
**Working branch:** `feat/holyversion-reference-parity`

## 1. Purpose

Bring Zapret2 Manager visually and behaviorally to practical 1:1 parity with `holyversion.html`, while preserving the current modular LuCI application and replacing every prototype simulation with real backend data and real operations.

The reference is authoritative for:

- information architecture;
- layout and visual hierarchy;
- labels and human-facing terminology;
- primary and secondary actions;
- simple and advanced modes;
- draft, modal, table, progress, empty, error, and success states;
- responsive behavior;
- the intended user flow across Overview, Strategy, Services, Lists, DNS, Telegram Proxy, Monitoring, and Maintenance.

The reference is **not** authoritative for:

- hard-coded example values;
- simulated delays or progress;
- random strategy results;
- fake service health;
- static dates, revisions, hostnames, ports, domains, and package versions;
- browser-only application of router settings;
- the 60-second automatic rollback flow.

Every displayed operational fact must come from a real RPC/backend contract or be shown as unavailable. The UI must never invent a successful state.

## 2. Non-negotiable product rules

1. `holyversion.html` is the canonical UI/UX reference.
2. Visual and interaction parity should be as close to 1:1 as LuCI and real backend constraints permit.
3. Demonstration data and prototype simulations must be replaced with real backend behavior.
4. If real data is unavailable, the UI must show an explicit empty or unavailable state instead of a placeholder success.
5. There is no automatic rollback countdown.
6. The global draft bar has three actions:
   - **Отменить все**;
   - **Показать различия**;
   - **Применить** as the primary action.
7. A manual rollback action is shown only when the backend confirms that a valid restorable snapshot exists.
8. Existing security properties remain mandatory: secrets, tokens, passwords, and proxy links must not be cached or rendered without an explicit reveal action.
9. Existing sanctioned apply, validation, snapshot, rollback, revision, and last-good mechanisms remain backend-authoritative. The UI must not create a second apply engine.
10. The repository may contain only `main` and the persistent working branch during this program of work.

## 3. Delivery strategy

The work is delivered as vertical slices on one persistent branch:

1. shared shell, visual tokens, loading behavior, Overview, and simple/advanced mode;
2. unified draft preview and apply flow without automatic rollback;
3. Services parity, category controls, bulk operations, and source modes;
4. Strategy parity and real all-strategy testing against the 61-domain corpus;
5. Lists and Autohostlist parity;
6. DNS parity;
7. Telegram Proxy, Monitoring, and Maintenance parity;
8. final visual and behavioral gap audit.

Each slice must be independently testable and usable. A slice may be merged only after exact-head CI is green, there are no review blockers, and the expected head SHA has not changed. After merge, the persistent branch is fast-forwarded to `main` and reused.

## 4. Architecture

### 4.1 Preserve the modular LuCI application

The prototype HTML must not be embedded as a second application. The existing structure remains:

- `app.js` owns navigation, shared state, module activation, cached data, draft coordination, and common apply behavior;
- `z2m-shell.js` owns shared visual primitives, modal, toast, chips, buttons, apply bar, and confirmation/rollback presentation;
- page modules own their page-specific load, render, mount, unmount, focus, reset, preview, and apply adapters;
- `z2m-store.js` remains the browser state container;
- `z2m-api.js` remains the RPC boundary;
- ucode and shell backend components remain authoritative for validation, mutation, restart, verification, history, snapshots, and rollback.

Reference markup is translated into reusable LuCI components and CSS. Prototype JavaScript is treated as a behavior specification, not production code.

### 4.2 Shared state model

The UI must distinguish at least these states:

- **applied:** confirmed backend/runtime state;
- **draft:** browser-side proposed changes not yet applied;
- **pending operation:** an RPC currently running;
- **last result:** completed validation or test result;
- **active run:** a live Orchestra/strategy run;
- **historical run:** a terminal snapshot that must not appear active;
- **rollback availability:** backend-confirmed snapshot metadata;
- **load state:** initial loading, refreshing with cached content, empty, partial, and error.

No page may use draft values as if they were applied values. Overview and status chips must read applied/backend state only and label pending draft separately.

### 4.3 Real-data rule

A component may render a success, count, latency, revision, package version, strategy name, health state, or connectivity result only when its data source is identified and available.

Allowed unavailable states include:

- `Нет данных`;
- `Последняя проверка ещё не выполнялась`;
- `Backend не предоставляет этот показатель`;
- `Служба недоступна`;
- `Результат устарел`.

A missing value must never be replaced by a reference example such as `57/61`, `312 мс`, `Flowseal ALT11`, or a fake timestamp.

## 5. Shared shell and visual parity

The production UI adopts the reference's:

- maximum content width and page padding;
- dark visual tokens;
- sticky application header;
- horizontal primary tabs and page subtabs;
- panel radii, borders, headers, and body spacing;
- typography scale;
- buttons, chips, dots, switches, progress bars, tables, forms, consoles, diffs, and accordions;
- modal and toast positioning;
- desktop, tablet, and mobile behavior;
- simple and advanced visibility rules.

The simple mode shows human-readable status, decisions, and safe actions. Technical paths, argv, raw JSON, raw RPC payloads, low-level flags, and internal identifiers belong in advanced mode unless they are necessary to resolve an error.

Initial page navigation must not replace the entire usable application with a blank area. When cached data exists, keep the last successful view visible and refresh it in the background. For first load, use a layout-preserving skeleton or explicit panel-level loading state.

## 6. Unified draft and apply flow

### 6.1 Draft bar

The sticky bar displays:

- a `Черновик` chip;
- number of changed scopes;
- human-readable scope names;
- a statement that the changes do not yet affect the router;
- **Отменить все**;
- **Показать различия**;
- **Применить** as the rightmost primary action.

`Показать на странице` and `Перейти к изменениям` are removed from the primary bar. Page-level focus helpers may remain available inside the semantic diff modal.

### 6.2 Semantic diff

The preview modal shows user-facing changes grouped by scope. Each entry must contain:

- object or setting label;
- previous applied value;
- proposed value;
- validation/applicability status when relevant;
- warning or blocker text;
- optional `Перейти` action to focus the exact page element;
- primary **Применить** action when the complete draft is valid.

Raw JSON is forbidden as the default representation. Legacy draft values without semantic metadata may be shown only in an advanced technical details section with secrets redacted.

### 6.3 Apply contract

The global apply coordinator must not directly mutate settings. It builds an ordered application plan from page-owned adapters. Each adapter exposes a bounded contract equivalent to:

- `validateDraft(scope, value, context)`;
- `previewDraft(scope, value, context)`;
- `applyDraft(scope, value, expectedRevision, context)`;
- `reloadAppliedState(context)`;
- `resetDraft()`.

The exact JavaScript shape may follow current project conventions, but responsibilities must remain separated.

Application sequence:

1. snapshot the browser draft and current backend revisions;
2. run local structural validation;
3. run backend preflight for all affected scopes;
4. reject the whole operation before mutation when a blocking conflict exists;
5. create backend snapshots where supported;
6. apply scopes in an explicitly documented order;
7. restart only affected services;
8. reread applied state;
9. verify the result;
10. clear only scopes confirmed as applied;
11. retain failed or unapplied scopes with exact errors;
12. refresh affected page caches and Overview.

The first implementation may support only scopes with a safe existing backend apply contract. Unsupported scopes must make **Применить** unavailable with a clear explanation; they must not be silently skipped.

### 6.4 Rollback

There is no timer, countdown, or automatic browser confirmation flow.

After an operation, a manual `Вернуться к предыдущей конфигурации` action may be displayed only when the response includes backend-confirmed rollback availability and snapshot identity. A rollback result must be reread and verified before the UI reports success.

## 7. Overview

Overview is the trusted summary of applied state. It mirrors the reference hero structure using real values:

- service/runtime health;
- applied strategy name and description;
- source and application time;
- revision or snapshot metadata;
- number of tested domains opened out of 61;
- latency summary;
- failed domains from the last completed corpus test;
- quick actions for full selection, all strategies, diagnostics, and rollback when available;
- single-resource check;
- point rules;
- actionable recommendations.

The page must visibly separate:

- currently applied configuration;
- pending draft;
- last completed test;
- active test run;
- stale historical data.

A service process being alive is not sufficient to label bypass or proxy connectivity healthy.

## 8. Strategy system

### 8.1 Candidate admission

All candidates use the same backend preflight for preview and apply. Each candidate exposes:

- stable ID and human label;
- description and optional technical argv in advanced mode;
- `applicable`;
- safe validation code/message;
- last completed result;
- whether it is currently applied, selected in draft, recommended, or unavailable.

Inapplicable candidates are shown but cannot enter network testing or the draft. A direct backend apply must still reject them.

### 8.2 Full corpus selection

The real selection unit is:

`all applicable strategies × 61 domains × configured attempts`

The corpus must be versioned and its identity recorded in the run. The backend owns orchestration, exclusive lease, snapshots, candidate activation, bounded probes, restoration, scoring, cancellation, and terminalization.

The UI shows:

- strategies completed / total;
- domain probes completed / total;
- current strategy;
- current domain;
- elapsed time and bounded estimate when reliable;
- cancellation state;
- infrastructure errors separately from candidate failures.

For each strategy, record at minimum:

- domains opened out of 61;
- success percentage;
- median latency;
- p95 latency;
- attempt stability;
- timeout count;
- infrastructure error count;
- regression count relative to baseline when available;
- final score;
- failed-domain list;
- preflight status.

The reference presentation is retained: sortable strategy rows, recommendation, details, history, and selection into the global draft.

### 8.3 Run state machine

Run phases and terminal states must be explicit. A missing run (`ENOENT`) terminalizes the UI state:

- polling stops;
- active run is cleared;
- stale active counters disappear;
- historical data is labelled as a snapshot;
- `testing` and `pending` are not rendered;
- the user receives a stable `Запуск больше не найден` explanation.

Cancellation must restore the previous runtime and report the verified restoration result.

## 9. Services

The Services page implements the reference's two modes:

- **Собрать по сервисам**;
- **Готовый hosts**.

### 9.1 Package mode

The page contains:

- real KPI values;
- search and filters;
- global enable-all and disable-all actions;
- reference category grouping;
- per-category enabled/total counters;
- one tri-state category master switch: off, on, mixed;
- individual service switches;
- changed-row indicators;
- service domain count and selected profile;
- package details;
- managed hosts/profile-hostlist summaries.

Category and global actions update only the browser draft. Individual services can override a category choice. All counters must derive synchronously from one draft-aware selector; the KPI strip and filters may not disagree.

Search behavior must be explicit: category controls always affect the entire category, not only currently visible search results. Global bulk actions affect all packages in the active mode. The UI states this near the controls.

### 9.2 Ready-hosts mode

A selected external/ready source becomes the managed DNS mapping base only after validation and application. The UI explains which layers are replaced and which remain independent. Switching modes must not discard the uncommitted selection of the other mode without confirmation.

After successful application, the services baseline is reloaded, changed count becomes zero, and the services draft scope is removed.

## 10. Lists and Autohostlist

The page mirrors the reference with real contracts for:

- domain membership check;
- source health and age;
- atomic source update;
- update history;
- failure policy;
- schedule state;
- Autohostlist contents and file count;
- promote to permanent include;
- remove and add to exclude;
- detector parameters;
- user include/exclude lists;
- read-only service lists in advanced mode.

Duplicate or conflicting warnings are consolidated into one actionable issue with links to the affected records. Mutations enter the global draft unless the action is explicitly operational, such as refreshing source metadata.

## 11. DNS

Default mode is `Системный DNS — без изменений`. The manager must not change the current OpenWrt/dnsmasq chain unless the user explicitly selects a custom mode.

The page implements:

- system, DoH, DoT, and UDP modes;
- primary and fallback provider;
- provider checks with real latency and errors;
- per-service DNS profiles;
- advanced options;
- history;
- clear explanation of which component owns DNS resolution.

Provider recommendations require a completed real test. Internal provider and service IDs are not primary labels.

## 12. Telegram Proxy

The reference visual structure is adopted while retaining the hardened secret model:

- initial load requests metadata only;
- reveal requires explicit confirmation and a dedicated RPC;
- the revealed link remains ephemeral and outside shared tab cache/store;
- closing the modal or refreshing removes it;
- no secret appears in toast, logs, diagnostics, draft, localStorage, or sessionStorage.

Health is split into:

- process state;
- exact listener verification;
- outbound Telegram/DC connectivity;
- active connections;
- degraded and unavailable reasons.

Repeated outbound timeouts must not coexist with a generic green healthy label. Basic mode shows safe common settings; technical mappings and low-level fields remain advanced.

## 13. Monitoring

Monitoring uses human-readable rows and summaries first, with raw argv and packet detail available on demand. It includes:

- live runtime status;
- connection filtering and pause/resume;
- per-host decision;
- profile/rule attribution;
- drops and errors;
- structured packet details;
- read-only technical evidence in advanced mode.

A process or NFQUEUE being present does not by itself prove end-to-end connectivity.

## 14. Maintenance

Maintenance mirrors the reference while using real package/system data:

- package versions;
- service/runtime information;
- human-readable uptime;
- memory in suitable units;
- backup list and semantic preview;
- restore confirmation and verified result;
- diagnostics and logs;
- dangerous operations with explicit confirmation.

Raw JSON is hidden under technical details. No backup or restore action reports success before backend verification.

## 15. Error handling

All RPC errors pass through normalized codes and human messages. The UI distinguishes:

- validation failure;
- revision conflict;
- permission failure;
- timeout;
- missing resource/run;
- apply failure with successful rollback;
- apply failure with rollback failure;
- verification failure;
- stale data;
- partial backend capability.

Errors must identify the affected scope and next safe action. Internal stack traces, raw ubus payloads, and secrets are never shown in basic mode.

## 16. Testing strategy

Each vertical slice follows test-driven development.

Required test layers:

- pure state selectors and formatting helpers;
- LuCI source contract tests;
- DOM interaction tests for navigation, draft, modal, switches, loading, and advanced mode;
- backend ucode tests for validation, apply, snapshots, rollback, revision, and run state;
- strategy corpus/orchestration tests;
- packaging and release tests;
- security tests for secret redaction and no external assets;
- responsive/source checks for the reference layout contract;
- full `tools/run-all-tests.sh` gate;
- exact-head GitHub Actions.

Visual parity acceptance uses a checklist and screenshots at representative desktop, tablet, and mobile widths. Pixel identity is not required where LuCI chrome or real state changes dimensions, but structure, spacing, hierarchy, controls, and states must remain recognizably equivalent.

Router validation remains separate from source/CI validation. No stage may claim router PASS without installation and real connectivity evidence.

## 17. Acceptance criteria

The parity program is complete only when:

1. all eight sections match the reference information architecture;
2. simple/advanced behavior matches the reference intent;
3. the shared visual system and responsive layout are implemented;
4. the global bar contains `Отменить все`, `Показать различия`, and `Применить`;
5. no 60-second auto-rollback UI or browser countdown remains;
6. semantic preview replaces default raw JSON;
7. global apply uses real backend contracts and clears only verified scopes;
8. Overview uses real applied state and real last-test data;
9. Services has global and category bulk controls with consistent counters;
10. Strategy tests every applicable strategy against the versioned 61-domain corpus;
11. missing runs terminalize without stale polling;
12. Lists, DNS, Proxy, Monitoring, and Maintenance use real data and reference-equivalent flows;
13. secrets remain protected;
14. no demonstration value is presented as real;
15. focused and full repository gates have zero failures;
16. exact-head CI is green;
17. final visual/behavior gap audit has no unresolved P0 or P1 deviations.

## 18. Explicit exclusions

This design does not authorize:

- embedding the prototype as production code;
- a second state manager or apply engine;
- fake data to preserve reference appearance;
- force-push;
- direct feature work on `main`;
- unrelated backend refactors;
- router reboot or destructive router actions;
- automatic merge before exact-head verification and review checks;
- claiming real-router acceptance from CI alone.
