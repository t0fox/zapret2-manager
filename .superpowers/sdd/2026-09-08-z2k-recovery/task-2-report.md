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

## Fix round 1 review remediation

Base review HEAD: `d161f8b250b76609534cdf7dfd00aa98d5d68a5f`.

### Executable RPC boundary

The forwarding test now executes the actual rpcd handler block in a deterministic
VM seam. It invokes `z2k_detect_discovery_enable_method({ args: { dnsSource:
'agh' } })` and records the actual `z2k_detect_discovery_control()` input.

RED:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
1 failing: rpcd handler must expose the executable request-to-control seam
```

The minimal production seam `z2k_detect_discovery_control_input()` was then
added and the actual handler routed through it. Focused result: `2 passed,
0 failed`.

### Procd root cause and runtime proof

Read-only inspection showed service `running`, helperd/watchdog present, no
`z2k-detect`, and config `{ "schema": 1, "enabled": true, "dnsSource": "auto" }`.
The direct init probe failed exactly as follows:

```text
/usr/bin/ucode /usr/libexec/zapret2-manager/z2k-detect.uc discovery-eligible
Syntax error: Exports may only appear at top level of a module
```

The init fix uses `ucode -e` imports of the existing module exports for
eligibility/source probing. Exact implementation HEAD deployed through the
reviewed workflow:

```text
78afdfc586a8c357339c5be705748b76452e5fec
Deployed reviewed closure from 78afdfc586a8c357339c5be705748b76452e5fec; backup: /tmp/z2m-task2-round1-final-20260908/backup
```

After `enable {"dnsSource":"auto"}`:

```text
{"ok":true,"schema":1,"enabled":true,"dnsSource":"auto","running":true,"pid":27363,"instance":"z2k-detect","action":"enable"}
"z2k-detect":{"running":true,"pid":27363,"command":["/usr/libexec/zapret2-manager/z2k-detect","run","-publish","/opt/zapret2/lists/discovered-domains.txt"]}
PID:27363
/usr/libexec/zapret2-manager/z2k-detect
/usr/libexec/zapret2-manager/z2k-detect run -publish /opt/zapret2/lists/discovered-domains.txt
```

After `restart {"dnsSource":"dnsmasq"}`, source propagation and fixed argv
were proven, but the upstream process exited with code 1:

```text
{"ok":true,"schema":1,"enabled":true,"dnsSource":"dnsmasq","running":false,"pid":null,"instance":"z2k-detect","action":"restart"}
"z2k-detect":{"running":false,"command":["/usr/libexec/zapret2-manager/z2k-detect","run","-dns-source","dnsmasq","-publish","/opt/zapret2/lists/discovered-domains.txt"],"exit_code":1}
engine: dnssrc(dnsmasq:/var/log/dnsmasq.log): open /var/log/dnsmasq.log: no such file or directory
```

This is not counted as a dnsmasq PASS: the upstream source requires a log file
absent on this router. The manager/procd lifecycle is proven for `auto`; the
dnsmasq source remains `NOT_VERIFIED_ON_THIS_ROUTER`. No manual detector launch
or destructive router operation was performed.

The intended state was restored and verified:

```text
disable {"dnsSource":"auto"}
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"instance":"z2k-detect","action":"disable"}
service list -> helperd and watchdog only; no z2k-detect instance
```

### Browser boundary

The available Codex in-app browser opened the LuCI Scanner URL but rendered
`Authorization Required` with Username and Password fields. No authorized
session or credentials were available and none were entered. Network capture
remains exactly `NOT_VERIFIED: LuCI requires credentials in the available
browser session`.

### Fix-round checks and commits

```text
node --test tests/product/z2k-detect-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/ui/scanner-ui-rework.test.mjs -> 14 passed, 0 failed, 7 skipped
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js -> passed
git diff --check -> passed
```

Implementation commits: `269f3ba570750a954df88326ef854fc3395f86e2`,
`31fc7369f0234f308367f6476b48e70df4f28d2a`, and
`78afdfc586a8c357339c5be705748b76452e5fec`. Task 1 `ledger.md` remains
preserved and unrelated. No APK/local build, push, merge, branch/worktree
deletion, or agent/reviewer invocation occurred.

## Fix round 2 — rpcd envelope repair and bounded runtime boundary

Review baseline: `73eaac200bcaf1eb89f1cf2b8371768ed6f3018a`.

The executable boundary harness now invokes the actual discovery registration
callback from the rpcd source. RED was:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
1 failed: {args:{args:{dnsSource:'agh'}}} reached control as
{args:{dnsSource:'agh'}}, not {dnsSource:'agh'}
```

