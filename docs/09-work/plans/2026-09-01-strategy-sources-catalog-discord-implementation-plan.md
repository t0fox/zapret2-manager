---
id: plan-strategy-sources-catalog-discord
title: "Multi-Source Strategy Catalog + Discord Implementation Plan"
type: plan
status: planned
authority: approved-spec
updated: 2026-09-01
publish: false
tags: [plan, strategy, catalog, discord, z2k]
---
# Multi-Source Strategy Catalog + Discord — Full Agent Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task-by-task. Use `systematic-debugging` for any unexpected failure and `verification-before-completion` before any PASS/DONE claim.

**Goal:** Add independent Avatar and Z2K Strategy sources behind one canonical catalog; make the existing **Обновить стратегии** button actually refresh all enabled sources and rebuild the index; preserve immutable applied runtime; and make Discord discovery/enablement use the canonical Strategy lifecycle.

**Reviewed repository anchor:** `6f1a3f9f72e105c888d93f8699b43b95ea383acf`. Do not reset newer accepted work to this SHA. Task 0 records the actual execution base.

**Approved design:** this plan contains the user-approved contract. Before production edits, persist the design section to `docs/superpowers/specs/2026-09-01-strategy-sources-catalog-discord-design.md` and this plan to `docs/superpowers/plans/2026-09-01-strategy-sources-catalog-discord-implementation-plan.md`.

---

# 1. Approved Design Contract

## 1.1 Canonical Strategy sources

Exactly two upstream Strategy sources:

```text
avatar → avatarDD/zapret-gui
z2k    → necronicle/z2k
```

Canonical IDs:

```text
avatar:<upstream-id>
z2k:<upstream-id>
user:<local-id>
```

If Avatar and Z2K contain the same upstream ID or display name, BOTH remain visible. There is no cross-source winner.

## 1.2 One unified catalog

```text
Avatar verified snapshot ─┐
                          ├→ canonical catalog generation
Z2K verified snapshot ────┤          ↓
User strategies ──────────┘   unified read index
                                   ↓
                         list/get/Preview/Validate/Apply
```

Normal catalog reads must perform **no network work**.

The canonical reader never scans arbitrary “newest” source directories to infer authority. It reads one atomically published generation/index identity.

## 1.3 Existing “Обновить стратегии” stays

The existing top-level button becomes:

```text
refresh ALL enabled sources
→ verify each source
→ use refreshed snapshot or that source's verified LKG
→ normalize
→ build complete unified index
→ verify index
→ publish new generation atomically
→ refresh UI
```

Current behavior only verifies/reindexes the existing Avatar snapshot; that is insufficient.

Per-source update also exists in Resource Center:

```text
Avatar [Обновить]
Z2K    [Обновить]
      [Обновить все]
```

After a single-source update, rebuild a complete generation using the new source snapshot plus current LKG of the other enabled source.

## 1.4 Refresh never mutates runtime

Source refresh, source disable, or upstream removal must NOT automatically change the active Strategy or restart nfqws2.

If active runtime came from `z2k:foo@snapshot-S1` and upstream now has S2:

```text
catalog → S2
runtime → still S1
```

Only normal:

```text
Preview → Validate → Apply
```

may move runtime to S2.

## 1.5 Disable semantics

If Z2K source is disabled:

- `z2k:*` is unavailable for new catalog browsing/Preview/Apply;
- the verified Z2K LKG snapshot is retained;
- an already-applied Z2K Strategy continues working from its immutable applied snapshot;
- UI can say “Источник Z2K отключён; используется ранее применённый snapshot”.

Re-enable may expose LKG again, then refresh. No auto-apply.

## 1.6 Strategy Sources ≠ Z2K Resources

`Z2K Resources` remains Asset Registry/runtime assets:

- Lua;
- blobs;
- lists;
- runtime files.

`Z2K Strategy Source` owns Strategy definitions and provenance.

Do not merge these lifecycles merely because both come from `necronicle/z2k`.

## 1.7 Source filters

Main Strategy UI stays one page with composable filters:

```text
Все | Avatar | Z2K | Пользовательские
```

Existing filters such as:

```text
Авто (circular) | Избранные | Рекомендуемые
```

compose with source filter, e.g. `Z2K + Авто`.

Each card shows source badge without replacing the normal human name.

