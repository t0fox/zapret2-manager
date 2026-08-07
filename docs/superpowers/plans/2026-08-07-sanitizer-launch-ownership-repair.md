# Sanitizer Launch Ownership Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the sanitizer harness so every attempted launch retains an ownership context independently of readiness, and cleanup reports success only after identity-verified disappearance of the complete Linux process group.

**Architecture:** Replace the throwable combined `startGroup()` boundary with `launchGroup(spec) -> OwnershipContext` and `awaitReadiness(context, options) -> Promise<ReadinessResult>`. Preallocate ownership before spawning `wsl.exe`, publish Linux identity through the existing atomic marker, and use one monotonic lifecycle plus identity-verified TERM/KILL cleanup; this test harness deliberately does not add a broker, so the pre-marker cross-OS gap is represented as cleanup uncertainty rather than guessed away.

**Tech Stack:** Node.js ESM and `node:test`, Windows `child_process`, WSL2, POSIX shell, `/proc`, `setsid`, and Git.

## Global Constraints

- This is a new SDD cycle. The old sanitizer task remains **BLOCKED after fix round 5/5** at commit `fddc0af`; this work is architectural repair, never “round 6.”
- Do not modify helper implementation, helper behavior tests, protocol/design documents, or production C. Scope is the sanitizer launch/cleanup harness under `tests/native/core/`.
- Freeze these invariants: **process existence => ownership context**; **marker deletion => verified complete group disappearance**; **scan failure != empty**; **Windows reap != Linux disappearance**; **PID-only signal forbidden**.
- Use the approved typed split exactly: `launchGroup(spec) -> OwnershipContext` and `awaitReadiness(context, options) -> Promise<ReadinessResult>`.
- Do not add a broker or supervisor for this test harness. Before a complete atomic marker exists, Linux identity is uncertain and no Linux group signal is permitted.
- Use deterministic gates/hooks for race proof. A sleep may bound a real-process wait, but elapsed sleep is never the assertion that proves ordering or correctness.
- Keep stdout/stderr and marker reads bounded at 4096 bytes; retain the existing 48-hex-character random cleanup token and expected scenario-path binding.
- Preserve current fail-closed `/proc` behavior and identity checks: PID, start time, PGID, SID, token in argv, and scenario path in argv must all agree before any negative-PGID signal.
- The implementation commit target is exactly `fix(test): preserve sanitizer launch ownership`.
- After this repair passes review, resume the first incomplete task in `docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md`: Milestone 1, “Add failing strict parser tests.”

---

## Root-Cause Evidence And Frozen Model

The ignored report `.superpowers/sdd/2026-08-07-native-foundation-fs-helper/launch-ownership-root-cause.md` establishes the exact defect:

- `tests/native/core/sanitizer-harness.test.mjs:312-356` has throwable `waitForLauncherReady()`; its timeout kills only the Windows launcher.
- `tests/native/core/sanitizer-harness.test.mjs:367-375` creates `pidFile`, token, scenario path, and `wsl.exe`, but awaits readiness before returning them.
- In the real silent-readiness reproduction, the promise returned no context; Windows PID `26352` exited by `SIGTERM`, while Linux PGID/SID `474` survived with leader `474`, child `492`, leader PPID `1`, start time `5750`, and the complete marker still present.
- The marker contained PID `474`, start time `5750`, PGID/SID `474`, the 48-hex token, and the exact scenario path. Its temp file was absent after same-directory rename.
- Existing identity-verified cleanup observed members `[474, 492]` and then `[]`, with `processGone: true`; only after that was the final marker deleted. `signalSent` was false in this run, proving signal syscall success is not cleanup proof.
- A second probe hit the opposite pre-marker race and could not parse a complete marker. Therefore marker discovery cannot create ownership retroactively, and absence of a final marker cannot prove absence of Linux work.

