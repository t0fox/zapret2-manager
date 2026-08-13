---
id: spec-avatar-strategy-catalog-parity
title: "Avatar Strategy Aggregate and Pinned Catalog Parity Design"
type: spec
status: planned
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [spec, strategy, catalog, parity]
---
# Avatar Strategy Aggregate and Pinned Catalog Parity Design

**Date:** 2026-08-10
**Branch:** `m5-native-state-store`
**Avatar source:** `avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c`
**Starting HEAD:** `068fa7d01f9648dd1aa628b3e4b5017e2198fed6`

## 1. Goal

Make Avatar's Strategy aggregate the canonical product model while retaining
the existing safe Profiles compiler and transactional Apply substrate. Ship the
complete pinned Avatar Strategy catalog as immutable product data and preserve
its IDs, entries, metadata, ordering, duplicate precedence, protocol grouping
and quick/standard/full membership.

## 2. Behavioral Source of Truth

The pinned Avatar commit above is normative. In particular,
`core/strategy_builder.py`, `core/catalog_loader.py`,
`core/catalog_updater.py`, `core/models.py`, `core/strategy_state.py`,
`api/strategies.py`, `api/catalog_update.py`,
`web/js/pages/strategies.js`, the catalog files and related tests define the
contract. Internal differences are permitted only as `OPENWRT_NATIVE` or
`SECURITY_HARDENING_EQUIVALENT_BEHAVIOR` under
`docs/architecture/avatar-parity.md`.

## 3. Explicit Non-goals

This slice does not implement Scanner, BlockCheck, BlockCheck2 parity, Block
Detector, Auto-remediation, Unified Routing, tunnels, DNS parity, IP-set parity,
full Lua or Blob managers, online catalog updates, Orchestra winner integration,
automatic winner Apply, a new transaction engine, reboot-durable rollback,
Task 11, Task 12, repository-wide storage migration or a large LuCI redesign.

## 4. Current-HEAD Repository Map and Storage Ownership

The current HEAD was inspected before this design was finalized. Existing
components to reuse are:

| Responsibility | Current path/ownership |
|---|---|
| Applied NFQWS2 configuration | `/opt/zapret2/config`, accessed through `apply.uc` and `PATHS.applied_conf` |
| Existing Profile drafts | `/etc/zapret2-manager/state.json`, `PATHS.draft_state`, owned by `profiles-draft.uc` and co-owned by existing service/DNS/catalog compatibility keys |
| Profile parser/tokenizer | `zapret2-manager/files/usr/libexec/zapret2-manager/profiles.uc` |
| Profile CRUD/revisions | `.../profiles-draft.uc` and `.../profiles-cli.uc` |
| Profile full-set compiler/Apply | `.../profiles-apply.uc`, `.../profiles-apply-cli.uc`, `.../apply.uc` |
| Native preflight | `.../native-preflight.uc` |
| Schema-3 status/observations | `.../status.uc`, `status-collector.uc`, `status-compat.uc`, `status-observations.uc` |
| Existing strategy page/workflow | `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js`, `z2m-strategy-page.js`, `z2m-strategy-workflow.js`, `z2m-strategy-workflow-core.js` |
| Existing Profile compatibility UI | `.../z2m-profiles-workflow.js` and the Profile pane in `z2m-strategy.js` |
| Existing native RPC registration | `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` |
| Existing native API transport | `luci-app-zapret2-manager/.../z2m-api.js` |
| Existing service-domain catalogs | `.../catalog/services.json`, `orchestra-strategies.json`, `orchestra-zapret2gui.json`, `flowseal-combos.json`, `stressozz-*.json`, `dns-providers.json` |

The existing `catalog.uc` is specifically the service/domain catalog backend;
it is not renamed or overloaded into the Avatar Strategy catalog.

New feature-owned paths are limited to the missing Strategy boundary:

| New component | Planned path | Why an existing component cannot own it |
|---|---|---|
| Avatar Strategy aggregate validation/normalization | `.../strategy-model.uc` | `profiles.uc` owns applied opaque fragments, not Strategy identity/metadata/ownership |
| Physical Avatar catalog parser and set construction | `.../strategy-catalog.uc` | `catalog.uc` owns service-domain catalog semantics and must remain separate |
| Avatar transforms over validated Profile fragments | `.../strategy-compiler.uc` | `profiles-apply.uc` owns generic full-set joining and transaction admission, not catalog autowrap/list/blob semantics |
| User Strategy/favorite/active projection state | `.../strategy-state.uc` | `profiles-draft.uc` owns legacy Profile drafts and shared state compatibility, not the canonical Strategy document |
| Safe RPC request-file boundary | `.../strategy-cli.uc` | Existing `profiles-cli.uc` is specialized to Profile wire contracts |
| Pinned raw assets and manifest | `.../catalog/avatar/` and `.../catalog/avatar/manifest.json` | Existing JSON catalogs represent different domains and cannot preserve the physical Avatar snapshot |