## 1.8 Atomic publication / LKG

Source snapshots are immutable after verification.

Conceptual durable layout:

```text
/etc/zapret2-manager/catalog/
  sources/avatar/snapshots/
  sources/z2k/snapshots/
  generations/
  active.json

/etc/zapret2-manager/strategy-sources.json
/etc/zapret2-manager/strategy-catalog-index.json
```

A generation binds exact source snapshot IDs + user revision + exact index digest.

Partial refresh rules:

```text
Avatar PASS + Z2K PASS → new A + new Z
Avatar PASS + Z2K FAIL → new A + previous Z LKG
Avatar FAIL + Z2K PASS → previous A LKG + new Z
both FAIL               → previous generation stays active
index/generation FAIL   → previous generation stays active
```

Publication pointer is last. Unpublished directories do not become active after reboot.

## 1.9 Discord

Current hardcoded donor behavior is retired.

Do NOT use:

```text
strategy_catalog_get_detail('z2k_all_in_one')
source: avatar-catalog
```

as production authority.

Discord compatibility is semantic/capability-based. Canonical `discord_udp` remains the new runtime key.

A compatible profile is derived from real semantics, including the current contract around:

- Discord/STUN UDP filtering;
- circular Lua desync;
- `key=discord_udp`;
- `hostkey=z2k_nohost_key`.

If current applied/running Strategy already contains valid Discord, UI must show **Активно** and must not offer “Включить Discord”.

If Discord is absent, the button opens a compatible donor picker:

```text
Все | Avatar | Z2K
```

After donor selection:

```text
merge donor into current Strategy draft
→ normal Preview
→ normal Validate
→ native preflight
→ normal Strategy Apply transaction
→ runtime/process postflight
```

Discord must not own a second production writer.

## 1.10 Hard invariants

1. One production Strategy Apply writer.
2. One published canonical catalog generation.
3. Avatar and Z2K remain separate source identities.
4. No cross-source winner.
5. No network in normal list/get.
6. Refresh never auto-applies runtime.
7. Disable never destroys already-applied runtime.
8. Failed source refresh retains LKG.
9. Failed generation/index publication exposes no partial state.
10. Z2K Strategy source is not Asset Registry/Z2K Resources.
11. Discord is a catalog/Strategy-lifecycle consumer, not a parallel updater.
12. No `discord_voice` resurrection as competing canonical key.

---

# 2. Required File Boundaries

## New production modules

```text
zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-avatar.uc
zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc
zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc
zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc
```

Responsibilities:

- `strategy-source-avatar.uc` — Avatar-specific manifest/layout/internal winner/normalization.
- `strategy-source-z2k.uc` — Z2K Strategy corpus parser/verification/normalization.
- `strategy-sources.uc` — enabled state, source status, refresh, immutable snapshot/LKG ownership.
- `strategy-catalog-generation.uc` — complete unified generation/index construction + atomic publication.

## Existing production modules expected to change

```text
strategy-catalog.uc
strategy-catalog-refresh.uc
strategy-catalog-refresh-cli.uc
strategy-catalog-update.uc
strategy-model.uc
strategy-cli.uc
strategies-ops.uc / strategies-ops-cli.uc
discord-profile.uc
rpcd zapret2-manager.uc
rpcd ACL
z2m-strategies.js
z2m-strategies-model.js
z2m-assets.js
z2m-resources-model.js
resources/manifest.json
```

Do not add more production boundaries without concrete evidence.

---

# 3. Task 0 — Baseline, spec persistence, no-regression anchor

