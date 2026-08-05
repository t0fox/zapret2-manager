# Holyversion Unified PR Design

**Date:** 2026-08-04  
**Repository:** `t0fox/zapret2-manager`  
**Reference:** user-supplied `holyversion.html`  
**Base commit:** `a1b0f897f10fddc323eb232f3246647876a30141`  
**Working branch:** `feat/holyversion-reference-parity`  
**Status:** approved design  
**Supersedes:** the multi-PR delivery strategy in `2026-08-04-holyversion-reference-parity-design.md`

## 1. Decision

The remaining Holyversion parity work is delivered through one pull request from `feat/holyversion-reference-parity` into `main`.

The pull request stays open and unmerged until the whole application is complete:

- the visible interface matches the actually rendered `holyversion.html` as closely as practical;
- every interactive element is connected to a real backend contract in the same implementation sequence in which it is introduced;
- no demonstration values, browser simulations, decorative fake states, or inert buttons remain;
- the complete application passes authenticated browser acceptance on the real router;
- final router verdict for this parity program is `PASS`.

Intermediate commits are allowed and required for reviewability, but they do not represent partial releases or completion claims. The branch is a development branch until final acceptance.

## 2. Source of truth and precedence

`holyversion.html` is the canonical source of truth for:

- rendered navigation and information architecture;
- page and subpage composition;
- visible labels and action hierarchy;
- dimensions, spacing, typography, colors, borders, cards, tables, forms, tabs, switches, chips, modals, toasts, progress, and responsive behavior;
- the position and visibility of controls;
- simple and advanced presentation;
- the user flow between Overview, Strategy, Services and domains, Lists/Autohostlist functions, DNS, Telegram Proxy, Monitoring, and Maintenance.

When an earlier document disagrees with the actual rendered reference, the rendered reference wins. For example, when `holyversion.html` moves list functionality into a unified Services and domains hub or hides a former primary tab, production should reproduce that visible structure while preserving the underlying capability.

The following intentional deviations remain authoritative:

1. no 60-second automatic rollback UI or countdown;
2. no fake or hard-coded operational values;
3. no simulated progress, health, latency, strategy result, package version, date, revision, domain count, or service state;
4. secrets remain protected by the existing explicit reveal model;
5. unsafe OpenWrt actions remain prohibited;
6. backend state, revision, preflight, snapshots, mutation, verification, and rollback remain authoritative.

## 3. Real-data rendering rule

A backend-dependent component is not allowed to render operational content until its real contract is connected.

Before connection, do not render:

- demo values;
- placeholder success;
- `null`;
- `undefined`;
- `[object Object]`;
- `[object HTMLDivElement]`;
- synthetic `—` values used to fill the reference layout;
- fake rows, charts, candidates, providers, services, logs, histories, or counters;
- static reference text that implies a measured or applied fact.

During implementation, the entire unfinished backend-dependent block may remain absent. It must not ship in the final PR as absent or unfinished.

After connection, the block may render only:

- confirmed real data;
- a real in-flight loading state;
- a real empty result returned by the backend;
- a normalized real error;
- a documented unsupported capability when the installed backend explicitly reports it.

The final merged interface must not contain visually complete but nonfunctional placeholders.

## 4. One-PR delivery model

### 4.1 Branches

Only these remote branches are permitted:

- `main`;
- `feat/holyversion-reference-parity`.

No temporary feature, fix, integration, verification, cleanup, or export branches may be created. No force-push is permitted.

### 4.2 Pull request

One draft pull request is opened from the persistent branch into `main` after the implementation plan is committed. It remains the same PR for the complete parity program.

The PR is not marked ready and cannot be merged while any page, subpage, action, backend adapter, test, browser scenario, router check, or parity deviation remains incomplete.

### 4.3 Commits

The single PR contains small, reviewable commits. Each product block is completed through this sequence:

1. inspect the exact reference markup, CSS, JavaScript, states, and responsive behavior;
2. identify current frontend and backend ownership;
3. write RED tests;
4. implement the visual structure;
5. connect real RPC/backend behavior immediately;
6. implement loading, empty, error, conflict, success, and verification states;
7. run focused tests;
8. run browser acceptance for the block on the router;
9. review the bounded diff;
10. fix Critical and Important findings before moving to the next block.

A commit must not add a visible working control whose backend action is deferred to a later commit.

## 5. Required implementation order

The order may be refined by the implementation plan when dependencies demand it, but all work remains in the same PR.

### 5.1 Validation foundation

Repair the router-validation tooling discovered broken during the `a1b0f897` acceptance attempt before relying on it:

- `tools/session-check.sh` shell syntax;
- stale `overview.js` expectations;
- no-extension rpcd ucode plugin compile validation;
- exact `hostlist` versus `hostlist-exclude` matching;
- canonical static resource URLs in `tools/deploy-verify.sh`.

These changes remain tooling-only and do not alter package releases by themselves.

