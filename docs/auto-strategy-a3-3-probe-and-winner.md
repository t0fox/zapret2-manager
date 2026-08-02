# Auto Strategy A3.3 — probe preflight, journal, and winner gate

## Acceptance result

This slice is **PARTIAL / no winner**. The canonical Discord service run completed with a bounded deadline and produced target-scoped evidence, but no candidate reached the required positive evidence gate. No Apply, rollback, configuration write, or service restart was requested.

- Starting HEAD: `8295f1e8f1149368064e730cf51b57fb2de457bf` (`8295f1e`, A3.2 acceptance).
- Final package line: r133 (`zapret2-manager`, LuCI, and full meta-package).
- Final bounded run: `or-6a6fa561-f84d`, generation `null`, `maxCandidates=4`, `maxAttempts=12`, `perAttemptTimeoutSec=10`, `totalTimeoutSec=180`.
- Run terminal state: `timed-out`, 10/12 attempts completed, `infrastructureErrorCount=0`, `applyAllowed=false`.

## Root cause and fix

The prior `EPROBEDEPENDENCY` was false: a target-level WebSocket curl timeout was written as `INFRA_ERROR code=EWEBSOCKET`; the worker consequently aborted the entire run. The runner now emits typed `PROBE_FAIL` markers for WebSocket and bounded-download target failures. `classify_attempt()` maps those markers to `target-fail`, while true wrapper/dependency failures remain infrastructure errors. Readiness is a separate, read-only preflight and does not create a run.

## Readiness contract

On the target router, `ubus call zapret2-manager orchestra_probe_preflight` returned `status=ready`, `reasonCode=null`, and `createsRun=false` on two consecutive calls. It reported `/usr/bin/ncat` 7.95, `/opt/zapret2/blockcheck2.sh`, `/usr/bin/curl`, and the Discord service catalog as ready, plus `web=https`, `gateway=websocket`, and `cdn=bounded_download`, all using the canonical `orchestra-candidate-run.sh` adapter. No raw probe was started from LuCI.

## Candidate journal and evidence

The backend and LuCI now expose every selected candidate, including technical `candidateId`, run/generation/source, status, attempt counts, target counts, duration, confirmation, rank, Apply, and last-good markers. The final journal contained all four zapret2gui candidates:

1. `z2gui-tcp_https-008b8317…` — Split cutoff — `failed`.
2. `z2gui-tcp_https-0171ac856…` — Мультисплит и смещение -1 — `failed`.
3. `z2gui-tcp_https-02ab1507…` — split badseq 10 — `failed`.
4. `z2gui-tcp_https-04b786b5…` — general (alt v6) 1.8.4 — `failed`.

The detailed run evidence records Web target timeouts (`rc=124`) and gateway/CDN target failures (`rc=65`, `target-fail`). There are no positive confirmations, no ranking entries, no selected winner, and therefore no sanctioned Preview/Apply call. Last-good remains unavailable; the applied configuration hash remains `75fa2ee28b278b9814d11b8dd22b8957c90e20bcf53bedf0cbce0a442c52f97f`.

## Runtime and verification boundary

After package install and the bounded run, `nfqws2` remained PID `17025 2116`, `uhttpd` remained PID `2588`, and the orchestration active lock was absent. No router reboot, manual kill, firewall restart, uhttpd restart, or nfqws2 restart was performed. The final source gate is 1092 node tests + 10 shell gates = **1092 green, 0 red, 0 skipped**.