- [ ] Invoke `using-git-worktrees` if not already in an isolated implementation worktree.
- [ ] Record:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD 6f1a3f9f72e105c888d93f8699b43b95ea383acf
git log --oneline --decorate -15
git diff --check
```

- [ ] Preserve all newer accepted work; never reset to the reviewed anchor.
- [ ] Create `.superpowers/sdd/2026-09-01-strategy-sources/baseline.md`.
- [ ] Record current facts with exact source references:
  - `strategy-catalog-refresh.uc` currently verifies/reindexes existing catalog;
  - `strategy-catalog.uc` is Avatar-specific;
  - `strategy-catalog-update.uc` already has complete-snapshot verification/LKG behavior;
  - `discord-profile.uc` hardcodes `z2k_all_in_one` and false Avatar provenance;
  - resource manifest already distinguishes strategy-catalog vs asset-bundle.
- [ ] Persist the approved spec and this plan in the repo as docs-only commit before production code.
- [ ] Run current focused catalog/Avatar/Strategy/Resource tests and record exact baseline counts.

Commit:

```bash
git commit -m "docs: specify multi-source strategy catalog"
```

---

# 4. Task 1 — Extract Avatar adapter with zero behavior change

Create:

```text
strategy-source-avatar.uc
tests/product/strategy-source-avatar.test.mjs
```

RED tests must prove:

- `sourceId === "avatar"`;
- canonical IDs are `avatar:<id>`;
- Avatar duplicate/winner semantics stay byte-for-byte/equivalent to current catalog result;
- package/managed/previous verification still works;
- `avatarDD/zapret-gui` provenance stays exact;
- adapter rejects Z2K provenance;
- current Avatar catalog read invariants remain green.

Move Avatar-only concerns out of `strategy-catalog.uc`:

- package/managed roots;
- manifest parsing;
- Avatar levels/protocol/sets;
- Avatar winner semantics;
- Avatar snapshot verification/activation.

At the end of this task external catalog behavior may still be Avatar-only; the goal is clean ownership extraction.

Run:

```bash
node --test --test-concurrency=1 \
  tests/product/strategy-source-avatar.test.mjs \
  tests/product/strategy-catalog-read-invariant.test.mjs \
  tests/product/avatar-strategy-integration.test.mjs \
  tests/product/resource-center-transaction.test.mjs
```

Commit:

```bash
git commit -m "refactor: isolate Avatar strategy source"
```

---

# 5. Task 2 — Z2K source adapter from real corpus

Create:

```text
strategy-source-z2k.uc
tests/product/strategy-source-z2k.test.mjs
tests/fixtures/strategy-source-z2k/
```

Use the real Z2K source model from `necronicle/z2k`, including `strats_new2.txt`. Do not invent a second nfqws2 parser; reuse existing Strategy tokenizer/model.

Fixtures must include:

- normal TCP Strategy;
- real `manual_autocircular_rkn`;
- multi-profile/all-in-one semantics with TLS/HTTP + QUIC + Discord;
- malformed input;
- a collision fixture used to prove namespacing.

RED assertions:

```text
sourceId = z2k
canonicalId = z2k:<upstream-id>
upstreamId retained separately
manual_autocircular_rkn → autocircular=true
discord_udp profile → discordUdp=true
malformed input → not usable
no avatar provenance invented
```

A Z2K source snapshot identity binds:

- `sourceId=z2k`;
- repository `necronicle/z2k`;
- exact source commit;
- SHA256 of exact staged Strategy corpus;
- normalized entry order/digests/count.

Schema:

```text
z2m.strategy-source-snapshot.v1
```

Run:

```bash
node --test --test-concurrency=1 tests/product/strategy-source-z2k.test.mjs
```

Commit:

```bash
git commit -m "feat: add Z2K strategy source adapter"
```

---

# 6. Task 3 — Durable source config + immutable snapshots/LKG

Create:

```text
strategy-sources.uc
tests/product/strategy-sources-lifecycle.test.mjs
```

Durable config:

```text
/etc/zapret2-manager/strategy-sources.json
```

Default, written only when needed:

```json
{
  "schema": "z2m.strategy-sources.v1",
  "revision": 1,
  "sources": {
    "avatar": {"enabled": true},
    "z2k": {"enabled": true}
  }
}
```

Mutations use revision/CAS; stale request → `ESTALE`.

Snapshots live under bounded source-owned paths. Activation authority is exact snapshot ID stored in source state; never directory mtime/name.

Required interfaces:

```text
strategy_sources_get()
strategy_source_get(id)
strategy_source_set_enabled(id, enabled, expectedRevision)
strategy_source_current_snapshot(id)
strategy_source_install_verified_snapshot(id, prepared)
```

RED tests:

- both sources enabled by default;
- unknown source rejected;
- CAS works;
- disable preserves LKG;
- failed candidate preserves current LKG;
- no arbitrary filesystem scan selects authority.

Update `resources/manifest.json` so these are distinct:

```text
avatar-strategy-source  kind=strategy-catalog
z2k-strategy-source     kind=strategy-catalog
z2k-resources           kind=asset-bundle
```

Do not move any Z2K Lua/blob/list ownership.

Run source lifecycle + Resource Center ownership tests.

Commit:

```bash
git commit -m "feat: add strategy source lifecycle"
```

---

# 7. Task 4 — Real upstream refresh, not reindex-only

Reuse:

```text
update-source.uc
```

for remote source metadata/revision discovery. Do not add network fetch to normal catalog readers.

Create:

```text
tests/product/strategy-source-refresh.test.mjs
tests/fixtures/strategy-source-refresh/
```

Refresh contract:

```text
fresh source identity
→ mutation-only private staging
→ exact source content from exact revision
→ adapter verification
→ immutable verified source snapshot
→ return snapshot identity
```

Do NOT publish the unified catalog here.

For Z2K:
- repository is `necronicle/z2k`;
- use exact validated revision;
- fetch `strats_new2.txt` from that exact revision;
- verify content before snapshot install.

For Avatar:
- preserve existing complete verified snapshot/manifest model;
- do not degrade to live per-file reads.

Required RED cases:

- Avatar refresh invokes accepted metadata authority;
- Z2K refresh invokes accepted metadata authority;
- list/get invokes no network;
- network failure keeps LKG;
- source revision/content mismatch rejects before activation;
- identical source is idempotent;
- successful source refresh changes exact snapshot identity.

Audit new transport calls:

```bash
rg -n "uclient-fetch|wget|curl|raw.githubusercontent|api.github" \
  zapret2-manager/files/usr/libexec/zapret2-manager