The existing RPC registration file and existing unified Strategy UI are
extended in place; no parallel RPC registration or duplicate Strategy page is
introduced.

## 5. Pinned Avatar Snapshot

The packaged source snapshot is the complete catalog present at the pinned
commit: `advanced/`, `basic/`, `builtin/` and `direct/`. There is no physical
`catalogs/presets/` directory at this commit; converted presets are packaged in
`builtin/winws2_presets.txt`. No directory or entry is omitted because its Lua,
Blob or list dependency is not yet installed.

The snapshot contains 23 catalog files, 1,836 physical entries and 732 distinct
IDs. Physical level counts are advanced 565, basic 496, builtin 100 and direct
675; inferred protocol counts are TCP 1,402 and UDP 434. There are 503 IDs with
multiple physical occurrences. Runtime winner selection is the exact traversal
described in section 9: sorted level directories, sorted files, source-order
entries appended to `level/protocol` cache keys, sorted cache keys, then
first-unseen ID within each accumulated cache.

## 6. Catalog File and Entry Inventory

| Path | Entries | SHA-256 |
|---|---:|---|
| `advanced/discord_voice_zapret2_advanced.txt` | 75 | `5da32af9b03f005405a1c3aecb608354e81763895cd2396c6e0edb56042a8844` |
| `advanced/http80_blockcheckw.txt` | 2 | `3fe64a1df68247b62685f6d89663de19797e4794482bada49046fc2ea750f805` |
| `advanced/http80_zapret2_advanced.txt` | 127 | `50769638b45bcb968e1edba2b9db6932c9bc4caaeae19e7a933e4200feddf3fe` |
| `advanced/tcp_blockcheckw.txt` | 6 | `bfe77d1610317182f1f86316aaaa17107e081e9b505bb704afe509d3c516d865` |
| `advanced/tcp_fake_zapret2_advanced.txt` | 24 | `f3d75636a7e9c686f71bef55b9af22efaaafd67bfb8d086386db04c0658293c9` |
| `advanced/tcp_z2k_advanced.txt` | 3 | `8625f516ecb9993199d6bb96116b50b86128bb27301f6929148b481f8534f995` |
| `advanced/tcp_zapret2_advanced.txt` | 253 | `0a9b988e01a36abb3dc27eaa296b626186e620a62556b386edaec73afa907b14` |
| `advanced/udp_z2k_advanced.txt` | 5 | `d8a2bd471d3a5fbdff88ac94a02236e36719e68882796d7b1fda45991003a5fc` |
| `advanced/udp_zapret2_advanced.txt` | 70 | `95085372bca639eb8499b5fdd4c17dcfa4db46b84c45afe4f05c44fb10b185c2` |
| `basic/discord_voice_zapret2_basic.txt` | 73 | `9feab1d06f15213bd1c3daac8910f7c3cc8e8af32075eaed2cad458152424f11` |
| `basic/http80_zapret2_basic.txt` | 126 | `9d7ce7c906f37494a05d511e6b56d430cef3c642145a1359101741c922acd3f9` |
| `basic/tcp_zapret2_basic.txt` | 235 | `035dd277e62e8705784348e2fcc34fc68cda8440d7999cf7cfa99188d34ba1af` |
| `basic/udp_zapret_basic.txt` | 62 | `8fbca351b3ed724fa84e20ff791461df69d69aba229663e69e349e40aeaf7ab6` |
| `builtin/winws2_presets.txt` | 85 | `87d33c2c202f365a48945a3326183a8e0bf638cd757dcbdbdde8f2c3c9768e8a` |
| `builtin/z2k_all_in_one.txt` | 1 | `83f79ba2f3566f9f5fa7e330c3b4e4b03b4afbfda1995f55f7b6133786d9ecaf` |
| `builtin/z2k_autocircular_quic.txt` | 2 | `b52cc3af6779e6ea69614d4a3014d3bc864148ae321652856e51d5c6c03db143` |
| `builtin/z2k_autocircular_tcp.txt` | 3 | `79b3df3aa7af7bfa440f2bb64cf3c8eb53c527900a8007b4213f5455af22b50d` |
| `builtin/z2k_circular.txt` | 1 | `d4e998e7a38c1232525c712f4d2411d64fe6f11ee22e2ed45be6dc0def348b7e` |
| `builtin/zapret_gui_defaults.txt` | 8 | `161aa598c2bdd860cc4c67123a78a32077722bdafbb907cfc12d7a17b9c4d7a9` |
| `direct/http80.txt` | 174 | `bce0dda3f008af8c6c3f3d6d51cfeb383226efcfea51baecb12c42f772436de3` |
| `direct/tcp.txt` | 354 | `5d5a57b8a96010d20bfb8bdf10eed1c41a50b58fe5cb3bcf4fdbf75ac3b079e1` |
| `direct/udp.txt` | 71 | `c0d0239b8d4883ae7ddb49c316dfad00b6a6bf0be9c17a62804b2a9ea5e7894c` |
| `direct/voice.txt` | 76 | `e4f444173a19e9364536b80c7df1197b50be225ba783b0947e1422bc78002b4b` |

