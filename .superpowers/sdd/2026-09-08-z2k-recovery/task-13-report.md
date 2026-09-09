# Task 13 report — canonical Components lifecycle UX

Date: 2026-09-09
Execution branch: `codex/z2k-recovery-v2`
Implementation commit: `f1be5ff4`

## Scope

Task 13 makes terminal Z2K lifecycle state authoritative from a canonical
re-read, persists accepted asynchronous operation ids across reloads, keeps
initiating failure separate from rollback evidence, and exposes same-release
repair through the existing transaction. It does not add a second lifecycle
owner or change the Avatar strategy implementation.

## Automated evidence

- Focused host/WSL command: `54 tests, 54 passed, 0 failed, 0 skipped`.
- WSL run used the canonical UCode binary and `/opt/ucode/lib` with
  `--test-concurrency=1`.
- `node --check` passed for the changed JavaScript files.
- `git diff --check` passed before commit.
- The broader historical UI suite still contains the four Task 1 baseline
  failures in `z2k-version-ux-behavior.test.mjs`; those are not attributed to
  Task 13 and are not claimed green here.

## Source-only router deployment

The repository deploy helper could not consume the Windows worktree `.git`
file from WSL, so the reviewed five-path manifest
`.superpowers/sdd/2026-09-08-z2k-recovery/task-13.deploy.manifest` was deployed
manually. Each target was backed up, copied, mode/ownership checked, and
verified by SHA-256. The router `rpcd` was restarted successfully (new PID
`12591`). Local and remote hashes were:

| Source | SHA-256 |
| --- | --- |
| `z2m-api.js` | `2f1720aba049a22106dce2d74e2349871315751c90cfa632449d1a96f42e3a76` |
| `z2m-maintenance.js` | `934ac0526d06b7171db7ef29ba8533a04949018ca611d3e24fc5430739e5dfab` |
| `resource-update-cli.uc` | `6c3acab4d2ee9191e7addd678eb21ce85262d51a52ab91b777d121bfac879eb2` |
| `resource-update.uc` | `6d6344b319f02f23b6e92fb9478893c0c58d2b39fdc28ea492bf6a424646033b` |
| `zapret2-manager.uc` | `e7b24db1f9fc2ea7e27c92e8be1ad1ea3b374543181acf726619445b55820454` |

## Browser and runtime evidence

Authenticated LuCI was opened as `root` with the existing empty password; no
password was created or changed. On the Strategies route, the Avatar card
`z2k всё-в-одном (TLS/HTTP + QUIC + Discord)` was confirmed through the real
confirmation dialog. The resulting page state showed:

- active card: `z2k всё-в-одном (TLS/HTTP + QUIC + Discord)`;
- `Выбрана Применена Используется сейчас`;
- source: `Avatar`;
- the filtered Avatar card also showed `Используется сейчас`;
- a hard reload retained the same state and removed the transient completion
  toast.

The immediate mutation response displayed `Стратегия применена`; it also
showed a transient background-status warning. A hard reload and direct RPC
read were clean, so the warning is recorded rather than hidden and is not
treated as a lifecycle failure.

Direct router evidence after the apply:

- `status_fast`: `ok:true`, `serviceState:"running"`;
- one `/opt/zapret2/nfq2/nfqws2` instance, PID `13282`;
- NFQUEUE `300` registered with the running process as owner;
- `strategyStatus.id:"avatar:z2k_all_in_one"`, origin `avatar_builtin`;
- the embedded applied config digest matches `sha256sum /opt/zapret2/config`.

The Components route was also loaded after deployment and rendered its
canonical single-card state without a stuck loading surface. The router's Z2K
identity remains unconfirmed on this old source-only runtime and is not
claimed as a Task 13 identity PASS.

## Delivery boundary

No local APK was built. APK work remains CI-only. No push, merge, branch
deletion, or worktree deletion was performed.

**Ruling:** Task 13 is `VERIFIED` for its canonical lifecycle/browser scope;
the separately observed baseline UI failures and the router's pre-existing
unconfirmed Z2K package identity remain deferred to the later planned gates.
