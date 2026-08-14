---
id: avatar-parity
title: "Avatar Behavioral Parity Contract"
type: parity
status: normative
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [parity, avatar, contract]
---
# Avatar Behavioral Parity Contract

**Avatar behavioral baseline:** `avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c`  
**zapret2-manager audited baseline:** `t0fox/zapret2-manager@152cb642d5e3a994b3be73aa096530d7f8c2a408`

This audit compares user-visible behavior and domain models, not filenames or implementation language. Avatar is normative unless an approved deviation appears in the Deviation Register.

## Summary

| Status | Count |
|---|---:|
| PARITY | 11 |
| PARTIAL | 31 |
| MISSING | 28 |
| DIVERGENT | 2 |
| INTENTIONAL_DEVIATION | 4 |
| CONFLICT_REQUIRES_USER_DECISION | 3 |
| LEGACY_DEAD | 2 |
| **Product parity total** | **79** |

Two LEGACY_DEAD inventory rows are excluded from product-parity arithmetic.

## Top Product Parity Blockers

1. Scanner, BlockCheck, Block Detector, BlockCheck2 and BlockCheckW are distinct product flows; ours preserves their manager boundaries while target evidence remains separate.
2. Auto-remediation cannot reach parity until Scanner, DNS remediation and tunnel routing exist.
3. Avatar unified routing requires destinations/selectors, primary method, ordered fallbacks, monitoring and failover; ours lacks that product model.
4. Lua, blob and IP-set registries required by Strategies are absent.
5. AWG, usque/MASQUE/WARP, sing-box, mihomo and Opera lifecycle products are absent.
6. Avatar has 38 canonical SPA pages plus two legacy hash aliases; ours has seven canonical LuCI tabs plus one lists alias and several backend-only capabilities.
7. Several existing equivalents are safer internally but do not expose the complete Avatar user capability.

## Detailed Parity Matrix

