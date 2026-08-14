---
id: plan-documentation-depth-v2
title: "Documentation Depth v2 Implementation Plan"
type: plan
status: active
authority: approved-spec
updated: 2026-08-14
publish: false
tags: [docs, quartz, parity, roadmap, evidence]
---
# Documentation Depth v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Russian Quartz overview into deep, living project documentation with evidence-backed architecture, lifecycle, Avatar parity, roadmap and documentation-freshness gates.

**Architecture:** Keep the existing public routes stable and add focused depth pages under `01-project`, `02-architecture`, `03-products` and `08-development`. Current `main` is authoritative for current behavior; the 2026-08-14 Graphify/UnderstandAnything audit is used as a structural map and pinned audit snapshot, with explicit current-main deltas where later code exists.

**Tech Stack:** Markdown/frontmatter, Quartz v5 pinned by `tools/docs-site/quartz.lock.json`, Node 22 knowledge tests, GitHub Actions, existing `scripts/docs.mjs` public/internal build pipeline.

## Global Constraints

- Work directly on `main`; do not create a branch or PR for this task.
- Do not change runtime/application behavior.
- Public prose is Russian; exact identifiers, API names and product names may remain English where they are canonical identifiers.
- Do not publish raw internal work logs, AI instructions, secrets, router identifiers or raw audit graphs.
- Audit baseline `59d28af7` is not silently treated as current implementation state.
- Pinned Avatar parity counts remain an audit snapshot until a deliberate full parity re-audit recomputes them.
- A plan/spec/ADR is design evidence, never implementation evidence.
- Scanner is not production-ready unless the complete production gate is evidenced.
- Preserve current GitHub Pages `/zapret2-manager/` routing/link behavior and publication-boundary tests.

---

### Task 1: Add RED acceptance tests for documentation depth

**Files:**
- Modify: `tests/knowledge/public-content.test.mjs`
- Create: `tests/knowledge/docs-freshness.test.mjs`

**Interfaces:**
- Consumes: `.artifacts/docs-public`, current Git history.
- Produces: public-depth assertions and a reusable freshness checker contract.

- [ ] **Step 1: Extend required public pages**

Add required generated pages for:

```text
01-project/avatar-parity.html
02-architecture/runtime-flow.html
02-architecture/state-ownership.html
03-products/strategy/lifecycle.html
03-products/scanner/lifecycle.html
03-products/scanner/family.html
03-products/dns-routing-assets.html
08-development/evidence-testing.html
08-development/decisions-and-specs.html
08-development/docs-freshness.html
```

Require Russian rendered content and load-bearing terms such as `PARITY`, `PARTIAL`, `A1`, `single-writer`, `rollback`, `BlockCheck2`, `доказательств` and `freshness`/`актуальност` as appropriate.

- [ ] **Step 2: Add parity/roadmap semantic assertions**

Require the generated public parity page to contain the pinned baseline counts `11`, `31`, `28`, `2`, `4`, both baseline labels and a current-main delta section. Require the roadmap to contain milestone identifiers, dependency language, completion criteria and evidence language.

- [ ] **Step 3: Add a failing freshness test fixture**

Implement `docs-freshness.test.mjs` so a synthetic Scanner source change with no mapped docs fails, while the same source change plus `docs/03-products/scanner/lifecycle.md` passes.

- [ ] **Step 4: Run RED**

Run after a public build if available:

```sh
node --test tests/knowledge/public-content.test.mjs
node --test tests/knowledge/docs-freshness.test.mjs
```

Expected: depth-page tests fail because pages do not yet exist; freshness fixture fails until the checker is implemented.

- [ ] **Step 5: Commit test-only RED**

```sh
git add tests/knowledge/public-content.test.mjs tests/knowledge/docs-freshness.test.mjs
git commit -m "test(docs): require deep public documentation"
```

### Task 2: Publish architecture and lifecycle depth

**Files:**
- Modify: `docs/02-architecture/index.md`
- Create: `docs/02-architecture/runtime-flow.md`
- Create: `docs/02-architecture/state-ownership.md`
- Create: `docs/03-products/strategy/lifecycle.md`
- Create: `docs/03-products/scanner/lifecycle.md`
- Create: `docs/03-products/scanner/family.md`
- Modify: `docs/03-products/strategy/index.md`
- Modify: `docs/03-products/scanner/index.md`

**Interfaces:**
- Consumes: current `main` source/tests/contracts plus audit architecture/product maps.
- Produces: deep public architecture and product lifecycle documentation.

