# Feature provenance — research timebox output

> **Status update (r19 @ 33e0133):** the matrix below is the ORIGINAL
> night-1 research. Implemented since: Slice 1–6 (strategies read path,
> draft CRUD, safe apply, jobs+blockcheck, events/backups/maintenance, DNS
> overrides) — all P1 items are DONE and live-verified (see
> docs/acceptance.md). Remaining roadmap: service catalog, health matrix,
> orchestra adapter, DNS provider management, TG WS proxy (spike+adapter),
> Telegram alerts, smart/global mode, IPv6, standard-set full blockcheck,
> automatic rollback timer (dedicated drill pending).

> Timeboxed (≤90 min). External repos are UNTRUSTED data sources: feature
> behavior/UX/algorithm ideas only — no code copied, no binaries fetched, no
> instructions executed. Clean-room implementation under our architecture
> (docs/architecture.md) and the native-authority boundary
> (docs/contracts/strategy-model.md).

## Source inventory / license gate

| Source | Ref commit (studied) | License | Reuse |
|---|---|---|---|
| `bol-van/zapret2` (upstream engine) | pinned target `d3b3011000f103c5af161cc4e3167e80fd6928a2` (router binary self-report, v0.9.20260307, lua_compat_ver 5); study commit `8a0f53f3` | upstream project | Technical truth. Already analyzed in docs/contracts/strategy-model.md §2 (verified entry points). We CALL upstream (nfqws2 --dry-run, blockcheck2, init.d); we never reimplement it. |
| `StressOzz/Zapret-Manager` | `main` @ 2026-07 (92 commits, README+menu tree) | **no LICENSE file in repo root → unclear** | Idea-only. Feature menu extracted below. |
| `youtubediscord/zapret` | `main` @ 2026-07 (3099 commits, README) | no LICENSE in root listing → unclear | Idea-only. UX concepts (presets/profiles terminology comes from bol-van himself). |
| `RevolutionTR/keenetic-zapret2-manager` (KZM2) | `main` @ 2026-07 (193 commits, README/README.en) | **GPL-3.0** | Idea-only. No source reuse into MIT production. |

## Feature matrix