| Avatar subsystem/feature | Avatar evidence | Avatar behavioral contract | Our evidence | Our current behavior | Status | Deviation reason | Required action |
|---|---|---|---|---|---|---|---|
| Dashboard | `web/js/app.js` routes `#dashboard`; `web/js/components/sidebar.js` dashboard entry | Global service/health/current Strategy/system shortcuts | `z2m-overview.js`; schema-3 `status.uc` | Status, service controls, resources and selected summaries exist | PARTIAL | — | Match Avatar cards, current Strategy identity, shortcuts and refresh semantics. |
| Global status | `core/system_info.py`, dashboard API consumers | Engine/process/system state plus active Strategy identity in one reachable view | `core/status-collector.uc`, `status-compat.uc`, `strategy-status.uc`, `z2m-overview.js` | Schema-3 status now carries a read-only active Strategy identity with revision, catalog/candidate/config evidence and derived match/drift/availability/uncertain fields; complete dashboard presentation remains unproven | PARTIAL | — | Map the proven status projection into the remaining dashboard surfaces. |
| Start/stop/restart | `core/system_control.py`; `api/system.py`; control page | Explicit lifecycle operations and results | rpcd `start/stop/restart`, Overview controls | Same user effect through init owner | INTENTIONAL_DEVIATION | OPENWRT_NATIVE (DEV-002) | Keep procd/init implementation and map Avatar result semantics. |
| Current Strategy display | dashboard/control/strategies consumers; `core/strategy_state.py` | Active Strategy ID/name/metadata visible | `z2m-strategy.js`; `avatar-strategy-integration.test.mjs` derived status assertion | Canonical Strategy UI consumes service status and renders active identity and drift | PARITY | — | Preserve identity and drift fields while extending the remaining dashboard surface. |
| Uptime/RAM/system | `core/system_info.py` | Visible uptime, memory and platform information | status collector `/proc`, uptime and memory observations | Substrate exists; field/UI equivalence is unproven | PARTIAL | — | Freeze and map each Avatar field and presentation. |
| Events/logs | `core/log_buffer.py`; `web/js/pages/logs.js` | Unified logs, filtering/tailing/copy/download | events tail, proxy logs, Maintenance/Monitoring views | Fragmented sources; no unified consumer | PARTIAL | — | Add Avatar-equivalent unified bounded log view. |
| Settings/expert/theme | `web/js/pages/settings.js`; config APIs | Product settings, expert-mode capability visibility, persistent UI settings | app advanced flag and native backend config | Expert mode partly exists; settings/defaults/theme differ | PARTIAL | — | Characterize exact Avatar defaults and expose equivalent settings. |
| Autostart/boot | `core/autostart_manager.py`; `#autostart` | Enable/disable, active Strategy interaction, inspect generated boot config | package enables service; init/procd and service actions | No Avatar-compatible Strategy autostart contract/view | PARTIAL | — | Bind boot persistence to active Avatar Strategy and expose state. |
| nfqws2 detect/version/path | `core/nfqws_manager.py`, `core/platform_dirs.py` | Detect binary/base path and expose version/path/failure semantics | status upstream/runtime and `/opt/zapret2` constants | Native detection exists; complete visible semantics are unproven | PARTIAL | OPENWRT_NATIVE (DEV-001) | Map Avatar fields/failures while retaining native paths. |
| Engine install/update/remove | `core/zapret_installer.py`, `binary_installer.py`, update pages | Lifecycle with progress/version/result | engine-provider/install RPC and Maintenance | Zapret2 lifecycle exists but UI/progress/version selection differs | PARTIAL | — | Match Avatar operations and visible outcomes. |
| Lua assets | `core/lua_manager.py`; `#lua` | List bundled/custom scripts, import/edit/delete, dependency checks | native preflight checks Lua function existence only | No Lua product registry/UI | MISSING | — | Implement Avatar Lua manager semantics on safe native storage. |
| Blob assets | `core/blob_manager.py`, `blob_registry.py`; `#blobs` | CRUD/generate/stats and Strategy requirements | native preflight checks blob existence only | No blob product registry/UI | MISSING | — | Implement binary-safe Avatar blob registry and references. |
| Engine dry-run/preflight | strategy preview/validation APIs and nfqws manager | Validate before apply | `native-preflight.uc`, `profiles-apply.uc` | Strong complete pinned native/Lua gate | INTENTIONAL_DEVIATION | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Retain stronger gate while preserving accepted Avatar strategies. |
| Strategy aggregate model | `core/strategy_builder.py` `StrategyManager`; `api/strategies.py`; strategies UI | Validated dictionary requires `id`, `name`, ordered `profiles[]`; Profile requires `id`, `args`, with `enabled` default true; enabled Profiles compile with `--new`; same-ID user Strategy overrides builtin | `strategy-state.uc`, `strategy-compiler.uc`, `z2m-strategy.js`; `avatar-strategy-integration.test.mjs` | Canonical Strategy API/UI owns the aggregate and shared compiler preserves ordered enabled Profiles | PARITY | — | Extend only with remaining Avatar catalog consumers; do not reintroduce Profile-first authority. |
| Profile belongs to Strategy | `strategy_builder.py` builds/validates profiles inside Strategy | Profiles are child runnable units, not top-level product | `z2m-strategy.js` nested editor; Strategy model/compiler tests | Canonical editor and RPCs expose Profiles as ordered Strategy children; compatibility CRUD remains a bounded legacy path | PARITY | — | Keep compatibility reachability without changing canonical ownership. |
| Ordered/enabled profiles | `strategy_builder.py`; strategy editor | Explicit order and enable state affect whole Strategy preview/apply | `avatar-strategy-model.test.mjs`, `avatar-strategy-compiler.test.mjs`, `avatar-strategy-preview.test.mjs` | Order is preserved, omitted `enabled` defaults true, disabled Profiles are excluded, and zero-enabled Preview remains inspectable | PARITY | — | Preserve zero-enabled Preview versus Validate/Apply admission. |
| Builtin/user Strategies | `core/catalog_loader.py`; user strategy JSON; strategies API | Builtins read-only, users CRUD; source distinction | `strategy-state.uc`, catalog manifest, Strategy RPC/UI tests | Pinned catalog winners are immutable builtins; user CRUD and CAS identity are separate and stable | PARITY | — | Add only future catalog channels without changing identity rules. |
| Strategy metadata | `core/models.py`; `strategy_builder.py`; `api/strategies.py` | Stored description, author, label, source, featured and protocol/level data; API computes `is_favorite` | catalog manifest conversion, Strategy model/UI tests | Metadata, provenance, protocol, level, featured and ordered favorite state are exposed from authoritative records | PARITY | — | Preserve stored versus computed metadata semantics. |
| Strategy duplicate/custom/manual | `web/js/pages/strategies.js` duplicate-to-user flow | Duplicate builtin/user Strategy into editable user Strategy | `strategy-state.uc`; `avatar-strategy-state.test.mjs`; RPC/UI tests | Duplicate creates a deep-copied user Strategy with stable copy identity and preserves metadata/Profiles | PARITY | — | Keep duplicate bounded by catalog and user-storage collision checks. |
| Strategy preview | `api/strategies.py` preview; strategies UI | Preview whole Strategy compilation | `strategy-cli.uc`; Preview/compiler tests; UI tests | Preview compiles the whole ordered Strategy, returns identity, effective command/argv, digest and dependencies without mutation | PARITY | — | Retain backend-owned output and bounded projections. |
| Strategy validation/apply | builder validation and whole-Strategy apply | Validate and apply aggregate | `strategy-cli.uc`, `profiles-apply.uc`; Preview/Apply/integration tests | Validate is explicit and non-mutating; Apply requires persisted identity/catalog digest, uses CAS transaction, runtime verification and rollback | PARITY | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Preserve the stronger transaction boundary while accepting the proven Strategy contract. |
| Hostlist injection/autowrap | `strategy_builder.py`; tests for bare trick autowrap/quoting | Inject filters/assets and auto-wrap bare trick as Avatar specifies | compiler/preview tests; integration fixture | Shared compiler preserves quote-aware fragments, hostlist/runtime injection and Avatar autowrap semantics | PARITY | — | Extend only from pinned characterization evidence. |
| Basic/advanced/direct/preset catalogs | `catalogs/**`; `core/catalog_loader.py` | Distinct catalog sources and stable Strategy IDs | installed `catalog/avatar/manifest.json`; package/catalog/integration tests | Four pinned Avatar catalog levels are packaged, hash-verified, loaded with deterministic winners and exposed separately from service/Orchestra catalogs | PARITY | — | Keep catalog reload verified and do not conflate service-domain identity. |
| Catalog protocol sets/labels | catalog metadata and scan UI | TCP/UDP/HTTP80/QUIC/Discord applicability; quick/standard/full; recommendation labels | manifest sets; catalog/compiler tests; integration test | TCP/UDP quick/standard/full sets preserve pinned order, uniqueness and winner membership; HTTP80/QUIC/Discord applicability and recommendation labels are unknown and unverified | PARTIAL | — | Collect bounded evidence before claiming HTTP80/QUIC/Discord parity. |
| Catalog update/reload | `core/catalog_updater.py`; `api/catalog_update.py` | Check/download/install catalog update while preserving users | service catalog revision/ownership ledger | Wrong catalog domain | MISSING | — | Implement strategy-catalog update with validation/preview and user preservation. |
| Strategy Scanner | `core/strategy_scanner.py`; `api/scan.py`; scan pages | Catalog Strategy executor with `quick|standard|full`, protocol/target/DPI filtering, resume index, baseline-aware success and apply by result index/Strategy ID | `scanner-planner.uc`, `scanner-worker.uc`, `scanner-results.uc`, Scanner RPC/LuCI and focused product tests | Native Scanner is bound to the Strategy catalog, target profiles, server-owned evidence, and the existing Strategy handoff | PARITY | — | `ROUTER_E2E: NOT RUN`; no physical-router claim is made. |
| Scanner probes | scanner testers/models/targets | Baseline, IPv4/6, TLS/body/QUIC/STUN as selected | `scanner-probe-adapter.uc`, `scanner-probes.uc`, probe and worker tests | TCP TLS/body and address-family evidence plus UDP STUN-only semantics are implemented; QUIC is intentionally excluded by the approved native spec | PARITY | INTENTIONAL_DEVIATION | Preserve the approved STUN-only UDP boundary. |
| Scanner progress/stop/resume | scan API/UI; scanner state | Ordered progress, stop and resume | `scanner-state.uc`, `scanner-worker.uc`, `z2m-scanner.js`, lifecycle/UI tests | Bounded status polling, cancellation, retained checkpoint identity, and resume are wired through the Scanner page | PARITY | — | Keep late-response suppression and terminal recovery visible. |
| Scanner result ranking | scanner report/results | Working/failed Strategies, success rate and order | `scanner-results.uc`, result/integration/apply tests | Server-owned TCP/UDP scoring, deterministic ordering, separated infrastructure failures, evidence and best references are exposed | PARITY | — | Keep evidence identities stable across refreshes. |
| Scanner runtime/firewall cleanup | scanner cleanup paths | Preserve current runtime/firewall and cleanup errors | `scanner-transient.uc`, `scanner-reconcile.uc`, native runtime and worker tests | Task 5/7 lifecycle ownership, fail-closed cleanup, terminal restoration and recovery states are the Scanner boundary | PARITY | — | `ROUTER_E2E: NOT RUN`; do not infer physical-router evidence. |
| Scanner apply found Strategy | `/api/scan/results`, apply endpoint | Result maps/applies Strategy by ID/index | `scanner-results.uc`, `scanner-cli.uc`, `z2m-scanner.js`, Strategy Apply tests | Existing Strategy references hand off to Preview/Validate/Apply; generated candidates use Save as Strategy and never gain Scanner Apply | PARITY | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Preserve the single permanent Strategy Apply owner. |
| BlockCheck | `core/blockcheck.py`; `api/blockcheck.py` | One-shot `quick|full|dpi_only`, rich evidence/classification, traceroute/deep trace and domains | `blockcheck-cli.uc`, diagnostic runner, result model and LuCI | Separate managed diagnostic vertical; router runtime evidence pending | PARTIAL | OPENWRT_NATIVE (DEV-002) | Preserve positive-evidence and infrastructure separation; collect target smoke. |
| Block Detector | `core/block_detector.py`; `api/block_detector.py` | Background DNS discovery, periodic probes, findings and optional managed-list candidates | `block-detector-cli.uc`, owned monitor runner and LuCI | Separate background lifecycle with bounded discovery/probes | PARTIAL | OPENWRT_NATIVE (DEV-002) | Add target evidence for DNS source/capture and list handoff. |
| BlockCheck2 execution | `core/blockcheck2.py`; `api/blockcheck2.py` | Original bol-van subprocess with `SCANLEVEL=quick|standard|force`, BATCH/env, streaming, stop and parsed found Strategies | dedicated `blockcheck2-cli.uc`/runner, RPC/ACL/LuCI | Typed env, monotonic bounded stream, ownership and parser are covered by focused tests | PARTIAL | OPENWRT_NATIVE (DEV-002) | Collect router script-discovery and terminal-tail evidence. |
| BlockCheck2 result→Strategy | parser/tests/UI | Reconstruct filters/tricks and transfer found Strategy | evidence-bound Strategy aggregate with Preview/Validate handoff | No permanent BlockCheck2 Apply path | PARTIAL | — | Keep existing Strategy authority as sole Apply owner. |
| BlockCheckW provider/Fast | external `rcd27/blockcheckw` | Version/provider lifecycle plus `status|scan|universal|check` structured reports | `blockcheckw-model/cli/install/run`, provider RPC/ACL/LuCI | Separate optional external provider; current characterization pinned to `d6f96719a6d555304aa565cd820699ef1de9515f` | PARTIAL | OPENWRT_NATIVE (DEV-002) | Verify asset compatibility and manual install/update on target architectures. |
| Auto-remediation mapping | `core/auto_remediation.py` | none→skip; DNS manipulation→dns_fix; DPI→Scanner; IP/full→tunnel, with overrides | `auto-strategy.uc` only Strategy health/recovery | Different product | MISSING | — | Implement orchestrator only after dependent features. |
| Auto-remediation safety | same module | preview/auto_apply/cooldown/concurrent guard/postverify/result | auto-strategy has CAS/cooldown/verification | Some machinery but wrong action model | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Reuse safeguards while matching Avatar actions. |
| Unified Destination model | `core/unified/model.py` Destination/Route | domains, CIDRs, lists, hostlists, ipsets, geosite/geoip, devices, DSCP | no unified route model | Missing | MISSING | — | Implement exact selector schema. |
| Primary + ordered fallbacks | `core/unified/model.py`, failover | Destination routes through primary then ordered fallback methods | no equivalent | Missing | MISSING | — | Implement explicit order and active-method state. |
| Route CRUD/preview/apply/remove | `api/unified.py`; routing UI | Complete route lifecycle | narrower DNS/domain operations | Missing aggregate | MISSING | — | Add typed ubus methods and LuCI consumer. |
| Route monitor/failover | unified monitor/failover modules | Health history, cooldown, automatic switching | no multi-method monitor | Missing | MISSING | — | Implement after route/method parity. |
| Fallback cyclic behavior | `core/unified/failover.py` modulo wraparound and tests | Avatar baseline cycles to primary after fallback exhaustion | no equivalent; product concern is evaluative, not source behavior | Missing | CONFLICT_REQUIRES_USER_DECISION | EXPLICIT_USER_PRODUCT_CONSTRAINT (DEC-001) | Decide whether exact cyclic behavior is required. |
| Route priority | `core/unified/model.py` persists priority; audited `core/unified/**` has no sorting/application use | User can store priority with no observed application precedence | no equivalent | Missing | CONFLICT_REQUIRES_USER_DECISION | EXPLICIT_USER_PRODUCT_CONSTRAINT (DEC-002) | Decide whether to reproduce the non-effect or approve correction. |
| DNS providers/diagnosis | `core/dns_providers.py`, DNS pages/diagnostics | Provider selection and diagnosis | DNS provider catalog/check RPC | Substantial equivalent | PARTIAL | OPENWRT_NATIVE (DEV-001) | Compare provider IDs/defaults/results field-by-field. |
| Per-domain DNS routing | `core/dns_routing.py`; `#dns-routing` | Domain-specific resolver/routing integration | service DNS/global DNS | Different selection model | PARTIAL | — | Add Avatar rule model and routing linkage. |
| DoH/DoT/hosts remediation | DNS and hosts managers/pages | Manage encrypted DNS/hosts fixes where supported | partial provider/hosts behavior | Incomplete | PARTIAL | — | Inventory exact endpoints/defaults and add missing actions. |
| Hostlists | `core/hostlist_manager.py`; `#hostlists` | Named CRUD/import/update used by Strategies/routing | Domain Hub/lists | Partial naming/lifecycle/references | PARTIAL | — | Match Avatar file/list semantics and references. |
| IP sets | `core/ipset_manager.py`; `#ipsets` | Named IP list CRUD/import/update | no product surface | Missing | MISSING | — | Implement before Strategy/routing parity. |
| Named/curated lists | `core/named_lists.py`, `list_updater.py`; `#lists` | CRUD, curated refresh, route attachment | services/domain catalog | Partial | PARTIAL | — | Match list types/dedup/validation/import/export. |
| Geosite/GeoIP | `core/unified/geo_engine.py`, importers | Selectors expanded/applied with data lifecycle | no equivalent | Missing | MISSING | — | Implement database lifecycle and selector expansion. |
| Hosts | `core/hosts_manager.py`; `#hosts` | CRUD/remediation | no equivalent consumer | Missing | MISSING | — | Add safe hosts manager. |
| Connectivity matrix | `core/connectivity/matrix.py`, traffic.py | Probe matrix/status feeds diagnostics/routing | health matrix RPC | Similar but schemas/consumers differ | PARTIAL | — | Characterize target/probe/result parity. |
| WARP/usque/MASQUE | `core/usque_manager.py`; `api/usque.py`; pages | detect/version/install/register/import/multiple configs/TUN/lifecycle/transport/HTTP2/keepalive/MTU/logs/health | no equivalent | Missing | MISSING | — | Implement full lifecycle, not generic proxy toggle. |
| WARP Zero Trust/JWT | usque APIs/UI | Enrollment/import options | no equivalent | Missing | MISSING | — | Implement secret-safe manager-owned config. |
| WARP route method | unified model/applier `warp:<iface>` | Selectable routing method | no unified routing | Missing | MISSING | — | Implement after WARP + routing. |
| Telegram tunnel | `core/tgproxy_manager.py`; `#tgproxy` | install/config/secret/lifecycle/autostart/health/link/logs/routing role | proxy provider/config/health/log/link UI/RPC | Broad capability exists; exact semantics differ | PARTIAL | OPENWRT_NATIVE (DEV-001) | Compare defaults, secret handling, autostart and routing integration. |
| AmneziaWG | `core/awg_*`; six pages | detect/install/config/key/lifecycle/watchdog/autostart/routing/WARP | absent | MISSING | — | Implement Avatar product after routing foundation. |
| sing-box | `core/singbox_*`; four pages | install/config/proxies/subscriptions/testing/lifecycle/routing | absent | MISSING | — | Implement exact product surface. |
| mihomo | `core/mihomo_*`; three pages | install/YAML/controller/proxies/testing/lifecycle/routing | absent | MISSING | — | Implement exact product surface. |
| Opera Proxy | `core/opera_proxy_*`; page | install/config/countries/chaining/lifecycle/health/logs | absent | MISSING | — | Implement exact product surface. |
| warp-in-warp | `core/warp_in_warp.py`, watchdog; page | Combined tunnel product | absent | MISSING | — | Implement after AWG/usque. |
| Extra tunnel implementation order/resource limits | Avatar includes AWG/sing-box/mihomo/Opera and strict parity requires inclusion | Current project omitted them | no permanent exclusion was approved | Inclusion is required; only order/resource policy is unresolved | CONFLICT_REQUIRES_USER_DECISION | EXPLICIT_USER_PRODUCT_CONSTRAINT (DEC-003) | Decide implementation order and hardware limits. |
| Tunnel monitor | tunnel watchdogs; `#tunnel-monitor` | Aggregate health/recovery/signals | nfqws monitor only | Missing cross-engine behavior | MISSING | — | Implement after engines. |
| Tunnel optimizer | `#tunnel-optimizer` and engine tests | Optimize method/config and display result | absent | MISSING | — | Implement exact controls after monitor. |
| Devices | `core/devices_discovery.py`; routing UI | Discover IP/MAC/hostname and select route sources | no product equivalent | MISSING | — | Implement OpenWrt neighbor/DHCP-backed discovery. |
| Backup export | `api/backup.py`; `core/backup.py` | Export selected sections: settings, strategies, singbox, mihomo and hostlists | scoped backup list/create/delete | Different scopes/lifecycle | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-004) | Accept/export Avatar sections while retaining hashes. |
| Restore preview/verification | backup import/settings flows | Import selected supported sections with summary preview | preview + verified scoped restore | Stronger hash/verification boundary, but format/scope parity is incomplete | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-004) | Preserve verification and add compatible mapping. |
| Diagnostics/export | `core/diagnostics.py`, selfcheck/healthcheck; diagnostics page | System/network/engine checks and export | diagnostics export/status/events | Partial checks/UI | PARTIAL | — | Match check inventory and bounded report. |
| GUI update | `core/gui_updater.py`; `#updates` | Check/update GUI | package-managed LuCI app; no self-update | Different platform lifecycle | INTENTIONAL_DEVIATION | OPENWRT_NATIVE (DEV-005) | Map to apk package update semantics, not self-modifying app. |
| Engine/catalog update | installers/catalog updater | Separate update channels/status | engine provider and service catalog update | Wrong/partial catalog domain | PARTIAL | OPENWRT_NATIVE (DEV-005) | Add Avatar strategy catalog channel. |
| UI/navigation reachability | `web/js/app.js` 38 canonical pages plus two legacy aliases | Every major capability has a reachable page | LuCI app seven canonical tabs plus one lists alias | Many capabilities unreachable | PARTIAL | OPENWRT_NATIVE (DEV-001) | Equivalent tabs/subtabs/deep links; CSS identity not required. |
| REST versus ubus | `api/*.py` REST endpoints | Typed CRUD/status/jobs/cancel/history/preview/apply | rpcd/ubus methods | Protocol differs by platform | INTENTIONAL_DEVIATION | OPENWRT_NATIVE (DEV-001) | Maintain semantic mapping tests. |
| API error semantics | API status/errors by subsystem | User receives bounded actionable result | mixed direct legacy/status and `{ok,error}` methods | Not systematically Avatar-compatible | PARTIAL | — | Freeze endpoint-by-endpoint mapping. |
| Strategy→runtime→status flow | catalog→Strategy profiles[]→preview→validate→apply→nfqws→status | Stable aggregate identity through status | catalog/Strategy CLI/compiler/transaction/derived status; integration test | Pinned catalog identity survives Preview, bounded Validate, verified Apply/rollback boundary and derived status without persisted drift; autostart linkage is not evidenced | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Preserve the verified flow and collect autostart evidence before claiming that boundary. |
| Scanner→Strategy apply flow | catalog Scanner→working result→Strategy apply | Tested Strategy identity preserved | Orchestra candidate→typed apply | Different catalog/result model | DIVERGENT | — | Rebuild product facade around native runner. |
| BlockCheck→recommendation | distinct BlockCheck classification | Diagnostic result informs remediation | blockcheck job and health matrix overlap | Product distinction incomplete | PARTIAL | — | Keep three independent flows. |
| Auto-remediation→DNS/Scanner/tunnel | `auto_remediation.py` | Classification dispatches exact subsystem | only auto-strategy | Missing flow | MISSING | — | Implement last, after dependencies. |
| Destination→method→fallback→monitor | unified modules | Complete route chain | absent | MISSING | — | Routing vertical slice before tunnel automation. |
| WARP→TUN→routing | usque + unified applier | WARP interfaces become route methods | absent | MISSING | — | WARP lifecycle then routing adapter. |
| Lists→Strategies/routing | managers + builder/unified model | Shared named selectors | Strategy compiler/list dependency seam; no unified routing | Strategy list/detail and dependency composition are bounded; routing crossflow is absent | PARTIAL | — | Stable list IDs/reference validation in both consumers. |
| DNS→routing | dns routing + unified applier | Resolver decisions support route selectors | separate DNS/service flows | Crossflow absent | MISSING | — | Integrate after unified routing. |
| Removed redirect-only legacy pages | Avatar pages are live | N/A | ours `strategies.js`, `orchestra.js` redirect to unified page | Compatibility alias inventory, not product parity | LEGACY_DEAD | OPENWRT_NATIVE (DEV-001) | Keep redirects and document replacement. |
| Legacy shared draft-state architecture | Avatar settings/user stores differ | N/A | `/etc/zapret2-manager/state.json` co-owned compatibility document | Retained only for current slices | LEGACY_DEAD | — | Migrate only in separately approved bounded work, not this audit. |