### 5.2 Shared shell and navigation

Reproduce the final Holyversion shell:

- application frame;
- actual visible primary navigation;
- subtabs and unified hubs;
- header, version area, simple/advanced control;
- content width and spacing;
- page headers;
- panels, cards, buttons, segmented controls, switches, chips, tables, forms, accordions, modals, toasts, progress, skeletons, and mobile variants;
- global draft bar with `Отменить все`, `Показать различия`, and `Применить`;
- no automatic rollback countdown.

Shared components must remain reusable and must not become a second application runtime.

### 5.3 Overview

Match the reference Overview visually and behaviorally, wired to real state:

- runtime and bypass health;
- active applied strategy;
- source and application metadata;
- last completed corpus result;
- failed domains and latency only when real results exist;
- active operation separated from historical result;
- recommendations based on real evidence;
- single-resource check;
- quick actions;
- manual rollback only with backend-confirmed snapshot evidence.

No raw `null` or fabricated status may appear.

### 5.4 Strategy

Implement the complete reference Strategy experience and real orchestration:

- strategy cards and details;
- applicability and unified preflight;
- candidate selection into the global draft;
- full corpus selection using every applicable strategy against the versioned 61-domain corpus and configured attempts;
- bounded progress, cancellation, restoration, ranking, history, journal, diagnostics, settings, and terminal missing-run behavior;
- infrastructure errors distinct from strategy failures;
- no raw argv or candidate ID in basic mode;
- one sanctioned apply pipeline with verification and rollback proof.

The final UI may not imply that one target or seven partial attempts equal a completed 61-domain corpus run.

### 5.5 Services, domains, Lists, and Autohostlist

Reproduce the reference's actual unified structure, including any relocation or hiding of old top-level navigation:

- package catalog;
- real categories;
- tri-state category switches;
- global enable/disable;
- consistent draft-aware KPI and filter counts;
- search that does not restrict whole-catalog bulk actions;
- individual overrides after category actions;
- semantic changed-row states;
- package domains and profile ownership;
- ready-hosts sources;
- user domains;
- include/exclude management;
- Autohostlist selection, promotion, ignore, stale cleanup, filters, and counts;
- source health, update, scheduling, history, and build state;
- conflict resolution with exact affected entries.

All mutations use real backend contracts and the global coordinator. No separate page-only apply engine is allowed.

### 5.6 DNS

Match the reference DNS interface and connect:

- system DNS without changes as the safe default;
- DoH, DoT, and UDP modes;
- primary and fallback providers;
- real provider validation and latency;
- per-service DNS ownership;
- advanced settings;
- history;
- semantic preview and verified apply.

The UI must not show a recommendation before a real provider test exists.

### 5.7 Telegram Proxy

Match the reference layout while preserving hardened secret handling:

- process state;
- exact listener verification;
- outbound Telegram/DC connectivity;
- active connections;
- degraded and unavailable reasons;
- basic and advanced settings;
- activity and logs;
- lifecycle operations;
- explicit reveal for secret/link data only.

A running process alone may not produce a generic healthy state when connectivity is failing.

### 5.8 Monitoring

Match the reference Monitoring experience:

- live runtime state;
- filtering and pause/resume;
- per-host decisions;
- profile/rule attribution;
- drops and errors;
- structured packet and connection evidence;
- technical argv/details only in advanced disclosure.

The basic interface must remain human-readable and responsive.

### 5.9 Maintenance

Match the reference Maintenance interface:

- package versions;
- system and runtime state;
- formatted uptime and memory;
- backup list;
- semantic backup preview;
- restore confirmation and verified outcome;
- diagnostics and logs;
- dangerous operations with explicit confirmation.

No raw JSON may be the primary representation.

### 5.10 Final parity audit

After every area is implemented, perform a new whole-application audit against the rendered reference at:

- 1920×1080;
- 1366×768;
- 1024×768;
- 390×844.

For every visible reference element record:

- reference location and state;
- production location and state;
- visual parity verdict;
- behavioral parity verdict;
- backend source;
- test evidence;
- router evidence;
- intentional deviation and reason, if any.

No unresolved P0 or P1 deviation is allowed. Any remaining P2 deviation must be explicitly approved before merge.

## 6. Architecture constraints

The implementation preserves the modular LuCI architecture:

- one root `L.view.extend()` in `app.js`;
- helper pages use `baseclass.extend(...)`;
- `z2m-store.js` owns browser state;
- `z2m-api.js` owns RPC boundaries;
- page modules own page-specific rendering and adapters;
- backend ucode/shell owns validation, mutation, snapshots, service lifecycle, verification, history, and rollback;
- current activation token and single-view lifecycle remain intact;
- timer-owning modules unmount before replacement;
- stale-while-revalidate is retained where safe;
- existing RPC transport semantics remain unless a proven missing contract requires an explicit change;
- ACL changes accompany new RPC only;
- external UI assets remain prohibited;
- proxy secret protections remain mandatory.

