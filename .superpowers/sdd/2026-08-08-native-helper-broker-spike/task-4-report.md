# Task 4 Report: Transport-v1 Framing And Original Cases

## Status

**M3 BLOCKED.** The strict transport-v1 spike was implemented and run on the
exact AArch64 OpenWrt musl target under real UID 0. The mandatory 4 MiB framed
request fails at the ucode AF_UNIX send boundary. Production Tasks 5+ were not
started and remain forbidden.

## Commits

- Clean executable input: `53dcc4bcdfd509ff39728b31a7902a1bff0e91da`
- Evidence/report commit: recorded by the completing commit for this report.

## Implemented Spike Scope

- Added the exact 20-byte `Z2MHTV1\n` prelude, request/response frame types,
  zero flags/reserved fields, and unsigned big-endian header/body lengths.
- Added exact request header validation for protocol, `probe:1`, and timeout.
- Added framed closed outcomes and opaque stdout plus retained-stderr bodies.
- Added strict malformed/short/trailing/oversized/duplicate/unknown/identity
  request cases, helper outcome cases, disconnect cases, response truncation,
  large bodies, stderr draining, timeout metadata, and 100 framed requests.
- Retained all review-clean Task 2/3 direct spawn and supervision cases.
- Added package/static evidence tests that recompute tracked source hashes and
  bind raw TAP to both compiled AArch64 binary markers.
- Added no production daemon, adapter, procd integration, or M4 work.

## TDD And Root Cause Evidence

The first strict frame case was observed RED with `actual error: socket` before
the frame implementation, then passed in a focused exact-target run. Subsequent
focused runs localized the required 4 MiB failure before the C server's accepted
frame marker:

```text
sendCalls=1
shortWrites=1
sendEagain=1
recvCalls=0
bytesRead=0
error=disconnect
server exit=0, signal=null
```

Three single-variable hypotheses were tested and rejected because the trace was
unchanged: combined `POLLOUT|POLLHUP` ordering, 64 KiB send chunks, and blocking
send flags. Systematic-debugging's three-attempt architecture gate therefore
requires stopping rather than layering a fourth speculative transport change.

## Exact Evidence

The reconstructable artifact is
`tests/native/core/native-helper-broker-exact-target-evidence.txt`. It records:

- clean input commit and empty pre-run porcelain status;
- hashes for all four tracked sources;
- hashes for both compiled AArch64 binaries;
- target ucode, socket module, package Makefile, and APK hashes;
- ARM aarch64 binary/module architecture;
- exact UID0 PRoot/QEMU invocation and environment paths;
- timestamp, raw TAP, exact exit 1, zero skips, and the failing assertion.

## Verification

- Strict target builds: PASS (`-std=c11 -Wall -Wextra -Werror`).
- Required exact-target focused case: FAIL, 0 pass / 1 fail / 0 skipped.
- Package static test was observed RED before the Task 4 artifact replacement,
  as expected; final verification is recorded after evidence creation.
- `git diff --check`: recorded in final verification.
- Package/static evidence suite: PASS, 24/24, 0 skipped.
- Independent Codex review could not run because the installed CLI is missing
  `@openai/codex-linux-x64`; this is an environment review gap, not a PASS.

## Concerns And Blocker

- Valid framed exchanges are not stable in the clean full run; malformed request
  rejection is repeatable, but valid exchanges frequently report socket failure.
- The exact 4 MiB required case is deterministically blocked at the client send
  boundary and prevents exercising the paired 6 MiB response in that test.
- The implementation remains spike-only and includes diagnostic markers retained
  specifically to reconstruct the failure boundary.
- No production continuation is permitted from this result.