## Cross-Subsystem Flow Verdicts

| Flow | Verdict | Evidence and gap |
|---|---|---|
| Strategy catalog → Strategy → Profiles[] → preview → apply → status → autostart | PARTIAL | Pinned catalog, aggregate Strategy identity, ordered Profiles, Preview/Validate/Apply, derived status, rollback and reconciliation are covered by the focused and Task 16 integration gates; autostart is not evidenced. |
| Scanner → catalog Strategies → working results → apply | DIVERGENT | Avatar `strategy_scanner.py` consumes catalog Strategies; ours Orchestra consumes other registries and requires different winner evidence. |
| BlockCheck → recommendation | PARTIAL | One-shot diagnostic model/UI and typed recommendations exist; router/runtime parity remains unverified. |
| Block Detector → managed lists | PARTIAL | Background discovery and candidates exist; automatic list mutation is intentionally not enabled in M5. |
| BlockCheck2 → found Strategy | PARTIAL | Dedicated parser and evidence-bound Strategy Preview/Validate handoff exist; target script evidence remains pending. |
| Auto-remediation → Scanner | MISSING | `auto-strategy.uc` is not Avatar auto-remediation. |
| Auto-remediation → DNS fix | MISSING | No classification dispatcher. |
| Auto-remediation → tunnel | MISSING | No unified routing/tunnel method graph. |
| Destination → primary → fallbacks → monitor/failover | MISSING | Unified route model absent. |
| WARP → TUN → Unified Routing | MISSING | Both dependencies absent. |
| Lists → Strategy/Profile filters | PARTIAL | Existing fragments reference lists, but no Avatar stable Strategy/list contract. |
| Lists → Unified Routing | MISSING | Unified Routing absent. |
| DNS → Routing | MISSING | Existing DNS is separate from Avatar unified route decisions. |