```

Every new Strategy-source metadata call must route through approved update-source authority; content transport is mutation-only and source-identity-bound.

Commit:

```bash
git commit -m "feat: refresh verified strategy sources"
```

---

# 8. Task 5 — Unified generation + `strategy-read-index.v3`

Create:

```text
strategy-catalog-generation.uc
tests/product/strategy-catalog-generation.test.mjs
```

Durable generation authority:

```text
/etc/zapret2-manager/catalog/generations/
/etc/zapret2-manager/catalog/active.json
/etc/zapret2-manager/strategy-catalog-index.json
```

New index schema:

```text
z2m.strategy-read-index.v3
```

Index/generation must carry:

```text
generationId
generatedAt
source map
exact source snapshot IDs
source commits/digests
user revision
index digest
canonical entries
```

Each entry:

```text
canonicalId
sourceId
upstreamId
sourceSnapshotId
sourceCommit
name/profiles
capabilities
requirements
provenance
```

RED cases:

- Avatar + Z2K both indexed;
- same upstream ID yields both `avatar:id` and `z2k:id`;
- disabled source excluded;
- unpublished snapshot ignored;
- index build failure leaves old generation;
- publication failure leaves old generation;
- reboot reloads same generation;
- pointer/index digest mismatch fails closed.

Publication order:

```text
verified source snapshots
→ full candidate index
→ validate
→ durable generation record
→ durable index
→ active publication pointer LAST
```

If separate index/pointer files cannot be swapped as one object, pointer MUST bind exact index digest and readers MUST reject mismatch.

Convert `strategy-catalog.uc` into a generation/index reader. It must no longer know raw Avatar layout or Z2K syntax.

Legacy unnamespaced ID compatibility may exist only as bounded migration:
- unique proven source → normalize;
- ambiguous → fail closed, never silently choose.

Commit:

```bash
git commit -m "feat: publish unified strategy catalog generations"
```

---

# 9. Task 6 — Make existing “Обновить стратегии” refresh all enabled sources

Modify existing async worker/RPC; preserve RPC names:

```text
strategies_catalog_refresh_start
strategies_catalog_refresh_status
```

Worker phases become source-aware:

```text
avatar-fetch
avatar-verify
z2k-fetch
z2k-verify
merge
indexing
activating
done
```

Required matrix:

```text
A PASS / Z PASS → new A + new Z
A PASS / Z FAIL → new A + Z LKG
A FAIL / Z PASS → A LKG + new Z
both FAIL        → previous generation
generation FAIL  → previous generation
```

If an enabled source has no valid current/LKG snapshot and fresh refresh fails, no new generation is published.

Update UI progress so “Каталог стратегий обновлён” is only used truthfully. If one source fell back to LKG, show it explicitly.

Commit:

```bash
git commit -m "feat: refresh all strategy sources"
```

---

# 10. Task 7 — Resource Center source cards + per-source update/enable/disable

Add exact RPC/ACL operations for:

```text
source list/status
refresh one
enable
disable
```

Single-source refresh reuses Task 4 code.

Resource Center must show:

```text
ИСТОЧНИКИ СТРАТЕГИЙ

