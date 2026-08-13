---
id: native-backend-v1
title: "Native Backend Contract v1"
type: contract
status: normative
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [contract, native-backend]
---
# Native Backend Contract v1

Status: frozen at repository commit
`304728c4fb5e49252247d9f80c27becec89cfe41`.

This contract is the compatibility boundary for the native backend rewrite.
Field names, types, enums, and ownership rules in this document are immutable
for version 1. New optional fields may be added, but changing or removing a v1
field requires a new contract version.

JSON examples use integers for counters and generations, RFC 3339 UTC strings
for timestamps, lowercase hexadecimal strings for SHA-256 values, and `null`
only where it is shown explicitly.

## State Envelope

Every state snapshot has this exact top-level shape:

```json
{
  "schemaVersion": 1,
  "generation": 42,
  "generatedAt": "2026-08-06T12:00:00Z",
  "serviceState": "running",
  "runtime": {
    "processes": [],
    "namespaces": []
  },
  "transactions": [],
  "jobs": [],
  "warnings": []
}
```

- `schemaVersion` is the integer `1`.
- `generation` is a non-negative integer. A committed mutation increments it
  exactly once; observation alone never increments it.
- `generatedAt` is the snapshot timestamp.
- `serviceState` is one of `engine_missing`, `running`, `stopped`, `partial`,
  `error`, `paused`, or `passthrough`.
- `runtime.processes` contains Process Identity objects.
- `runtime.namespaces` contains Namespace Ownership objects.
- `transactions` contains Transaction objects described below.
- `jobs` contains Job objects described below.
- `warnings` is an array of `{ "code": string, "message": string }` objects.

Unknown evidence is represented by `null` in the evidence field, never by a
fabricated zero, empty object, healthy state, or successful envelope.

## RPC Envelope

Every successful RPC response has this shape:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "generation": 42,
  "data": {}
}
```

Every rejected or failed RPC response has this shape:

```json
{
  "ok": false,
  "schemaVersion": 1,
  "generation": 42,
  "error": {
    "code": "ECONFLICT",
    "message": "A conflicting mutation is active.",
    "details": {}
  }
}
```

`ok`, `schemaVersion`, and `generation` are required. Exactly one of `data` or
`error` is present. `error.code` and `error.message` are required strings;
`error.details` is an optional object. Callers branch only on `error.code` and
must not parse `error.message`. Transport failures remain transport failures
and must not be converted into `{ "ok": true }` responses.

## Process Identity

A process is identified only by the complete tuple
`pid,startTime,exe,argvSha256,owner,generation`:

```json
{
  "pid": 1234,
  "startTime": 987654,
  "exe": "/opt/zapret2/nfqws2",
  "argvSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "owner": "runtime/nfqws2",
  "generation": 42
}
```

`pid`, `startTime`, and `generation` are non-negative integers. `startTime` is
the process start tick from `/proc/<pid>/stat`; it is not wall-clock time.
`exe` is the resolved absolute executable path. `argvSha256` is the SHA-256 of
the NUL-delimited argv bytes. `owner` is the manager namespace that launched or
adopted the process. PID alone never proves identity. Before signal, adoption,
cleanup, or ownership transfer, all six fields must still match.

## Namespace Ownership

Each mutable namespace has exactly one ownership record:

```json
{
  "namespace": "config/global",
  "owner": "transaction/01J4NATIVE",
  "generation": 42,
  "acquiredAt": "2026-08-06T12:00:00Z",
  "process": null
}
```

`namespace`, `owner`, `generation`, and `acquiredAt` are required. `process` is
either `null` or a complete Process Identity object. Namespace names are
canonical slash-delimited strings. A namespace may not have two owners in the
same generation. Acquisition is compare-and-swap against both owner and
generation; stale owners cannot write, release, signal, or clean up resources.
Child namespaces do not bypass ownership of a held parent namespace.

## Transaction Phases

A transaction has this exact shape:

```json
{
  "id": "01J4NATIVE",
  "kind": "config_apply",
  "phase": "verifying",
  "generation": 42,
  "namespaces": ["config/global"],
  "createdAt": "2026-08-06T12:00:00Z",
  "updatedAt": "2026-08-06T12:00:01Z",
  "error": null
}
```

The closed phase enum is:

`queued|validating|snapshotting|rendering|checking|installing|activating|verifying|committing|succeeded|failed|rolling_back|rolled_back`

Forward execution follows the enum order from `queued` through `succeeded`.
Validation failures may transition to `failed` before installation. Any failure
after mutation begins transitions to `rolling_back`, then to `rolled_back` only
after rollback verification succeeds; an unsuccessful rollback terminates as
`failed` with both primary and rollback errors in `error.details`. A terminal
phase never returns to a non-terminal phase. The generation is committed only
by `committing` to `succeeded`.

## Job States

A job has this exact shape:

```json
{
  "id": "01J4JOB",
  "kind": "dns_verify",
  "state": "running",
  "generation": 42,
  "owner": "jobs/dns_verify",
  "createdAt": "2026-08-06T12:00:00Z",
  "updatedAt": "2026-08-06T12:00:01Z",
  "result": null,
  "error": null
}
```

The closed state enum is:

`queued|running|succeeded|failed|cancelling|cancelled|rolling_back|rolled_back`

Allowed transitions are:

```text
queued -> running | cancelling
running -> succeeded | failed | cancelling | rolling_back
cancelling -> cancelled | rolling_back
rolling_back -> rolled_back | failed
```

`succeeded`, `failed`, `cancelled`, and `rolled_back` are terminal. `result` is
`null` until successful completion and otherwise is an object. `error` is
`null` unless the job fails and otherwise has the RPC error shape. Cancellation
is a request represented by `cancelling`; it is never reported as `cancelled`
until the worker and owned resources are verified stopped. Job IDs are opaque.
