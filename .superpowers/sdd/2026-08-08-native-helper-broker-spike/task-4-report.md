# Task 4 Report: Transport-v1 Framing And Original Cases

## Status

**PASS.** Fix round 3 passed 90/90 cases with zero skips on the exact
AArch64 OpenWrt musl target under real UID 0. The earlier claimed socket API
blocker was a C control-flow defect. No production Task 5+, procd, adapter, or M4
work was started.

## Root Cause Correction

`read_request_frame()` omitted braces around invalid-prelude handling. Only the
diagnostic `fprintf()` was conditional; `return false` executed for every valid
prelude.

Focused exact-target RED instrumentation showed:

```text
server: request-frame=prelude header=76 body=4194304
client: sendNullErrno=32 (EPIPE)
client: sendPollRevents=[28] (POLLOUT|POLLERR|POLLHUP)
client: shortWrites=1, recvCalls=0, bytesRead=0
```

After adding only braces, with chunk size, send flags, and deadline unchanged:

```text
client: sendNullErrno=11 (EAGAIN)
client: sendPollRevents=[4] (POLLOUT)
server: prelude header=76 body=4194304
server: header bytes=76
server: body bytes=1278944, 2192544, 3361952, 4194304
```

The prior report's API limitation and EAGAIN attribution were false. Null send
is now labeled only from immediate numeric `socket.error(true)` evidence.

## Independent Findings Fixed

- Restored blocking child pipe ends and made only parent pump ends nonblocking.
- Separated transport frame overhead from the helper stdout cap. A legal 6 MiB
  stdout passes; stdout cap plus one returns reaped `transport_failure`.
- Every malformed request asserts exact parser stage and reason.
- Request parsing requires real EOF after one frame; `EAGAIN` is not EOF.
- Before-exec disconnect returns before pipe creation/fork. After-exec disconnect
  proves status-pipe EOF/start, TERM, and reap.
- Strict response validation checks raw duplicate keys, exact outcome-dependent
  fields, types, protocol/request identity, closed enums, body split, EOF/reap,
  and lifecycle compatibility.
- Added malformed, duplicate, unknown-field, wrong-type, unknown-outcome,
  wrong-ID, lifecycle-contradiction, trailing, and truncated response cases.
- Scoped instrumentation so stderr backpressure cannot perturb 100-request proof.

## Review Fix Round 2

- Duplicate-key scanning now covers every allowed response header key before
  JSON collapse, including outcome, lengths, lifecycle fields, stage, and reason.
- The outcome matrix has exact outcome-specific field sets and lifecycle rules.
  Timeout forbids exit code; pre-start failures forbid exit/signal metadata;
  transport failures define compatible not-started/started/unknown states.
- Stage and reason values are closed enums. Stderr truncation is equivalent to
  drained bytes exceeding retained bytes, and non-truncation requires equality.
- Before-exec disconnect is observed from kernel peer HUP/error after a complete
  request and full client close. Server evidence records fork count zero before
  returning; the old unconditional fixture branch is gone.
- Response lengths are decoded arithmetically as unsigned 32-bit values. High-bit
  and `0xffffffff` header/body lengths reject before addition or substring use.
- The long-lived server measures its own descriptors before and after 100 child
  requests and reports 100 forks; both client and server counts must be unchanged.
- Static evidence now reads each source blob from the recorded executed input
  commit and hashes that blob, rather than checking only the current working tree.

## Review Fix Round 3

- Replaced raw key-token searching with a pre-collapse top-level JSON key
  scanner. It decodes standard escapes and UTF-16 surrogate pairs to canonical
  UTF-8, then compares decoded key identities before `json()` can collapse them.
- Added escaped-equivalent duplicates for `outcome`, `stdoutLength`, and
  `childReaped`, plus invalid escape and unpaired high/low surrogate cases.
- Split `spawn_failure` lifecycle by stage: `fork` means no child existed and
  requires `childReaped:false`; `exec` means an intermediate child existed and
  requires proven reap. Setup failures also require proven reap.
- Added an injected framed fork-failure exact-target case. It closes all created
  pipe resources, returns no exit/signal metadata, reports `forks=0`, and is
  accepted by the strict response validator.

## Exact Evidence

- Clean executable input: `7d570e095d09479ee9a0bb5e149b34fc0b1d88c1`
- Pre-run porcelain: empty
- Full raw TAP: `tests/native/core/native-helper-broker-exact-target.tap`
- Reconstructable metadata: `tests/native/core/native-helper-broker-exact-target-evidence.txt`
- Full exact-target result: 90 tests, 90 pass, 0 fail, 0 skipped
- Strict target builds: `-std=c11 -Wall -Wextra -Werror`

The evidence records all source, compiled binary, module, package, and raw TAP
hashes plus architecture, environment paths, timestamp, invocation, and exit 0.

## Verification

- Exact AArch64 UID0 full suite: PASS 90/90, zero skips.
- Package/static evidence suite: PASS 25/25, zero skips.
- Raw TAP capture comparison: byte-identical (`cmp` exit 0).
- `git diff --check`: PASS.

## Commits

- Reviewer fixes and executable clean input:
  `7d570e095d09479ee9a0bb5e149b34fc0b1d88c1`
- Evidence/report commit: the completing commit containing this report.

## Concerns

- This remains spike-only code and test instrumentation, not production design.
- Request-header strictness in the C spike intentionally recognizes the fixed
  exact test header and explicit adversarial fixtures; production parsing remains
  Task 5 scope and was not started.
- No blocker remains for Task 4 itself.