The aggregate digest over sorted lines `<file-sha256>  <relative-path>\n` is
`5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1`.

## 7. Strategy Domain Contract

The public product object is:

```text
Strategy {
  id,
  name,
  metadata,
  profiles: [Profile, ...]
}
```

`id`, `name` and `profiles` are required. Avatar's core validator requires the
array but permits it to be empty. Public POST create rejects an empty array;
the pinned PUT/update path does not repeat that non-empty check and therefore
permits an empty array through structural persistence. Native create/update
must preserve this observable distinction. Regardless of persistence policy, a
Strategy with no enabled child compiles successfully to an empty argv. It is a
non-executable preview: Preview returns `ok: true`, `args: []`,
`profiles_count: 0` and an explicit non-applicable projection where native wire
shape provides one. Validate and Apply reject it with the distinct
no-enabled-profiles error.

Strategy identity is the stable Avatar ID, never a path-derived hash, Orchestra
candidate ID or `z2m_` rewrite.

## 8. Profile Child Contract

A Profile is owned by exactly one Strategy. Avatar input requires `id` and
`args`. `enabled` is optional and defaults to `true`, exactly matching
`p.get("enabled", True)`. Catalog normalization materializes `enabled: true`,
and normalized native responses may do the same, but an omitted input field
must retain default-true semantics.

Profiles remain in explicit array order regardless of enabled state. Disabled
Profiles remain visible and editable but contribute neither arguments nor a
separator. Duplicate child IDs are accepted because pinned Avatar validation
does not reject them. The normalized implementation must not silently rename,
deduplicate or reorder them.

Avatar-facing `args` may contain spaces, tabs, CR/LF and matching quoted
whitespace. Avatar tokenization splits on any whitespace outside quotes and
preserves quote characters and exact token values; unmatched quotes remain in
the final token because the pinned tokenizer does not synthesize a new error.
The Strategy adapter applies that quote-aware tokenizer first, then
canonicalizes the token stream to the existing safe single-line Profile
fragment representation. The compatibility guarantee is token-semantic
losslessness, not byte-identical whitespace:

```text
tokenize_avatar(originalArgs) == tokenize_avatar(canonicalizedFragment)
```

The canonicalization preserves token count, order, exact token values and
unknown valid nfqws2 options. It does not silently reorder flags or drop them.
Malformed/unmatched quoting is characterized against Avatar before any native
safety strengthening is classified as a deviation.

## 9. Builtin Strategy Semantics

Builtin Strategies are generated from the packaged snapshot and are read-only.
Public create over a visible builtin ID returns conflict; update/delete return
builtin-immutable errors. The UI offers Duplicate rather than Edit/Delete.

Catalog/catalog collisions preserve this exact Avatar traversal: sorted level
directories; sorted files within each level; source order within each file;
append to cache key `level/protocol`; sorted cache keys in StrategyManager;
source order within each accumulated cache key; first previously unseen ID wins.
Duplicate names are allowed. Full physical entries remain in the integrity
manifest even when they do not win runtime identity.

## 10. User Strategy Semantics

User Strategies support create, read, update and delete, ordered child editing,
enable/disable, Preview, Validate and Apply. The public API prevents overwrite
of a visible builtin ID, matching Avatar even though Avatar's lower-level
manager can overlay one internally. User IDs and revisions are stable. Names
need not be unique.

Deleting the active user Strategy clears the selected active identity. Updating
an active user Strategy preserves its ID but causes expected-compiled drift
until the revised Strategy is successfully applied.

Avatar's PUT handler fixes the ID from the URL and does not repeat POST's
non-empty-profile check; the lower-level validator still requires the array and
allows it to be empty. Characterization must preserve this observable distinction
between POST create, PUT update, and later build/validate/apply rejection.

## 11. Extension Strategy Semantics

Future packaged Z2M Strategies occupy an explicit extension namespace distinct
from Avatar builtin IDs and user storage. Extension loading rejects collisions
with every Avatar builtin and with another extension; it never shadows or
changes the pinned snapshot. Extensions do not alter Avatar set membership.

## 12. Identity and Collision Rules

The namespaces are `avatar_builtin`, `z2m_extension` and `user`. Avatar IDs are
preserved verbatim. Packaged extensions must use a reserved Z2M policy selected
by their catalog format and must not collide with Avatar IDs. Public user CRUD
cannot claim a visible builtin or extension ID. This reproduces Avatar's public
builtin protection while preventing packaged extension replacement.

