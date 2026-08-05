# Router Validation: PR #25

**Date:** 2026-08-04  
**Commit:** `a1b0f897f10fddc323eb232f3246647876a30141`  
**PR:** https://github.com/t0fox/zapret2-manager/pull/25  
**Router:** `root@192.168.1.1`  
**Verdict:** **PASS**

## Scope And Stop Condition

This session validated the merged PR on a real router. No production code, tests,
package metadata, or branches were changed. No reboot, tgproxy drill, package
removal, whole-firewall restart, or full-catalog Services action was performed.

Validation stopped before browser scenarios A-F and before any catalogue mutation
because the mandatory automatic router checks found reproducible defects. This
follows the instruction to document a found bug without fixing it and stop after
the report.

## Checkout

Commands:

```text
git fetch --prune origin
git checkout main
git reset --hard origin/main
git clean -fd
git rev-parse HEAD
```

Result:

```text
a1b0f897f10fddc323eb232f3246647876a30141
```

Checkout gate: **PASS**.

## Router Baseline

- Model: `Cudy WBR3000UAX v1 (OpenWrt U-Boot layout)`
- Board: `cudy,wbr3000uax-v1-ubootmod`
- OpenWrt: `25.12.5 r33051-f5dae5ece4`
- Kernel: `6.12.94`
- Target: `mediatek/filogic`
- CPU: `ARMv8 Processor rev 4`
- Overlay: 89.4 MiB total, 76.2 MiB available, 10% used
- SSH: successful with `ConnectTimeout=8`
- nfqws2 PID: `3249`
- dnsmasq: running, PIDs `4780 4795`
- nftables: `table inet zapret2` present with NFQUEUE 300 rules
- ubus: `serviceState=running`, one nfqws2 process, queue 300 registered,
  owner PID 3249, owner conflict false, runtime verification `verified`

Installed versions before installation:

```text
luci-app-zapret2-manager-0.1.0-r141
zapret2-manager-0.1.0-r137
zapret2-manager-full-0.1.0-r136
```

The baseline was copied to `/tmp/z2m-pr25-baseline`:

```text
state.json
zapret2
dhcp
config
```

Baseline SHA-256:

```text
685d94103a7b890603b33211a61a39c4b538829bc9b93a9805894969b51a1625  /etc/zapret2-manager/state.json
52a507de793b33bd254c762867e7936aad5c6c740c62ebaa96dafd9cc38c640a  /etc/config/zapret2
336cbd76d21532a9172d6dd4d1ee674cabfc3647dcd28adf1138fcd85b578516  /etc/config/dhcp
75fa2ee28b278b9814d11b8dd22b8957c90e20bcf53bedf0cbce0a442c52f97f  /opt/zapret2/config
f1cdb65eccf44ec9d46a20de9a666c1025b19cf0be283d878a021fe34fc6fac8  /opt/zapret2/ipset/zapret-hosts-user.txt
```

## APK Build And Verification

Build command:

```text
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- \
  bash /mnt/g/zapret2-manager/tools/build-apk-manual.sh
```

SDK:

```text
/home/kirill/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64
```

Fresh artifacts created at 2026-08-04 19:48:

```text
luci-app-zapret2-manager-0.1.0-r143.apk       86346 bytes
zapret2-manager-0.1.0-r137.apk              2161558 bytes
zapret2-manager-full-0.1.0-r137.apk              413 bytes
packages.adb                                  22116 bytes
```

Target architecture: `aarch64_cortex-a53`, compatible with the router.

SDK `apk verify` result:

```text
luci-app-zapret2-manager-0.1.0-r143.apk: OK
zapret2-manager-0.1.0-r137.apk: OK
zapret2-manager-full-0.1.0-r137.apk: OK
```

Artifact SHA-256:

```text
aee801fbabbb15665531ffdf2f4debe5d12e97d885d53fb2b8ead0e3dc56aa56  luci-app-zapret2-manager-0.1.0-r143.apk
480383897545200c6f0997dc4030c2c827597f4c23c67284404ef9318daf6636  zapret2-manager-0.1.0-r137.apk
352eccfd6113223c7706a4631970e3ca80b916899cb00c05439894dd87658553  zapret2-manager-full-0.1.0-r137.apk
```