## Known Strategy/Profile Result

Avatar’s authoritative domain model is **Strategy containing ordered Profiles[]**. Builtins come from catalogs; user Strategies have separate CRUD; preview and apply operate on the whole Strategy; the builder composes enabled profiles with `--new`, injects required filters/assets and applies Avatar’s bare-trick wrapping rules. The verified OpenWrt implementation now exposes that aggregate through the canonical Strategy API/UI, preserves the pinned catalog identity, and keeps the safer transaction, rollback, reconciliation and derived status machinery underneath. Status: **PARITY** for the verified Strategy vertical slice.

## Known Scanner Result

The approved Avatar Strategy Scanner slice is now implemented over the native Strategy catalog and durable Scanner lifecycle: request/target validation, planning, probes, transient execution, cancellation/resume, results/ranking, ubus/ACL, LuCI integration, package inventory, and the existing Strategy Preview/Validate/Apply handoff are covered by focused product/native evidence. The Scanner remains separate from Orchestra and does not gain a permanent Apply path. Status: **PARITY** for the approved scope. `ROUTER_E2E: NOT RUN` because physical-router deployment approval was not provided.

## Dependency-Ordered Parity Program

1. Strategy/Profile aggregate and pinned strategy-catalog parity.
2. Lua, blob, hostlist and IP-set dependency registries.
3. Scanner parity using the native durable runner. **COMPLETE for the approved scope.**
4. Separate BlockCheck, Block Detector and BlockCheck2 parity, including result→Strategy.
5. BlockCheckW provider/version policy and fast-engine integration.
6. Unified Routing destination/selectors/method/fallback model.
7. Devices, DNS/list/geosite/geoip routing crossflows.
8. Core tunnel lifecycle foundation mapped onto procd/native storage.
9. WARP/usque and AWG; then sing-box, mihomo, Opera and warp-in-warp.
10. Tunnel monitoring/optimizer and failover.
11. Auto-remediation dispatch over Scanner, DNS and tunnels.
12. Remaining settings/update/navigation parity and end-to-end acceptance.

