# Task 12 report: supervise Z2K Detect autodiscovery

Status: IMPLEMENTED; focused host/WSL gates pass. Router deployment, live
procd acceptance, browser acceptance, merge and push were not run.

## Scope delivered

- Added schema-1 discovery configuration at
  `/etc/zapret2-manager/z2k-detect-discovery.json` with typed `enabled` and
  `dnsSource` values `auto`, `agh`, `dnsmasq`, and `pkt`.
- Extended the existing init owner with exactly one named `z2k-detect`
  procd instance. It starts only after bootstrap and lifecycle recovery, when
  the fixed coherent Detect authority is available, discovery is enabled, and
  the paused flag is absent. The command is fixed to the installed upstream
  binary and publishes to `/opt/zapret2/lists/discovered-domains.txt`.
- Configured bounded `term_timeout 10` and `respawn 60 5 5`.
- Added actual process/file health projection: running state and pid come
  from the named process probe; discovered-domain count and mtime come from
  the persistent list. Status and controls use the existing coherent Core
  authority and canonical Detect errors.
- Added typed discovery RPC methods for status, enable, disable, and restart,
  plus ACL registration. No raw executable, argv, shell, environment, cwd, or
  arbitrary path is accepted.
- Core update/restart paths do not write, remove, or truncate the discovered
  domain list; the list remains runtime/user data outside the Core receipt and
  release-owned asset set.

## TDD evidence

RED was observed before production changes:

```text
node --test tests/product/z2k-detect-discovery-service.test.mjs
3 failed, 0 passed, 2 skipped
```

The failures were the expected missing procd Detect instance, discovery
adapter, and discovery RPC surface on reviewed HEAD `3c730ffb`.

GREEN focused gate:

```text
wsl.exe -e bash -lc "set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && sh -n zapret2-manager/files/etc/init.d/zapret2-manager && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-detect-rpc.test.mjs"
20 passed, 0 failed, 0 skipped
```

The initial Task 12 service suite itself was 6/6. It covered disabled/no-command behavior,
fixed run argv/output path, schema/source validation, actual pid/running and
file count/mtime projection, coherent-authority rejection, and all four RPC
methods. The existing typed Detect RPC suite is 14/14 in the combined gate.

Additional checks:

- `sh -n zapret2-manager/files/etc/init.d/zapret2-manager`: passed in WSL.
- UCode module import/execution through `/opt/ucode/bin/ucode` with
  `LD_LIBRARY_PATH=/opt/ucode/lib`: passed through the six Task 12 UCode tests
  and the existing Detect RPC tests.
- `node --check tests/product/z2k-detect-discovery-service.test.mjs`: passed.
- ACL JSON parse: passed.
- `git diff --check`: passed.

## Boundaries

Not run: OpenWrt/router deployment, real procd start/stop/respawn, live
Detect DNS observation, live ubus/rpcd calls, discovered-list persistence on
an actual Core update/restart, browser acceptance, package E2E, full
regression, merge, push, or delegation/other model. Existing Task 10/11
typed adapter and canonical ownership remain the only Detect execution path;
no second updater, receipt, database, or scanner authority was introduced.

Implementation and this report are intended to be committed together from
the Task 12 worktree. Unrelated work was preserved.

## Fix-round 1 — independent-review corrections

Status: IMPLEMENTED; all four Important findings are addressed in the Task 12
implementation and focused tests. No router, browser, merge, or push actions
were performed.

### Corrections

- Discovery status no longer calls global `pidof z2k-detect`. It queries the
  named `zapret2-manager` procd instance `z2k-detect`, then validates the
  Manager-owned PID through `/proc/<pid>/exe` and `/proc/<pid>/cmdline`. The
  executable, `run` argv, fixed DNS-source domain, and fixed discovered-list
  output must all match. Missing, duplicate, unrelated, or invalid process
  evidence is reported as `running: false`, `pid: null`.
- Control-file reads distinguish a genuinely absent file from every present
  failure. Empty, unreadable, malformed, wrong-schema, wrong-type, invalid
  `dnsSource`, non-regular, and symlink inputs fail closed with
  `EDETECT_SCHEMA`; only absent defaults to schema 1 disabled/`auto`.
- Writes use a same-directory `mktemp` under `umask 077`, explicit `chmod 600`,
  and atomic `mv`. Enable, disable, and restart all persist the complete typed
  config before the service action. Restart therefore cannot silently discard a
  caller-provided `dnsSource`, and service failure is returned after the
  persisted input is known.
- The production-shaped WSL init harness stubs recovery, eligibility, DNS
  source, and procd. It verifies one exact named run command, zero instances
  when disabled, duplicate-process rejection, config write order/permissions,
  restart failure propagation, and preservation of existing discovered data.
  The update assertion recognizes the existing migration owner for
  `dynamic:discovered-domains` and rejects direct write/unlink of that data.

### Fix-round TDD and verification

RED was observed after adding the review tests and before the production
corrections: duplicate/unrelated process evidence incorrectly returned
`running: true`; the new config-reader export was absent; and restart invoked
the service without a preceding config write. The WSL fixture had one
test-only path issue, which was corrected before evaluating the production
implementation.

Focused GREEN:

```text
wsl.exe -e bash -lc "... node --test tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-detect-rpc.test.mjs"
24 passed, 0 failed, 0 skipped, 0 todo
```

The strengthened Task 12 service suite is 10/10; the existing typed Detect RPC
suite is 14/14. The production-shaped init harness is included in those ten
tests.

Bounded Task 10/11 plus Detect/lifecycle/update gate:

```text
node --test [15 focused Detect, receipt, lifecycle, runtime, update and coherent-transaction files]
185 tests; 183 passed, 1 failed, 1 todo
```

The sole failure is an existing unrelated
`z2k-update-source-integration` cold version-details assertion: it expected
five requests and observed three. The Task 12 implementation does not change
that source-resolution path; the pre-existing TODO is
`candidate CAS distinguishes unrelated revision changes from its own N to N+1 commit`.

Additional fix-round checks passed: `sh -n` for the init script, Node syntax
checks, UCode module execution through `/opt/ucode/bin/ucode`, ACL JSON parse,
`git diff --check`, knowledge validation, and Quartz verification.

### Explicitly unverified

Live OpenWrt/router acceptance remains unrun: real procd instance lifecycle,
ubus/rpcd calls, actual permissions and atomic rename on the router, live DNS
observation, and a real Core update/restart with the discovered list are not
claimed. Browser/package E2E, merge, push, router deploy, and final visual
acceptance also remain unrun.
