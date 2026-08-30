# Z2K update-details bugfix QA report

Status: PASS_WITH_CONCERNS

This is a bugfix-only change. No CSS redesign, copy rewrite, resource update,
or push was performed.

## Root cause

`z2k_version_details()` used the installed release's historical
`UPDATES.json` as the prerequisite for both `installChanges` and repository
Compare. When the confirmed installed identity was `r-79.7` but its historical
manifest was unavailable, `changes_between()` returned `known=false` and the
Compare request was skipped. The UI then used that unknown historical result
as the device-detail gate.

## Changed authority boundaries

- `z2k_upstream_plan(targetManifest)` remains the sole device mutation planner.
- The planner now exposes structured `updateItems` derived from the existing
  Asset Registry observation and target classification.
- `z2k_version_details()` projects those items as `deviceChanges`, preserving
  `releaseChanges` as the independent release-to-release history.
- Existing `installChanges` and `changes` fields remain compatibility aliases
  for the canonical `deviceChanges` payload.
- Compare is requested from valid installed/target commit identities alone;
  annotated installed tags are resolved before Compare. Missing explanations
  leave the device row present with the existing deterministic fallback.
- Device `removedItems` remain empty because the current updater does not
  establish an orphan-removal mutation.

## Real router acceptance

Router: `192.168.1.1`, installed release confirmed as `r-79.7`.

Raw RPC/CLI evidence after staged install:

- `resources_status`: `ok=true`; Z2K source state `update`, latest checked
  resource manifest `p-80.4`; installed Asset Registry remained unchanged.
- `resources_check`: `ok=true`; check completed at `1788044938`.
- `resources.versions` (`z2k_versions` CLI): `ok=true`,
  `installedRelease=r-79.7`, catalog latest `r-80.3`; rows are annotated tags
  with valid `tagSha` values.
- `resources.versionDetails(r-80.3, fallback)`:
  `installedVersion=r-79.7`, `releaseChanges.known=false`,
  `deviceChanges.known=true`, `modified=2`, `added=2`, `removed=0`.
- `resources.versionDetails(r-80.3, compare)` cold run returned
  `deviceChanges.known=true`, four rows with `summarySource=repository-compare`,
  and `compareUrl=https://github.com/necronicle/z2k/compare/r-79.7...r-80.3`.
  The response diagnostics recorded `requestCount=4`, `restRequestCount=3`.

Browser acceptance on real LuCI selected `r-80.3` and showed:

- `r-79.7 → r-80.3`;
- `Обновится · 2`, `Добавится · 2`, `Удалится · 0`;
- all four real `sourcePath` rows;
- after opening details, upstream commit subjects/excerpts and context links;
- no `История установленной версии не подтверждена.` in place of the rows.

The update button was not activated. Browser logs contain one pre-existing
LuCI `uci/get Access denied` entry from the no-root-password router session;
no new error appeared during this flow.

## Verification

- Focused bugfix tests: `33/33` passed.
- Relevant product suite: `255` tests, `219` passed, `4` existing baseline
  failures, `32` skipped because local Windows lacks the native `/opt/ucode`
  environment. The four failures are CHECK_STATE fixture, runtime init
  fixture, pinned-key fixture, and classification fixture failures outside this
  diff.
- Relevant UI suite: `92` tests, `90` passed; two existing issues remain:
  `resource-center-signed-z2k` expects stale `signedSources` markup and a
  separate UI contract file cannot load because local `vitest` is absent.
- `node --check` passed for the two changed JavaScript modules.
- `node scripts/validate-knowledge.mjs` passed.
- `git diff --check` passed.

## Delivery state

Base `HEAD`: `bfa5eca36bf4af970faf5d434d5157240041988f` on branch `main`.
The worktree remains intentionally dirty with this bugfix, pre-existing
Strategy IDE work, and an unrelated untracked directory. No commit or push was
performed.
