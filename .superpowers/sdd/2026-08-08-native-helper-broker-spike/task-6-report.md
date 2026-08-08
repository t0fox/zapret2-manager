# Task 6 Report: procd Broker Lifecycle

## Status

**PASS.** Commit `df8201ee5f92e3d4861c436fe67819b1a6c5f3b5` implements Task 6 only. The
service now performs fail-closed managed-root bootstrap before declaring named
`helperd` and `watchdog` procd instances. Each instance has its own respawn
policy and bounded termination, and helperd is launched directly from its fixed
installed path.

Task 7 adapter, Task 8 gate replacement, and M4 were not started.

## Implementation

- Added fixed `HELPERD=/usr/libexec/zapret2-manager/z2m-helperd`.
- Preserved `"$BOOTSTRAP" all || return $?` as the first `start_service()`
  action and preserved the existing `check()` bootstrap and watchdog behavior.
- Declared named `helperd` before named `watchdog` without adding a readiness
  wait or treating declaration order as a readiness acknowledgment.
- Configured both instances independently with `respawn 60 5 5`,
  `term_timeout 10`, stdout/stderr forwarding, and the existing core limit.
- Passed helperd as direct fixed argv to procd; no shell command construction,
  `eval`, or command append path was introduced.

## TDD Evidence

The initial RED runs failed for the intended missing lifecycle behavior:

- `bootstrap.test.mjs` recorded one unnamed watchdog, no helperd declaration,
  and no bounded `term_timeout`.
- `package-helper.test.mjs` could not find the fixed helperd path or named
  lifecycle declarations.

After the init-script change, the executable shell harness proves exact call
ordering and independent parameters. It also injects bootstrap exit 73 and
proves no procd declaration occurs after bootstrap failure. Static package
coverage rejects helperd shell construction and readiness polling.

## Exact Verification

```sh
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=safe.directory \
GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node --test \
  tests/native/bootstrap.test.mjs \
  tests/native/package-helper.test.mjs
# 39 tests, 39 pass, 0 fail, 0 skipped

GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=safe.directory \
GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
scripts/test/native-root.sh \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
# 97 tests, 97 pass, 0 fail, 0 skipped

sh -n zapret2-manager/files/etc/init.d/zapret2-manager
# PASS

git diff --check
# PASS
```

The focused and root commands were run as WSL root. The process-local
`safe.directory` values were required only because root does not own the linked
worktree; no Git configuration was changed.

## Concerns

- Declaration order intentionally provides no readiness guarantee. Task 6 does
  not add an adapter or any consumer that assumes the helper socket is ready
  when watchdog is declared.
- The chosen 10-second procd termination bound is longer than the broker's own
  bounded child cleanup path and prevents an unbounded service stop.
- The first plain combined root run had one pre-existing evidence-test failure
  from Git's dubious-ownership protection. The identical suite passed 39/39
  with the process-local `safe.directory` setting shown above.
- WSL Git lacked an author identity. The implementation commit reused the
  existing repository identity (`OpenCode <opencode@local>`) through command
  environment variables; global and repository Git config were not modified.
