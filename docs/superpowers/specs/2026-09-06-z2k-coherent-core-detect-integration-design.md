# Z2K Coherent Core + Detect Integration Design

## Status

Approved architectural design for replacing the current partially-coupled Z2K integration with one coherent Z2K Core lifecycle and using upstream `z2k-detect` as the sole DPI detection engine.

## Goal

Make Z2K a single, version-coherent component inside zapret2-manager where runtime assets, official strategies, consumed lists, `z2k-detect`, compiler inputs, compatibility identity, diagnostics and migration all belong to the same exact Z2K release. Remove independent Z2K strategy refresh and retire the Manager-owned DPI scanner engine from production detection.

## 1. Scope and ownership

The user-visible product has one Z2K component: **Z2K Core**. The following are internal capabilities owned by that component, not independently updatable products:

- Z2K runtime Lua.
- Z2K fake/blob assets.
- Z2K release-owned lists and ipsets.
- Official Z2K compiler inputs.
- Compiled official Z2K strategy catalog.
- Architecture-specific upstream `z2k-detect` binary.
- Z2K release identity and compatibility identity.
- Z2K diagnostics relevant to the runtime bundle.
- Autocircular runtime dependencies and semantic pool identity.

The ownership boundaries are:

- **Z2K Core** owns installation, update, downgrade, repair, rollback and release coherence.
- **Upstream `z2k-detect`** owns DPI measurement and classification algorithms.
- **Strategy subsystem** owns persistent strategy selection and apply.
- **zapret2-manager** owns orchestration, security, LuCI/RPC presentation, transactionality, receipts, health status and user-facing state.
- **procd** owns long-running `z2k-detect run` process supervision on OpenWrt.

The following upstream platform owners are not copied into Z2M because Z2M/OpenWrt already owns those concerns:

- Z2K webpanel.
- Keenetic `ndm/*` hooks.
- Keenetic `S99*` init lifecycle.
- Z2K product auto-updater.

Their useful behavior may be represented by Z2M where required, but they must not become parallel lifecycle owners.

## 2. Coherent release model

A Z2K release candidate is immutable and contains all required artifacts before activation:

```text
Z2K Release Candidate
├── releaseIdentity
│   ├── version
│   ├── sourceCommit
│   ├── manifestSeq
│   ├── manifestSha256
│   └── classificationSha256
├── runtimeAssets[]
│   ├── Lua
│   ├── fake/blob
│   ├── hostlists
│   └── ipsets
├── detection
│   └── z2k-detect-<router-arch>
├── compilerInputs[]
├── compiledStrategies[]
└── compatibilityIdentity
```

The lifecycle must support both historical `r-*` and current `p-*` release names. A release is valid if it matches either historical/current family accepted by the upstream catalog. `latest` must come from authoritative upstream release metadata, not lexical prefix ordering.

The compatibility identity is calculated only after all candidate content is known and validated. Conceptually it binds:

```text
release
sourceCommit
manifestSha256
runtimeBundleDigest
detectBinarySha256
compilerSnapshotDigest
compiledCatalogDigest
```

The exact serialization and digest function are implementation details, but the identity must change whenever any semantically relevant release-owned input changes.

No supported state may exist where Core, Strategies and Detect belong to different Z2K revisions.

## 3. Installation, update, downgrade and rollback

### 3.1 Clean install

A clean install prepares the full selected Z2K release without mutating the active system:

```text
resolve selected release
→ resolve exact sourceCommit
→ verify authoritative manifest
→ detect router architecture
→ fetch exact runtime assets
→ fetch one matching z2k-detect binary
→ fetch compiler inputs from the same revision
→ compile official strategy catalog
→ dependency closure
→ native preflight
→ detect binary executable/self-check
→ build compatibilityIdentity
→ commit
```

Only a fully prepared candidate may activate. Missing required Detect binary, runtime asset, list, compiler input or failed compatibility validation rejects the whole candidate.

### 3.2 Update

For `p-X → p-Y`, active `p-X` remains untouched while `p-Y` is fully prepared in staging. Activation is a single coherent switch. Failure before commit destroys the candidate and leaves the current LKG untouched.

The update transaction must not replace active Lua, lists, strategies or binary incrementally before all other candidate pieces are ready.

### 3.3 Active strategy handling

If the active strategy is an official Z2K strategy, the candidate catalog must contain the same canonical strategy ID. The same ID is recompiled/preflighted against the candidate runtime and remains selected after commit. If the canonical ID disappears, the update is blocked rather than silently selecting another strategy.

If the active strategy comes from Avatar or User sources, it remains selected. The candidate Z2K runtime must validate the active strategy against the staged runtime before update commit. Incompatibility blocks the update.

