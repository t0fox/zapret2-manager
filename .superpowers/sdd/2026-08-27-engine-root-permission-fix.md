---
id: engine-root-permission-fix
title: "Engine manager-root permission fix"
type: handoff
status: live
authority: evidence
updated: 2026-08-27
publish: false
tags: [engine, permissions, router, regression]
---

# Engine manager-root permission fix

## Root cause

`engine-catalog.uc` used one generic `ensure_dir()` for both private cache
directories and `/etc/zapret2-manager`. That helper unconditionally ran
`chmod 700`, so `engine-manager.uc:commit_state()` could remove the execute
permission required by the non-root `nfqws2` daemon (UID 1) to traverse to
`lists/whitelist.txt`.

## Writer trace

| Path | Operation | Contract result |
|---|---|---|
| `engine-catalog.uc` | `save_engine_state()` previously passed the manager root to `ensure_dir()` | Authoritative production writer; now uses `ensure_manager_root()` and exact `0701` |
| `engine-catalog.uc` | Generic `ensure_dir()` for `engine-cache` and `/tmp` check state | Remains private `0700`; it no longer receives the manager root |
| `engine-providers.uc` | Retained legacy `save_engine_provider_state()` previously passed the manager root to the same unsafe helper | No production importer remains, but its shipped writer now also enforces `0701` |
| `engine-operation-worker.sh` | `mkdir -p /etc/zapret2-manager` during backup restore | Does not chmod an existing root and cannot narrow its mode |
| `service.uc`, `discord-profile-cli.uc`, `dns-global.uc`, `strategy-catalog.uc` | Root or child `mkdir`/`mkdir -p` only | No mode regression of an existing manager root |
| `Makefile` and package postinst | File modes, child directory setup, and package bootstrap | No root `chmod 0700`; private files and child directories remain private |
| `src/z2m-root-bootstrap.c` | Opens/creates managed child roots | Enforces child roots at `0700`; it does not chmod the manager root |

## Permission contract

- `/etc/zapret2-manager` is exactly `0701`: root has `rwx`, group has no
  access, and other users have execute-only traversal.
- `engine-state.json` remains `0600`.
- Private managed state roots remain `0700`.
- `lists/whitelist.txt` keeps its intended readable mode; traversal is the
  only permission added to the manager root.
- A failed root permission repair now fails `save_engine_state()` instead of
  writing state while leaving the runtime path broken.

## Source changes

- `zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc`
  separates private directory setup from manager-root setup, makes state-path
  resolution testable without changing the production default, and makes
  repeated state commits idempotently enforce `0701`.
- `zapret2-manager/files/usr/libexec/zapret2-manager/engine-providers.uc`
  removes its remaining direct unsafe manager-root writer.
- `tests/product/engine-state-permissions.test.mjs` performs three repeated
  state commits, checks exact `0701`, checks `0600` private state, reads the
  whitelist as UID 1, and rejects a private-state read as UID 65534.

## Local evidence

Focused command:

```text
node --test tests/product/engine-state-permissions.test.mjs tests/product/engine-stock-authority.test.mjs tests/product/engine-worker-transaction.test.mjs tests/native/bootstrap.test.mjs tests/ui/system-diagnostics-consolidation.test.mjs
```

Result: **23 tests, 23 passed, 0 failed**.

`git diff --check` passed. The repository validator still reports the
pre-existing unrelated issue:
`docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md: missing frontmatter`.

## Router evidence

- Only the two source writers were deployed, using same-directory temporary
  files and atomic `mv`; no package install or reboot was performed.
- Final deployed SHA-256 values matched the worktree:
  - `engine-catalog.uc`: `47f0d7437cff181f282afee80fdf70bf7a20130aa40a58125fa1e58223634746`
  - `engine-providers.uc`: `811f9e7109227a2764bc4249e7d1231d8a0b31c55aec58581ffabfc875ef5473`
- A real official `v1.0.4` reinstall transaction ran after the final source
  deployment: operation `eng-1787842766-5331d84d2339`, terminal phase
  `completed`, including `commit_state` and postflight.
- No manual chmod was run after the final source deployment. The commit path
  itself produced `drwx-----x` (`0701`) on `/etc/zapret2-manager`.
- `engine-state.json`: `0600`; `whitelist.txt`: `0644`.
- Running `nfqws2` reported `Uid: 1 1 1 1` and its command line contained
  `whitelist.txt`.
- `service.uc restart` returned `rc=0`.
- `nfqws2_count=1`.
- `QUEUE300=yes`.
- `NFT=yes`.
- `NFQWS2_ENABLE=1`.
- `paused` was absent.
- No `Permission denied` entries were present in the runtime log scan.
- `state.tsv` MD5 before and after: `a7f2a248e5b99f8b06b32ff95cd68620`.
- Egress probes: Google generate-204 `204`, Cloudflare trace `200`, ya.ru
  `302`.

## Scope boundary

UI Tasks 10-19 were not touched. Native foundation failures inherited from
`main` remain a separate upstream blocker and were not modified here.