Avatar
avatarDD/zapret-gui
status / count / revision
[Обновить] [Отключить]

Z2K
necronicle/z2k
status / count / revision
[Обновить] [Отключить]

[Обновить все]

УПРАВЛЯЕМЫЕ РЕСУРСЫ
Z2K Resources
...
```

Create:

```text
tests/ui/resource-strategy-sources.test.mjs
```

Critical test:
- apply/retain real Z2K Strategy state;
- disable Z2K source;
- unified catalog excludes Z2K;
- applied Strategy identity/runtime state remains unchanged;
- re-enable exposes LKG but does not auto-apply.

Commit:

```bash
git commit -m "feat: manage strategy sources in Resource Center"
```

---

# 11. Task 8 — Source filters/badges and canonical-ID-safe UI

Create:

```text
tests/ui/strategy-source-filters.test.mjs
```

Required primary filters:

```text
Все | Avatar | Z2K | Пользовательские
```

Existing filters remain composable.

RED cases:

- `Z2K + Авто`;
- `Avatar + Избранные`;
- same upstream ID from Avatar/Z2K renders two cards;
- Preview/Validate/Apply/detail/favorite/editor actions use canonical ID, not display/upstream ID.

Each card gets source badge:
- Avatar;
- Z2K;
- User.

Audit every UI operation that accepts Strategy ID and ensure namespace is never lost.

Run existing Strategy UI contract suites too.

Commit:

```bash
git commit -m "feat: filter strategies by source"
```

---

# 12. Task 9 — Persist immutable applied source provenance

Extend the EXISTING canonical applied Strategy state; do not create a second active-state owner.

Applied evidence must include:

```text
canonicalStrategyId
sourceId
sourceSnapshotId
sourceCommit
strategy/content digest
normal Strategy runtime proof
```

RED cases:

- Apply `z2k:id@S1`;
- refresh Z2K to S2 → applied remains S1;
- disable Z2K → applied remains S1;
- upstream removes Strategy → applied remains S1;
- explicit new Apply updates applied evidence.

Legacy state:
- proven unique source → normalize;
- ambiguous → preserve runtime/readability but mark catalog linkage ambiguous instead of guessing.

Commit:

```bash
git commit -m "feat: persist strategy source snapshot identity"
```

---

# 13. Task 10 — Semantic Discord discovery, no hardcoded donor

Create:

```text
tests/product/strategy-discord-source-integration.test.mjs
```

Remove production assumption:

```text
strategy_catalog_get_detail('z2k_all_in_one')
source='avatar-catalog'
```

Canonical Discord capability is derived from profile semantics.

Tests include:
- Z2K compatible donor;
- Avatar compatible donor;
- incompatible entries;
- source filter;
- same display name from both sources;
- no `z2k_all_in_one` ID dependency.

Discovery result must carry exact:

```text
canonicalStrategyId
sourceId
sourceSnapshotId
sourceCommit
donorProfileId
donorProfileDigest
required dependencies
native validation result
```

`discord_voice` may only be recognized for legacy cleanup/migration; canonical key remains `discord_udp`.

Commit:

```bash
git commit -m "fix: resolve Discord donors from canonical catalog"
```

---

# 14. Task 11 — “Включить Discord” through normal Strategy lifecycle only

RED test: Discord enable path must NOT directly call `profiles_apply_candidate`.

When current Strategy lacks Discord:

```text
Включить Discord
→ compatible picker
→ Все / Avatar / Z2K
→ selected canonical donor
→ merge into current full Strategy draft
→ normal Preview
→ normal Validate
→ native preflight
→ normal Strategy Apply
→ runtime postflight
```

Preserve unrelated current profiles.

Reject duplicate/conflicting `discord_udp` rather than adding two.

Retire old mutation path:
- migrate all production callers;
- compatibility wrapper may delegate to canonical Strategy lifecycle;
- no separate direct writer remains.

Audit:

```bash
rg -n "profiles_apply_candidate|discord_apply|z2k_all_in_one|avatar-catalog" \
  zapret2-manager/files/usr/libexec/zapret2-manager \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager
```

Commit:

```bash
git commit -m "feat: enable Discord through strategy lifecycle"
```

---

# 15. Task 12 — Correct already-active Discord projection

Reproduce the observed case:

```text
active = z2k всё-в-одном (TLS/HTTP + QUIC + Discord)
runtime contains canonical discord_udp
```

Expected UI:

```text
Discord Voice / Video
● Активно
Источник: Z2K
Стратегия: z2k всё-в-одном
```

No “Включить Discord” button.

Do not merely loosen frontend regex. Trace:
- applied Strategy;
- runtime instance/config;
- canonical Discord semantics.

Use the smallest existing authoritative state.

Commit:

```bash
git commit -m "fix: project active Discord strategy correctly"
```

---

# 16. Task 13 — Migration from current Avatar-only catalog

On first startup with no new generation:

1. resolve current verified Avatar authority via Avatar adapter;
2. preserve its existing managed/package/LKG identity;
3. install/associate it as Avatar source snapshot;
4. obtain/verify Z2K Strategy source snapshot before exposing Z2K;
5. include existing user Strategies;
6. build/publish first generation.

RED cases:

- current managed Avatar migrates;
- package Avatar migrates;
- invalid old state fails closed;
- migration idempotent;
- reboot restores same generation;
- migration never auto-applies runtime;
- user Strategies preserved.

Do not delete old Avatar previous/LKG during initial migration.

Commit:

```bash
git commit -m "feat: migrate strategy catalog to source generations"
```

---

# 17. Task 14 — Transaction/failure injection

Add deterministic tests for:

```text
Avatar fetch fail
Z2K fetch fail
Avatar verify fail
Z2K verify fail
snapshot install fail
index build fail
generation write fail
final publish fail
```

Assertions:

```text
new A + old Z
old A + new Z
old generation when both fail
old generation when publication fails
unpublished candidates ignored after simulated restart
```

No production user-visible “failure injection” switch.

Run:

```bash
node --test --test-concurrency=1 \
  tests/product/strategy-sources-lifecycle.test.mjs \
  tests/product/strategy-source-refresh.test.mjs \
  tests/product/strategy-catalog-generation.test.mjs
