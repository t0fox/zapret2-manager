---
id: spec-documentation-depth-v2
title: "Documentation Depth v2 Design"
type: spec
status: approved
authority: approved-spec
updated: 2026-08-14
publish: false
tags: [docs, quartz, parity, roadmap, architecture, evidence]
---
# Documentation Depth v2 Design

## Purpose

Turn the already-working Russian Quartz site from a useful overview into a living engineering/product documentation surface. The site must explain not only what zapret2-manager is, but how the current implementation is structured, which lifecycle owns each mutation, how far Avatar behavioral parity has progressed, what blocks the next milestones, and what evidence is required before a capability can be called complete.

This design is explicitly content/evidence work. It does not change runtime/application behavior.

## Inputs and evidence hierarchy

The implementation uses two evidence layers:

1. **Current `main` is the source of truth for current behavior.** Source files, tests, current contracts and fresh CI outrank older audits.
2. The read-only `audit-package` captured on 2026-08-14 at manager checkout `59d28af7` is a structural/evidence map produced from Graphify, UnderstandAnything and direct source/test/spec analysis. It is useful for architecture, dependency and gap discovery, but it is not silently treated as current implementation state.

The audit package includes architecture, product dependencies, Avatar parity, roadmap evidence, documentation gaps and graph projections. Raw Graphify/UnderstandAnything JSON is not published and is not committed merely to power the public site.

Evidence vocabulary for public docs:

- **CURRENT / реализовано:** current source + reachable consumer + suitable tests/evidence.
- **PROTOTYPE / активная разработка:** meaningful source exists, but the required vertical slice or target evidence is incomplete.
- **APPROVED DESIGN:** approved spec/ADR defines intended behavior; this is not implementation evidence.
- **PLANNED:** roadmap dependency is known but implementation is not present.
- **INFERENCE:** reasoned conclusion, explicitly labelled.

A plan/spec/ADR alone never upgrades a feature to CURRENT.

## Public information architecture

Keep the existing stable public routes and add depth beneath them rather than renumbering the whole documentation tree.

### Project

- `01-project/status-roadmap.md` becomes the evidence-backed roadmap with milestones, dependencies, completion criteria and current-main deltas.
- `01-project/avatar-parity.md` becomes the public Avatar parity surface. It must preserve the pinned baseline counts and explain that post-baseline changes are reported as deltas until a deliberate full re-audit recomputes the matrix.

### Architecture

- `02-architecture/index.md` remains the architectural entry point.
- `02-architecture/runtime-flow.md` documents LuCI → rpcd/ubus → bounded backend/CLI → sanctioned writer/runtime → verification/status.
- `02-architecture/state-ownership.md` documents canonical state, generations, process identity, jobs, transactions, snapshots, rollback and the single-writer rule.

Graphify projections are translated into stable Markdown/ASCII diagrams unless the currently pinned Quartz build is proven to render Mermaid reliably. No diagram plugin is added only for this work.

### Products

- `03-products/strategy/lifecycle.md` deepens catalog/profile → compile/preflight → Preview → Validate → Apply → verification/rollback.
- `03-products/scanner/lifecycle.md` documents the Scanner lifecycle and the production-readiness gate.
- `03-products/scanner/family.md` separates Scanner, BlockCheck and BlockCheck2 so the three Avatar flows are not conflated.
- `03-products/dns-routing-assets.md` explains current DNS/lists/assets surfaces and the dependency chain toward unified routing and tunnels.

### Development/evidence

- `08-development/evidence-testing.md` defines what unit/source tests, package tests, ucode tests, router E2E and live/LAN evidence prove and do not prove.
- `08-development/decisions-and-specs.md` is a safe public index of major contracts/specs/decisions. It summarizes intent/status without exposing internal work logs, agent instructions or raw private plans.
- `08-development/docs-freshness.md` documents the documentation impact contract.

## Avatar parity publication contract

