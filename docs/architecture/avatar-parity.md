# Avatar Behavioral Parity Contract

**Avatar behavioral baseline:** `avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c`  
**zapret2-manager audited baseline:** `t0fox/zapret2-manager@152cb642d5e3a994b3be73aa096530d7f8c2a408`

This audit compares user-visible behavior and domain models, not filenames or implementation language. Avatar is normative unless an approved deviation appears in the Deviation Register.

## Summary

| Status | Count |
|---|---:|
| PARITY | 0 |
| PARTIAL | 36 |
| MISSING | 30 |
| DIVERGENT | 8 |
| INTENTIONAL_DEVIATION | 4 |
| CONFLICT_REQUIRES_USER_DECISION | 3 |
| LEGACY_DEAD | 2 |
| **Product parity total** | **81** |

Two LEGACY_DEAD inventory rows are excluded from product-parity arithmetic.

## Top Product Parity Blockers

1. Avatar Strategy owns ordered `profiles[]`; ours exposes Profiles first and separately models Orchestra candidates.
2. Avatar strategy catalogs are not our service-domain catalog or Orchestra registry.
3. Scanner and BlockCheck/BlockCheck2 are three distinct Avatar flows; ours does not preserve all three product models.
4. Auto-remediation cannot reach parity until Scanner, DNS remediation and tunnel routing exist.
5. Avatar unified routing requires destinations/selectors, primary method, ordered fallbacks, monitoring and failover; ours lacks that product model.
6. Lua, blob and IP-set registries required by Strategies are absent.
7. AWG, usque/MASQUE/WARP, sing-box, mihomo and Opera lifecycle products are absent.
8. Avatar has 38 canonical SPA pages plus two legacy hash aliases; ours has seven canonical LuCI tabs plus one lists alias and several backend-only capabilities.
9. Cross-flow identity is missing between catalog Strategy, scan result, applied Strategy and status.
10. Several existing equivalents are safer internally but do not expose the complete Avatar user capability.

## Detailed Parity Matrix