```mermaid
sequenceDiagram
    participant P as Windows parent
    participant C as OwnershipContext
    participant W as wsl.exe
    participant S as setsid --wait
    participant R as wrapper.sh
    participant M as atomic marker
    participant G as Linux PGID/SID

    P->>C: preallocate token, unique pidFile, expected scenarioPath; state=CREATED
    P->>W: spawn launcher; attach immediately; state=SPAWNED
    W->>S: enter WSL and exec setsid --wait
    S->>R: create session/process-group leader
    R->>G: read PID/startTime/PGID/SID from /proc
    R->>M: write complete JSON to pidFile.tmp.PID
    R->>M: same-directory atomic rename to pidFile
    P->>M: read and validate complete identity
    P->>C: marker=identity; state=IDENTITY_VERIFIED
    R-->>P: bounded stdout readiness notification
    P->>C: state=READY; settle ready once
    alt readiness timeout/cancel/error/launcher death
        P->>W: terminate and reap Windows launcher
        Note over P,G: Windows reap does not prove Linux disappearance
        P->>M: retain final/temp evidence if identity incomplete
        P->>G: scan diagnostically only when identity is incomplete; never signal
        P->>G: with verified identity, scan then TERM negative PGID
        P->>G: deterministic grace gate; KILL negative PGID if survivors
        P->>G: fail-closed PGID+SID scan until verified empty
        P->>M: delete final marker only after verified group absence
        P->>C: state=CLEANED or CLEANUP_UNCERTAIN
    end
```

### Exact Interfaces

Create `tests/native/core/sanitizer-launch-ownership.mjs` as the sole owner of launch/readiness state. Use these exact JSDoc structural types; do not add parallel booleans that duplicate `state` or rename fields at call sites:

```js
/** @typedef {'CREATED'|'SPAWNED'|'IDENTITY_PARTIAL'|'IDENTITY_VERIFIED'|'READY'|'FAILED'|'CLEANING'|'CLEANED'|'CLEANUP_UNCERTAIN'} OwnershipState */

/** @typedef {{
 * readyMode: 'ready'|'silent',
 * command: readonly string[],
 * scenarioPath: string,
 * pidFile?: string,
 * token?: string,
 * spawnImpl?: typeof import('node:child_process').spawn,
 * now?: () => number
 * }} LaunchSpec */

/** @typedef {{
 * pid: number,
 * startTime: string,
 * pgid: number,
 * sid: number,
 * token: string,
 * scenarioPath: string
 * }} ProcessMarker */

/** @typedef {{
 * state: OwnershipState,
 * pidFile: string,
 * token: string,
 * scenarioPath: string,
 * launcher: import('node:child_process').ChildProcess|null,
 * marker: ProcessMarker|null,
 * partialEvidence: readonly string[],
 * launcherExit: { code: number|null, signal: NodeJS.Signals|null, at: number }|null,
 * failure: { name: string, code: string|null, message: string }|null,
 * now: () => number
 * }} OwnershipContext */

/** @typedef {{
 * kind: 'ready'|'timeout'|'cancelled'|'launcher-exit'|'launch-error'|'protocol-error',
 * context: OwnershipContext,
 * deadlineAt: number,
 * readyObservedAt: number|null,
 * settledAt: number,
 * cleanup: CleanupResult|null
 * }} ReadinessResult */

/** @typedef {{
 * status: 'verified-gone'|'not-started'|'uncertain',
 * pid: string|null,
 * identityVerified: boolean,
 * termSent: boolean,
 * killSent: boolean,
 * windowsReaped: boolean,
 * groupGone: boolean,
 * scanOk: boolean,
 * membersBefore: readonly number[],
 * membersAfter: readonly number[],
 * markerDeleted: boolean,
 * evidence: string
 * }} CleanupResult */
```

`launchGroup(spec)` validates and allocates token/path/context first, sets `CREATED`, then invokes `spawnImpl` and attaches the returned child before setting `SPAWNED`. It catches synchronous spawn failure and records `FAILED` in the same returned context. Only invalid caller input or failure to allocate the token/path may throw, and those occur before any spawn attempt. Node `error` events become `launch-error` results carrying the context; no post-spawn event or operation may reject without it.

