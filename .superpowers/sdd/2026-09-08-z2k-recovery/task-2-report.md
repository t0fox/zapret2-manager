# Z2K recovery Task 2 report

## Scope and commit

- Worktree: `G:\\zapret2-manager\\.worktrees\\z2k-recovery-v2`
- Branch: `codex/z2k-recovery-v2`
- Commit: `aba32959c14bdac865fa3f70b95a56c63d7070dd`
- Message: `fix: restore typed Z2K discovery controls`
- Task 1 `ledger.md` change was preserved and was not included in this task commit.
- No APK build, push, merge, branch/worktree deletion, or agent/reviewer invocation.

## RED

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
```

Expected failure: the new boundary test failed because enable/disable/restart
registrations omitted typed `dnsSource`. The forwarding assertion passed,
confirming the existing handler reads `req.args` before calling
`z2k_detect_discovery_control()`.

## GREEN and host checks

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/ui/scanner-ui-rework.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
git diff --check
```

Result: `13 passed, 0 failed, 7 skipped`; skips are existing environment-
dependent UCode/WSL cases. Syntax and diff checks passed.

Production change: status remains parameterless and enable/disable/restart each
declare `args: { dnsSource: 'string' }`. Existing positional LuCI calls and
procd source were preserved. Tests pin the current Scanner argument contract
(`hello: 'both'`; TCP16 `timeoutMs` only).

## Reviewed source deployment and router evidence

Manifest: `.superpowers/sdd/2026-09-08-z2k-recovery/task-2.deploy.manifest`

The reviewed `scripts/deploy-target.sh` succeeded from a clean temporary clone
at the same commit because the requested worktree contains the preserved Task 1
dirty ledger file:

```text
Deployed reviewed closure from aba32959c14bdac865fa3f70b95a56c63d7070dd; backup: /tmp/z2m-task2-20260908/backup
```

Two bounded WSL attempts failed before router contact: linked-worktree Git
metadata was not resolvable, then WSL reported `Network is unreachable`. Git
Bash ran the reviewed workflow successfully. Local/router SHA-256 matched:

```text
local  = 193fb5c7a81bc725c04a2d7b5a63040161e5ce6907f46622bceb6ca838c49f64
remote = 193fb5c7a81bc725c04a2d7b5a63040161e5ce6907f46622bceb6ca838c49f64
```

Read-only precheck:

```json
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect"}
```

Required ubus registration and controlled sequence:

```text
"z2k_detect_discovery_status":{}
"z2k_detect_discovery_enable":{"dnsSource":"String"}
"z2k_detect_discovery_disable":{"dnsSource":"String"}
"z2k_detect_discovery_restart":{"dnsSource":"String"}
"z2k_detect_probe":{"domain":"String","timeoutMs":"Integer"}

enable {"dnsSource":"auto"} -> {"ok":true,"enabled":true,"dnsSource":"auto","running":false,"action":"enable"}
status {} -> {"ok":true,"enabled":true,"dnsSource":"auto","running":false}
restart {"dnsSource":"dnsmasq"} -> {"ok":true,"enabled":true,"dnsSource":"dnsmasq","running":false,"action":"restart"}
disable {"dnsSource":"dnsmasq"} -> {"ok":true,"enabled":false,"dnsSource":"dnsmasq","running":false,"action":"disable"}
```

The intended state was restored with `disable {"dnsSource":"auto"}` and
verified as:

```json
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect"}
```

No destructive router operation was performed.

## Browser boundary

LuCI Scanner was opened at
`http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager/scanner`.
The browser rendered `Authorization Required` with Username and Password
fields. No credentials were entered; Network payload capture is therefore
`NOT_VERIFIED: LuCI requires credentials in the available browser session`.

## Final state

Task-owned implementation and evidence are committed. The only remaining
worktree modification is the pre-existing Task 1 `ledger.md` change, preserved
and excluded from the Task 2 commit.