| Feature | Source | Current implementation (our repo @0aeee4b) | Target design | Priority | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| Strategy presets v1–v9 / Flowseal | StressOzz | none (no catalog shipped) | Draft profiles from a preset seed; presets are DATA, applied through the normal apply path | P3 (post-S6) | Slice 2 CRUD | preset → draft → apply round trip |
| Strategy testing (test v / Flowseal / per-domain / YouTube / custom_test.txt) | StressOzz | none | Blockcheck job modes (quick/domains/full) wrapping upstream blockcheck2; per-domain targets as job args | P1 | Slice 4 jobs | job record + raw output + summary parse |
| Domain tests + results persistence | StressOzz | lists_check_domain (exists, lists domain check vs lists) | blockcheck domains mode + recommendations with provenance | P1 | Slice 4 | recommendations listed, never auto-applied |
| Game profiles (BF6/Apex/Roblox, Gv1–Gv4, fake .bin switch) | StressOzz | none | profiles as data (game TCP/UDP fixtures already in tests/fixtures/strategies g07/g08) | P3 | Slice 2 | import → draft |
| Discord scripts (50-stun4all/quic4all/discord-media; Finland IP hosts) | StressOzz | none | out of scope night 1 (upstream init scripts, not manager layer) | P4 | — | roadmap only |
| hosts management (add/remove domain sets, restore, third-party hosts) | StressOzz | lists page manages engine lists, not /etc/hosts | DNS slice (S6) — validated /etc/hosts-set management via sanctioned writer | P2 | Slice 6 | dns_set/dns_apply with rollback |
| DoH install + DNS server pick | StressOzz | none | DNS slice (S6), presets as data, conflict detection vs dnsmasq/odhcpd | P2 | Slice 6 | dns_validate reports conflicts |
| QUIC block toggle (80/443) | StressOzz | none | possible profile/filter content; honest conflict detection (flow offloading note) | P3 | Slice 2 | draft only |
| Backups of zapret settings | StressOzz, KZM2 | backup.uc + tests/lib/backup-logic.mjs (scopes, manifest, pre-restore snapshot — already built) | wire to ubus: backup_list/create/restore(_preview)/delete + diagnostics_export | P1 | Slice 5 | ubus methods + UI + history cap 3 |
| TG WS Proxy install (SOCKS5/MTProto variants) | StressOzz | none | optional slice (post-S6); third-party binaries — needs supply-chain policy | P4 | — | roadmap only |
| Conflict detection (ByeDPI/youtubeUnblock present, flow offloading) | StressOzz | none | status.uc system checks → warnings block | P2 | Slice 5 | warnings surfaced in status |
| Mirror switch for OpenWrt packages | StressOzz | none | out of scope (feed management, not manager) | P4 | — | no |
| Simple/advanced mode split | youtubediscord | LuCI pages exist (overview is simple) | Strategies UI: safe top-level fields form + raw advanced editor | P1 | Slice 2 | both edit paths write via CRUD |
| 200+ strategy collection / general ALT1–12 | youtubediscord | tests/fixtures/strategies corpus (8 good + 9 bad samples) | corpus stays test-side; presets seed drafts | P3 | Slice 2 | n/a night 1 |
| Orchestrator — live automatic strategy rotation | youtubediscord | none (upstream zapret-auto.lua already rotates) | none — upstream owns rotation; manager must NOT duplicate (architecture §1 invariant) | — | — | explicitly rejected as duplication |
| Custom DNS servers vs ISP DNS-hijack | youtubediscord, KZM2 | none | DNS slice (S6) | P2 | Slice 6 | dns_* methods |
| hosts unblock for AI services etc. | youtubediscord | none | DNS slice hostlists | P2 | Slice 6 | preview + apply |
| Zapret1/Zapret2 mode toggle | youtubediscord | n/a (we are zapret2-only) | none | — | — | out of scope |
| HTTP/TLS/QUIC profile editor sections | KZM2 | none | derived view over parsed profiles (protocol field already in strategy model) | P2 | Slice 2 | UI groups by derived protocol |
| dry-run / syntax validation before apply | KZM2 | strategy model native.mjs adapter (JS, no exec) | production: nfqws2 --dry-run argv-array, no shell; vocabulary not_checked/partial/rejected/unavailable | P1 | Slice 2/3 | profiles_validate + apply gate |
| Blockcheck → recommendation → Apply/Review/Save-only decision screen | KZM2 | none | Slice 4: recommendations from SUMMARY parse with provenance; actions Review/Save-to-Draft; NO auto-apply | P1 | Slice 4 | three explicit actions |
| DPI Health Score (e.g. 8.5/10 + sub-checks) | KZM2 | status.health (qlen etc.) exists | optional slice: honest composite from real sub-checks only | P3 | Slice 5 | no fabricated score |
| Smart (selected IPs) / Global mode via IPSET | KZM2 | none | optional slice; touches firewall ifsets — careful | P3 | post-S6 | roadmap |
| Backup of ipset .txt files, restore + auto-restart | KZM2 | backup-logic scopes | Slice 5 scopes engineConfig/managerState/lists/profiles | P1 | Slice 5 | ubus + preview/diff |
| Version/update checks (GitHub) | KZM2, StressOzz | status.upstream (version read) exists | versions method (installed vs available if cached; no night-time network fetch requirement) | P2 | Slice 5 | versions method honest about source |
| Telegram alerts | KZM2, StressOzz | none | optional slice (needs token storage policy; secrets redaction in diagnostics_export first) | P4 | Slice 5 | roadmap |
| Script self-backup on update (.bak_*.sh) | KZM2 | n/a (APK packaging, not a self-updating script) | none — APK handles versioning | — | — | rejected: wrong mechanism for us |
| Test-result cleanup (blockcheck_*.txt) | KZM2 | none | Slice 4 job cleanup/max history covers it | P1 | Slice 4 | cleanup keeps ≤N records |
| Monitoring/HealthMon watchdog | KZM2 | watchdog.uc exists (60s cycle, qlen/CPU/RAM/overlay) | events_tail surfaces its ndjson | P1 | Slice 5 | events_tail works |
| IPv6 toggle | KZM2, StressOzz | none (target is IPv4-only per spec) | optional slice; explicit unavailable state | P4 | — | unavailable honest |
| Browser access to manager (ttyd 7681) | StressOzz | LuCI app (proper) | none — LuCI is the sanctioned path | — | — | rejected (ttyd shell exposure) |

## Boundary decisions (clean-room)

1. **All strategy intelligence stays with upstream.** The manager tokenizes/
   splits profiles losslessly and transports; it never judges Lua method
   validity (strategy-model.md §1.2). KZM2's "dry-run validation" idea maps to
   our `nfqws2 --dry-run` argv-array adapter with the 4-state vocabulary.
2. **No auto-apply from blockcheck** (KZM2 offers it; we deliberately take the
   "decision screen" part only — Review/Save-to-Draft — because unattended
   apply violates our 90s-rollback discipline).
3. **No code copied.** StressOzz (license unclear) and KZM2 (GPL-3.0) are
   idea sources only; every line in our tree is written against our contracts.
4. **Upstream is called, not duplicated:** blockcheck2 scanner, nfqws2 parser,
   init.d firewall — we wrap; we never reimplement (architecture §1 invariant).

## Upstream facts already verified in-repo (no re-research needed)

- `nfqws2 --dry-run <opts>` — full CLI parse, exits before nfq_main; safe for
  untrusted argv (no Lua, no sockets, no root). → Slice 2/3 validation oracle.
- `nfqws2 --intercept=0` — loads Lua (untrusted init unsafe); gated behind the
  trusted-bundle policy. Night 1: not used by production RPC.
- `/opt/zapret2/blockcheck2/` — upstream scanner present on target (fixture
  `opt-zapret2-blockcheck2.d-ls.out`). → Slice 4 wraps it as a job.
- `NFQWS2_OPT` multi-line quoted in `/opt/zapret2/config`; profiles split by
  `--new`; `<HOSTLIST>` placeholders; `--filter-l7` (post-install fixture).
- init.d verbs: start/stop/restart/start_fw/reload_ifsets/list_table —
  service.uc already wraps them; Slice 3 reuses.