`awaitReadiness(context, { timeoutMs, signal, cleanup, gates })` always resolves one `ReadinessResult`; it does not reject for launcher, marker, readiness, cancellation, or cleanup outcomes. Programmer-contract violations such as a non-context argument may throw before listeners are installed. `gates` is test-only dependency injection with `beforeMarkerRename`, `afterMarkerRename`, `beforeReadySettle`, `beforeTerm`, and `beforeKill` async gates; production defaults continue immediately.

Allowed state transitions are monotonic and explicit:

```text
CREATED -> SPAWNED | FAILED
SPAWNED -> IDENTITY_PARTIAL | IDENTITY_VERIFIED | FAILED
IDENTITY_PARTIAL -> IDENTITY_VERIFIED | FAILED | CLEANING
IDENTITY_VERIFIED -> READY | FAILED | CLEANING
READY -> CLEANING
FAILED -> CLEANING
CLEANING -> CLEANED | CLEANUP_UNCERTAIN
```

Never move backward and never infer `IDENTITY_VERIFIED` from stdout alone. A readiness line is only a notification; parse and validate the final file marker against `pidFile`, `token`, and `scenarioPath`, then require stdout identity to equal that file identity before `READY`.

### Failure, Cancellation, And Cleanup Policy

- **Strict pre-marker limitation:** the preallocated context exists before spawn, but no complete final marker means Linux PID/PGID/SID identity is uncertain. Terminate and reap the Windows launcher, retain `partialEvidence` and any temp marker, run the process scanner only for bounded diagnostics, send no Linux signal, delete no marker, and resolve a non-PASS result whose cleanup is `status: 'uncertain'`, `identityVerified: false`, `groupGone: false`, and `markerDeleted: false`. This is the deliberate no-broker boundary.
- **Exceptions:** invalid inputs/allocation may throw before spawn; every post-spawn operational failure resolves a typed result with context. Cleanup command throws/failures become `uncertain`, never an empty group.
- **Cancellation:** an already-aborted signal settles `cancelled` immediately after listener installation; later abort competes in the same settlement arbiter. Cancellation terminates/reaps Windows, then performs the same marker-state-dependent cleanup. Remove abort and child listeners on settlement.
- **Timeout versus ready:** capture an absolute `deadlineAt`. The single arbiter compares `readyObservedAt <= deadlineAt`; exactly one result settles. Ready observed after the deadline cannot win, and a timeout remains `kind: 'timeout'` even when its induced termination later produces launcher `SIGTERM`.
- **Natural exit:** record `launcherExit` separately. Exit before verified readiness yields `launcher-exit`; cleanup still scans the entire verified PGID/SID because leader exit does not imply descendant exit. An already verified empty group is success even if TERM returned nonzero.
- **PID reuse:** never signal unless the current leader still matches marker start time, PGID, SID, token argv, and scenario-path argv. A mismatch is `uncertain`, preserves the marker, and records diagnostic members without signaling.
- **Launcher death:** Windows child exit/reap and Linux group disappearance are independent evidence. If the marker is complete, perform identity-verified group cleanup after Windows death; otherwise report uncertainty under the pre-marker rule.
- **Escalation:** after verified identity and non-empty enumeration, send TERM to negative PGID, wait through the injected deterministic grace gate while rescanning fail closed, then send KILL only if verified members remain. Success is a successful scan returning no PGID/SID members, not signal return status.
- **Marker lifecycle:** the wrapper uses a unique token-derived final filename, writes exactly one complete JSON document to `pidFile.tmp.$$`, and renames it in the same directory. Minimum fields are exactly `pid`, `startTime`, `pgid`, `sid`, `token`, and `scenarioPath`; marker/stdout contain no environment, stdin, secrets, or sanitizer payload. Keep temp/final marker on uncertainty. Delete the final marker only after a successful scan verifies the complete group absent; deletion failure makes cleanup uncertain. Same-directory rename gives local atomic visibility in WSL/tmpfs only; it does **not** claim OpenWrt persistence or crash durability, which require file and directory `fsync` in the helper design and are outside this harness.

