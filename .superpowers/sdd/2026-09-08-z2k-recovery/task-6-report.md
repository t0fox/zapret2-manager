# Task 6 — Truthful Z2K discovery control block

Date: 2026-09-08
Worktree: `G:\zapret2-manager\.worktrees\z2k-recovery-v2`
Branch: `codex/z2k-recovery-v2`
BASE: `53da4c059ab5686a9f1fd8f0b4cdc089bebc157d`

## Scope

Implemented only the compact automatic-discovery control block. The existing
`.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md` modification was preserved
and was not edited or staged.

The UI consumes canonical `{schema, enabled, running, dnsSource,
discoveredDomains}`. It never derives `running` from `enabled`, accepts only
`auto`, `agh`, `dnsmasq`, and `pkt`, preserves canonical error codes, displays
the discovered count and optional mtime, and offers one concise state action.

## TDD evidence

### RED

Exact plan command, run after adding the new assertions and before production
changes:

```text
node --test tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-detect-discovery-service.test.mjs
```

Result: `26 tests`, `15 passed`, `2 failed`, `9 skipped`. The two new UI tests
failed because `discoveryViewModel` and `discoverySources` did not yet exist.

### GREEN

Exact focused command after implementation:

```text
node --test tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-detect-discovery-service.test.mjs
```

Result: `26 tests`, `17 passed`, `0 failed`, `9 skipped`.

The nine skips are environment-bounded: `/opt/ucode/bin/ucode` is unavailable
on this Windows host and the WSL control directory is not writable for the
safe temporary symlink case. They are not claimed as product passes.

Additional focused gates:

```text
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
git diff --check
```

Both exited `0`.

## Router/source-only evidence

The two changed runtime files were copied source-only to `root@192.168.1.1`
with backups under `/tmp/z2m-task6-backup` and no APK build. Remote hashes
matched the local files:

```text
z2m-scanner.js       1fc58fbf528c3ee7916ff98987e8628a865347452c969d3e30b2032a1f71fbab
z2m-components.css   a4ee27111da5344f89867ea99430f93f9a1a91812b1874f031e06fc5952c33ae
```

Observed through `ubus`:

- Initial status: `enabled:false`, `running:false`, `dnsSource:auto`,
  `discoveredDomains.count:2`, `mtime:1788883403`.
- `enable({dnsSource:"auto"})`: `enabled:true`, `running:true`, PID `9271`.
- `ubus call service list {"name":"zapret2-manager"}` showed one named
  `z2k-detect` instance with exact `run -publish` argv.
- `restart({dnsSource:"dnsmasq"})`: typed `ok:true`, source changed to
  `dnsmasq`, but actual validated process state was `running:false`.
- `disable({dnsSource:"dnsmasq"})`: `enabled:false`, `running:false`; the
  discovered count and mtime remained `2` and `1788883403`.

This is partial router lifecycle evidence. The dnsmasq restart did not prove a
new running process, so no full router PASS is claimed.

## Browser evidence

NOT RUN. The available CUA browser gate refused to open the visible LuCI IAB
tab with the exact limitation: `IAB visibility is not supported in a subagent
thread`. Per the task instruction, this is recorded as unavailable rather than
treated as browser acceptance. No screenshot or browser Network payload claim
is made.

## Files changed by Task 6

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `tests/ui/scanner-ui-rework.test.mjs`
- `tests/product/z2k-detect-discovery-service.test.mjs`
- `.superpowers/sdd/2026-09-08-z2k-recovery/task-6-report.md`

## Unresolved concerns

- Browser lifecycle acceptance remains unverified because the available CUA
  surface could not open the visible IAB tab.
- `dnsmasq` restart returned a canonical response but did not yield a running
  process on this router, so the new-process portion remains unverified.
- UCode-backed product assertions remain skipped in the Windows host run and
  require the canonical WSL UCode environment for a full product count.