### 3.4 Downgrade

Downgrade is the same coherent pipeline targeting an older release. It must restore runtime, strategies, Detect and release-owned data from that historical release together. A historical release may be shown in the catalog while being marked not coherently installable if required exact artifacts cannot be reconstructed.

### 3.5 Rollback and repair

Any failure during activation must restore the exact previous physical LKG, not only metadata. Repair targets the same currently installed release identity and reconstructs its exact coherent bundle; repair is distinct from updating to latest.

## 4. Full Core bundle contents

### 4.1 Current runtime Lua

The target current upstream Lua set is:

- `files/lua/z2k-alert.lua`
- `files/lua/z2k-fooling-ext.lua`
- `files/lua/z2k-modern-core.lua`
- `files/lua/z2k-quic-silence.lua`
- `files/lua/z2k-range-rand.lua`
- `files/lua/z2k-state-persist.lua`

The old `z2k-detectors.lua` must leave production runtime after a migration proof demonstrates that every function referenced by the current compiled official strategy catalog resolves from the current coherent runtime. There must be no hidden legacy fallback.

### 4.2 Fake/blob assets

All `files/fake/*` entries that are part of the selected release and actually consumed by the compiled catalog/runtime/Detect dependency graph are lifecycle-managed exact assets. The implementation must not hard-code an eternal count such as “21 blobs”; membership comes from exact release metadata plus current classification rules.

### 4.3 Release-owned lists and data

Current upstream consumed lists include, at minimum when required by the selected release/feature graph:

- `sni_wl_candidates.txt`
- `tcp16_targets.txt`
- `tcp16_nets.txt`
- `rkn-false-positive.txt`
- `ipset-exclude.txt`
- `meta-ranges.txt`
- `cf_extra_check_ips.txt`
- `extra-domains.txt`
- `telegram_ips.txt`

Additional current release-owned lists are integrated when actual runtime/compiler/Detect consumption proves they are required. Unknown newly-consumed upstream files must not be silently ignored; the candidate becomes unsupported/inconsistent until classification is updated.

`sni_wl_candidates.txt`, `tcp16_targets.txt` and `tcp16_nets.txt` are first-class runtime dependencies rather than advisory metadata when current upstream semantics consume them.

### 4.4 Compiler inputs

Official Z2K strategies are generated only from exact compiler inputs belonging to the selected Core release:

- `strats_new2.txt`
- `quic_strats.ini`
- `lib/utils.sh`
- `lib/strategies.sh`
- `lib/config_official.sh`

The official Z2K strategy source must not independently refresh branch HEAD. The compiled catalog is a derivative of the installed/selected Core release.

## 5. z2k-detect integration

### 5.1 Upstream binary as source of truth

Z2M must not port or reimplement the scanning algorithms in ucode. The original upstream architecture-specific `z2k-detect` artifact is integrated as part of Z2K Core and updated/downgraded with that Core release.

Only one binary matching the router architecture is installed. Its expected digest is part of candidate validation and compatibility identity.

The full upstream command surface is integrated:

- `probe`
- `classify`
- `quic`
- `voice`
- `tcp16`
- `run`

### 5.2 RPC adapter

The browser never executes arbitrary CLI text. Z2M owns typed RPC methods that validate inputs, resolve the installed coherent Detect binary, construct argv without shell interpolation, run a bounded process, consume JSON output and validate its result schema.

Conceptual RPC surface:

```text
z2k_detect.status
z2k_detect.probe
z2k_detect.classify
z2k_detect.quic
z2k_detect.voice
z2k_detect.tcp16
z2k_detect.discovery_status
z2k_detect.discovery_enable
z2k_detect.discovery_disable
z2k_detect.discovery_restart
```

Each one-shot execution has bounded wall time, stdout, stderr and concurrency. Child processes are killed on timeout/cancellation. Browser clients cannot supply arbitrary flags or executables.

Only JSON output is authoritative. Human-readable stdout is not parsed with regexes. Unknown additive fields may be tolerated where safe, but missing/wrong required semantic fields return `EDETECT_SCHEMA`.

### 5.3 Long-running autodiscovery

`z2k-detect run` is a procd-managed service, not a long-lived RPC child. Manager controls enable/disable/restart/status while procd owns restart behavior.

The data flow is:

```text
DNS observation
→ z2k-detect run
→ probe
→ HOT verdict
→ discovered-domains.txt
→ nfqws2 inotify
→ subsequent traffic uses bypass
```

Producer/authority/consumer boundaries are explicit:

- producer: `z2k-detect`
- user-visible/persistent list management: Z2M
- consumer: `nfqws2`

Discovered domains are user/runtime learned data, not release-owned assets, and must survive Core updates and migration.

## 6. Scanner replacement

The current Manager-owned DPI scanner engine is retired from production detection. Existing useful UI/session/RPC shell may be preserved temporarily, but detection results must come only from `z2k-detect`.

There must be no production fallback of the form “if Detect fails, run the old scanner.” If Detect is absent, invalid or incompatible, detection is unavailable and the UI reports the reason.

During migration the old scanner may remain as an unwired or shadow-only regression oracle for bounded comparison. After real-router parity is proven, its production worker/prober/classifier implementation is removed.

The resulting boundary is:

```text
LuCI Scanner / Diagnostics
→ Z2M typed RPC adapter
→ exact installed z2k-detect --json
→ bounded schema validation
→ LuCI result
```

Persistent strategy application remains owned by Strategy APIs. Detect may recommend a strategy but does not directly persistently apply it.

## 7. Geosite, dynamic lists and diagnostics

### 7.1 Geosite

Geosite functionality is integrated functionally rather than merely watched for upstream drift. If exact upstream `z2k-geosite.sh` can be safely invoked on OpenWrt without taking lifecycle ownership, Z2M may execute it under controlled staging/validation. If its platform-specific portions conflict with OpenWrt ownership, Z2M reproduces only the required data-generation behavior.

The required lifecycle is staged download/generation, validation and atomic publish.

### 7.2 Dynamic external datasets

Immutable release-owned lists are part of Core identity and change only with Core release activation. Dynamic externally refreshed datasets are Manager-managed data revisions and do not change Core compatibility identity when their schema remains compatible.

Downgrading Core does not automatically roll dynamic data back unless the target Core requires another schema or incompatible dataset format.

### 7.3 Diagnostics

Useful Z2K diagnostic semantics are exposed through Manager. If current exact `z2k-diag.sh` is safe and portable, it may be invoked; platform-specific checks are represented with equivalent Manager evidence.

Diagnostics cover at least:

- release identity
- activation receipt
- runtime composition
- Lua load order and referenced functions
- blob/fake assets
- runtime lists
- compiler snapshot
- official strategy catalog
- compatibility identity
- Detect binary and JSON contract
- autodiscovery service
- discovered domains
- autocircular storage
- TCP16 state
- NFQUEUE
- firewall
- nfqws2 process

## 8. TCP16, SNI and autocircular

### 8.1 TCP16

TCP16 is integrated as a full mechanism, not only a one-shot button. Required curated targets/lists, Detect probing and resulting runtime state used by current `z2k-alert.lua` semantics must remain coherent.

### 8.2 SNI candidate selection

`sni_wl_candidates.txt` is a required exact runtime asset whenever current official strategy/runtime semantics reference it. Candidate preparation fails if a strategy that needs SNI rotation would activate without the list.

### 8.3 Autocircular

Upstream `z2k-state-persist.lua` remains exact-managed. Manager remains control plane for learned-state display, freeze/unfreeze, reset and debug.

Each semantic strategy pool must have a `poolSemanticDigest`. Learned strategy indexes are valid only against the pool semantics they were learned from.

On Core update:

- same pool digest → preserve learned state
- changed pool digest → reset only affected keys

Legacy learned rows without provable pool identity are reset during the one-time legacy-to-coherent migration because an integer strategy index cannot safely be interpreted against a changed pool. User strategy selection, exclusions, discovered domains and unrelated user data are not reset.

## 9. Migration

### 9.1 Legacy detection

Existing installations are classified as `LEGACY_Z2K` or `COHERENT_Z2K`. Old verified receipts remain readable evidence but are not treated as proof of the new coherent contract.

A new receipt revision (conceptually `asset-activation-receipt.v3`) records at least:

- release
- sourceCommit
- manifestSeq
- manifestSha256
- classificationSha256
- runtime membership
- detect architecture and digest
- compiler inputs digest
- catalog digest
- compatibilityIdentity
- installed authority revision

V1/V2 may be read/verified as `LEGACY_VERIFIED`; V3 proves `COHERENT_VERIFIED`. After the first successful coherent activation, Manager writes only the new contract.

### 9.2 Migration flow

Before migration, capture a legacy LKG evidence snapshot containing version, source commit if known, receipt, asset hashes, active strategy, compiled strategy digest, runtime config/service state and learned state.

Migration then uses the ordinary coherent update pipeline to prepare a selected current release. Failure leaves the legacy system operating unchanged. Clean reinstall is not required.

### 9.3 User/runtime data preservation

