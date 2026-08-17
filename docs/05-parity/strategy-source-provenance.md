# P03-SF Strategy source provenance and semantic closure

Status: implementation in progress; this document records the audited source
boundary and the canonical contract being implemented. P04 is not started.

## Frozen revisions

| Role | Repository | Revision |
|---|---|---|
| Engine authority | `bol-van/zapret2` | `a8d24607a5ebae5f0a78aa066b35d0b7e66163ff` |
| Current catalog metadata | `https://git.zapret.moe/zapretdiscordyoutube/zapretgui` | `6824294ee53421cc9c3e2a361f4976783ff62307` |
| Curated adaptation/reference | `avatarDD/zapret-gui` | `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` |
| z2k extension/preset source | `necronicle/z2k` | `11f5e77c48b87438567179ea763c635780a04b7b` |

The installed target engine is `/opt/zapret2/nfq2/nfqws2`, official release
`v1.0.4` build `2c21faa80e1acb71ddceb8b49176f266b7d33f05`, with Lua
compatibility version `6`. The target has the official core Lua files under
`/opt/zapret2/lua/`; z2k/custom Lua and blob/list assets are separate
dependencies and must be present before Apply.

## Inventory and first lossy boundaries

The current deployed catalog was read directly from the target:

```
source = /etc/zapret2-manager/catalog/forgejo/manifest.json
files = 4
physicalEntries = 686
unique IDs = 639
duplicate ID groups = 46
--filter-tcp = 0
--filter-udp = 0
--new = 0
--lua-init = 0
--blob = 0
```

The prepared Avatar catalog contains the actual full source inventory:

```
source = avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c
files = 23
physicalEntries = 1836
unique IDs = 732
duplicate ID groups = 503
entries with --filter-tcp = 97
entries with --filter-udp = 93
multi-profile entries with --new = 96
entries with --lua-init = 85
entries with --blob = 91
entries with targeting/filter options = 108
```

`FILTER_LOSS_FIRST_BOUNDARY = source/curation selection`: Avatar's
`catalog_loader.py` and `strategy_builder.py` preserve full `--filter-*`,
`--new`, globals, Lua, blob, and targeting arguments. Z2M instead selected
only Forgejo's four `src/system/strategy_catalogs/winws2/*.txt` direct files;
its parser did not remove those flags because they were absent at the source.

`METADATA_LOSS_FIRST_BOUNDARY = RPC list projection`: Z2M's
`catalog_summary_profiles()` reconstructed every profile as `Профиль N`
instead of using the canonical Strategy model. The list projection therefore
hid protocol/port semantics even when a full source record existed.

## Semantic dedupe audit

The old `unique_entries()` and winner traversal used only `entry.id`.
Read-only comparison of the frozen manifests found:

```
cross-source common IDs = 524
IDs with differing semantics across Forgejo/Avatar = 72
Avatar same-ID/different-semantics groups = 60
Avatar same-name/different-semantics groups = 66
```

Concrete differences include `dronatar_4_2` (filter/payload and Lua/blob
differences) and `fake_2_n2_google` (`--payload=all` represented differently).
These are not safe ID duplicates.

The canonical reader now groups by the complete ordered, lossless execution
stream. The stream includes globals, profile order and `--new` boundaries,
filters, target lists, ranges, payload, Lua functions/parameters, Lua init,
blobs, and unknown future nfqws2 options. A compact fingerprint is exposed
for identity and diagnostics, while the full normalized stream remains the
collision-free grouping key.

Required report fields for the canonical snapshot:

```
EXACT_SEMANTIC_DUPLICATES: canonical semantic groups with >1 provenance link
SAME_NAME_DIFFERENT_SEMANTICS: retained independently by fingerprint
CROSS_SOURCE_DUPLICATES: retained as provenance links only when fingerprints equal
CANONICAL_AFTER_DEDUPE: semanticFingerprintCount
PROVENANCE_LINKS_PRESERVED: provenanceLinkCount
SEMANTIC_FINGERPRINT_EQUAL = YES: required for every collapsed group
```

The verified merged projection (Avatar + Forgejo secondary source) currently
produces the following target-side counts:

```
EXACT_SEMANTIC_DUPLICATES: 554
SAME_NAME_DIFFERENT_SEMANTICS: 59
CROSS_SOURCE_DUPLICATES: 455
CANONICAL_AFTER_DEDUPE: 790
PROVENANCE_LINKS_PRESERVED: 2522
SEMANTIC_FINGERPRINT_EQUAL = YES: 554/554 collapsed groups
```

The physical source inventory is 2522 records (`Avatar 1836 + Forgejo 686`);
the canonical projection keeps 790 semantic Strategies. A z2k record such as
`z2k_all_in_one` remains a three-profile canonical Strategy with its TCP/UDP
filters and full provenance, rather than being reduced to a generic profile.

Presentation priority is Avatar-curated metadata, then current Forgejo
metadata, then raw z2k metadata. It changes only name/description/label and
never execution arguments.

## Card and runtime contract

Collapsed cards must derive protocol and actual port/range tags from the same
canonical profile object used by get/preview/Apply. Generic `Профиль N` is not
a valid substitute when a filter exists. No port label is hardcoded.

Normal list/get/preview reads the verified local snapshot only. Source update
is stage -> digest/provenance/semantic/dependency validation -> atomic
activation, with the active last-known-good snapshot retained on failure.

## Live acceptance after P03-SF

The corrected backend and runtime closure were installed on the target with a
reversible backup at `/tmp/p03sf-backup-20260817`. The live RPC status returned:

```
sourceModel = avatar-curated-lossless-semantic-v1
sources.catalogs = 2
sources.physicalEntries = 2522
semantic.canonicalStrategies = 790
semantic.semanticDuplicateGroups = 554
semantic.provenanceLinks = 2522
semantic.sameIdDifferentSemantics = 82
```

The runtime sync completed with `RC=0` and populated 90 blob files, 26 Lua
files, 48 list files and 68 ipset/list files under the trusted runtime roots.
The official engine and Lua bundle were pinned to the hashes observed on this
target in `native-preflight.json`.

Direct target Preview for `z2k_all_in_one` returned `ok=true`, three profiles,
and `dependencies.available=true`. Its command retained the full ordered
execution stream, including two `--new` boundaries, the TCP/UDP filters, all
Lua parameters and blob mappings. Live Browser acceptance on the Strategies
page passed: the card rendered `TCP (порты 80,443)`, `UDP (порты 443)` and
`UDP (порты 50000-50099,1400,3478-3481,5349,19294-19344)` in the collapsed
card, and Preview rendered the complete command instead of `Сервис не вернул
команду`.

`VALIDATE_NATIVE_PREFLIGHT = PARTIAL`: the source/dependency checks pass, but
the specific z2k strategy is rejected by the installed official engine's Lua
preflight because its custom z2k functions are not accepted by that engine
bundle. This is reported as a runtime compatibility gate, not hidden as a
catalog or port-metadata failure.

`PACKAGE_APK_E2E = NOT_RUN`; `LAN_LIVE_TRAFFIC = NOT_RUN`.