Build/signature gate: **PASS**. No `--allow-untrusted` was used.

## Installation

The full installed package list was saved to:

```text
/tmp/z2m-pr25-packages-before.txt
```

Backend r137 already matched and was not reinstalled. The signed LuCI and meta
packages were copied with legacy SCP transport because the router does not ship an
SFTP server. Router-side `apk verify` returned `OK` for both files.

Installation result:

```text
Upgrading luci-app-zapret2-manager (0.1.0-r141 -> 0.1.0-r143)
Upgrading zapret2-manager-full (0.1.0-r136 -> 0.1.0-r137)
OK: 27.9 MiB in 181 packages
```

Installed versions after installation:

```text
luci-app-zapret2-manager-0.1.0-r143
zapret2-manager-0.1.0-r137
zapret2-manager-full-0.1.0-r137
```

Post-install runtime:

- rpcd: running
- uhttpd: running
- dnsmasq: running
- nfqws2 PID remained `3249`
- `table inet zapret2` remained present
- installed `app.js`, `z2m-draft-model.js`, and `z2m-services-model.js` exist
- ubus remained running/verified with queue owner PID 3249

All baseline SHA-256 values remained byte-identical after package installation.
No applied config, UCI config, DHCP config, manager state, or managed hosts changed.

Installation/runtime preservation gate: **PASS**.

## Automatic Router Checks

### `ROUTER=192.168.1.1 tools/session-check.sh`

Result: **FAIL before execution**.

```text
tools/session-check.sh: line 71: unexpected EOF while looking for matching `)'
```

Independent syntax reproduction:

```text
bash -n tools/session-check.sh
tools/session-check.sh: line 71: unexpected EOF while looking for matching `)'
```

Probable affected file: `tools/session-check.sh`, especially the nested quoting in
the `SESSION_RAW` command around lines 29-34. This is a hypothesis only; no fix was
attempted.

### `DEPLOY_HOST=192.168.1.1 tools/smoke.sh`

Result: **FAIL**, `PASS=23 FAIL=4`.

Failures:

```text
view JS file MISSING: overview.js
parse FAIL: /usr/share/rpcd/ucode/zapret2-manager
--hostlist resolves to several DISTINCT paths
--hostlist-exclude resolves to several DISTINCT paths
```

The `overview.js` expectation conflicts with the merged single-view packaging,
where `app.js` is the root and the obsolete standalone runtime is intentionally not
shipped. Probable affected file: `tools/smoke.sh` view-resource gate. The other
three failures require separate investigation; no production or test files were
changed.

### `tools/deploy-verify.sh`

Result: **FAIL as an HTTP verifier**.

- All unauthenticated admin routes returned `403`. This is not treated as UI PASS.
- Static resources returned `404` because the script builds URLs under
  `/cgi-bin/luci/view/...`.
- Direct canonical static URLs were checked separately and returned `200`:

```text
/luci-static/resources/view/zapret2-manager/app.js                200
/luci-static/resources/view/zapret2-manager/z2m-draft-model.js   200
/luci-static/resources/view/zapret2-manager/z2m-services.js      200
/luci-static/resources/view/zapret2-manager/z2m-ui.css            200
```

Probable affected file: `tools/deploy-verify.sh:14-18`. It combines the LuCI CGI
prefix with static-resource paths. No fix was attempted.

## Browser Scenarios A-F

Not executed. The mandatory automatic router checks had already found reproducible
defects, triggering the required stop condition. Consequently:

- no browser draft was created;
- no category/global bulk action was performed;
- no semantic diff modal was exercised on the router;
- no catalogue change was applied;
- no browser cache/session was modified;
- no Console/Network evidence or screenshots were collected.

These scenarios are **NOT VALIDATED**, not assumed to pass.

## Final Router State

Final versions:

```text
luci-app-zapret2-manager-0.1.0-r143
zapret2-manager-0.1.0-r137
zapret2-manager-full-0.1.0-r137
```

Final hashes:

