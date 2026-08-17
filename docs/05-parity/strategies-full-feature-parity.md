# P03-FULL — Strategies feature parity audit

Status: `CLOSED`  
P04: `NO`

This is the source-driven closure record for the frozen donor and the current
Forgejo catalog. Z2M keeps LuCI, rpcd/ubus, ucode, canonical Strategy state,
procd and nfqws2 as the authorities; donor HTTP/Python APIs are not imported.

## Frozen sources

| Source | Evidence |
|---|---|
| Donor | `G:\\avatarDD\\zapret-gui-p03`, SHA `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` |
| Current upstream | `https://git.zapret.moe/zapretdiscordyoutube/zapretgui`, SHA `6824294ee53421cc9c3e2a361f4976783ff62307` |
| Current catalog paths | `src/system/strategy_catalogs/winws2/{http80,tcp,udp,voice}.txt` |
| Z2M route | `z2m-strategy-page.js` → `z2m-strategies.js` → `z2m-api.js` → `zapret2-manager` |

## Feature matrix

`IMPLEMENTED` means the useful donor behavior is present under the canonical
Z2M boundary. `ADAPTED_BOUNDARY_ONLY` records an intentional source/runtime
difference with an explicit guard or empty-source result. There are no silent
omissions.

| DONOR_FEATURE | DONOR_SOURCE | DONOR_API | DONOR_BACKEND_FILE | DONOR_STATE | DONOR_ASSETS | Z2M_IMPLEMENTATION | TEST | BROWSER_RESULT | CLASSIFICATION |
|---|---|---|---|---|---|---|---|---|---|
| catalog load, status, update, reload | `web/js/pages/strategies.js`, `core/catalog_loader.py` | `GET /api/strategies`, catalog status/update | `api/strategies.py`, `core/catalog_updater.py` | immutable verified manifest | four Forgejo catalog files | local verified catalog is critical-path; update is explicit transactional fetch/validate/activate | P03-FULL contract; target source/status/update canary | PASS: 4 files / 639 unique entries visible | IMPLEMENTED |
| current Forgejo provenance | `core/catalog_loader.py` | source/revision fields | `core/catalog_updater.py` | source URL/SHA in manifest | `src/system/strategy_catalogs/winws2/*.txt` | official Forgejo URL/SHA and per-file hashes; no obsolete operational source | provenance contract; target `strategies_catalog_source` | PASS: source shown by target RPC | IMPLEMENTED |
| metadata, builtin/user, labels | `core/catalog_loader.py`, `strategies.js` | strategy metadata in list/get | `core/models.py`, `api/strategies.py` | canonical strategy records | catalog metadata fields | author, label, protocol, profile and provenance metadata are normalized | model/UI contracts | PASS: metadata visible on cards | IMPLEMENTED |
| recommended green semantics | `strategies.js`, donor CSS selectors | list metadata | catalog loader | `label=recommended` remains distinct | label metadata | recommended badge/card accent uses Z2M green token; normal cards are not green | P03-FULL contract | PASS: `recommended` cards visibly marked | IMPLEMENTED |
| featured priority | `core/strategy_builder.py`, `catalog_loader.py` | featured metadata | catalog loader | `featured` remains separate from recommended | optional `featured` field | stable featured-first sort/filter when source provides the field | model contract | PASS: filter exercised; current Forgejo `featuredIds=[]`, so empty result is source-correct | ADAPTED_BOUNDARY_ONLY |
| favorites | `strategies.js`, `api/strategies.py`, `core/strategy_state.py` | favorite mutation + revision | canonical Strategy state | `/etc/zapret2-manager/strategy-state.json` | none | revisioned favorite persistence and filter; no Apply side effect | P03-FULL contract; target RPC; browser reload | PASS: star persisted and returned after reload | IMPLEMENTED |
| search and supported filters | `list_ui.js`, `strategies.js` | none per keystroke | client-side donor behavior | local view state only | metadata/args | immediate local search; all/circular/favorite/featured/recommended/builtin/user filters | P03-FULL contract | PASS: all seven controls exercised; empty filters remain explicit | IMPLEMENTED |
| card details and full actions | `strategies.js` | get/preview/validate/create/update/delete/duplicate/apply | canonical Strategy CLI/RPC | Strategy revision/identity | dependency metadata | details, Preview, Validate, duplicate, delete/edit controls and Apply confirmation | existing Strategy tests + browser Preview/details | PASS: details and command Preview; Apply intentionally not run | IMPLEMENTED |
| copy vs clipboard | `strategies.js`, `utils/clipboard.js` | none / import RPC | clipboard helper + import adapter | no mutation for copy/export | plain command text | `Копировать` duplicates a Strategy; `В буфер` exports plain nfqws2 text; HTTP fallback prompt path retained | model/UI contract | PASS: exported text read; import opened editor | IMPLEMENTED |
| bulk selection | `list_ui.js`, `strategies.js` | none | transient page state | selection clears on route destroy | none | checkbox selection survives filter rerender; sticky count and clear action | P03-FULL contract | PASS: `Выбрано: 2`, clear action | IMPLEMENTED |
| combine | donor combine helper and `strategies.js` | inline Preview | canonical compiler/preview | editor draft only until explicit save | profile/dependency metadata | profile boundaries and order preserved; compiler receives `--new` structure | model/UI contract; target inline Preview | PASS: combined Preview returned `--new`; not saved | IMPLEMENTED |
| create/edit/delete/duplicate | `api/strategies.py`, `core/strategy_builder.py` | CRUD RPCs | `strategy-state.uc`, Strategy CLI | user files + revision CAS; builtin immutable | validated profile/dependency data | canonical user CRUD and duplicate, with confirmation for destructive delete | existing Strategy product contracts | PASS: create/editor surface opened; persistent destructive actions not run | IMPLEMENTED |
| nfqws2 IDE syntax/highlight | `utils/syntax.js`, editor components | none | canonical validation remains backend authority | draft only | canonical syntax module | overlay syntax highlighting over a multi-profile editor | P03-FULL UI contract; browser DOM | PASS: `data-ide=syntax-highlighted` | IMPLEMENTED |
| lint and diagnostics | `utils/nfqws2_lint.js`, editor components | none | compiler validation on Preview/Validate | draft only | syntax/spec data | unknown flags, warnings, red/amber diagnostic range and missing-target hint | P03-FULL UI contract; browser DOM | PASS: unknown flag + missing-target visibly rendered | IMPLEMENTED |
| autocomplete and token help | `utils/autocomplete.js`, editor help | resource helpers | bounded `assets_list` RPC | no persistence | flags + server asset list | Ctrl+Space completion, syntax/spec help and lazy resource fetch | P03-FULL contract; browser Ctrl+Space | PASS: `--f` completed to `--filter-tcp` | IMPLEMENTED |
| active Strategy, debug, journal | `strategies.js`, `api/strategies.py` | debug get/set; logs route | canonical lifecycle/log readers | runtime observed state | shared event/log stream | debug mutation is backend lifecycle-owned; journal link uses Z2M diagnostics route | P03-FULL RPC/UI contract; target debug canary | PASS: debug toggled/restored; journal navigated to `#/logs` | IMPLEMENTED |
| autocircular and learned state | `core/strategy_state.py`, donor autocircular card | state/reset endpoints | `strategy-state.uc`, `strategies-ops.uc` | `/etc/zapret2-manager/state/autocircular/state.tsv` | dependency guard for Lua/blob/list refs | read-only summary, host/key/all reset, auto filter; absent dependencies never appear ready | P03-FULL model/backend contract; target state canary | PASS: learned card and auto filter visible; current Forgejo has no circular rows | ADAPTED_BOUNDARY_ONLY |
| healthcheck / auto-repair | `core/healthcheck.py`, `api/healthcheck.py` | status, run, enable/disable, config | bounded `health_matrix` async job adapter | `/etc/zapret2-manager/strategy-healthcheck.json` + bounded history | checked services/domains | default OFF; nonblocking one-shot; threshold/config/auto-reset/outage guard; no frontend worker | P03-FULL backend contract; target async canary | PASS: one-shot accepted and status polled; settings action no native-prompt error | IMPLEMENTED |
| runtime asset readiness | donor `import/lua/*`, blob/list managers | assets list/validate | canonical asset registry/compiler dependency checks | registry/runtime evidence | only required assets, no repository copy | asset references are validated and missing dependencies are exposed as unavailable, never ready | asset compiler tests; target asset/list and Preview canaries | PASS: Preview returned command; validation remains separate and failed closed | ADAPTED_BOUNDARY_ONLY |
| lazy initial load / no duplicate reads | donor page lifecycle and ListUI | none | existing RPC snapshot boundaries | view state only | catalog manifest deferred update | initial render uses list/catalog/status/profiles only; IDE, learned, health and assets are lazy | P03-FULL load contract | PASS: page rendered cards before operational panels completed | IMPLEMENTED |

## Closure evidence

| Gate | Result |
|---|---|
| Current donor audited | PASS — frozen source and required donor modules inspected |
| Current Forgejo upstream audited | PASS — exact SHA, four current paths, hashes and manifest recorded |
| Focused P03 tests | PASS — 17/17 UI/model/route contracts |
| JS syntax and diff checks | PASS — changed JS `node --check`; `git diff --check` clean |
| Target ucode/RPC canaries | PASS — raw RPC registration, source/status, state, debug, Preview and async Healthcheck |
| Catalog update safety | PASS — candidate validation, backup, atomic activation and rollback path; update activated on target |
| Direct deployment | PASS — exact changed closure streamed directly; local/target SHA matched for deployed files |
| Owner/mode/reload | PASS — root ownership/modes; minimal `rpcd` restart only |
| Real Browser acceptance | PASS — one authenticated same-tab session; safe actions only, no Apply/reboot |
| LAN/live traffic E2E | `ROUTER_E2E: NOT RUN` — no WAN/LAN traffic or firewall mutation was required |
| P04 started | NO |