| Avatar subsystem/feature | Avatar evidence | Avatar behavioral contract | Our evidence | Our current behavior | Status | Deviation reason | Required action |
|---|---|---|---|---|---|---|---|
| Dashboard | `web/js/app.js` routes `#dashboard`; `web/js/components/sidebar.js` dashboard entry | Global service/health/current Strategy/system shortcuts | `z2m-overview.js`; schema-3 `status.uc` | Status, service controls, resources and selected summaries exist | PARTIAL | — | Match Avatar cards, current Strategy identity, shortcuts and refresh semantics. |
| Global status | `core/system_info.py`, dashboard API consumers | Engine/process/system state plus active Strategy identity in one reachable view | `core/status-collector.uc`, `status-compat.uc`, `z2m-overview.js` | Runtime/system/upstream evidence exists, but active Avatar Strategy identity does not | PARTIAL | — | Add active Strategy identity while preserving schema 3. |
| Start/stop/restart | `core/system_control.py`; `api/system.py`; control page | Explicit lifecycle operations and results | rpcd `start/stop/restart`, Overview controls | Same user effect through init owner | INTENTIONAL_DEVIATION | OPENWRT_NATIVE (DEV-002) | Keep procd/init implementation and map Avatar result semantics. |
| Current Strategy display | dashboard/control/strategies consumers; `core/strategy_state.py` | Active Strategy ID/name/metadata visible | Profiles applied parse plus Orchestra preview in `z2m-strategy.js` | No single Avatar-compatible active Strategy identity | DIVERGENT | — | Add active Strategy projection after Strategy model parity. |
| Uptime/RAM/system | `core/system_info.py` | Visible uptime, memory and platform information | status collector `/proc`, uptime and memory observations | Substrate exists; field/UI equivalence is unproven | PARTIAL | — | Freeze and map each Avatar field and presentation. |
| Events/logs | `core/log_buffer.py`; `web/js/pages/logs.js` | Unified logs, filtering/tailing/copy/download | events tail, proxy logs, Maintenance/Monitoring views | Fragmented sources; no unified consumer | PARTIAL | — | Add Avatar-equivalent unified bounded log view. |
| Settings/expert/theme | `web/js/pages/settings.js`; config APIs | Product settings, expert-mode capability visibility, persistent UI settings | app advanced flag and native backend config | Expert mode partly exists; settings/defaults/theme differ | PARTIAL | — | Characterize exact Avatar defaults and expose equivalent settings. |
| Autostart/boot | `core/autostart_manager.py`; `#autostart` | Enable/disable, active Strategy interaction, inspect generated boot config | package enables service; init/procd and service actions | No Avatar-compatible Strategy autostart contract/view | PARTIAL | — | Bind boot persistence to active Avatar Strategy and expose state. |
| nfqws2 detect/version/path | `core/nfqws_manager.py`, `core/platform_dirs.py` | Detect binary/base path and expose version/path/failure semantics | status upstream/runtime and `/opt/zapret2` constants | Native detection exists; complete visible semantics are unproven | PARTIAL | OPENWRT_NATIVE (DEV-001) | Map Avatar fields/failures while retaining native paths. |
| Engine install/update/remove | `core/zapret_installer.py`, `binary_installer.py`, update pages | Lifecycle with progress/version/result | engine-provider/install RPC and Maintenance | Zapret2 lifecycle exists but UI/progress/version selection differs | PARTIAL | — | Match Avatar operations and visible outcomes. |
| Lua assets | `core/lua_manager.py`; `#lua` | List bundled/custom scripts, import/edit/delete, dependency checks | native preflight checks Lua function existence only | No Lua product registry/UI | MISSING | — | Implement Avatar Lua manager semantics on safe native storage. |
| Blob assets | `core/blob_manager.py`, `blob_registry.py`; `#blobs` | CRUD/generate/stats and Strategy requirements | native preflight checks blob existence only | No blob product registry/UI | MISSING | — | Implement binary-safe Avatar blob registry and references. |
| Engine dry-run/preflight | strategy preview/validation APIs and nfqws manager | Validate before apply | `native-preflight.uc`, `profiles-apply.uc` | Strong complete pinned native/Lua gate | INTENTIONAL_DEVIATION | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Retain stronger gate while preserving accepted Avatar strategies. |
| Strategy aggregate model | `core/strategy_builder.py` `StrategyManager`; `api/strategies.py`; strategies UI | Validated dictionary requires `id`, `name`, ordered `profiles[]`; Profile requires `id`, `args`, with `enabled` default true; enabled Profiles compile with `--new`; same-ID user Strategy overrides builtin | `profiles-draft.uc`; `orchestra-run.uc`; `z2m-strategy.js` | Profile-first drafts and separate candidate registry | DIVERGENT | — | Make these exact invariants public and reuse existing compiler underneath. |
| Profile belongs to Strategy | `strategy_builder.py` builds/validates profiles inside Strategy | Profiles are child runnable units, not top-level product | Profile CRUD RPCs are top-level | Profiles are primary public entities | DIVERGENT | — | Nest existing profile records under Strategy-facing API/UI. |
| Ordered/enabled profiles | `strategy_builder.py`; strategy editor | Explicit order and enable state affect whole Strategy preview/apply | ordered drafts/reorder; no Avatar enable model | Order parity exists; enable semantics absent | PARTIAL | — | Add Strategy-owned enabled state and compile enabled children only. |
| Builtin/user Strategies | `core/catalog_loader.py`; user strategy JSON; strategies API | Builtins read-only, users CRUD; source distinction | immutable Orchestra sources plus mutable drafts, no unified identity | Overlapping models not Avatar-compatible | DIVERGENT | — | One Strategy API preserving builtin restrictions and user CRUD. |
| Strategy metadata | `core/models.py`; `strategy_builder.py`; `api/strategies.py` | Stored description, author, label, source, featured and protocol/level data; API computes `is_favorite` | partial candidate provenance/tags | No complete Avatar metadata contract | PARTIAL | — | Preserve exact stored/computed distinction and stable IDs. |
| Strategy duplicate/custom/manual | `web/js/pages/strategies.js` duplicate-to-user flow | Duplicate builtin/user Strategy into editable user Strategy | profile clone only | Cannot duplicate whole Strategy | MISSING | — | Implement whole-Strategy duplicate and manual user Strategy. |
| Strategy preview | `api/strategies.py` preview; strategies UI | Preview whole Strategy compilation | profiles full-set preview | Whole ordered profile set preview exists but lacks Strategy identity/metadata | PARTIAL | — | Wrap exact existing preview in Strategy request/response. |
| Strategy validation/apply | builder validation and whole-Strategy apply | Validate and apply aggregate | mandatory profile validation, shared compiler, transactional apply | Safer full-set apply but public model differs | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Reuse transaction behind Avatar Strategy semantics. |
| Hostlist injection/autowrap | `strategy_builder.py`; tests for bare trick autowrap/quoting | Inject filters/assets and auto-wrap bare trick as Avatar specifies | lossless opaque fragments; no complete Avatar builder transforms | Compatibility fragments require manual expression | MISSING | — | Characterize builder transformations and implement exact compiler front-end. |
| Basic/advanced/direct/preset catalogs | `catalogs/**`; `core/catalog_loader.py` | Distinct catalog sources and stable Strategy IDs | `catalog/services.json`, Orchestra corpus/registry | Different domain catalogs | DIVERGENT | — | Import/map Avatar pinned catalogs; do not reuse service catalog identity. |
| Catalog protocol sets/labels | catalog metadata and scan UI | TCP/UDP/HTTP80/QUIC/Discord applicability; quick/standard/full; recommendation labels | Orchestra protocol/candidate modes | Partial protocol/corpus semantics | PARTIAL | — | Preserve Avatar classifications, order, labels and set membership. |
| Catalog update/reload | `core/catalog_updater.py`; `api/catalog_update.py` | Check/download/install catalog update while preserving users | service catalog revision/ownership ledger | Wrong catalog domain | MISSING | — | Implement strategy-catalog update with validation/preview and user preservation. |
| Strategy Scanner | `core/strategy_scanner.py`; `api/scan.py`; scan pages | Catalog Strategy executor with `quick|standard|full`, protocol/target/DPI filtering, resume index, baseline-aware success and apply by result index/Strategy ID | Orchestra runs | Evidence-gated runner exists but product semantics and catalog differ | DIVERGENT | — | Reproduce exact Scanner semantics using durable native jobs. |
| Scanner probes | scanner testers/models/targets | Baseline, IPv4/6, TLS/body/QUIC/STUN as selected | health matrix/Orchestra HTTPS-centric probes | Not full probe matrix | PARTIAL | — | Add each Avatar probe and verdict semantics. |
| Scanner progress/stop/resume | scan API/UI; scanner state | Ordered progress, stop and resume | run events, stop/pause/resume/continue | Stronger durable controls | PARTIAL | OPENWRT_NATIVE (DEV-002) | Map exact Avatar phases/progress/results onto jobs. |
| Scanner result ranking | scanner report/results | Working/failed Strategies, success rate and order | winner/evidence model | Different result/ranking semantics | PARTIAL | — | Implement Avatar report/ranking, retaining evidence IDs. |
| Scanner runtime/firewall cleanup | scanner cleanup paths | Preserve current runtime/firewall and cleanup errors | transactional apply/rollback; runner cleanup | Strong safety but Scanner-specific equivalence unproven | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Characterization tests for Avatar scan cleanup effects. |
| Scanner apply found Strategy | `/api/scan/results`, apply endpoint | Result maps/applies Strategy by ID/index | Orchestra preview hash/apply | Safer apply but wrong domain identity | PARTIAL | SECURITY_HARDENING_EQUIVALENT_BEHAVIOR (DEV-003) | Preserve Strategy identity through scan→preview→apply. |
| BlockCheck | `core/blockcheck.py`; `api/blockcheck.py` | Native probe/classification runner with `quick|full|dpi_only`, results/traceroute/domains | no direct equivalent | Missing distinct feature | MISSING | — | Implement separately from Scanner and BlockCheck2. |
| BlockCheck2 execution | `core/blockcheck2.py`; `api/blockcheck2.py` | Original bol-van subprocess with `SCANLEVEL=quick|standard|force`, BATCH/env, streaming, stop and parsed found Strategies | `jobs.uc` upstream script job | Durable job overlaps BlockCheck2 only | PARTIAL | OPENWRT_NATIVE (DEV-002) | Match test/repeats/parallel/env/result semantics and UI. |
| BlockCheck2 result→Strategy | parser/tests/UI | Reconstruct filters/tricks and transfer found Strategy | blockcheck apply path/raw profile integration | Not Avatar whole-Strategy conversion | PARTIAL | — | Produce Avatar user Strategy with profiles[]. |
| Block detector | `core/block_detector.py`; diagnostics consumers | Classify block type from probes | health matrix/classification differs | No Avatar block-detector contract | MISSING | — | Implement exact probe classes/result. |
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
| Strategy→runtime→status flow | catalog→Strategy profiles[]→preview→validate→apply→nfqws→status→autostart | Stable aggregate identity throughout | profile drafts→compiler→transaction→status; Orchestra separate | Flow works below aggregate but identity breaks | DIVERGENT | — | Add Strategy facade and active identity without replacing safe pipeline. |
| Scanner→Strategy apply flow | catalog Scanner→working result→Strategy apply | Tested Strategy identity preserved | Orchestra candidate→typed apply | Different catalog/result model | DIVERGENT | — | Rebuild product facade around native runner. |
| BlockCheck→recommendation | distinct BlockCheck classification | Diagnostic result informs remediation | blockcheck job and health matrix overlap | Product distinction incomplete | PARTIAL | — | Keep three independent flows. |
| Auto-remediation→DNS/Scanner/tunnel | `auto_remediation.py` | Classification dispatches exact subsystem | only auto-strategy | Missing flow | MISSING | — | Implement last, after dependencies. |
| Destination→method→fallback→monitor | unified modules | Complete route chain | absent | MISSING | — | Routing vertical slice before tunnel automation. |
| WARP→TUN→routing | usque + unified applier | WARP interfaces become route methods | absent | MISSING | — | WARP lifecycle then routing adapter. |
| Lists→Strategies/routing | managers + builder/unified model | Shared named selectors | lists feed profiles partially; no routing | Partial crossflow | PARTIAL | — | Stable list IDs/reference validation in both consumers. |
| DNS→routing | dns routing + unified applier | Resolver decisions support route selectors | separate DNS/service flows | Crossflow absent | MISSING | — | Integrate after unified routing. |
| Removed redirect-only legacy pages | Avatar pages are live | N/A | ours `strategies.js`, `orchestra.js` redirect to unified page | Compatibility alias inventory, not product parity | LEGACY_DEAD | OPENWRT_NATIVE (DEV-001) | Keep redirects and document replacement. |
| Legacy shared draft-state architecture | Avatar settings/user stores differ | N/A | `/etc/zapret2-manager/state.json` co-owned compatibility document | Retained only for current slices | LEGACY_DEAD | — | Migrate only in separately approved bounded work, not this audit. |