Preserve and normalize runtime learned/user-owned data such as discovered domains. Do not treat it as release membership. Dynamic datasets remain independently managed when compatible.

## 10. UI design

### 10.1 Components

The Components page shows one Z2K Core card. Healthy state requires the full bundle to be coherent.

Example healthy card:

```text
Z2K Core                                  ● Работает
p-X

Strategies          8 официальных
Z2K Detect          Работает · arm64
Runtime             6 Lua · N blobs · N lists
Автообнаружение     Включено
Совместимость       ● Синхронизировано

[Подробнее]
```

Expanded details show release, source commit, manifest sequence/digest, runtime bundle digest, compiler/catalog identity, Detect version/architecture/digest and compatibility identity.

Update available shows installed and authoritative latest release and states that Runtime, Strategies and Detect update together.

Prepare failure explicitly says the current installed version continues working. Physical installed corruption offers **Repair** of the same release rather than implying an update.

### 10.2 Resources

Z2K source is lifecycle-managed by Core:

```text
Z2K
necronicle/z2k

● Актуально
Версия p-X
Стратегий 8
Z2K Detect arm64

Управляется Z2K Core

[Отключить]
```

There is no independent Z2K `Обновить` button. `Обновить всё` refreshes independent sources such as Avatar and skips Z2K. Backend direct refresh attempts return `EMANAGED` with owner `z2k-core`.

### 10.3 Scanner

The existing “Сканер” product area may remain, but its semantics become a frontend to Detect:

- Проверка домена → `probe`
- Тип блокировки → `classify`
- QUIC → `quic`
- Discord Voice → `voice`
- TCP16 → `tcp16`
- Автоматическое обнаружение → `run`

Controls tied only to legacy scanner planner heuristics are removed rather than emulated.

Discord Voice is a first-class diagnostic view and must distinguish target discovery, general UDP control, Discord-specific blocking, recommended working arm and current autocircular arm when available.

### 10.4 Product-area boundaries

- Components = installation and coherent health
- Resources = available sources/data ownership
- Scanner = network measurement via Detect
- Strategies = selection/application of bypass configuration

These concerns are not mixed in the UI.

## 11. Error contracts

The integration uses typed errors rather than generic failure strings. Required families include:

```text
EZ2K_NOT_INSTALLED
EZ2K_INCOHERENT
EDETECT_UNAVAILABLE
EDETECT_INCOMPATIBLE
EDETECT_TIMEOUT
EDETECT_FAILED
EDETECT_SCHEMA
EDETECT_NO_TARGET
EDETECT_NO_ACTIVE_VOICE
EDETECT_NETWORK_UNKNOWN
EMANAGED
ECOMPATIBILITY
```

Examples:

- `EDETECT_NO_ACTIVE_VOICE` → no live Discord call was found; user must join a voice/video call and retry.
- `EDETECT_INCOMPATIBLE` → Detect does not match installed Z2K Core; repair Core.
- `ECOMPATIBILITY` for a stale official strategy → strategy catalog/Core mismatch; no “apply anyway” escape hatch.

Managed Z2K strategy/Detect/Lua/release-owned-list update endpoints reject independent mutations with `EMANAGED`.

## 12. State model

Installed Core user-visible states are:

```text
CURRENT
UPDATE_AVAILABLE
BROKEN
```

Update transaction states are:

```text
PREPARING
READY_TO_COMMIT
COMMITTED
ROLLED_BACK
FAILED_BEFORE_COMMIT
```

Any failure before commit preserves the active LKG.

## 13. Testing and acceptance

Completion requires four levels of evidence.

### 13.1 L1 — unit/schema

Required coverage includes:

- `r-*` and `p-*` release parsing/authority.
- installed historical release with newer current `p-*` latest.
- coherent receipt validation and mismatch rejection.
- runtime composition with current six upstream Lua.
- missing required Lua/list rejection.
- strategy provenance/Core identity match.
- correct/wrong Detect architecture and digest.
- Detect JSON schema validation.
- exact typed argv construction/no shell passthrough.
- `EMANAGED` for direct Z2K lifecycle mutations.

### 13.2 L2 — integration

Build one candidate from a single exact upstream release and prove runtime, Detect, compiler inputs, official strategies and compatibility identity share one revision.

Explicit mixed-revision fixtures must be rejected.

Compile the current official All-in-One and prove every referenced Lua function resolves from current coherent runtime without legacy `z2k-detectors.lua`.

Missing `sni_wl_candidates.txt`, `tcp16_targets.txt` or `tcp16_nets.txt` must reject candidates when required by current feature dependencies.

Each Detect command adapter receives valid and invalid fixture JSON tests.