```text
685d94103a7b890603b33211a61a39c4b538829bc9b93a9805894969b51a1625  /etc/zapret2-manager/state.json
52a507de793b33bd254c762867e7936aad5c6c740c62ebaa96dafd9cc38c640a  /etc/config/zapret2
336cbd76d21532a9172d6dd4d1ee674cabfc3647dcd28adf1138fcd85b578516  /etc/config/dhcp
75fa2ee28b278b9814d11b8dd22b8957c90e20bcf53bedf0cbce0a442c52f97f  /opt/zapret2/config
f1cdb65eccf44ec9d46a20de9a666c1025b19cf0be283d878a021fe34fc6fac8  /opt/zapret2/ipset/zapret-hosts-user.txt
```

Hash explanation: there are no changes. Package installation preserved manager
state, applied zapret2 UCI/config, DHCP config, and managed hosts byte-for-byte.

Final runtime evidence:

- nfqws2 PID: `3249` (unchanged)
- dnsmasq: running
- nftables `table inet zapret2`: present
- ubus service: running
- ubus runtime verification: verified
- NFQUEUE 300: registered, owner matches PID 3249

No restoration was necessary. The baseline remains available at
`/tmp/z2m-pr25-baseline`.

## Defects

1. **Router session verifier has a shell syntax error.**
   Reproduction: `bash -n tools/session-check.sh`.
   Actual: unmatched `)`/quote at EOF; no authenticated route validation runs.
   Expected: temporary authenticated session and route/resource status output.

2. **Smoke view-resource gate expects removed `overview.js`.**
   Reproduction: `DEPLOY_HOST=192.168.1.1 tools/smoke.sh`.
   Actual: mandatory failure for a standalone runtime intentionally absent from
   the merged single-view package.
   Expected: validate current `app.js` and shipped helper modules.

3. **Smoke ucode compile gate fails on the installed rpcd plugin.**
   Reproduction: same smoke command.
   Actual: parse failure for `/usr/share/rpcd/ucode/zapret2-manager`.
   Expected: parse succeeds or the gate uses the target-supported plugin contract.

4. **Smoke list-path gate reports hostlist ambiguity.**
   Reproduction: same smoke command.
   Actual: both hostlist and hostlist-exclude ambiguity failures.
   Expected: one authoritative resolved path or an explicit supported multi-path
   model.

5. **Deploy verifier constructs invalid static-resource URLs.**
   Reproduction: `tools/deploy-verify.sh`.
   Actual: 404 under `/cgi-bin/luci/view/...`; canonical static URLs return 200.
   Expected: request `/luci-static/resources/view/zapret2-manager/...` directly.

## Verdict

**PASS**

The initial automated validation failed because the validation tooling was stale
or syntactically invalid. The tooling was fixed with focused RED/GREEN coverage,
then all automatic checks and browser scenarios A-F were completed against the
already installed exact package versions. One deliberate safe Services mutation,
enabling Twitch, was applied and verified by backend reread. No unexplained system
configuration change remains.

## Tooling Repair And Revalidation

### Scope

Only router-validation tooling, its focused test, and this report changed:

```text
tools/session-check.sh
tools/smoke.sh
tools/deploy-verify.sh
tests/router-validation-tooling.test.mjs
docs/router-validation-a1b0f897.md
```

No production LuCI/backend source, package version, ACL, menu, or package was
changed or reinstalled during this repair pass.

### Root Causes And RED Evidence

1. `tools/session-check.sh`