## Cross-Subsystem Flow Verdicts

| Flow | Verdict | Evidence and gap |
|---|---|---|
| Strategy catalog → Strategy → Profiles[] → preview → apply → status → autostart | DIVERGENT | Avatar builder/catalog/state owns one aggregate; ours splits Profiles and Orchestra, though `profiles-apply.uc` provides a reusable safe lower layer. |
| Scanner → catalog Strategies → working results → apply | DIVERGENT | Avatar `strategy_scanner.py` consumes catalog Strategies; ours Orchestra consumes other registries and requires different winner evidence. |
| BlockCheck → recommendation | PARTIAL | Avatar native BlockCheck is distinct; ours lacks equivalent classification UI. |
| BlockCheck2 → found Strategy | PARTIAL | Script job exists, but reconstruction does not yield Avatar Strategy aggregate. |
| Auto-remediation → Scanner | MISSING | `auto-strategy.uc` is not Avatar auto-remediation. |
| Auto-remediation → DNS fix | MISSING | No classification dispatcher. |
| Auto-remediation → tunnel | MISSING | No unified routing/tunnel method graph. |
| Destination → primary → fallbacks → monitor/failover | MISSING | Unified route model absent. |
| WARP → TUN → Unified Routing | MISSING | Both dependencies absent. |
| Lists → Strategy/Profile filters | PARTIAL | Existing fragments reference lists, but no Avatar stable Strategy/list contract. |
| Lists → Unified Routing | MISSING | Unified Routing absent. |
| DNS → Routing | MISSING | Existing DNS is separate from Avatar unified route decisions. |