### Race Matrix

| Race | Deterministic trigger | Required settlement and evidence |
|---|---|---|
| Before wrapper | Stub launcher fails before wrapper gate | Returned `CREATED`/`SPAWNED` context; Windows reaped; no signal; `uncertain` unless launch is proven not started. |
| Before marker | Hold `beforeMarkerRename`, then cancel/kill launcher | `IDENTITY_PARTIAL`; retain temp evidence; diagnostic scan only; no signal/deletion; non-PASS uncertainty. |
| Partial marker temp | Write truncated temp and block rename | Temp is never parsed as authority; same uncertainty behavior as before-marker. |
| Complete marker before readiness | Hold silent readiness after `afterMarkerRename` | Context reaches `IDENTITY_VERIFIED`; timeout retains ownership and safely cleans the verified group. |
| Timeout vs ready | Set fake clock/deadline and release `beforeReadySettle` on both sides | One settlement; ready wins only at or before deadline; timeout cause is not overwritten by induced exit. |
| Timeout vs natural exit | Release exit and deadline gates in both orders | Primary kind is deterministic; `launcherExit` remains secondary evidence; group scan decides cleanup. |
| Cleanup vs natural exit | Exit group between pre-signal scan and `beforeTerm` | Failed TERM is diagnostic; verified empty post-scan produces `verified-gone`. |
| TERM vs KILL | Fixture ignores TERM and is held at `beforeKill` | KILL occurs only after verified survivors; final empty scan is required. |
| PID reuse | Replace leader record after marker publication | Start-time/full-identity mismatch forbids signal and marker deletion; result is uncertain. |
| Cancellation at each state | Abort at `SPAWNED`, `IDENTITY_PARTIAL`, and `IDENTITY_VERIFIED` gates | One `cancelled` settlement, retained context, state-appropriate cleanup, no listener leak. |
| Windows death/Linux survival | Kill/reap `wsl.exe` after complete marker while group persists | Windows reap alone is non-success; verified Linux group is independently TERM/KILL cleaned. |
| Scan failure | Inject scanner nonzero before signal and after TERM | Never convert `members: []` from failed scan to absence; no initial signal or no deletion, respectively. |
| Marker deletion vs final scan | Inject delete before/after verified-empty gate | Early deletion is impossible; deletion failure changes status to uncertainty and preserves evidence. |

### Task 1: Preserve Sanitizer Launch Ownership Across Every Readiness Outcome

**Files:**
- Create: `tests/native/core/sanitizer-launch-ownership.mjs` - preallocated context, state transitions, single-settlement readiness, Windows reap, and orchestration of owned cleanup.
- Create: `tests/native/core/sanitizer-launch-ownership.test.mjs` - deterministic unit races plus the real WSL boundary regression.
- Modify: `tests/native/core/fixtures/sanitizer-process-wrapper.sh` - only deterministic test gates and the frozen atomic marker protocol; keep normal invocation behavior unchanged.
- Modify: `tests/native/core/fixtures/sanitizer-process-group.sh` - only explicit natural-exit and TERM-resistant fixture modes needed by the focused tests.
- Modify: `tests/native/core/sanitizer-process-cleanup.mjs` - consume `OwnershipContext`, enforce TERM-then-KILL and conditional marker deletion, and return the exact `CleanupResult`.
- Modify: `tests/native/core/sanitizer-harness.test.mjs` - remove local combined launch/readiness helpers and import the focused module; retain existing scanner and end-to-end assertions.
- Modify: `tests/native/core/run-fs-helper-sanitizers.mjs` - minimally route controlled execution cleanup through the same marker lifecycle without changing classifications or helper execution.
- Do not modify: `zapret2-manager/src/z2m-core-helper/**`, helper protocol tests, or any production helper source.