The canonical internal parity contract pins Avatar `f9dd3ea47a2239514f396a843b475c92c33f0b4c` and a historical manager baseline. The audited snapshot reports:

- PARITY: 11
- PARTIAL: 31
- MISSING: 28
- DIVERGENT: 2
- INTENTIONAL_DEVIATION: 4
- plus 3 user-decision rows and 2 legacy-dead rows outside the main five-status matrix.

These counts are a pinned audit snapshot, not a live percentage. The public page must show the baseline and a separate **current-main delta** section when newer work exists. It must not silently recalculate global counts from a few recent commits.

The public page groups capabilities by Dashboard, Strategy, Scanner, BlockCheck/BlockCheck2, DNS/lists/assets, routing, tunneling, auto-remediation and lifecycle/maintenance. Each group states status, current evidence and the transition criterion for parity.

## Roadmap contract

Roadmap milestones are dependency/evidence gates, not dates or promises. Use the audit sequence as a starting dependency model but refresh stale current-state observations against current `main`.

The roadmap must show for each milestone:

- what is already evidenced;
- what is in work;
- blockers/dependencies;
- the next safe slice;
- completion criterion;
- evidence that proves completion.

Current post-audit Scanner work (including the A1 transient runtime lifecycle and its acceptance tail) must be reflected as a current-main delta. This does not by itself make full Scanner production-ready; the production gate still requires the complete model/planner/probes/result/ranking/cleanup/Strategy-handoff/LuCI vertical slice plus target evidence.

## Documentation freshness contract

Add a repository check that maps product source areas to relevant documentation areas. If a commit changes a mapped product source area and changes none of its mapped docs, the check fails with a precise message.

The first version is intentionally bounded:

- Strategy/Profile source → Strategy docs or project parity/roadmap.
- Scanner source/runtime/LuCI → Scanner docs or project parity/roadmap.
- BlockCheck source → BlockCheck/Scanner-family docs or parity/roadmap.
- DNS/service-DNS/domain/list source → DNS-routing-assets docs or parity/roadmap.
- Proxy/tunnel source → DNS-routing-assets/roadmap/parity docs.
- Core state/jobs/transaction/native ownership source → architecture/evidence docs.

Only product/runtime source paths trigger the rule; tests, docs and generated artifacts do not trigger it by themselves. The check is a change-impact gate, not proof that every sentence is current.

The public development page explains that a pure internal refactor with no user-visible/contract change still requires an explicit documentation impact decision in the same change set rather than allowing documentation drift by default.

## Safety/publication boundary

Do not publish:

- secrets, tokens, credentials, private keys or secret-bearing configuration;
- real router addresses, usernames, session IDs or unredacted traces;
- internal AI/agent contracts, handoffs, work logs or scratchpads;
- raw Graphify/UnderstandAnything corpora;
- claims of router/browser/live proof that are supported only by source tests.

Safe public material includes abstract ownership diagrams, capability/parity status, bounded test evidence summaries, stable RPC/domain concepts, intentional deviations and redacted examples.

## Acceptance criteria

Documentation Depth v2 is complete when:

1. Roadmap is dependency/evidence based and materially deeper than the previous short status page.
2. Public Avatar parity is non-empty, grouped by product area, shows pinned counts/baselines and current-main delta without fabricating a refreshed global score.
3. Architecture has separate runtime-flow and state-ownership pages.
4. Strategy and Scanner have lifecycle pages; Scanner has an explicit production-readiness gate.
5. Scanner, BlockCheck and BlockCheck2 are documented as separate product flows.
6. Evidence/testing and public decisions/spec index pages exist.
7. Documentation freshness check has a demonstrated RED→GREEN test.
8. Home/project/development/product pages link to the deeper material within two clicks where practical.
9. Public/internal leak checks, GitHub Pages path/link checks, internal/public Quartz builds and live serve smoke remain green.
10. No runtime/application implementation changes are required by this documentation task.