The parser rejects post-normalization ID collisions rather than reproducing
Avatar's unsafe sanitize-after-check edge case. This is a security hardening
that does not alter accepted canonical Avatar IDs.

## 13. List and Detail Wire Semantics

Pinned Avatar GET list and GET detail both return the cleaned full Strategy
object, including Profiles; each response adds computed `is_active` and
`is_favorite`, while internal `_filepath` is removed. Full Avatar-compatible
list responses are the default. Before any native projection, pagination or
list/detail split is considered, implementation work must measure the actual
packaged full-list payload and the concrete rpcd/ubus message-size, memory and
serialization limits. Only measured evidence of an unsafe or unworkable full
response can authorize an `OPENWRT_NATIVE` deviation, with no loss of user
capability; “732 Strategies sounds large” is not evidence. Detail remains
lossless and authoritative for editing/Apply.

## 14. Catalog Parser and Normalizer

Stage A, catalog parsing, consumes the packaged files close to their Avatar INI
format. It preserves physical file/section order, section ID, raw argument
lines and all recognized metadata; infers protocol and records catalog level;
and removes Windows-only `--wf-*` lines only at this catalog parsing stage,
matching Avatar. It omits sections with no executable args.

Stage B, CatalogEntry → Strategy conversion, maps the section ID to Strategy
ID, copies metadata, splits only exact `--new` tokens into ordered Profiles,
derives Profile IDs/names from the first TCP/UDP/L3 filter, materializes
`enabled: true`, and computes `single`/`combined`, builtin/source/version.

Stage C, Strategy compilation, performs enabled selection, quote-aware Profile
normalization, autowrap, list injection, blob declarations and native path
resolution before delegating to the existing Profile compiler. WinDivert
filtering is not a generic user-Profile rewrite: it occurs only where the
pinned catalog parsing/conversion path proves it.

Parsing is bounded and fail-closed. A corrupt packaged catalog is reported
rather than partially accepted.

## 15. Catalog Provenance and Integrity

The package carries a machine-readable manifest containing source repository,
source commit, every path, byte length, SHA-256, physical entry count, ordered
physical entry information, metadata digest, duplicate occurrences, runtime
winner and set membership. Each entry records catalog level, protocol, cache
key, source filename, section ID, source-entry ordinal, cache-local ordinal,
effective global traversal ordinal, duplicate group and winner boolean.
Startup/listing requires no network access.

Regression tests verify all 23 file hashes, aggregate digest, 1,836 physical
entries, 732 IDs, level/protocol counts, duplicate precedence, both featured
IDs, metadata, ordering and exact set lists. A future refresh changes raw files
and manifest in one reviewable commit; a changed count alone is insufficient.

The Avatar MIT notice and upstream youtubediscord/zapret and blockcheckw
attribution remain packaged as required. Existing licenses are not rewritten.

## 16. Metadata Semantics

Catalog source fields are `name`, `author`, valid `label`, `description`,
`blobs`, `featured`, inferred/supplied `protocol`, directory-derived `level`,
section ID and source file. Missing name falls back to ID; invalid labels become
empty. Runtime Strategy normalization copies the product metadata and computes
`type`, `version`, `is_builtin` and `source="catalog"`.

`is_favorite` and `is_active` are response projections, not persisted Strategy
metadata. Internal file paths are never exposed. Specific fields remain
distinct; they are not flattened into tags.

## 17. Protocol and Set Membership

The canonical Avatar Strategy `protocol` field is only `"tcp"` or `"udp"`.
Filename inference maps names containing `udp`, `voice`, `discord`, `stun` or
`quic` to `udp`; names containing `tcp`, `http80`, `http`, or `tls` to `tcp`;
the fallback is `tcp`. HTTP80, QUIC/HTTP3 and Discord Voice distinctions remain
available through physical source file/category, metadata and Profile filters;
they are not replacement Strategy protocol values. Future Scanner target/test
types may be richer without changing this catalog field.

The manifest stores exact ordered TCP and UDP quick, standard and full ID
lists. Quick prioritizes recommended entries and caps at 30. Standard takes
basic entries, then recommended advanced, then remaining advanced, deduplicated
and capped at 80. Full traverses all levels and keeps first-ID winners. Scanner's
later full-preset prepending and generated Strategies are not implemented here,
but the source data required to reproduce them is retained.

## 18. Preset Semantics

Pinned preset output is represented by `builtin/winws2_presets.txt` and other
builtin catalog files. Each section becomes one Strategy and exact `--new`
boundaries become child Profiles. Full filters, globals, Lua calls, blob flags
and ordering remain intact. Preset origin is retained in the manifest. This
slice does not refetch or reconvert live upstream preset files.

## 19. Builder Transformations