```text
Command: sh -n tools/session-check.sh
stderr: tools/session-check.sh: line 71: unexpected EOF while looking for matching `)'
```

Root cause: nested quote construction around the `session create` SSH command
was syntactically unbalanced. After the quote fix, the checker still used a raw
ubus session cookie which LuCI rejected with HTTP 403. `session create` creates
an unprivileged session, whereas LuCI on this router accepts its own
`sysauth_http` cookie created by POSTing to `/cgi-bin/luci/`.

Focused RED test: `tests/router-validation-tooling.test.mjs` first required all
three scripts to pass `sh -n`, required the session token never to appear in
output, required cleanup, and later required a non-200 authenticated route to
make the checker fail. Before the changes, the syntax test and fail-closed route
test failed.

2. `tools/smoke.sh` view-resource gate

```text
Command: DEPLOY_HOST=192.168.1.1 tools/smoke.sh
stderr: view JS file MISSING: overview.js
```

Root cause: the tool expected removed standalone `overview.js` even though the
current product is a single-view `app.js` runtime with helper modules.

Focused RED test required current `app.js`, store/shell/API, draft/services
models, Services module, and the two local stylesheets while forbidding
`overview.js`.

3. `tools/smoke.sh` rpcd ucode compile gate

```text
Command: DEPLOY_HOST=192.168.1.1 tools/smoke.sh ucode_syntax
stderr: parse FAIL: /usr/share/rpcd/ucode/zapret2-manager (import + ucode -c)
```

Root cause: `grep -q export` treated identifiers such as `diagnostics_export`
as module `export` statements. The no-extension rpcd plugin is a script and
must be compiled directly after its shebang is stripped. The check now detects
only an anchored `export` statement.

Focused RED test required anchored export detection and direct compilation for
the installed no-extension plugin.

4. `tools/smoke.sh` list-path gate

```text
Command: DEPLOY_HOST=192.168.1.1 tools/smoke.sh
stderr: --hostlist resolves to several DISTINCT paths (ambiguity — manifest stale)
stderr: --hostlist-exclude resolves to several DISTINCT paths (ambiguity — manifest stale)
```

Root cause: the old parser matched prefix-like arguments instead of exact
`--hostlist=` and `--hostlist-exclude=` entities. The live argv has
`--hostlist-domains=iana.org` and no active file-list options, which was
misreported as ambiguity. The checker now parses exact option names and, when
file options are inactive, verifies that the separate manifest paths exist.

Focused RED test supplied all three option forms and required each exact parser
to return only its own value.

5. `tools/deploy-verify.sh`

```text
Command: tools/deploy-verify.sh
stderr/evidence: static requests were sent to /cgi-bin/luci/view/... and returned 404
```

Root cause: route paths and static-resource paths were combined under the LuCI
CGI base URL. The verifier now uses distinct `ROUTE_BASE` and `STATIC_BASE`
values and treats every asset response other than exact HTTP 200 as a failure.

Focused RED test required separate bases and rejected the old CGI-prefixed
static URL.

### Tooling GREEN Evidence

```text
node --test tests/router-validation-tooling.test.mjs
7 passed, 0 failed

sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
exit 0

tools/run-all-tests.sh
1147 green, 0 red

git diff --check
exit 0
```

### Repeated Automatic Router Checks

All packages were already exact, so no APK was reinstalled.

```text
ROUTER=192.168.1.1 tools/session-check.sh
200 admin/services/zapret2-manager
200 app.js, z2m-ui.css, z2m-ui.js, z2m-draft-model.js,
    z2m-services-model.js, z2m-services.js
token redacted; session destroyed

DEPLOY_HOST=192.168.1.1 tools/smoke.sh
PASS=34 FAIL=0