The production fix adds a discovery-only rpcd input normalizer. It accepts the
canonical `req.args.dnsSource`, unwraps exactly one nested `args` envelope, and
rejects unexpected siblings with `EINPUT`; unknown fields are not dropped.

GREEN and checks:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-detect-rpc-boundary.test.mjs tests/ui/scanner-ui-rework.test.mjs
14 passed, 0 failed, 7 skipped
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
passed
diff check: passed
```

Fix-round implementation commit:

```text
9f4b9df2e88859d1018760289e3f2348a3e48b4f fix: restore typed Z2K discovery controls
```

Reviewed source deployment from a clean detached clone succeeded:

```text
Deployed reviewed closure from 9f4b9df2e88859d1018760289e3f2348a3e48b4f; backup: /tmp/z2m-task2-round2-20260908/backup
```

Deployment identity checks:

```text
/usr/share/rpcd/ucode/zapret2-manager.uc
local/router sha256: 2878d3347904ac7f43f2e7cea67e6a98f49fa5b35851c36dd5376a6cdfe27f24
/etc/init.d/zapret2-manager
local/router sha256: 7fa5b2e566fae3fe984ab7d5b6f2d9a138d4f895dd2fdea0dbb4d6f2799ee72c
/usr/libexec/zapret2-manager/z2k-detect.uc
local/router sha256: 05a3f46b2ba827b6e5ad3de06af7c07e923bb2e8b579f9abde0396e9e38f5bf8
```

The target typed registration was read-only verified:

```text
z2k_detect_discovery_status {}
z2k_detect_discovery_enable {"dnsSource":"String"}
z2k_detect_discovery_disable {"dnsSource":"String"}
z2k_detect_discovery_restart {"dnsSource":"String"}
```

Direct target parity before the fix-round deployment proved the exact payload,
canonical status, and named process identity:

```text
enable {"dnsSource":"auto"}
{"ok":true,"schema":1,"enabled":true,"dnsSource":"auto","running":true,"pid":31241,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect","action":"enable"}
status {}
{"ok":true,"schema":1,"enabled":true,"dnsSource":"auto","running":true,"pid":31241,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect"}
/proc/31241/exe -> /usr/libexec/zapret2-manager/z2k-detect
/proc/31241/cmdline -> /usr/libexec/zapret2-manager/z2k-detect run -publish /opt/zapret2/lists/discovered-domains.txt
```

The post-deploy enable/restart gate is not a PASS: remote BusyBox has no
`timeout`, so each wrapped command stopped before `ubus` with
`sh: timeout: not found` and exit `127`; the outer SSH wrapper returned `0`.
No further deploy/retry was made. The required post-deploy restore did complete:

```text
disable {"dnsSource":"auto"}
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect","action":"disable"}
status {}
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect"}
service list {"name":"z2k-detect"}
{}
```

## Fix round 2 — browser boundary

The supplied authenticated browser evidence remains the real pre-fix failure:
LuCI Enable sent `z2k_detect_discovery_enable {dnsSource:'auto'}` in a `/ubus`
batch and received `EINPUT: Unsupported discovery control field.` The UI stayed
disabled. Post-deploy credentialed browser repeat is `NOT_VERIFIED`: the
available CUA attempt failed before opening a tab with
`IAB visibility is not supported in a subagent thread`; no credentials were
available or entered and no Network PASS is claimed.

Final router state is disabled with `dnsSource:auto`, `running:false`, and no
`z2k-detect` service instance. No password/security change or destructive router
operation was performed. The only unrelated worktree modification is the
preserved pre-existing Task 1 `ledger.md` change.

## Fix round 3 — rpcd lifecycle and final bounded evidence

The controller's authenticated post-`9f4b9df2` browser retest reproduced the
production failure exactly: LuCI sent batch id `25` with
`z2k_detect_discovery_enable {dnsSource:'auto'}`; rpcd returned
`{ok:false,error:{code:'EINPUT',message:'Unsupported discovery control field.'}}`
and the UI remained `Autodiscovery: выключено`. This is a real runtime failure,
not an authentication result.

The deterministic RED reproducer first failed because the reviewed source
deployment workflow only performed rpcd reload, and did not expose an explicit
restart path after replacing a long-lived rpcd UCode plugin:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
1 failed: reviewed source deploy can restart rpcd after replacing a UCode plugin
AssertionError: input did not match /RESTART_RPCD/
```

Read-only target inspection showed the deployed rpc source hash already
matched the reviewed source, while the rpcd process had remained on its prior
PID after reload. The production fix adds the bounded, opt-in
`RESTART_RPCD=1` path to `scripts/deploy-target.sh`; it does not weaken the
typed schema or unknown-field rejection. The executable RPC seam continues to
invoke the actual registered handler with canonical `{args:{dnsSource:'agh'}}`
and rejects an extra nested field.

Focused GREEN after the fix:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-detect-rpc-boundary.test.mjs tests/ui/scanner-ui-rework.test.mjs
15 passed, 0 failed, 7 skipped
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
passed
bash -n scripts/deploy-target.sh
passed
git diff --check
passed
```

Production fix commit and reviewed source deployment:

```text
5230e4fe80b4c7d41691988b7436530555466a0d fix: restore typed Z2K discovery controls
Deployed reviewed closure from 5230e4fe80b4c7d41691988b7436530555466a0d; backup: /tmp/z2m-task2-round3-20260908/backup
```

After deployment with `RESTART_RPCD=1`, the router's rpcd PID changed from
`6903` to `29908`, proving the new workflow restarted the long-lived rpcd
process. The deployed rpc source hash was
`a9bbff9fc065cff058340372d71ce927f3e13de37d030b7ea24404294a128055`; typed
registrations remained present:

```text
z2k_detect_discovery_status {}
z2k_detect_discovery_enable {"dnsSource":"String"}
z2k_detect_discovery_disable {"dnsSource":"String"}
z2k_detect_discovery_restart {"dnsSource":"String"}
z2k_detect_probe {"domain":"String","timeoutMs":"Integer"}
```

Bounded direct ubus lifecycle proof after the restart accepted the canonical
payload and reflected the action in canonical status:

```text
enable {"dnsSource":"auto"}
{"ok":true,"schema":1,"enabled":true,"dnsSource":"auto","running":true,"pid":32197,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect","action":"enable"}
status {}
{"ok":true,"schema":1,"enabled":true,"dnsSource":"auto","running":true,"pid":32197,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect"}
/proc/32197/exe -> /usr/libexec/zapret2-manager/z2k-detect
/proc/32197/cmdline -> /usr/libexec/zapret2-manager/z2k-detect run -publish /opt/zapret2/lists/discovered-domains.txt
disable {"dnsSource":"auto"}
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect","action":"disable"}
final status {}
{"ok":true,"schema":1,"enabled":false,"dnsSource":"auto","running":false,"pid":null,"discoveredDomains":{"count":0,"mtime":1788621576},"instance":"z2k-detect"}
service list {"name":"z2k-detect"}
{}
```

The exact fixed argv and executable identity are therefore proven through
`/proc`; the separate `service list` query returned `{}` and is not claimed as
a PASS. Final intended state is disabled with `dnsSource:auto` and
`running:false`.

Post-`5230e4fe` authenticated LuCI Network/UI success remains
`NOT_VERIFIED`. A bounded browser availability check found no authorized tab;
the available CUA mechanism reported `IAB visibility is not supported in a
subagent thread`. No credentials were available or entered, no browser
request/response was fabricated, and no new browser PASS is claimed. The last
real browser evidence is the controller-supplied EINPUT failure above.

The report-only commit following this round records the exact boundary and
runtime evidence. The pre-existing unrelated Task 1 `ledger.md` modification
remains preserved and was not staged.

## Fix round 4 — authenticated rpcd request boundary

The production mismatch is the authenticated transport field, not a different
business payload. LuCI's HTTP JSON-RPC request is the batch shape
`params: [session, 'zapret2-manager', 'z2k_detect_discovery_enable', { dnsSource: 'auto' }]`.
The rpcd UCode bridge consumes that outer JSON-RPC envelope before invoking the
plugin; the callback receives a request resource whose `req.args` contains the
typed body. For an authenticated call rpcd also permits and includes the
transport-only `ubus_rpc_session` attribute in that body. A direct ubus socket
call has no such attribute, which explains why the same visible discovery JSON
worked over SSH but failed in LuCI.

The bounded fix clones the normalized discovery input and removes only
`ubus_rpc_session` before the existing discovery validator. Unknown siblings
remain in the cloned input and still return `EINPUT`; typed registration is
unchanged. The regression models the authenticated rpcd callback shape,
including `ubus_rpc_session`, and separately asserts rejection of an unknown
field. The test also records that the HTTP `params[3]` envelope is transport
input, not a second business payload to pass into `z2k_detect_discovery_control`.

Focused checks after the fix:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-detect-rpc-boundary.test.mjs tests/ui/scanner-ui-rework.test.mjs
15 passed, 0 failed, 7 skipped
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
passed
bash -n scripts/deploy-target.sh
passed
git diff --check
passed
```

This round is committed locally only. Router/browser retest remains required;
Task 2 is not verified. No deployment, credential change, APK build, merge,
push, or branch/worktree deletion was performed.

## Fix round 4 — authenticated rpcd session metadata boundary

The supplied production evidence isolates the remaining failure to the
authenticated rpcd UCode bridge: the LuCI HTTP JSON-RPC request carries the
business body in `params[3]`, but the UCode callback receives the consumed body
as `req.args`. For authenticated calls rpcd adds its transport-only
`ubus_rpc_session` attribute to that object; direct ubus CLI calls do not have
the attribute. The typed registration was already correct, but discovery
normalization forwarded the session attribute to
`z2k_detect_discovery_control()`, whose intentional strict validator rejected
it as `EINPUT Unsupported discovery control field.`

The deterministic RED test models the real callback request as
`{ args: { dnsSource: 'agh', ubus_rpc_session: 'session-123' }, info }` and
failed because the captured business input contained `ubus_rpc_session`.
The production fix strips only that exact rpcd transport key while copying the
remaining discovery input. The existing business validator remains the owner
of discovery fields, so an unexpected canonical sibling still returns
`EINPUT`. The full JSON-RPC `params[3]` envelope is not unwrapped in UCode:
LuCI constructs it, while the registered callback boundary receives `req.args`;
passing envelope fields into the business layer would broaden the boundary.

GREEN and focused checks:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
3 passed, 0 failed

node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-detect-rpc-boundary.test.mjs tests/ui/scanner-ui-rework.test.mjs
15 passed, 0 failed, 7 skipped

node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
passed

bash -n scripts/deploy-target.sh
passed (Git Bash; WSL retry was unavailable with E_ACCESSDENIED)

node scripts/validate-knowledge.mjs
Knowledge validation passed.

git diff --check
passed
```

Implementation commit:

```text
68dae3ea fix: ignore rpcd discovery session metadata
```

Changed files in round 4:

- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `tests/product/z2k-detect-discovery-rpc-boundary.test.mjs`
- this report

The pre-existing Task 1 `ledger.md` modification remains dirty and was not
staged. Per the approved round-4 boundary, there was no router deployment,
authenticated browser retest, APK build, merge, push, credential change, or
branch/worktree deletion. Task 2 remains `NOT_VERIFIED` pending the required
authenticated LuCI browser retest; this report does not claim Task 2 verified.

## Post-fix source deploy and authenticated LuCI acceptance (2026-09-08)

The exact fix closure was deployed through the reviewed source workflow from
commit `cddc63deb83935379cea989d701258f27f2c0cd7` with
`RELOAD_RPCD=1 RESTART_RPCD=1`. The remote SHA-256 values matched the clean
closure for both manifest targets:

```text
zapret2-manager.uc       d6add17da508cd827bf81b005e0178d6c2df9619950d5dfa770aae07176dd9c1
zapret2-manager init     7fa5b2e566fae3fe984ab7d5b6f2d9a138d4f895dd2fdea0dbb4d6f2799ee72c
```

The restarted router exposed the reviewed typed registrations and rpcd PIDs
`20464` and `19466` during the source verification. The controller then used
the authenticated LuCI tab and captured the real Network request and response.
LuCI sent the canonical batch parameters with
`z2k_detect_discovery_enable({dnsSource:'auto'})`; the response batch returned
`id:9 -> ok:true, enabled:true, running:true` with a live `z2k-detect` PID.
The UI visibly reconstructed `Autodiscovery: включено и запущено · DNS: auto ·
доменов: 0`.

The same authenticated tab then sent
`z2k_detect_discovery_disable({dnsSource:'auto'})`; the response returned
`id:14 -> ok:true, enabled:false, running:false`, and the UI visibly showed
`Autodiscovery: выключено · DNS: auto · доменов: 2`. The final router state was
therefore restored to disabled/auto. Session identifiers and credentials are
not recorded.

The callback-boundary contract intentionally treats the exact
`ubus_rpc_session` key as rpcd transport metadata: rpcd adds it to the
authenticated `req.args` object before the typed callback reaches this module.
The callback boundary has no independent provenance bit with which to
distinguish that reserved key from a caller-shaped object, so the safe
contract is an exact one-key transport allowlist plus strict rejection of all
other siblings. The executable regression now runs enable, disable, and
restart through the registered callbacks for plain, nested, and authenticated
request shapes, and rejects both nested and canonical unknown siblings.

Focused boundary result after this review finding fix:

```text
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
3 passed, 0 failed
```

The earlier full focused suite remains `15 passed, 0 failed, 7 skipped`; it was
rerun before the callback-loop-only test expansion, and the boundary suite was
rerun after it. A fresh independent review is required before marking Task 2
VERIFIED.