## Known Strategy/Profile Result

Avatar’s authoritative domain model is **Strategy containing ordered Profiles[]**. Builtins come from catalogs; user Strategies have separate CRUD; preview and apply operate on the whole Strategy; the builder composes enabled profiles with `--new`, injects required filters/assets and applies Avatar’s bare-trick wrapping rules. Our baseline instead exposes ordered Profile drafts as the primary editable product and has a separate Orchestra candidate registry. The current full-set compiler, validation, preview, transactional apply, runtime verification, rollback and status are suitable implementation machinery underneath Avatar-compatible Strategy semantics, but they do not make the current public model parity. Status: **DIVERGENT**.

## Known Scanner Result

Avatar Scanner tests catalog Strategies using quick/standard/full modes, protocol and target selection, DPI filters and its complete probe/result/ranking semantics, then maps a working result back to Strategy application. Our Orchestra is durable, evidence-gated and rollback-safe, but uses different catalogs, request modes, probes, winner identity and UI semantics. It is not an Avatar Scanner replacement. Status: **DIVERGENT**.

## Dependency-Ordered Parity Program

1. Strategy/Profile aggregate and pinned strategy-catalog parity.
2. Lua, blob, hostlist and IP-set dependency registries.
3. Scanner parity using the native durable runner.
4. Separate BlockCheck and BlockCheck2 parity, including result→Strategy.
5. Block detector classification.
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