- [ ] **Step 1: Write runtime-flow page**

Document:

```text
LuCI → z2m-api.js → rpcd/ubus → bounded CLI/module owner
     → snapshot/preflight/CAS → sanctioned writer/runtime
     → runtime observations → verification → status/LuCI
```

Explain failure boundaries, Preview versus mutation, and that UI state is not canonical runtime state.

- [ ] **Step 2: Write state-ownership page**

Cover state envelope/generation, process identity tuple, namespaces, jobs, transactions, single-writer ownership, snapshots, rollback, reconciliation and evidence uncertainty. Derive public wording from current native contract/source; do not expose internal work instructions.

- [ ] **Step 3: Write Strategy lifecycle page**

Describe catalog/Profile aggregate, compile/preflight, Preview, Validate, Apply authority boundary, verification and rollback. Separate current implementation from future parity dependencies such as asset registries.

- [ ] **Step 4: Write Scanner lifecycle page**

Document current-main delta including A1 transient runtime work, then the full gate:

```text
model → planner/generator → transient execution → probes → typed result
→ ranking/report → cleanup → Strategy handoff → LuCI
```

Explicitly state which pieces are source/test-backed and why full production-ready status still requires complete vertical + target evidence.

- [ ] **Step 5: Write Scanner family page**

Separate Avatar Scanner, BlockCheck and BlockCheck2 by purpose, state/result model and handoff semantics. Explain why Orchestra/BlockCheck2 wrappers are not automatically Scanner parity.

- [ ] **Step 6: Link entry pages to depth pages**

Add concise “глубже” links from Architecture, Strategy and Scanner indexes.

- [ ] **Step 7: Run public content tests and commit**

```sh
node scripts/docs.mjs build public --production
node --test tests/knowledge/public-content.test.mjs
```

Expected: new architecture/lifecycle assertions pass; parity/roadmap/evidence assertions may still be RED until later tasks.

### Task 3: Publish Avatar parity and evidence-backed roadmap

**Files:**
- Create: `docs/01-project/avatar-parity.md`
- Rewrite: `docs/01-project/status-roadmap.md`
- Modify: `docs/01-project/index.md`
- Modify: `docs/index.md`

**Interfaces:**
- Consumes: internal `docs/05-parity/avatar-parity.md`, audit parity/roadmap maps, current-main Scanner commits/source/tests.
- Produces: public parity and roadmap sources linked from project/home.

- [ ] **Step 1: Publish parity snapshot contract**

State the pinned Avatar baseline and audited manager baseline; publish the counts:

```text
PARITY 11
PARTIAL 31
MISSING 28
DIVERGENT 2
INTENTIONAL_DEVIATION 4
```

Explain that three user-decision rows and two legacy-dead rows are tracked separately.

- [ ] **Step 2: Add product-area capability matrix**

Group Dashboard, Strategy, Scanner, BlockCheck/BlockCheck2, DNS/lists/assets, routing, tunnels, auto-remediation and lifecycle/maintenance. For each, include status, current evidence summary and transition-to-parity criterion.

- [ ] **Step 3: Add current-main delta**

Record post-audit Scanner work such as canonical A1 ownership helper/runtime integration, transient A1 execution and acceptance-tail tests as a delta. Do not silently alter the global parity counts.

- [ ] **Step 4: Rewrite roadmap**

Use milestone IDs and refresh stale audit observations against current `main`. Each milestone includes `Сейчас`, `В работе`, `Зависимости`, `Следующий срез`, `Критерий завершения`, `Доказательства`.

Preserve the dependency direction from native foundation/assets/Scanner/BlockCheck/routing/tunnels/monitoring/remediation, but do not keep stale claims such as missing `core/result.uc` when the file exists on current `main`.

- [ ] **Step 5: Add dependency diagram in plain Markdown/ASCII**

Avoid adding a diagram plugin. The graph must clearly show major dependency edges and the fact that documentation is continuous rather than only an end milestone.

- [ ] **Step 6: Link Home/Project to parity and roadmap**

Make both reachable within two clicks.

- [ ] **Step 7: Build/test and commit**

```sh
node scripts/docs.mjs build public --production
node --test tests/knowledge/public-content.test.mjs
```

### Task 4: Document DNS/routing/assets, evidence policy and public decision index