## Deviation Register

| ID | Avatar behavior | Our deviation | Reason class | Why unavoidable/approved | User-visible impact | Can parity be restored later? |
|---|---|---|---|---|---|---|
| DEV-001 | Bottle/Python REST service | rpcd/ubus/ucode/procd | OPENWRT_NATIVE | Native OpenWrt control plane | Protocol differs, capability must not | Semantic parity is required now |
| DEV-002 | Direct/process-local lifecycle, Scanner controls and BlockCheck2 subprocesses | procd/init and durable native jobs | OPENWRT_NATIVE | Platform process owner | Different progress/process details; semantics remain required | Yes, at API/UI level |
| DEV-003 | Direct Strategy apply | locked CAS transaction, runtime verify and rollback | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR | Prevent lost config/fake success | Additional validation/failure detail | Yes; accepted Avatar inputs must remain usable |
| DEV-004 | Export/import of selected settings, strategies, singbox, mihomo and hostlists | scoped hashed preview and verified restore | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR | Safer restore boundary | More confirmation and currently different scopes | Yes, via compatible import facade |
| DEV-005 | GUI self-update | OpenWrt package update mechanism | OPENWRT_NATIVE | Package manager owns installed files | Update UX differs | Yes, equivalent check/apply/status |
| DEC-001 | Failover cycles to primary after fallback exhaustion | Not implemented | EXPLICIT_USER_PRODUCT_CONSTRAINT | Behavior may cause repeated outage switching | Pending decision | Yes |
| DEC-002 | Stored route priority appears behaviorally inert at pinned baseline | Not implemented | EXPLICIT_USER_PRODUCT_CONSTRAINT | Reproducing a non-effect versus correcting it needs approval | Pending decision | Yes |
| DEC-003 | Avatar includes AWG, sing-box, mihomo, Opera and combined tunnels | Current project has not implemented them | EXPLICIT_USER_PRODUCT_CONSTRAINT | Inclusion is required; only implementation order and router resource limits await approval | Major missing product surface | Yes |

No other divergence is approved. In particular, “cleaner architecture,” existing implementation, easier maintenance and YAGNI are not deviation reasons.

## Parity Laws

1. The pinned Avatar baseline is the behavioral reference.
2. User-visible and domain behavior matches Avatar by default.
3. Internal implementation may be OpenWrt-native.
4. Stronger safety is allowed only when behavior is preserved.
5. A deviation requires explicit evidence and classification.
6. An existing different implementation is not justification for divergence.
7. Before implementing a subsystem, read the corresponding Avatar source.
8. Tests must characterize Avatar behavior before changing our subsystem.
9. New upstream Avatar behavior is not silently adopted; baseline refresh is deliberate.
10. No product model may be invented when Avatar already defines it.

## Evidence Discipline

This contract is pinned. Refreshing either SHA requires a deliberate new audit. A row may move to PARITY only with implementation evidence and a reachable consumer; backend-only capability remains PARTIAL. Infrastructure differences are not product differences when observable behavior is preserved. Every non-PARITY row above has a required action; every approved deviation is registered above.