The reference HTML must not be copied wholesale as a second runtime or state manager.

Large files must be split into focused modules when responsibilities become unclear. This is allowed only when directly required by parity work; unrelated refactors remain out of scope.

## 7. Backend contract policy

For each reference action, implementation must prove one of:

- existing backend contract is sufficient;
- a small adapter is sufficient;
- existing RPC requires a bounded extension;
- a new RPC is necessary because no sanctioned operation exists.

A new RPC may be introduced only after a RED backend test demonstrates the missing contract. Every mutation requires:

- structural validation;
- applicability validation;
- expected revision or equivalent concurrency guard;
- backend preflight;
- snapshot where supported;
- sanctioned writer/lifecycle;
- reread;
- verification;
- explicit partial failure handling;
- rollback evidence when rollback is advertised.

RPC resolution or process liveness alone is not proof of success.

## 8. Testing and review

### 8.1 Test-driven development

Every behavior begins with a failing test. Coverage includes:

- pure selectors, formatters, state machines, and semantic diff;
- DOM interactions and accessibility states;
- page lifecycle and navigation;
- real RPC adapters;
- backend validation, revision, apply, snapshots, verification, rollback, and history;
- strategy corpus and run state;
- service category and bulk behavior;
- lists, DNS, proxy, monitoring, and maintenance contracts;
- packaging and releases;
- security and secret redaction;
- responsive layout contracts;
- no external assets;
- no raw `null`, `undefined`, object stringification, or fake operational values.

### 8.2 Review cadence

Each bounded product block receives:

- implementer review;
- spec-compliance review;
- code-quality and safety review;
- fix loop for Critical and Important findings.

At the end, the whole PR receives a separate full review. The review must reject scope drift, duplicate runtimes, fake data, inert controls, unverified success, or unsupported completion claims.

### 8.3 CI

Before router acceptance:

- all changed JavaScript passes syntax check;
- all shell scripts pass `sh -n`;
- menu and ACL JSON are valid;
- CSS is balanced;
- focused suites are green;
- `tools/run-all-tests.sh` reports zero failures;
- exact-head GitHub Actions is green;
- no tests are removed or silently skipped to obtain green status;
- no temporary workflow or patch files remain.

## 9. Router acceptance

Router testing is continuous by completed product block and comprehensive at the end.

The final acceptance is performed from the exact PR head using signed APK on the real router. It must cover:

- package installation and versions;
- authenticated LuCI routes and canonical assets;
- console errors and rejected promises;
- every visible page, subtab, modal, and responsive state;
- every read-only action;
- global draft, semantic diff, cancel, apply, partial failure, revision conflict, reread, verification, and manual rollback where available;
- full Services/domains/Lists/Autohostlist workflows;
- DNS provider checks and safe apply;
- Strategy full-corpus progress, cancel, restore, result, and winner application in an approved safe window;
- Telegram Proxy process/listener/connectivity distinction without exposing secrets;
- Monitoring evidence;
- Maintenance backup preview and safe restore test where approved;
- unchanged runtime/config evidence for read-only actions;
- explained runtime/config changes for sanctioned mutations;
- nfqws2 identity, NFQUEUE owner, nftables, dnsmasq, rpcd, and uhttpd health.

No reboot, firewall stop/restart, nft flush, manual nfqws2 kill, `--allow-untrusted`, or destructive action is permitted unless separately and explicitly approved.

The parity PR cannot merge with router verdict `PARTIAL`. Final required verdict is `PASS`.

## 10. Pull request readiness and merge gate

The single PR can be marked ready only when:

1. every rendered Holyversion area is represented;
2. every visible control works through a real backend contract;
3. no unfinished backend-dependent block is visible or absent from the final product;
4. no demonstration data or raw null-like output remains;
5. no automatic rollback timer remains;
6. all package releases are correctly bumped according to changed components;
7. full CI is green at the exact head;
8. full router acceptance is `PASS` at the same exact head;
9. final parity matrix has no unresolved P0/P1 issues;
10. whole-PR review is clean;
11. no unresolved review thread or `REQUEST_CHANGES` exists;
12. only `main` and `feat/holyversion-reference-parity` exist remotely.

Merge method is a merge commit with expected head SHA. After merge, fast-forward the persistent branch to the new `main` and verify `0 ahead / 0 behind`.

## 11. Completion definition

The work is complete only when the entire application, not an individual screen or subsystem, satisfies all of the following:

- practical visual 1:1 parity with the rendered `holyversion.html`;
- practical interaction parity with the intentional deviations documented above;
- all real backend integrations complete;
- all controls functional;
- no fake data, inert UI, or unfinished blocks;
- all source, test, package, browser, and router gates green;
- exact-head router verdict `PASS`;
- the unified PR merged;
- `main` and the persistent branch synchronized.

No intermediate commit, test count, CI result, installed package, or partially matched page may be described as completion of this program.