**Interfaces:**
- Consumes: existing `wsl.exe -d Ubuntu -u root -- /usr/bin/setsid --wait ...`, wrapper marker fields, and fail-closed `sanitizer-proc-group-scan.sh` output.
- Produces: `launchGroup(spec) -> OwnershipContext`, `awaitReadiness(context, options) -> Promise<ReadinessResult>`, and `cleanupOwnedGroup(context, options) -> CleanupResult` with the exact fields and transitions above.

- [ ] **Step 1: Establish RED for cases 1-3 at the real and controlled boundaries**

Add focused tests with explicit gates and exact assertions:

```js
test('1 real silent readiness timeout retains context through the actual WSL boundary', async () => {
  const context = launchGroup(realGroupSpec({ readyMode: 'silent', mode: 'child' }));
  const result = await awaitReadiness(context, { timeoutMs: 250, cleanup: cleanupOwnedGroup });
  assert.equal(result.kind, 'timeout');
  assert.equal(result.context, context);
  assert.equal(result.cleanup.status, 'verified-gone');
  assert.equal(result.cleanup.windowsReaped, true);
  assert.equal(result.cleanup.groupGone, true);
  assert.equal(result.cleanup.markerDeleted, true);
});

test('2 partial identity retains evidence and forbids every Linux signal', async () => {
  const fixture = controlledLaunch({ stopAt: 'beforeMarkerRename', tempMarker: '{"pid":' });
  const context = launchGroup(fixture.spec);
  const result = await fixture.cancelAndSettle(context);
  assert.equal(context.state, 'CLEANUP_UNCERTAIN');
  assert.ok(context.partialEvidence.some((item) => item.includes('.tmp.')));
  assert.equal(result.cleanup.identityVerified, false);
  assert.equal(result.cleanup.termSent, false);
  assert.equal(result.cleanup.killSent, false);
  assert.equal(result.cleanup.markerDeleted, false);
});

test('3 verified survivors escalate TERM to KILL and require an empty scan', async () => {
  const fixture = controlledLaunch({ marker: validMarker(), termLeavesMembers: [701, 702], killLeavesMembers: [] });
  const result = fixture.cleanup();
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, true);
  assert.equal(result.scanOk, true);
  assert.deepEqual(result.membersAfter, []);
  assert.equal(result.status, 'verified-gone');
});
```

Run: `node --test tests/native/core/sanitizer-launch-ownership.test.mjs --test-name-pattern="^(1|2|3) "`

Expected: FAIL because `sanitizer-launch-ownership.mjs` and the typed interfaces do not exist; retain the real silent-mode failure evidence showing the old combined boundary cannot return context.

- [ ] **Step 2: Establish RED for cases 4-9 and all listed races**

Add these named cases, using fake clocks, deferred promises/gates, injected spawn/scanner/signal/delete functions, and fixture modes rather than sleeps as proof:

```text
4 natural exit between verified scan and TERM succeeds only on a verified empty rescan
5 PID reuse after marker publication forbids TERM KILL and marker deletion
6 readiness at the exact deadline settles once while post-deadline readiness loses to timeout
7 cleanup uncertainty retains final and temp markers and cannot classify PASS
8 Windows launcher death with Linux survival independently cleans the verified Linux group
9 repeated default-concurrency native runs leave no launcher group marker temp or worktree artifact
```

Also cover cancellation at each publication state, malformed/oversize stdout, child `error`, synchronous spawn failure, before-wrapper failure, timeout versus natural exit in both orders, scan failure before signal, scan failure after TERM, and marker deletion failure. Assert listener counts return to baseline and each promise settles exactly once.

Run: `node --test tests/native/core/sanitizer-launch-ownership.test.mjs`

