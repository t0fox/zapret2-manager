# Backend Core Hardening Design

## Goal

Close the backend audit findings A–V and converge RPC, service control, apply, watchdog, jobs, DNS, lists, profiles, health matrix, and proxy integration on one set of safe backend primitives.

## Scope

The manager remains a management layer around upstream zapret2. It must not duplicate DPI-bypass logic. This design changes orchestration, state handling, process execution, locking, persistence, diagnostics, and RPC contracts only.

## Architecture

### 1. Shared backend core

Create focused ucode modules under `/usr/libexec/zapret2-manager/lib/`:

- `errors.uc`: canonical `{ ok, error: { code, message, details? } }` results.
- `exec.uc`: bounded process execution, exit-status capture, stderr capture/redaction, argv-safe helpers, and timeout handling.
- `fs.uc`: secure temporary files, mode enforcement, atomic write/rename, optional fsync, bounded reads, and cleanup.
- `lock.uc`: flock-backed named locks with fail-closed fallback.
- `runtime.uc`: one canonical zapret2 process detector and nftables detector.
- `events.uc`: locked append, rotation, bounded retention, and structured events.
- `transaction.uc`: snapshot → write → restart/reload → verify → rollback.

No RPC wrapper may interpolate user data into a shell command. Request payloads cross process boundaries through files or stdin.

### 2. Declarative RPC contract

Define one method manifest containing method name, handler, parameter signature, access class (`read`, `write`, `secret`), and mutation flag. Generate the rpcd signature from this manifest and add a test that compares it with the ACL JSON.

Read ACL must not contain mutating methods. Secret reveal methods require write-level authorization plus the existing explicit confirmation token. Package installation is removed from RPC.

### 3. Persistent recovery and state

Move recovery data from `/tmp` to `/etc/zapret2-manager/recovery/` with mode 0700 and files mode 0600. Store last-good config, previous config, original enable/options, applied hashes, and transaction metadata there. Runtime caches may remain in `/tmp`, but no successful rollback may depend only on tmpfs.

Every state write uses atomic temp+rename under a lock. Missing or corrupt recovery data is an explicit error; rollback and passthrough must never report success after falling back to guessed defaults.

### 4. Unified mutation pipeline

All configuration mutations acquire one global apply lock and use `transaction.uc`. The pipeline is:

1. validate request and optimistic revision;
2. create persistent snapshot;
3. render candidate safely;
4. syntax-check candidate (`sh -n` for shell config);
5. atomically install candidate;
6. invoke the upstream sanctioned lifecycle command;
7. verify process, nftables, listener, and content hashes as appropriate;
8. persist applied baseline;
9. rollback automatically on failure and report both primary and rollback results.

The preset synchronizer may only write options when its caller explicitly requests preset application; service start/restart must not overwrite profile/orchestra/blockcheck choices.

### 5. Jobs and health matrix

Use one job engine with per-kind metadata. Job records, sequence allocation, active-job checks, and cleanup run under locks. Records are atomic JSON writes. Each kind defines its runner fingerprint and timeout. Health requests are JSON, not sourced shell env. Service IDs are validated with `^[a-z0-9][a-z0-9-]{0,62}$`.

Long DNS verification becomes a job. Synchronous DNS apply performs bounded validation and configuration installation only, then returns a job ID for probes.

### 6. Runtime observation

All callers use the canonical argv-based process detector and `nft list table inet zapret2`. Watchdog retry backoff and event cooldown are independent. CPU accounting tracks stable per-PID samples; PID churn resets the sample instead of producing aggregate spikes. Profile counting tokenizes argv and counts exact `--new` arguments.

Events use a locked bounded NDJSON writer with rotation. Hotplug, watchdog, and RPC diagnostics use the same writer.

### 7. Parsing and bounds

Status collection uses a refresh lock to prevent cache stampede. Raw command output is bounded and never returned wholesale on parse failure. DNS UCI data is read through UCI APIs rather than line-shape parsing. Hosts parsing treats all ASCII whitespace as separators.

### 8. Testing and acceptance

Add tests for every audit item, including shell injection, shell escaping, ACL/signature drift, secure temp uniqueness, symlink refusal, persistent rollback after simulated reboot, double pause, state write interruption, per-kind job recovery, concurrent sequence allocation, event retention, PID churn, exact argv token counting, status cache stampede, DNS workload bounds, UCI formatting variants, and output truncation.

The canonical gate must execute real ucode syntax/runtime tests when ucode is available and fail closed when a required target-only test is skipped. Router acceptance remains mandatory for process supervision, nftables, procd, UCI, and timeout behavior.

## Compatibility

Existing public method names remain unless they are unsafe by design. `proxy_quick_install` is removed. Secret reveal keeps its two-step confirmation but moves to privileged ACL. Error payloads become consistent; the frontend must consume `error.code` and `error.message`.

## Delivery order

1. Core primitives and regression tests.
2. RPC manifest, ACL split, and unsafe RPC removal.
3. Persistent state and transaction pipeline.
4. Service/profile/list integration.
5. Jobs/health integration.
6. Runtime/watchdog/events integration.
7. DNS async verification and UCI parsing.
8. Full CI and router acceptance evidence.