**Files:**
- Create: `docs/03-products/dns-routing-assets.md`
- Create: `docs/08-development/evidence-testing.md`
- Create: `docs/08-development/decisions-and-specs.md`
- Modify: `docs/08-development/index.md`

**Interfaces:**
- Consumes: current DNS/list/domain source/tests, native/backend contract, audit gaps/dependency map, approved specs/ADRs.
- Produces: public cross-product dependency, evidence taxonomy and safe design index.

- [ ] **Step 1: Write DNS/routing/assets page**

Separate current DNS/provider/list/domain capabilities from missing registries and planned unified routing. Explain dependency order without claiming future routing/tunnel functionality exists.

- [ ] **Step 2: Write evidence/testing page**

Define evidence levels:

```text
source/unit
contract/integration
package/toolchain
router read-only
router mutation/E2E
LAN/live traffic
```

For each, state what it proves and what it cannot prove. Include the rule that passing source tests does not prove OpenWrt target or router E2E.

- [ ] **Step 3: Write decisions/spec index**

Summarize major public-relevant contracts/specs: native backend v1, Strategy aggregate/catalog, Scanner parity design, ownership/safety deviations. Label each as normative/current/approved design and never link public navigation into internal work logs.

- [ ] **Step 4: Link Development index**

Make evidence policy, docs freshness and decision/spec index easy to find.

- [ ] **Step 5: Build/test and commit**

### Task 5: Implement documentation freshness gate

**Files:**
- Create: `scripts/check-docs-freshness.mjs`
- Complete: `tests/knowledge/docs-freshness.test.mjs`
- Create: `docs/08-development/docs-freshness.md`
- Modify: `tests/knowledge/public-leak.test.mjs` or `scripts/validate-knowledge.mjs` to execute the checker in CI without adding a second documentation pipeline.

**Interfaces:**
- `evaluateDocsFreshness(changedPaths: string[]) -> { ok: boolean, violations: Array<{ area, changedSource, acceptedDocs }> }`
- CLI mode discovers changed paths from `DOCS_FRESHNESS_BASE..HEAD` when provided, otherwise `HEAD^..HEAD`; if Git history is unavailable it reports a controlled skip for local archive builds, not a fabricated pass.

- [ ] **Step 1: Implement bounded area mapping**

Map source patterns to accepted docs as defined by the design. Exclude tests/docs/generated artifacts from source triggers.

- [ ] **Step 2: Run fixture RED→GREEN**

```sh
node --test tests/knowledge/docs-freshness.test.mjs
```

Expected: Scanner/no-doc fixture fails; Scanner+mapped-doc passes; unrelated docs-only change passes.

- [ ] **Step 3: Wire checker into existing Knowledge CI path**

Prefer importing/running it from the existing knowledge validation/test chain so no new workflow architecture is required.

- [ ] **Step 4: Document contributor behavior**

Explain examples for Strategy, Scanner, BlockCheck, DNS/routing and core ownership changes. Explain that the gate proves documentation impact was addressed, not that every statement is automatically correct.

- [ ] **Step 5: Commit**

### Task 6: Navigation, full verification and production evidence

**Files:**
- Modify as needed: public Home, Project, Architecture, Product and Development indexes.
- Modify: `tests/knowledge/public-content.test.mjs` only for final stable assertions discovered during generated-site inspection.

**Interfaces:**
- Consumes all previous documentation and checks.
- Produces the final public Documentation Depth v2 site.

- [ ] **Step 1: Run canonical validation/build gates**

```sh
node scripts/docs.mjs verify
node scripts/validate-knowledge.mjs
node scripts/docs.mjs build internal --production
node scripts/docs.mjs build public --production
node tests/knowledge/public-leak.test.mjs
node --test tests/knowledge/docs-freshness.test.mjs
```

- [ ] **Step 2: Inspect generated public artifact**

Verify all new pages exist, are Russian, have meaningful rendered content, stay under `/zapret2-manager/`, contain no internal paths/markers and do not expose raw audit-package content.

- [ ] **Step 3: Run local serve smoke**

Check Home, Avatar parity, roadmap, runtime flow, state ownership, Strategy lifecycle, Scanner lifecycle, evidence/testing and docs freshness routes.

- [ ] **Step 4: Wait for fresh `main` Knowledge CI**

Require the final `main` SHA to pass the complete knowledge job.

- [ ] **Step 5: Wait for GitHub Pages deployment on the same SHA**

Download the deployed `github-pages` artifact and re-run the public link/publication checks against that exact artifact before claiming completion.