```

Commit:

```bash
git commit -m "test: harden strategy source publication failures"
```

---

# 18. Task 15 — Broad source verification + adversarial review

Fresh runs only. Record command/count/exit code.

At minimum run:

- source Avatar tests;
- source Z2K tests;
- source lifecycle;
- source refresh;
- generation/index;
- Strategy catalog read;
- Strategy Apply/lifecycle;
- Discord integration;
- Resource Center;
- Strategy UI filters;
- update-source;
- existing Avatar integration;
- affected Z2K/canonical runtime gates;
- affected Autocircular tests;
- JS syntax;
- UCode imports;
- docs/knowledge validator;
- `git diff --check`.

Run:

```bash
node scripts/validate-knowledge.mjs
git diff --check
```

Then adversarial review specifically for:

```text
duplicate source authority
duplicate catalog authority
index/generation mismatch
partial publication
network in read path
cross-source ID collision loss
source disable breaking runtime
refresh auto-applying runtime
Z2K Resources/source coupling
hardcoded z2k_all_in_one
false Avatar provenance
Discord second writer
discord_voice resurrection
```

Every proven blocker:
`RED → fix → GREEN`.

---

# 19. Task 16 — Safe real-router source deployment

Before mutation capture:

- current deployed SHA hashes;
- current catalog/index identity;
- Avatar source identity;
- applied Strategy identity;
- nfqws2 PID/starttime/argv;
- current Z2K runtime identity;
- Autocircular state checksum/count;
- backup paths.

Deploy only verified source delta using existing safe workflow.

Verify exact local/router SHA parity.

No APK build.

---

# 20. Task 17 — Real router acceptance: sources/catalog

## 20.1 Top-level update

Click real **Обновить стратегии**.

Prove:

```text
both enabled sources actually refreshed
Avatar verification PASS
Z2K verification PASS
unified index rebuilt
one generation published
UI reloads
```

Record source before/after commit/snapshot IDs and generation ID.

## 20.2 Filters

Real UI:

```text
Все
Avatar
Z2K
Пользовательские
Z2K + Авто
```

Canonical backend detail must prove source identity.

## 20.3 Per-source update

Avatar-only update:
- Z2K fetch does not run;
- current Z2K LKG still in complete generation.

Z2K-only update:
- Avatar fetch does not run;
- current Avatar LKG still present.

## 20.4 LKG failure

Safely cause one source refresh failure through an approved test/transport seam.

Required:
- catalog remains usable;
- source LKG retained;
- UI reports source error + LKG;
- no partial broken generation.

## 20.5 Disable/re-enable

With real Z2K Strategy applied:

Disable Z2K:
- Z2K disappears from new catalog operations;
- active Strategy continues;
- nfqws2 runtime unchanged;
- UI shows disabled-source provenance.

Re-enable:
- LKG available again;
- no runtime auto-change.

## 20.6 Reboot

Reboot router.

Required:
- same published generation;
- source config restored;
- applied Strategy/runtime restored;
- unpublished candidate directories ignored.

---

# 21. Task 18 — Real Discord acceptance

## 21.1 Already active

Use real catalog:

```text
z2k всё-в-одном (TLS/HTTP + QUIC + Discord)
```

Prove:
- applied canonical source = Z2K;
- runtime has `discord_udp`;
- Discord card says Active;
- no enable button.

## 21.2 Picker

Apply a real Strategy without Discord.

Open **Включить Discord**.

Prove:
- compatible donor list;
- `Все | Avatar | Z2K`;
- correct provenance;
- incompatible profiles absent.

## 21.3 Enable

Choose real compatible donor.

Evidence:

```text
donor canonical ID
source snapshot
merged draft
Preview PASS
Validate PASS
native PASS
normal Apply PASS
runtime/postflight PASS
discord_udp present
```

Prove legacy Discord writer was not the mutation authority.

## 21.4 Refresh/disable donor source

After Discord Apply:
- source refresh does not silently replace runtime donor;
- source disable does not stop working Discord;
- disabled source cannot be used for new donor selection;
- reboot restores the same applied runtime.

---

# 22. Final Gate

Invoke:

```text
superpowers:verification-before-completion
```

Re-run all affected tests fresh. Audit every TODO/SKIP in affected core contracts.

Final adversarial review must have:

```text
0 unresolved blocking findings
```

Run:

```bash
git status --short --branch
git diff --check
git fetch origin
```

Review unrelated diff and upstream ancestry.

Do not push incomplete state.

If the enclosing mission already has `PUSH:YES`, after ALL source + router + Discord gates:
- integrate safely;
- non-force push;
- prove final local SHA equals `origin/main`.

If there is no active push authorization, stop with the verified worktree/branch SHA.

Final DONE report must explicitly contain:

```text
STATUS: DONE

STRATEGY SOURCES
Avatar PASS
Z2K PASS
Refresh all PASS
Refresh one PASS
Partial failure/LKG PASS
Disable/re-enable PASS

CATALOG
Unified generation/index PASS
Namespaced identities PASS
Reboot restore PASS

UI
All/Avatar/Z2K/User filters PASS
Source badges/provenance PASS

RUNTIME
Refresh does not auto-apply PASS
Applied Strategy survives source disable PASS

DISCORD
Already-active detection PASS
Compatible donor picker PASS
Preview/Validate/Apply through normal Strategy lifecycle PASS
discord_udp runtime proof PASS
No second writer PASS

TESTS
exact fresh counts

ADVERSARIAL REVIEW
0 unresolved blocking findings

FINAL SHA
exact SHA and delivery state
```

If any required row is unproven, overall status stays `WORKING`; continue engineering instead of reporting PASS.

---

# Plan Self-Review

- The plan preserves the existing top-level update button and its index-building role, but changes it from reindex-only to real refresh-all.
- Avatar and Z2K source identities are separate; same IDs coexist.
- Source filters are composable.
- Active runtime is independent from source refresh/disable.
- Z2K Strategy source and Z2K runtime resources stay separate.
- Partial refresh/LKG and crash publication are explicit.
- Discord hardcoding/provenance defect and second-writer risk are both covered.
- Real-router acceptance includes refresh, filters, source disable, reboot, Discord active detection and Discord Apply.
- No unrelated product redesign is included.


