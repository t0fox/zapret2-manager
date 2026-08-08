# Task 4 Report: Transport-v1 Framing And Original Cases

## Status

**PASS.** The complete spike passed 54/54 cases with zero skips on the exact
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

## Exact Evidence

- Clean executable input: `347278194579bdbc3a822a9aaf538a36dfe4976d`
- Pre-run porcelain: empty
- Full raw TAP: `tests/native/core/native-helper-broker-exact-target.tap`
- Reconstructable metadata: `tests/native/core/native-helper-broker-exact-target-evidence.txt`
- Full exact-target result: 54 tests, 54 pass, 0 fail, 0 skipped
- Strict target builds: `-std=c11 -Wall -Wextra -Werror`

The evidence records all source, compiled binary, module, package, and raw TAP
hashes plus architecture, environment paths, timestamp, invocation, and exit 0.

## Verification

- Exact AArch64 UID0 full suite: PASS 54/54, zero skips.
- Package/static evidence suite: PASS 24/24, zero skips.
- Raw TAP capture comparison: byte-identical (`cmp` exit 0).
- `git diff --check`: PASS.

## Commits

- Reviewer fixes and executable clean input:
  `347278194579bdbc3a822a9aaf538a36dfe4976d`
- Evidence/report commit: the completing commit containing this report.

## Concerns

- This remains spike-only code and test instrumentation, not production design.
- Request-header strictness in the C spike intentionally recognizes the fixed
  exact test header and explicit adversarial fixtures; production parsing remains
  Task 5 scope and was not started.
- No blocker remains for Task 4 itself.