One Strategy compatibility adapter performs Avatar transformations before
delegating to existing Profiles machinery:

1. Validate aggregate schema.
2. Preserve Profile order and filter disabled children.
3. Tokenize each Avatar-facing Profile with the pinned any-whitespace,
   quote-aware tokenizer, preserving quote characters and exact token values;
   canonicalize that token stream to the existing safe single-line fragment
   representation without changing token order or semantics.
4. Apply bare-trick autowrap.
5. Inject Strategy-facing list flags.
6. Add missing global blob declarations once.
7. Resolve allowed Lua, Blob, hostlist and ipset references to native paths.
8. Pass each result through the existing one-fragment validator.
9. Delegate exact ` --new ` joining and round-trip proof to the existing
   full-set compiler.

The Avatar-compatible tokenizer is the Strategy boundary; it is not a second
semantic compiler. No second `--new` compiler or Apply engine is introduced.

## 20. Autowrap Semantics

Autowrap is per enabled Profile and occurs only when it has a
`--lua-desync*` argument, has no `--filter-tcp`, `--filter-udp` or
`--filter-l7`, and the first payload value before its first comma is recognized:

| Payload | Prepended filters |
|---|---|
| `tls_client_hello` | `--filter-tcp=443 --filter-l7=tls` |
| `http_req` or `http_reply` | `--filter-tcp=80 --filter-l7=http` |
| `quic_initial` | `--filter-udp=443 --filter-l7=quic` |

No wrapping occurs without Lua desync, with an existing recognized filter, no
payload, empty/unknown/differently-cased payload, `payload=all`, or when the
first payload is invalid even if a later payload is recognized. Original args
remain unchanged after the prepended filters.

## 21. Hostlist and List Behavior

An explicit existing scan hostlist injects `--hostlist=<path>`; a missing path
injects nothing. Without it, `none` and legacy `hostlist` add no include,
`autohostlist`/`auto` adds `--hostlist-auto=<native auto list>`, and `ipset`
adds no hostlist. Existing Profile hostlist/ipset options suppress corresponding
include injection. Protection may add the native equivalent of
`--hostlist-exclude=netrogat.txt` unless ipset mode or an explicit exclusion
already applies.

Injected list flags follow the last filter and precede the first payload.
OpenWrt paths are runtime-derived and never persisted as portable product IDs.
Only this Strategy-facing seam is included; full List/IP-set parity is later.

## 22. Lua and Blob Dependency Representation

All catalog entries remain listed. The parser records declared and referenced
Lua functions and Blobs. Responses distinguish catalog presence from runtime
availability and report bounded missing dependencies. Known missing Blob
declarations are inserted globally before first use exactly once. Native
preflight remains authoritative and Apply never fakes success. Full registries
are separate slices.

## 23. Strategy to Existing Profiles Compiler Adapter

```text
Strategy
  -> aggregate validation
  -> ordered enabled Profiles
  -> Avatar compatibility transformations
  -> existing single-fragment validation
  -> existing deterministic full-set compiler
  -> compiled candidate + digest
```

The adapter returns the existing candidate representation consumed by
`profiles_apply_candidate()`. It never writes `NFQWS2_OPT` directly.

## 24. Preview

Preview is read-only and accepts either a persisted `strategy_id` plus its
expected revision/catalog digest, or a bounded complete inline `strategy_data`
object. Inline Preview never persists the object, mutates runtime/configuration,
or creates active identity. It is not save-first behavior.

Both inputs compile through the same authoritative server-side adapter. The
response exposes at least:

- `strategyArgs`: exact compiled Strategy/NFQWS2_OPT-level args;
- `effectiveCommand` and/or `effectiveArgv`: the full effective nfqws2
  invocation produced by the same runtime composition layer used for live
  execution, including native base/runtime-required composition;
- `profilesCount`/`profiles_count`;
- dependency availability and bounded missing dependencies;
- candidate/config digest and explicit executable/applicable projection.

For Avatar wire compatibility, native responses also expose the conceptual
aliases `command = effectiveCommand` and `args = strategyArgs`, alongside the
snake/camel-case `profiles_count`/`profilesCount` projection.

The effective command is not merely Strategy args and is never composed in
LuCI. There is no preview-only command composer: the backend reuses the live
runtime composition inputs and path.

Zero enabled Profiles are a successful non-executable inspection result:
`ok: true`, `args: []`, `profiles_count: 0`; Preview does not reject solely for
empty argv. Structural compilation errors may still fail the request.

Pure Preview does not require dry-run validation. If required Lua/Blob/path
assets are unavailable but structural compilation is possible, Preview still
returns the command/args plus `unavailable` dependency information; it does
not hide or erase the Strategy and does not fake execution readiness.

