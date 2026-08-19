# Z2K Full Capability Parity Audit (Revised)

**Audited Upstream Repositories:**
- **`necronicle/z2k`** @ `z2k-enhanced`  
  Commit: `99be613303e00d42ed027d5197f6e353995bb353` (Date: Wed Aug 19 14:59:58 2026 +0300, Tag: `r-77.2`)
- **`necronicle/zapret2-z2k`** @ `z2k-master`  
  Commit: `8193742d8fde42fc646fbd10c0d2866572a54d3b` (Date: Tue Aug 18 12:01:41 2026 +0300)
- **`bol-van/zapret2`** @ `master`  
  Commit: `b08ae78778b602d246596435ea9b3f953f489828` (Date: Wed Aug 19 10:06:17 2026 +0300)
- **`t0fox/zapret2-manager`** @ `main`  
  Commit: `3c73e90eef8c3499152a950dd617de95a3b6ef58` (Date: Wed Aug 19 15:59:14 2026 +0300)

---

## 1. Executive Summary & Status Overview

| Metric | Value |
|---|---|
| **Total Audited Capabilities** | **36** |
| **PARITY** | **12** |
| **PARTIAL** | **11** |
| **MISSING** | **5** |
| **DIVERGENT** | **3** |
| **INTENTIONAL_DEVIATION** | **3** |
| **NOT_APPLICABLE** | **2** |

---

## 2. Complete Capability Matrix

