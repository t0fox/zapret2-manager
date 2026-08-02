# T4.2 — Production Auto Strategy UI

## Scope

T4.2 is a presentation-only LuCI slice. It keeps the existing Auto Strategy RPC names, backend candidate journal, ranking, probe semantics, transactional apply/rollback writer, IDs, ACLs, and nfqws2 runtime unchanged.

The UI now has one canonical runtime presentation for Overview and Auto, separates the last status refresh from the last run timestamp, uses a collapsed service selector with backend catalog categories, and renders a bounded run-scoped candidate journal. Candidate rows expose rank, source/techniques, status, target and attempt counters, duration, Apply/last-good markers, and collapsed evidence/technical details. Empty and malformed journals use explicit bounded Russian states.

The Overview grid remains 2×2 on desktop and one column on mobile. Auto status cards use the available width, tested strategies span the full row, and advanced diagnostics are collapsed by default. Primary actions are hierarchical: stop active work, refresh stale state, enable disabled mode, or start a bounded check.

## Verification

- RED-first tests: `tests/t4-2-production-auto-ui.test.mjs` (10/10).
- Focused compatibility tests: 27/27 green.
- Full gate: 1102 Node tests + 10 shell gates = 1112 green, 0 red, 0 skipped.
- Package release: r134; signed APKs were installed on 192.168.1.1.
- Target runtime remained unchanged: nfqws2 PID 2116 (NFQUEUE 300) and PID 17025 (NFQUEUE 15695); uhttpd PID 2588 unchanged. No reboot, nfqws2 restart, firewall restart, uhttpd restart, Apply, rollback, or new scan.
- Source/target MD5 matched for `orchestra.js`, `z2m-ui.js`, and `z2m-ui.css`; static assets returned HTTP 200.
- Browser attempted at 1366×768, 1920×1080, and 390×844; LuCI returned HTTP 403/login, so real authenticated Auto DOM acceptance is **not claimed**. Screenshots record this boundary in `artifacts/t4-2-browser-*.png`.