When `validate=true` is requested, Preview first returns the same compile result
and then attaches optional native dry-run/preflight validation. Missing runtime
assets may make that validation unavailable or failed without removing the
pure inspection result. Preview performs zero feature-state, manager-state or
runtime writes. The client never supplies authoritative compiled text to a
later Apply.

## 25. Validate

Validate uses exactly the same authoritative compiler and effective runtime
composition as Preview and Apply. It may validate a bounded inline Strategy as
an explicit non-persisting operation, or a persisted Strategy under its
revision/catalog precondition. It requires execution admission: aggregate and
Profile validation, dependencies, output bounds, lossless token round trip,
native dry-run/preflight and runtime-required checks. Zero enabled Profiles is
rejected with no-enabled-profiles. No UI-side or consumer-specific builder
exists.

## 26. Apply

Apply recompiles server-side under the existing transaction and requires
Strategy revision, catalog digest and current config hash preconditions. A
preview response is not trusted as client-compiled input. Either the server
recompiles from the same Strategy identity/revision and compiler-relevant
environment, or it consumes a bounded server-owned candidate bound to those
inputs and digest; arbitrary client NFQWS2 text is never accepted.

It delegates to the existing lock, CAS, atomic config mutation, upstream
restart, runtime verification and exact rollback path. The compiled config,
runtime verification and active identity have one coherent Apply outcome. The
active projection itself is atomically written. If identity persistence fails
after runtime/config mutation, the implementation must compensate by rolling
back to the previous verified config/runtime/identity, or enter an explicit
bounded degraded/uncertain reconciliation state; it must never silently leave
new runtime/config with old identity or old runtime/config with new identity.

The deterministic compensation order is:

1. Retry the identity projection write only within the current Apply lock and
   bounded operation deadline.
2. If it still fails, invoke the existing exact rollback to the previous
   verified configuration/runtime and retain the previous identity.
3. If rollback or restoration of the previous identity also fails, publish a
   bounded volatile reconciliation record under the existing
   `/tmp/zapret2-manager/last-good/` transaction area containing old/new config
   hashes, old/new Strategy identities and the verified runtime outcome. The
   operation is reported as `uncertain`, normal Apply is blocked, and status
   reports the uncertainty without writing observation state.
4. The next explicit Strategy operation reconciles deterministically: an old
   config hash plus old runtime restores/retains the old identity; a new config
   hash plus verified new runtime completes the new identity projection; any
   other hash/runtime combination remains degraded and requires bounded manual
   recovery. Reconciliation never guesses identity from equal argv.

Failure reports rollback/reconciliation outcome and never falsely marks the
Strategy active. The reconciliation record is volatile; this does not add
reboot-durable transaction recovery.

## 27. Active Strategy

A manager-owned active projection stores ID, display name, origin, user revision
or pinned catalog digest and expected compiled candidate hash. It is durable
across normal rereads and reboot and is not stored in M5 manager-state. ID is
the selected identity; equality of arguments alone does not infer identity.

## 28. External Drift

Existing status/config hashes compare current `NFQWS2_OPT` with the active
projection's expected candidate. External change retains “last selected”
identity for diagnosis but derives a read-only `match`/`drift`/
`unavailable`/`uncertain` status projection. The current drift boolean,
dependency availability, runtime health, process state and queue state are not
persisted in Strategy feature storage. The UI must not claim healthy active
equivalence until the selected Strategy is applied again successfully.

## 29. Favorites

Favorites are an ordered manager-owned list of Strategy IDs, separate from
Strategy files. List/detail compute `is_favorite`. Toggle requires a currently
visible Strategy. Delete removes the deleted user ID from favorites. Favorites
do not affect compilation, catalog identity or set membership.

## 30. Duplicate and Copy

Duplicate accepts builtin or user source, deep-copies ordered Profiles and
creates a user Strategy. For a builtin, the pinned Avatar UI proposes
`id + "_copy"` and `name + " (копия)"`, copies `description`, `type` and the
Profiles, and opens the normal user-create editor; the source remains
immutable. The native implementation preserves this observable behavior while
collision-checking the proposed ID and requiring the user-create path to reject
protected IDs. The copied Profiles preserve args, order and enabled values,
including default-true normalization. Other metadata is not silently invented:
fields copied by the pinned UI are preserved, and fields not copied by that UI
remain at their Avatar create defaults.

## 31. Persistence, Atomicity and CAS

Based on the current repository's existing `/etc/zapret2-manager/` feature-owned
documents, user Strategies use one file per ID under
`/etc/zapret2-manager/strategies/`; favorites and the persisted active selection
projection use `/etc/zapret2-manager/strategy-state.json`. These are new
Strategy-owned documents, not M5 manager-state and not the legacy shared
`/etc/zapret2-manager/state.json`. The latter remains the Profile-draft and
compatibility document.