Expected: FAIL only for absent ownership behavior, state transitions, escalation, and cleanup certainty; no test may depend on “wait N milliseconds and assume the race happened.”

- [ ] **Step 3: Implement preallocated launch ownership and atomic identity publication**

Create `sanitizer-launch-ownership.mjs` with the exact types and exports. Allocate `pidFile` as `/tmp/z2m-cleanup-${token}.pid` unless supplied by a focused test, instantiate the context in `CREATED`, attach the launcher synchronously, and return in `SPAWNED` without waiting. Centralize state changes in `transition(context, next)` using the allowed transition table and throw on an illegal transition before mutating state.

Keep wrapper publication exactly:

```sh
MARKER_TMP="$PID_FILE.tmp.$$"
MARKER=$(printf '{"pid":%s,"startTime":"%s","pgid":%s,"sid":%s,"token":"%s","scenarioPath":"%s"}' \
  "$$" "$START_TIME" "$PGID" "$SID" "$TOKEN" "$SCENARIO_PATH")
printf '%s\n' "$MARKER" > "$MARKER_TMP"
/bin/mv "$MARKER_TMP" "$PID_FILE"
test "$READY_MODE" = silent || printf '%s\n' "$MARKER"
```

Test hooks must be explicit optional fixture arguments/environment used only by focused tests; they may block at named gates but must not alter default wrapper semantics or weaken marker validation.

Run: `node --test tests/native/core/sanitizer-launch-ownership.test.mjs --test-name-pattern="(partial identity|PID reuse|synchronous spawn|before wrapper|malformed|oversize)"`

Expected: context/interface tests PASS; readiness and cleanup tests that require later steps remain RED.

- [ ] **Step 4: Implement single-settlement readiness and policy-complete cancellation**

Implement one `settle(kind, observedAt)` path that removes timer, abort, stdout, stderr, `error`, and `exit` listeners exactly once. Bound streams, preserve the primary event, validate stdout against the complete final marker, and populate every `ReadinessResult` field. On all non-ready outcomes invoke the injected/default cleanup with the same context; never reject after spawn.

Run: `node --test tests/native/core/sanitizer-launch-ownership.test.mjs --test-name-pattern="(readiness|deadline|cancel|launcher|silent)"`

Expected: cases 1, 6, and 8 plus cancellation/protocol/listener tests PASS; cleanup escalation tests remain RED until Step 5.

- [ ] **Step 5: Implement identity-verified cleanup, escalation, and conditional deletion**

Refactor `sanitizer-process-cleanup.mjs` to export `cleanupOwnedGroup(context, options = {})`. Reuse strict marker parsing and the fail-closed scanner. Before signal, verify all identity fields against the live leader. Send `TERM` and later `KILL` only as negative PGID after successful identity verification; rescan PGID and SID after every action. Preserve temp/final markers on every uncertainty. Remove the final marker only after a successful empty scan, verify removal, and set `markerDeleted: true`; otherwise return `uncertain`. Keep diagnostic signal booleans separate from `groupGone`.

Run: `node --test tests/native/core/sanitizer-launch-ownership.test.mjs`

Expected: all focused cases 1-9 and the complete race matrix PASS.

- [ ] **Step 6: Integrate minimally with the existing sanitizer harness and runner**

Delete local `waitForLauncherReady()`, `startGroup()`, and unsafe `forceCleanup()` from `sanitizer-harness.test.mjs`; import the new module and make every test retain context immediately. Adapt `runControlled()` only enough to construct the same context/marker ownership and use conditional deletion; preserve report classifications and fields consumed by existing tests. Do not move helper compile/run policy into the ownership module.

Run: `node --test tests/native/core/sanitizer-harness.test.mjs`

Expected: all harness tests PASS, including existing forged-marker, stale-start-time, leader-survivor, scan-failure, timeout, and artifact tests.

- [ ] **Step 7: Run exact verification and prove no orphans or artifacts**

Run in PowerShell from `G:\zapret2-native-fs-helper`:

```powershell
node --test tests/native/core/sanitizer-launch-ownership.test.mjs
node --test tests/native/core/sanitizer-harness.test.mjs
node --test tests/native/baseline.test.mjs tests/native/core/result.test.mjs
node --test tests/native
node --test tests/native
$markers = & wsl.exe -d Ubuntu -u root -- /usr/bin/find /tmp -maxdepth 1 -type f -name 'z2m-cleanup-*.pid' -print 2>&1
if ($LASTEXITCODE -ne 0) { throw "marker discovery failed: $markers" }
foreach ($marker in @($markers)) {
  if (-not $marker) { continue }
  $identity = & wsl.exe -d Ubuntu -u root -- /usr/bin/jq -r '[.pgid,.sid] | @tsv' $marker 2>&1
  if ($LASTEXITCODE -ne 0 -or $identity -notmatch '^(\d+)\t(\d+)$') { throw "marker identity read failed for ${marker}: $identity" }
  $scan = & wsl.exe -d Ubuntu -u root -- /bin/sh /mnt/g/zapret2-native-fs-helper/tests/native/core/fixtures/sanitizer-proc-group-scan.sh $Matches[1] $Matches[2] 2>&1
  if ($LASTEXITCODE -ne 0) { throw "orphan scan failed for ${marker}: $scan" }
  if ($scan) { throw "orphan group survives for ${marker}: $scan" }
}
$artifacts = & wsl.exe -d Ubuntu -u root -- /usr/bin/find /tmp -maxdepth 1 \( -name 'z2m-cleanup-*' -o -name 'z2m-sanitizer-*' \) -print 2>&1
if ($LASTEXITCODE -ne 0) { throw "artifact scan failed: $artifacts" }
if ($artifacts) { throw "sanitizer artifacts remain: $artifacts" }
git diff --check
$unexpected = git status --short | Where-Object { $_ -notmatch '^.. (tests/native/core/|docs/superpowers/plans/2026-08-07-sanitizer-launch-ownership-repair.md)' }
if ($unexpected) { throw "unexpected worktree artifacts: $unexpected" }
```

Every retained final marker is mapped to its PGID/SID and passed to the scanner, whose nonzero status is fatal, so scan failure can never be reported as an empty result. The subsequent artifact check also fails because even an empty verified group must not leave a marker after successful cleanup. The two unfiltered `node --test tests/native` runs are the required repeated default-concurrency native runs. Record counts, durations, cleanup results, and empty artifact output in `.superpowers/sdd/2026-08-07-sanitizer-launch-ownership-repair/plan-report.md`.

- [ ] **Step 8: Commit the implementation as one architectural repair**

Review `git status --short`, `git diff --check`, and `git diff -- tests/native/core`. Stage only the seven scoped sanitizer files; do not stage ignored SDD reports or unrelated changes.

```powershell
git add tests/native/core/sanitizer-launch-ownership.mjs tests/native/core/sanitizer-launch-ownership.test.mjs tests/native/core/fixtures/sanitizer-process-wrapper.sh tests/native/core/fixtures/sanitizer-process-group.sh tests/native/core/sanitizer-process-cleanup.mjs tests/native/core/sanitizer-harness.test.mjs tests/native/core/run-fs-helper-sanitizers.mjs
git commit -m "fix(test): preserve sanitizer launch ownership"
```

Expected: one implementation commit with no helper implementation or helper behavior-test changes.

- [ ] **Step 9: Close this SDD cycle and resume the main helper plan**

Mark this task complete in `.superpowers/sdd/2026-08-07-sanitizer-launch-ownership-repair/progress.md` with the implementation SHA and verification evidence. Then return explicitly to `docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md`, line 59, the first incomplete item: **Milestone 1 - Add failing strict parser tests**. Do not treat sanitizer repair as completion of Foundation Task 3 and do not continue changing the sanitizer harness unless a new failing review finding requires a separately ruled cycle.