### 13.3 L3 — lifecycle

Test:

- clean coherent install
- X → Y update with X active until commit
- failure before commit leaves X untouched
- controlled activation failure restores physical LKG
- same canonical Z2K strategy survives update
- removed canonical strategy blocks update
- active Avatar/User strategy remains selected and is validated against candidate runtime
- legacy V1/V2 → coherent receipt migration
- safe learned-state migration
- discovered/user data preservation

### 13.4 L4 — real-router acceptance

Real-router evidence is required for final PASS.

Capture baseline hardware/architecture/OpenWrt/Z2M/Core/strategy/runtime/NFQUEUE/nfqws2 state.

Verify fresh version catalog correctly shows historical installed `r-*` versus current authoritative `p-*` latest.

Perform ordinary Core update and prove after activation that physical runtime, compiled strategies and Detect all match the same release/source commit/manifest/compatibility identity.

Verify Components and Resources managed UX and backend `EMANAGED` behavior.

Run real `z2k-detect` commands:

- `probe`
- `classify`
- `quic`
- `tcp16`
- `voice`
- `run`

For Discord Voice, a real active Discord voice/video session is the acceptance oracle. Capture live endpoint, Discord STUN result, control STUN result, probe trace and working arm if found.

Simultaneously capture autocircular `discord_udp` pool identity and current learned arm. Prove a real failure-driven arm transition. Ideal acceptance reaches the arm that `z2k-detect voice` independently confirmed as working and remains there after success.

If Detect finds a working Discord arm but autocircular does not reach it, architecture work may be integrated but the original Discord behavior is not considered fully solved. Continue systematic debugging through detector → circular wrapper → persistence → Lua order → pool definition → runtime selected strategy. Final status is at most `DONE_WITH_CONCERNS` until behavior is proven.

### 13.5 Autodiscovery and supervision

Enable `z2k-detect run` under procd and prove:

- service running
- DNS source detected
- DNS observation triggers a probe
- HOT domain is published to `discovered-domains.txt`
- nfqws2 observes the change
- next request follows bypass path
- existing discovered domains survive service restart

Kill the Detect process and prove procd respawns it. Repeated crash must eventually surface a non-working health state rather than infinite green status.

### 13.6 Reboot and resource acceptance

After successful setup, verify service/runtime persistence across restart; full router reboot is an explicit acceptance step when safe/user-approved.

Measure bounded flash/RAM/CPU impact, especially on MIPS. If continuous autodiscovery is too expensive on weak hardware, it may default off there, but Detect remains part of coherent Core.

### 13.7 Security acceptance

Verify invalid hosts/ports/repeats/timeouts are rejected, concurrent scans are bounded, output is bounded, timed-out children are killed, and browser clients cannot request arbitrary binary execution.

### 13.8 Regression and review

Run focused and full regression across Engine lifecycle, Z2K lifecycle, Resources, Strategy apply, Avatar source, User strategies, autocircular UI, Telegram integration, Components, runtime composition, Asset Registry and native preflight.

Before completion, code review must specifically check:

- no second lifecycle owner
- no hidden fallback to old scanner
- no Z2K HEAD strategy/Detect refresh independent of Core
- no stale production `z2k-detectors.lua`
- `p-*` support through the full authority chain
- physical rollback correctness
- user data not classified as release-owned
- dynamic dataset refresh does not mutate Core identity incorrectly

## 14. DONE and blocker contract

Final implementation report must include status, current repository HEAD, selected upstream release/source identity, Core/runtime/Detect/Strategies identities, autocircular evidence, autodiscovery evidence, migration/rollback evidence, UI behavior, test results, real-router evidence and code review result.

Allowed final statuses are `PASS`, `DONE_WITH_CONCERNS`, or `FAIL`.

Engineering difficulty, failed tests, regressions, debugging uncertainty, refactoring or lack of a ready fixture are not user blockers; work remains `WORKING`.

`WAITING_FOR_USER` is allowed only for a proven user-only dependency such as joining a live Discord call or approving a risky reboot window. When blocked, use exactly:

```text
REQUIRED_USER_INPUT:
...

WHY_ONLY_USER_CAN_PROVIDE_IT:
...

[goal:blocked]
```

## 15. Architectural decision summary

The chosen architecture is:

```text
Z2K Core
= one release-coherent lifecycle

z2k-detect
= sole DPI detection engine

Z2M
= transactional lifecycle + security + RPC + UI + evidence

Strategy subsystem
= persistent apply owner
```

The design intentionally rejects parallel Z2K strategy refresh, parallel scanner engines, mixed release identities and platform-specific duplicate owners.