Writes use a same-directory temporary file, fsync/atomic replace, bounded
backups and locks. Every user mutation carries expected Strategy/store revision;
stale writes fail without blind retry. Package upgrades replace only builtin
assets. The persisted projection contains selection identity, display metadata,
origin, user revision or catalog digest and expected candidate/config hash. It
does not contain current drift, dependency availability, runtime health,
process/queue state or other observations. Derived status reads perform zero
Strategy feature writes and zero manager-state writes.

## 32. Native RPC Contract

Following current rpcd conventions, the semantic surface provides bounded
methods for list, detail, user create/update/delete, duplicate, favorite toggle,
whole-Strategy Preview, Validate and Apply, and packaged catalog status/reload.
The default wire contract reproduces Avatar: list and detail both return full
cleaned Strategy objects including Profiles and computed active/favorite
projections. The implementation must first measure the actual packaged full-list
payload and rpcd/ubus memory/message/serialization limits. Only concrete
measured native evidence that the full response is unsafe or unworkable may
authorize pagination or a bounded list projection plus full detail; that choice
must be classified `OPENWRT_NATIVE` and preserve every user capability. No
assumption based only on the 732-ID count is sufficient. No method exposes
arbitrary paths or executables.

Distinct bounded errors cover Strategy not found, builtin immutable, protected
ID collision, invalid Strategy, invalid Profile, no enabled Profiles, stale
revision, corrupt catalog, manifest mismatch, dependency missing, compile
failure, Apply conflict/preflight failure, runtime verification failure,
rollback failure and active-identity persistence/reconciliation failure.

## 33. LuCI Consumer

The unified Strategy page becomes the canonical consumer: catalog listing,
builtin/user distinction, metadata, favorites, active/drift state, details,
ordered child Profiles, enable/disable, user CRUD, Duplicate, Preview, Validate
and Apply. Existing components are reused. The standalone Profiles pane remains
temporary advanced compatibility tooling and is not the canonical model.

## 34. Existing Profile Compatibility and Migration

Current top-level Profile drafts are not silently reinterpreted. An explicit,
previewable import creates one user Strategy containing the drafts in current
order, preserving each valid opaque fragment and stable source information.
Invalid fragments are reported and block import rather than being repaired.
Import performs no runtime Apply. Existing Profile storage/RPC remains during
the compatibility period, so migration is deterministic and inspectable and
does not lose user data.

## 35. Error Model

Project-native bounded envelopes and codes are reused. Aggregate, child,
dependency, catalog, concurrency, preflight, runtime and rollback failures stay
distinct. Error details are size-limited and redact secrets and arbitrary file
contents. No operation returns a generic “strategy failed” when a specific
phase is known.

## 36. Security

All input is bounded; catalog/user JSON is strict; paths are resolved only
through allowed registries; shell execution is forbidden; fragments must pass
the production validator; embedded aggregate separators are rejected at the
child boundary; writes are atomic and CAS-protected; builtins are immutable;
Apply retains pinned native admission and rollback. Unsupported dependencies
are visible but fail closed.

## 37. Status Schema-3 Integration

Schema remains 3. Backward-compatible extension fields expose selected Strategy
ID/name/origin, expected revision/digest, compiled candidate hash and derived
match/drift/availability/uncertain state without changing existing fields.
Current drift and availability are derived observations, not persisted in
`strategy-state.json`. Observation reads perform zero Strategy feature writes
and zero manager-state writes. Absence of active evidence produces no fabricated
identity.

## 38. Autostart Relationship

Successful Strategy Apply updates the managed configuration used by existing
procd boot behavior and the active projection. No second boot manager is added.
On normal service boot, status reports whether runtime/config still match the
last selected Strategy. Persistent transaction recovery across interrupted
reboot remains outside this slice.

## 39. Testing and Avatar Characterization Fixtures

Before production changes, fixtures freeze:

- all 23 physical catalog files, their size/hash/count, deterministic physical
  order, 1,836 physical entries, 732 unique IDs, 503 duplicate-ID groups,
  duplicate winners and aggregate manifest digest;
- metadata, two featured IDs, level/protocol counts and exact TCP/UDP
  quick/standard/full ordered sets;
- one/many/disabled/all-disabled Profiles and optional `enabled` defaulting;
- Profile order and exact `--new` boundaries;
- empty Profile-array core/create/update/build edge behavior;
- builtin/user collision, public immutability, duplicate and favorites;
- Strategy conversion and computed metadata;
- persisted Strategy Preview and inline unsaved Preview;
- zero-enabled Preview returns `ok`, empty args and `profiles_count: 0`, while
  Validate/Apply reject it;
- Preview `strategyArgs`, full effective command/argv, profiles count, digest,
  optional `validate=true`, unavailable dependencies and zero writes;