| ID | Capability | Upstream Source Owner | zapret2-z2k Dependency | zapret2-manager Equivalent | Status | OpenWrt Relevance | Action | Verification / Evidence |
|---|---|---|---|---|---|---|---|---|
| **CAP-00** | C-Level Engine Patches (`z2k_tls_mod`, per-attempt loop) | `zapret2-z2k/nfq2/z2k_tls_mod.c`, `lua/zapret-antidpi.lua` | Patched nfqws2 binary | Stock `nfqws2` | **PARTIAL** | High (JA3 extension mutation) | Create minimal 3-patch series on `bol-van/zapret2` & `NFQWS2_COMPAT_VER` preflight check | Preflight validation test |
| **CAP-01** | Autocircular Domain State | `z2k-state-persist.lua`, `zapret-auto.lua` | `family_split` in `standard_hostkey` | `z2k-state-persist.lua`, `strategies-ops.uc` | **PARTIAL** | High (core bypass memory) | Port `family_split` into manager `zapret-auto.lua` | `test_z2k_state_persist.lua` |
| **CAP-02** | Synthetic / Non-Domain Keys | `z2k-modern-core.lua:z2k_nohost_key` | None | `z2k-modern-core.lua`, `strategies-ops.uc` | **PARTIAL** | High (Discord Voice / STUN) | Wire `z2k_nohost_key` in profile compiler and LuCI | Profile dry-run with `hostkey=z2k_nohost_key` |
| **CAP-03** | Persistent `state.tsv` & Atomic IO | `z2k-state-persist.lua` | None | `strategies-ops.uc` (`state_set`, `learned_rows`) | **PARITY** | High | Preserved at `/etc/zapret2-manager/state/autocircular` | File write and atomic replace test |
| **CAP-04** | Strategy Freeze / Unfreeze | `webpanel/cgi/actions.sh:rotator_freeze` | None | `strategies-ops.uc:state_set(mode='frozen')` | **PARITY** | High (LuCI rotator UI) | Retain ucode implementation | LuCI learned state modal freeze/unfreeze |
| **CAP-05** | Learned State Reset (Single / Pool / All) | `webpanel/cgi/actions.sh:rotator_reset` | None | `strategies-ops.uc:state_reset` | **PARITY** | High | Retain ucode implementation | `rpcd call zapret2-manager-engine state_reset` |
| **CAP-06** | RKN TCP Strategy Pool (50 strats) | `strats_new2.txt`, `config_official.sh` | C `z2k_tls_mod`, Lua per-attempt | `catalog/avatar/`, `stressozz-corpus.json` | **PARTIAL** | High (Russian ISP bypass) | Import upstream 50-strategy arsenal into Strategy Catalog | Strategy compiler structural parse & test |
| **CAP-07** | YouTube TCP Pool (22 strats) | `strats_new2.txt`, `config_official.sh` | None | `catalog/`, `z2k_yt_v2` | **PARTIAL** | High (YouTube bypass) | Import upstream 22-strategy pool | Strategy compilation & dry-run |
| **CAP-08** | GoogleVideo / GV Pool (22 strats) | `strats_new2.txt`, `config_official.sh` | None | `catalog/` | **PARTIAL** | High (GV CDN bypass) | Import upstream 22-strategy pool | Strategy compilation & dry-run |
| **CAP-09** | YouTube QUIC Pool (13 strats) | `config_official.sh`, `quic_strats.ini` | None | `catalog/` | **PARTIAL** | High (QUIC 443 bypass) | Import 13-strategy QUIC arsenal | QUIC profile compiler test |
| **CAP-10** | Discord Voice / STUN Pool (12 strats) | `config_official.sh`, `quic_strats.ini` | `z2k_nohost_key` | `z2m-strategies-model.js` | **PARTIAL** | High (Discord voice) | Synchronize 12-strategy STUN pool & UI rotator | UDP test fixture with mock STUN |
| **CAP-11** | Silent Drop Detector | `z2k-detectors.lua:z2k_silent_drop_detector` | None | `z2k-detectors.lua` | **DIVERGENT** | High (TV / webOS & browser preconnects) | Fix missing `return false` on `is_browser_cancel` | `tests/test_silent_drop_detector.lua` |
| **CAP-12** | 3-State HTTP Classifier | `z2k-detectors.lua:z2k_classify_http_reply` | None | `z2k-detectors.lua` | **PARITY** | High | Retain current implementation | `test_http_classifier.lua` |
| **CAP-13** | HTTP Success Positive-Only & No-Reset | `z2k-detectors.lua` | None | `z2k-detectors.lua` | **PARITY** | High | Retain current implementation | Unit test fixture |
| **CAP-14** | TLS Fatal Alert Detector | `z2k-detectors.lua:z2k_tls_alert_fatal` | None | `z2k-detectors.lua` | **PARITY** | High | Retain current implementation | Unit test fixture |
| **CAP-15** | QUIC Video Rotation Detectors | `z2k-detectors.lua:z2k_quic_success/stall` | None | None | **MISSING** | High (prevents QUIC video stalls) | Port `z2k_quic_success` & `z2k_quic_stall` | Unit tests for QUIC byte threshold |
| **CAP-16** | ClientHello / Server Alert Monitor | `z2k-alert.lua` (Aug 18, 2026) | None | None | **MISSING** | Medium (advanced TV stall detection) | Port `z2k-alert.lua` to `runtime-assets/lua/` | Standalone Lua test |
| **CAP-17** | QUIC Silent Drop Timer Detector | `z2k-quic-silence.lua` (Aug 19, 2026) | None | None | **MISSING** | Medium (fast QUIC failover) | Port `z2k-quic-silence.lua` | Standalone Lua test |
| **CAP-18** | QUIC Morph v2 & Timing Morph | `z2k-modern-core.lua` | None | `z2k-modern-core.lua` | **DIVERGENT** | High (anti-fingerprinting) | Synchronize `z2k_quic_morph_v2` (drop broken `live_chance`, fix `ipfrag=""`) | `test_quic_morph.lua` |
| **CAP-19** | Dynamic TTL Fooling | `z2k-fooling-ext.lua:z2k_dynamic_ttl` | None | `z2k-fooling-ext.lua` | **PARITY** | High (DPI evasion) | Retain Lua implementation | `test_dynamic_ttl.lua` |
| **CAP-20** | z2k-detect Staged Prober Engine | `z2k-detect/` (Go daemon) | Go runtime | `z2m-core-helper`, `scanner-worker.uc` | **DIVERGENT** | High (Complementary diagnostic flow) | Adapt staged algorithm (DNS->TCP->TLS->HTTP cutoff + neutral SNI test) into C helper without 6MB daemon | Unit tests for probe classifier |
| **CAP-21** | Autohostlist / Discovered Domains | `config_official.sh`, `discovered-domains.txt` | None | `zapret2-manager-domain-hub.uc` | **PARTIAL** | High (auto-discovery) | Connect probe discoveries to manager domain registry | Hub test on domain addition |
| **CAP-22** | Whitelist / Exclusion Engine | `config_official.sh:wl_excl` | None | `ipset-exclude.txt`, manager firewall | **PARITY** | High | Maintain managed `/etc/zapret2-manager/lists/whitelist.txt` | Rule verification |
| **CAP-23** | Russia Blocked GeoSite Import | `z2k-geosite.sh` (`runetfreedom`) | None | None | **MISSING** | High (daily updated domain lists) | Implement OpenWrt-native list fetcher (`ru-blocked.txt`) with RAM safety | Script fetch and RAM footprint test |
| **CAP-24** | Custom Pool Strategy Override | `lists/custom-strategies/<pool>.txt` | None | Strategy Model (`strategy-compiler.uc`) | **INTENTIONAL_DEVIATION** | High | Use manager Preview/Validate/Apply/Rollback transaction pipeline | Compiler dry-run test |
| **CAP-25** | Router Diagnostics Snapshot | `z2k-diag.sh` | None | `status.uc`, `zapret2-manager-monitor.uc` | **PARTIAL** | High | Add circular health & drop stats to schema-3 status | RPC status output check |
| **CAP-26** | List Auto-Updater & Cron | `z2k-update-lists.sh`, `z2k-scheduler.sh` | None | OpenWrt cron / procd | **PARTIAL** | High | Add cron job for daily list refresh with ETag support | Cron execution test |
| **CAP-27** | Telegram MTProto WS Proxy | `tg-mtproxy-client`, `z2k-tg-redirect.sh` | VPS MTProto Relay | `tg-ws-proxy-rs` / `tg-ws-proxy-go` + nftables | **PARITY** | High | Retain native Rust/Go daemons + OpenWrt nftables redirect | Local proxy connection test |
| **CAP-28** | Telegram IPv6 Conditional Fast-REJECT | `z2k-tg-redirect.sh` (ip6tables REJECT RST) | None | None | **MISSING** | High (fixes 40s mobile TG connection stall) | Add bounded nftables rule rejecting TG IPv6 DC CIDRs with enable/disable toggle | nftables rule test & TCP reset verification |
| **CAP-29** | Dual-Stack IPv4/IPv6 Rotator | `zapret-auto.lua:standard_hostkey` | `family_split` | `zapret-auto.lua` | **PARTIAL** | High | Suffix hostkey with `|4` or `|6` | Lua test with IPv4/IPv6 mock dissects |
| **CAP-30** | RST Filter (`DROP_DPI_RST`) | `tests/test_rst_filter_removed.sh` | None | None | **INTENTIONAL_DEVIATION** | Low (Characterized upstream failure) | Excluded with documented technical justification | Evidence verification |
| **CAP-31** | Silent Fallback Toggle | `tests/test_silent_fallback_removed.sh` | None | None | **INTENTIONAL_DEVIATION** | Low (Characterized upstream redundancy) | Excluded with documented technical justification | Evidence verification |
| **CAP-32** | WARP Game Routing (MASQUE) | `z2k-warp.sh` (`usque`) | `usque` / WARP endpoint | Planned for M6/M8 | **NOT_APPLICABLE** | High in future (Audit only for now) | Record architecture for unified routing milestone | Architecture documentation |
| **CAP-33** | Package Lifecycle & Rollback | `z2k-auto-update.sh` | Entware opkg | OpenWrt opkg + `strategy-state.uc` leases | **PARITY** | High | Retain OpenWrt package manager & lease rollback | Package test |
| **CAP-34** | Range Rand Randomizer | `z2k-range-rand.lua` | None | `z2k-range-rand.lua` | **PARITY** | High | Retain current implementation | Lua unit test |

