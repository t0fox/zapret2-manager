# Holyversion Production Parity Matrix

This matrix tracks the production implementation on `feat/holyversion-reference-parity` against the rendered `holyversion.html` reference. Source implementation is present; test, package, and router evidence remain intentionally deferred until the verification wave.

| Reference state | Production state | Visual verdict | Behavior verdict | Backend source | Test evidence | Router evidence | Intentional deviation |
|---|---|---:|---:|---|---|---|---|
| Seven-section application shell | Seven canonical primary tabs in `app.js`; legacy Lists hash redirects to Services | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | LuCI root view | Deferred: shell/navigation/responsive suites | Deferred | None |
| Desktop 1920 layout | Wide centered content, two-column detail grids | IMPLEMENTED / UNVERIFIED | N/A | CSS | Deferred: viewport-1920 | Deferred | None |
| Desktop 1366 layout | Standard compact desktop spacing | IMPLEMENTED / UNVERIFIED | N/A | CSS | Deferred: viewport-1366 | Deferred | None |
| Tablet 1024 layout | Scrollable tabs, one-column dense sections | IMPLEMENTED / UNVERIFIED | N/A | CSS | Deferred: viewport-1024 | Deferred | None |
| Mobile 390 layout | Single-column cards, visible actions, sticky draft bar | IMPLEMENTED / UNVERIFIED | N/A | CSS | Deferred: viewport-390 | Deferred | None |
| Keyboard-visible focus | `:focus-visible` guardrails, tab arrow navigation | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Shell | Deferred | Deferred | None |
| Modal semantics | Focusable `role=dialog`, `aria-modal`, Escape close | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Shell | Deferred | Deferred | Focus trap requires router/browser acceptance |
| Global draft bar | Discard, semantic diff, Apply; no countdown | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Browser store + coordinator | Deferred | Deferred | None |
| Deterministic multi-scope apply | `strategy → domainHub → dns → proxy`; all scopes preflight before mutation | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing sanctioned owners | Deferred | Deferred | Service DNS arbitrary-payload zero-write preview still blocked |
| Verified partial result retention | Clears only reread-verified successes; failed drafts remain | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Coordinator/adapters | Deferred | Deferred | None |
| Manual rollback result | Visible only with backend targetable snapshot proof | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Domain Hub snapshot; owner-specific proofs | Deferred | Deferred | No automatic rollback timer |
| Overview hero and health | Trusted read-only overview model; no inferred bypass success | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing status/overview evidence | Deferred | Deferred | Missing evidence omits section |
| Strategy catalogue | Human labels in basic mode; technical ID/argv advanced only | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Orchestra catalog | Deferred | Deferred | None |
| Strategy full-corpus run | Exact candidate set and versioned 61-domain corpus | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Orchestra corpus/run owner | Deferred | Deferred | Mutation requires later approved safe router window |
| Strategy progress | 61-domain progress, pending/failed retention, infrastructure split | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Orchestra journal | Deferred | Deferred | None |
| Strategy winner | Completed winner stages semantic draft, not immediate runtime mutation | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Strategy coordinator adapter | Deferred | Deferred | None |
| Services package catalogue | Real backend packages/categories; tri-state; full-catalog bulk actions | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Domain Hub → catalog owner | Deferred | Deferred | None |
| User domain lists | Include/exclude normalization and conflict blocking | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Domain Hub → lists owner | Deferred | Deferred | URL/IP/wildcard rejected |
| Autohostlist | Read engine-owned list; promote/ignore through user lists | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Domain Hub/list owner | Deferred | Deferred | Engine-owned stale cleanup blocked until sanctioned owner exists |
| Sources and build | Backend source records only; no fake source | IMPLEMENTED / UNVERIFIED | BLOCKED | Domain Hub read model | Deferred | Deferred | Source update/schedule blocked: no sanctioned owner contract |
| DNS modes/model | System, DoH, DoT, UDP truth model; real-test-only recommendation | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing DNS owner | Deferred | Deferred | Existing UI wiring needs verification |
| Manual DNS overrides | Revision-bound validate/set/apply/reread | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing DNS owner | Deferred | Deferred | None |
| Per-service DNS | Folded into canonical DNS draft | IMPLEMENTED / UNVERIFIED | BLOCKED | Existing Service DNS owner | Deferred | Deferred | Arbitrary selections cannot be zero-write previewed by current backend |
| Telegram Proxy truth | Stopped/starting/healthy/degraded/unsupported/error | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing proxy status/health | Deferred | Deferred | PID alone never equals healthy |
| Telegram Proxy settings | Secret-free semantic draft and existing safe preview/apply | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Proxy config owner | Deferred | Deferred | Upstream secret-bearing values remain backend-only |
| Telegram Proxy link | Hidden by default, one-shot explicit reveal/QR | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Proxy link owner | Deferred | Deferred | Link never enters store/coordinator |
| Monitoring | Bounded structured rows, filters, KPIs, client-only pause | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Status cache + bounded events journal | Deferred | Deferred | No packet capture or new persistent store |
| Maintenance system | Scalar versions, uptime, memory, runtime cards | IMPLEMENTED / UNVERIFIED | READ-ONLY | Existing maintenance/status | Deferred | Deferred | Missing fields omitted |
| Backup list/create/delete | Explicit actions and bounded identity-preserving list | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing backup owner | Deferred | Deferred | None |
| Backup restore | Semantic preview, exact preview identity/revision, reread verification | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing backup owner/CLI | Deferred | Deferred | Router restore requires later safe disposable backup window |
| Events and diagnostics | Bounded redacted events; semantic diagnostics output | IMPLEMENTED / UNVERIFIED | IMPLEMENTED / UNVERIFIED | Existing events/diagnostics owners | Deferred | Deferred | Technical nested details advanced only |
| No raw null/object text | Strict formatters and state panels | IMPLEMENTED / UNVERIFIED | N/A | Frontend models/shell | Deferred | Deferred | None |
| No external UI assets | Local LuCI JS/CSS/QR only | IMPLEMENTED / UNVERIFIED | N/A | Package contents | Deferred | Deferred | None |

## Known implementation blockers before verification

1. Extend Service DNS preview to accept arbitrary proposed selections without writing backend draft state; only then may the canonical `dns` scope apply Service DNS changes.
2. Add a sanctioned source/schedule owner before enabling writes in `Источники и сборка`.
3. Run source tests, package-manifest checks, signed APK build, and exact-head router/browser acceptance; no row may be promoted from `IMPLEMENTED / UNVERIFIED` before evidence exists.