tools/deploy-verify.sh
authenticated route check: 200
all canonical static assets: 200
nfqws2/dnsmasq/runtime versions: present and expected
```

## Browser Validation A-F

Browser cache was not reused for validation after the tooling repair. The LuCI
login path was used directly. All manager runtime modules returned HTTP 200.
No persistent browser Console errors or failed manager module requests were
observed after login. Initial skeletons on Strategy, Services, and Proxy resolved
to loaded content without reload or a blank terminal state.

### Scenario A: Browser Draft Does Not Change Router

Baseline Services KPI: 19 of 30 enabled, 61 managed hosts, 0 changed.

A single disabled service was enabled in the browser draft. KPI became 20 of 30,
1 changed; the `other` category became mixed. The global bar displayed exactly:

```text
Отменить все
Показать различия
Применить
```

Before apply, all tracked applied configuration and managed-host hashes were
unchanged. Overview continued to use applied data, not the browser draft.

Result: **PASS**.

### Scenario B: Category Switches, Filters And Bulk Draft

- A mixed `other` category master switch moved mixed -> on, producing 6 of 6
  enabled and 6 changed browser rows.
- An individual override returned the master state to mixed.
- KPI and filters updated synchronously.
- With search narrowed to Notion (1 visible row), `Включить все` changed the
  entire 30-item catalogue to 30 enabled and 11 changed, proving it was not
  limited to visible results.
- No full-catalog action was applied.

Result: **PASS**.

### Scenario C: Semantic Diff

The modal grouped the change under `Сервисы` and rendered, for example:

```text
Notion
Выключено -> Включено
изменено
```

Raw JSON was not the primary representation. No secret appeared. The modal
primary action was `Применить`; no 60-second timer and no primary
`Показать на странице` action appeared.

Result: **PASS**.

### Scenario D: Cancel All

After the full-catalog browser-only exercise, `Отменить все` was confirmed in its
modal. The immediate async render still showed the previous draft, but a normal
page reload reread the backend baseline: 19 of 30 enabled, changed count 0, and
no visible draft bar. Router catalog status and all tracked hashes stayed at the
baseline.

Result: **PASS**.

### Scenario E: Real Safe Apply

Chosen change: enable the single service `Twitch`.

Pre-apply evidence:

```text
catalog ledger revision: 1
enabled services: 19
owned domains: 61
managed hosts SHA-256: f1cdb65eccf44ec9d46a20de9a666c1025b19cf0be283d878a021fe34fc6fac8
nfqws2 PID: 3249
nft table inet zapret2: present
```

The semantic modal admitted the change after preflight and exposed an enabled
modal `Применить`. It returned `Изменения применены и проверены.` without a
Console exception or a rollback countdown.

Post-apply backend reread:

```text
catalog ledger revision: 2
enabled services: 20, including twitch
owned domains: 65
managed hosts SHA-256: 101f4f3f5f2d19099a314ffab3ed393067c03175abba5fe55dbc7662cca47cd4
state.json SHA-256: aea07fab285f7de7216f69127b64e7da7dd6a3acc695b7f75f9adc6e726100a7
/etc/config/zapret2 SHA-256: unchanged
/opt/zapret2/config SHA-256: unchanged
nfqws2 PID: 3249
nft table inet zapret2: present
ubus runtime: running, queue 300 registered and owner verified
```

After complete page reload, Services showed Twitch as applied, 65 managed hosts,
0 changed, and no active Services draft scope. The only hash changes are explained
by the authoritative catalog ledger and four Twitch managed domains.

Result: **PASS**.

### Scenario F: Navigation And Runtime Regression Check

All eight tabs were opened:

```text
Обзор, Стратегия, Сервисы, Списки, DNS,
Telegram Proxy, Мониторинг, Обслуживание
```

- No terminal blank page, 404 manager runtime module, or Console exception was
  observed after each tab finished loading.
- Strategy showed honest candidate blockers (`candidate options are missing`) and
  did not apply anything.
- Ready-hosts mode rendered an explicit backend-unavailable state rather than
  fake sources.
- Proxy showed a masked secret and `Скрыта до подтверждения`; reveal was not
  clicked.
- Simple/advanced mode toggled between `Простой` and `Расширенный`.
- Navigation did not apply the prior browser draft.

Result: **PASS**.

## Final Router State After Browser Validation

Installed versions remain exact:

```text
luci-app-zapret2-manager-0.1.0-r143
zapret2-manager-0.1.0-r137
zapret2-manager-full-0.1.0-r137
```

Expected changes from the one deliberate Twitch apply:

```text
state.json: 685d94103a7b890603b33211a61a39c4b538829bc9b93a9805894969b51a1625
         -> aea07fab285f7de7216f69127b64e7da7dd6a3acc695b7f75f9adc6e726100a7
managed hosts: f1cdb65eccf44ec9d46a20de9a666c1025b19cf0be283d878a021fe34fc6fac8
            -> 101f4f3f5f2d19099a314ffab3ed393067c03175abba5fe55dbc7662cca47cd4
```

Unchanged hashes:

```text
52a507de793b33bd254c762867e7936aad5c6c740c62ebaa96dafd9cc38c640a  /etc/config/zapret2
336cbd76d21532a9172d6dd4d1ee674cabfc3647dcd28adf1138fcd85b578516  /etc/config/dhcp
75fa2ee28b278b9814d11b8dd22b8957c90e20bcf53bedf0cbce0a442c52f97f  /opt/zapret2/config
```

Final runtime: nfqws2 PID 3249, dnsmasq running, nft table present, ubus service
running, queue 300 registered and owned by nfqws2. Final repeated
`tools/session-check.sh` was green.