- Preview does not require dry-run unless requested;
- Preview/Validate/Apply use the same authoritative compiler;
- all autowrap yes/no cases and explicit filters;
- TLS, HTTP, QUIC, ambiguous/all payloads;
- every hostlist mode and insertion position;
- Avatar args containing spaces, tabs, CR/LF, multiline textarea input,
  multiple flags per line, quoted whitespace, preserved single/double quote
  characters, inline Lua quotes and unmatched quotes;
- token-semantic equality between original Avatar args and the canonicalized
  native fragment;
- preset conversion and multi-Profile output;
- Blob/Lua present and missing dependencies;
- exact TCP/UDP and quick/standard/full ordered memberships;
- full Avatar-compatible list payload measurement and the measured-evidence gate
  for any later list/detail projection;
- selected identity and expected hash persistence, derived drift and zero-write
  status reads.

Implementation tests then cover native parser parity, manifest drift diagnostics,
CRUD/CAS, compatibility import, dependency errors, shared compilation,
transaction success/rollback, active identity/drift, schema-3 read purity, RPC
contracts and LuCI reachability. Focused tests and `scripts/test/native.sh` are
required before completion.

## 40. Migration Rollout

The package first installs immutable snapshot/manifest and dedicated empty user
storage. Strategy RPC and UI then become canonical while current Profile RPCs
remain available. Users may explicitly import existing drafts into one user
Strategy. No automatic Apply or destructive cleanup occurs. Removal of legacy
Profile product storage requires a later approved bounded migration.

## 41. Future Scanner Seam

The Strategy domain exposes immutable catalog identity, exact ordered set
membership, dependency status and the shared whole-Strategy compiler. Future
Scanner consumes this interface and returns Strategy IDs; it does not consume
the service catalog or Orchestra registry and does not create another builder.

## 42. Explicit Out of Scope

The out-of-scope systems in section 3 remain operational and unchanged. In
particular, Orchestra is neither removed nor made authoritative. Catalog online
update remains a later lifecycle capability; packaged catalog status/reload is
not update parity.

## 43. Expected Parity Matrix Movement

On complete implementation and verification, these rows are intended to move:

| Row | Intended result |
|---|---|
| Strategy aggregate model | PARITY |
| Profile belongs to Strategy | PARITY |
| Ordered/enabled profiles | PARITY |
| Builtin/user Strategies | PARITY |
| Strategy metadata | PARITY |
| Strategy duplicate/custom/manual | PARITY |
| Strategy preview | PARITY |
| Strategy validation/apply | approved native-equivalent behavior with product parity |
| Hostlist injection/autowrap | PARITY for the Strategy-facing contract |
| Basic/advanced/direct/preset catalogs | PARITY to the pinned snapshot |
| Catalog protocol sets/labels | PARITY for preserved source membership |
| Current Strategy display | PARITY when active identity and drift are reachable |
| Strategy→runtime→status flow | PARITY for this slice's path |

`Catalog update/reload` does not move to PARITY because online update is not
implemented. Scanner and Orchestra-related rows do not move in this slice.

## 44. Parity Classification and Approved Native Safety

The implementation records each result as one of:

| Classification | Meaning in this slice |
|---|---|
| PARITY | Avatar behavior is reproduced. |
| SAFER EQUIVALENT | Observable product intent is preserved while native CAS, preflight, bounded RPC or rollback is stronger. |
| PARTIAL | Some supported behavior exists, but this slice does not complete the contract. |
| MISSING | The capability is intentionally outside this slice. |

Expected PARITY includes the Strategy aggregate, ordered/optional-enabled
Profiles, builtin/user model, metadata, physical catalog and duplicate
provenance, duplicate/copy, favorites, Preview, set membership, protocol
inference, autowrap, list behavior and dependency visibility.

Expected SAFER EQUIVALENT includes transactional Apply, revision/CAS
mutations, native preflight, verified same-boot rollback, bounded native RPC
and the active identity/drift transaction where it is stronger than Avatar.

Online catalog update, Scanner/Orchestra/BlockCheck integration, complete
Lua/Blob registries and persistent reboot transaction recovery remain
MISSING/PARTIAL.

## 45. Branch and Milestone Policy

All work for this slice remains on `m5-native-state-store` and existing PR #32.
It creates zero new branches and zero new PRs. Milestones are commits. It does
not merge, delete or modify `main`, and it does not revive Task 11/12 or any
repository-wide legacy filesystem migration.

## 46. Rollback Boundary

This slice keeps the current volatile rollback model: existing transactional
Apply, `/tmp` last-good snapshots, runtime verification and same-boot verified
rollback. It does not add persistent last-good configuration or reboot
transaction recovery. Power-loss/reboot-durable rollback is a later native
backend milestone.

## 47. Physical Router Boundary

No new deployment framework or APK installation is part of this design. Any
later physical-router test uses the existing bounded edit → transfer → restart
affected service → verify workflow. Repository CI does not imply that this M5
runtime is installed on a physical router.