---

## 3. Detailed Characterization of RST Filter & Silent Fallback

### 1. RST Filter Characterization
- **Mechanism**: Upstream previously attempted to drop incoming RST packets with IP ID `0x0000..0x000F` in `raw PREROUTING` via iptables u32 match (`DROP_DPI_RST`).
- **Failure Mode**:
  1. Linux origin servers emit IP ID 0 on RST packets when DF (Don't Fragment) bit is set (standard Linux kernel IP ID behavior per RFC 6864). The filter was dropping legitimate server connection terminations.
  2. The kernel conntrack state machine was blinded: TCP connections remained in `ESTABLISHED` state while the server had reset the connection, preventing `standard_failure_detector` from observing RSTs and rotating strategies.
- **Upstream Resolution**: Removed in commit `8193742d8fde42fc646fbd10c0d2866572a54d3b` and verified by `tests/test_rst_filter_removed.sh`.
- **Classification**: `INTENTIONAL_DEVIATION`.

### 2. Silent Fallback Characterization
- **Mechanism**: A boolean flag (`RKN_SILENT_FALLBACK`) attempting to insert `--payload=tls_client_hello,empty` before the circular token in `config_official.sh`.
- **Failure Mode**: The circular token already operates over `--payload=all`. Injecting a separate payload token created command-line ordering bugs and was completely redundant with `z2k_silent_drop_detector`.
- **Upstream Resolution**: Excised in upstream release r-77.1 and verified by `tests/test_silent_fallback_removed.sh`.
- **Classification**: `INTENTIONAL_DEVIATION`.

---

## 4. Detailed Characterization of z2k-detect

- **Nature**: Complementary diagnostic and auto-discovery engine.
- **Upstream Staged Algorithm**:
  1. Watches DNS queries via dnsmasq/AGH tail.
  2. Performs staged active probe:
     - DNS resolution (`getaddrinfo`).
     - TCP:443 3-way handshake.
     - TLS ClientHello with target SNI (TLS 1.3 followed by TLS 1.2 retry if 1.3 fails).
     - HTTP GET request with 32KB bounded read cutoff to distinguish early DPI RST from successful deep response.
     - Neutral SNI probe (`example.com`) to the same resolved IP address.
  3. Classification:
     - If target SNI fails but neutral SNI succeeds -> `PathSNI` (DPI censorship).
     - If both target SNI and neutral SNI fail -> `PathIP` (IP-level blocking).
     - If origin returns TLS alert or connection refused -> `PathServer`.
- **OpenWrt Integration Strategy**:
  - The upstream Go daemon binary is ~6.3MB, exceeding typical router flash storage and RAM limits.
  - Manager adapts this exact 5-stage algorithm into `z2m-core-helper/scanner.c` (C native helper) and `scanner-worker.uc`, preserving exact `FailureCode` and `PathVerdict` semantics while consuming < 2MB RAM.
- **Classification**: `DIVERGENT` (Implementation divergence; behavioral parity).

---

## 5. Bounded Telegram IPv6 Fast-Reject Specification

- **Problem**: Telegram mobile clients on cold start race IPv4 and IPv6 DC endpoints in parallel. When ISP drops IPv6 DC packets silently, mobile clients stall for 40 seconds before falling back to IPv4.
- **Design**:
  - **Bounded Scope**: Restricted strictly to official Telegram IPv6 DC CIDRs (`2001:67c:4e8::/48`, `2001:b28:f23d::/48`, `2a0a:f280::/29`).
  - **UCI Configuration**:
    - `config telegram 'main'`
      - `option ipv6_reject 'auto'` (`auto` | `enabled` | `disabled`)
  - **Behavior**:
    - `enabled`: nftables rule `ip6 daddr { 2001:67c:4e8::/48, ... } tcp dport { 80, 443 } reject with tcp reset` injected in `inet fw4 prerouting`.
    - `disabled`: No rejection rule injected; IPv6 Telegram connects natively.
    - `auto`: Default mode. Enabled if Telegram IPv4 WS proxy is active and IPv6 DC connectivity test fails.
