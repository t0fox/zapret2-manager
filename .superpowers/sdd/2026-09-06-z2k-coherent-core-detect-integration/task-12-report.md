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

The Task 12 suite itself is 6/6. It covers disabled/no-command behavior,
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
