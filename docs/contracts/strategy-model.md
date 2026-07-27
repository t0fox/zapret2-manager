# Strategy Model Contract (v1)

> **Zapret2 native parser and the loaded Lua bundle are authoritative. The
> manager parses only shell/profile structure and provides lossless transport.
> Lua strategy expressions are opaque to the manager.**

This contract defines the reference strategy model implemented under
`tests/strategy/lib/`. It is a *reference implementation and contract only* —
it is not wired into the production backend/UI (integration happens separately,
after review).

---

## 1. Scope and hard boundaries

### 1.1 The manager MAY

- safely tokenize a shell-style `NFQWS2_OPT` string (quotes, escapes,
  source spans) — `tokenize.mjs`;
- split profiles on `--new` / `--new=name` and extract `--name=name`;
- extract top-level options for the UI: filters, ports, payload, ranges,
  hostlists, ipsets, blob declarations, `--lua-init`, and the *boundaries* of
  `--lua-desync` values;
- preserve every token losslessly and round-trip byte-identically
  (preserve mode);
- reorder **manager-owned top-level structure** in canonical mode;
- load versioned native bundle manifests and run manager-level diagnostics;
- provide a native-validation adapter interface (no self-invented verdicts).

### 1.2 The manager MUST NOT

- interpret the internal grammar of a `--lua-desync` expression;
- decide whether `circular`, `repeater`, `fake`, or any other method is valid;
- parse method arguments into an AST, build an execution plan, or emulate
  `zapret-auto.lua` / `zapret-lib.lua` semantics;
- declare a Lua method valid/invalid **solely** from the JS catalog;
- reorder colon fragments, rename arguments, normalize, or auto-fix a native
  expression;
- execute Lua expressions from Node (no eval/load/shell), copy the upstream
  parser into JavaScript, or fork the upstream grammar;
- call packet methods with a traffic context, send packets, touch the
  firewall, or run a second daemon.

A name missing from the manager catalog yields **warning
`MANAGER_NOT_IN_CATALOG`**, never a fatal error. The final verdict on any Lua
strategy expression belongs to the native parser + the loaded Lua bundle of
the selected release.

---

## 2. Verified native architecture (pinned upstream)

Upstream: `bol-van/zapret2`.
Pinned study commit: **`8a0f53f3cf2c92ddeaa66995ee63a35c1210c410`**.
Target commit (current router binary self-report): **`d3b3011000f103c5af161cc4e3167e80fd6928a2`**
(version `0.9.20260307`, `lua_compat_ver 5`).

1. The top-level command line is parsed by the C code of `nfqws2` via
   `getopt_long_only` (`nfq2/nfqws.c`), including `--new[=name]`, `--name`,
   `--filter-*`, `--payload`, `--out-range`, `--in-range`, `--lua-init`,
   `--lua-desync`, and all other CLI options.
2. The C part hands Lua an already-parsed structure: `desync.func`,
   `desync.arg`, filters, ranges, execution plan, context.
3. `zapret-auto.lua` is NOT a text tokenizer of `NFQWS2_OPT`; it implements
   native semantics (rotation, conditions, detectors) over the parsed
   structure.
4. `zapret-lib.lua` implements the execution-plan machinery.
5. `zapret-antidpi.lua` implements the 25 packet methods and their runtime
   argument handling.

### 2.1 Verified native entry points

| File | Native function | Parses/executes | Input | Output | Errors | Callable without traffic? |
|---|---|---|---|---|---|---|
| nfq2/nfqws.c:1287 | `parse_pf_list` / `pf_parse` (filter.c:12) | `--filter-tcp/udp` port lists | `[~]N[-M],*` | port_filter list | exit(1) on bad element | yes (option parse) |
| nfq2/filter.c:126 | `packet_range_parse` (+`packet_pos_parse`:115) | `--out-range` / `--in-range` | range string | packet_range | exit(1) on invalid | yes (option parse) |
| nfq2/nfqws.c:1380 | `parse_lua_call` | `--lua-desync` call **shape** (identifier + `:`-separated `k=v`; `\:` escape at :1394) | option string | func_list entry | `invalid lua function call` → exit(1) | yes (option parse) |
| nfq2/nfqws.c:2706 | `IDX_NEW` case | profile boundary; optional value names the profile (`dp->name = strdup(optarg)` :2738) | `--new[=name]` | new desync_profile | OOM only | yes |
| nfq2/nfqws.c:2756 | `IDX_NAME` case | names current profile (later `--name` overwrites) | `--name=x` | `dp->name` | — | yes |
| nfq2/nfqws.c:2357/3304 | `IDX_DRY_RUN` (`--dry-run`) | full CLI parse, then `command line parameters verified`, exit(0) **before** `nfq_main` | argv | exit code | exit(1) on any parse error / unknown option | **yes — no Lua, no sockets, no NFQUEUE, no traffic, no root needed** |
| nfq2/nfqws.c:2360 + :455-496 | `--intercept=0` flow | CLI parse + `lua_init()` + `NoInterceptLoop` → `no intercept quit` | argv | exit code | init failures → exit(1) | yes, with caveats (see §2.2) |
| nfq2/lua.c:4023 (@8a0f53f) / :3891 (@d3b3011) | `lua_desync_functions_exist` | **function-existence oracle**: every `--lua-desync` function looked up in the loaded bundle | parsed profiles | bool | `desync function '%s' does not exist` → init fails | yes (runs inside `lua_init`, before any packet) |
| nfq2/lua.c:4605 (@8a0f53f) / :4481 (@d3b3011) | `lua_init` | loads `--lua-init` scripts; compat gate | Lua files | Lua state | `Incompatible NFQWS2_COMPAT_VER...` (zapret-lib.lua:1-5) | yes |
| lua/zapret-auto.lua:312 | `circular(ctx, desync)` | rotation semantics | parsed desync | verdicts | runtime (packet time) | **no — packet context** |
| lua/zapret-auto.lua:525/451/469/505 | `repeater` / `condition` / `per_instance_condition` / `stopif` | orchestration semantics | parsed desync | verdicts | runtime | no |
| lua/zapret-auto.lua:9/29/60/73/146/226 | `standard_hostkey`, `automate_host_record`, `automate_conn_record`, `automate_failure_counter`, `standard_failure_detector`, `standard_success_detector` | failure/success detection | parsed desync + conntrack | records/verdicts | runtime | no |
| lua/zapret-lib.lua:230/174/250/214/218/221/182/112/134/151 | `orchestrate`, `apply_execution_plan`, `replay_execution_plan`, `plan_instance_execute`, `plan_instance_pop`, `plan_clear`, `verdict_aggregate`, `instance_cutoff_shim`, `cutoff_shim_check`, `apply_arg_prefix` | execution-plan machinery | parsed desync + plan | verdicts | runtime | no |
| lua/zapret-antidpi.lua:79-1235 | 25 methods `name(ctx, desync)` | packet tampering | packets | verdicts | runtime arg errors | no |

All signatures verified against the pinned commit; the critical ones
(`--dry-run`, `parse_lua_call`, `lua_desync_functions_exist`) re-verified at
the target commit d3b3011.

### 2.2 Safe native oracle research

| Entry point | Command | Parses CLI | Loads Lua | Binds NFQUEUE | Sends traffic | Changes state | Safe |
|---|---|---|---|---|---|---|---|
| dry-run | `nfqws2 --dry-run <options>` | ✓ (all option syntax incl. ranges/ports/lua-desync call shape; unknown options exit 1) | ✗ | ✗ | ✗ | ✗ (exits before `nfq_main`) | **YES** (no root required) |
| intercept-zero | `nfqws2 --intercept=0 <options>` | ✓ | ✓ (lua-init + compat check + function-existence oracle) | ✗ (`nfq_init` skipped) | ✗ (no packets processed) | transient raw sockets (`rawsend_preinit`), Lua init execution; no firewall, no pidfile unless requested | **YES with caveats**: needs CAP_NET_RAW; executes the config's lua-init (same trust as the daemon); run under a timeout (a lua-init may register timers → `NoInterceptLoop` waits) |
| fuzz | `nfqws2 --fuzz=N <options>` | ✓ | ✓ | ✗ | **✓ — feeds random packets through the real desync path (`processPacketData` → rawsend)** | ✓ | **NO — EXCLUDED** |

Coverage honestly stated:
- `--dry-run` validates CLI-level syntax only.
- `--intercept=0` additionally validates: Lua bundle loads,
  `NFQWS2_COMPAT_VER` match, and **existence of every lua-desync function**.
- NOT covered without packets: per-method argument semantics, orchestrator
  plan semantics, runtime blob resolution (`blob 'x' unavailable` fires at
  packet time). A native "valid" is always *coverage-limited* and must cite
  the entry point used.

Static analysis source: pinned `nfq2/nfqws.c` (`bDry` exit at :3304 @8a0f53f /
:3202 @d3b3011; intercept flow :455-496), `nfq2/lua.c` (:4619/:4481),
`nfq2/darkmagic.c:1969`. Execution on the target is an integrator step —
see `[NATIVE_ORACLE:PENDING]` in the corpus report.

---

## 3. Model entities

### 3.1 StrategyDocument

```jsonc
{
  "version": 1,
  "source": null,                 // informational (e.g. file name)
  "profiles": [ /* Profile */ ],
  "globalOptions": [              // derived view: --lua-init entries in document order
    { "option": "--lua-init", "value": "@/opt/zapret2/lua/init_vars.lua",
      "tokenIndex": 0, "profileIndex": 0 }
  ],
  "diagnostics": [ /* Diagnostic — parse-time (tokenizer + profile structure) */ ],
  "originalText": "…",            // input, verbatim
  "normalizedText": "…",          // canonical serialization (computed at parse)
  "tokens": [ /* OptionToken */ ],
  "trailingTokens": [ /* token indexes of a trailing bare --new */ ]
}
```

### 3.2 Profile

```jsonc
{
  "index": 0,
  "name": "GamesTCP",             // string | null — resolution: LAST naming event wins (native order semantics)
  "nameSource": "new",            // "new" | "name-option" | null
  "nameRecords": [                // EVERY naming event is preserved
    { "value": "GamesTCP", "via": "new", "tokenIndex": 5, "valueTokenIndex": null }
  ],
  "separator": {                  // null for the implicit first profile
    "form": "new-with-name",      // "new" | "new-with-name"
    "raw": "--new=GamesTCP",
    "value": "GamesTCP",
    "tokenIndex": 5
  },
  "enabled": true,                // false when --skip present
  "protocol": "tcp",              // derived: "tcp" | "udp" | "mixed" | null
  "tcpPorts": [ /* OptionEntry + .elements[] (structured ports) */ ],
  "udpPorts": [],
  "l7Filters": [], "payloads": [],
  "outboundRanges": [],           // OptionEntry + .range (structured, C-grounded)
  "inboundRanges": [],
  "hostlists": [], "hostlistExcludes": [],
  "ipsets": [], "ipsetExcludes": [],
  "blobs": [],                    // declarations: .blobName/.blobSource/.blobSourceType
  "luaInit": [],
  "luaDesync": [ /* LuaDesyncOpaque */ ],
  "passthroughOptions": [],       // known top-level options kept raw
  "unknownOptions": [],           // unknown options/stray words kept raw
  "originalTokens": [ /* token indexes */ ],
  "sourceSpan": { "start": 0, "end": 0 }
}
```

`--new` forms (native ground truth — nfqws.c:2706-2749):

- `--new` — begins a new profile; name stays null unless `--name=` follows.
- `--new=GamesTCP` — begins a new profile **and names it**.
- `--name=GamesTCP` — names the current profile (no boundary).
- `--new=One` + `--name=Two` → `MANAGER_CONFLICTING_PROFILE_NAMES`
  (warning); both records preserved; native order semantics: the last naming
  event wins (`name = "Two"`).

### 3.3 OptionToken

```jsonc
{
  "index": 0,
  "kind": "option",               // "option" (starts with --) | "word"
  "raw": "--name='My Profile'",   // EXACT source slice
  "value": "--name=My Profile",   // decoded (quotes/escapes resolved)
  "quoteStyle": "single",         // null | "single" | "double" | "mixed"
  "start": 0, "end": 24,          // offsets into originalText
  "profileIndex": null            // assigned by the parser
}
```

Tokenizer errors are manager-level: `MANAGER_UNTERMINATED_QUOTE`,
`MANAGER_DANGLING_ESCAPE`, `MANAGER_CONTROL_CHARACTER`, `MANAGER_EMPTY_OPTION`.
Backslash rules follow the **double-quoted shell assignment** format of
`NFQWS2_OPT` (backslash special only before `` $ ` " \ `` and newline), which
keeps the native `\:` escape intact.

### 3.4 LuaDesyncOpaque

```jsonc
{
  "raw": "circular:fails=2:time=30",               // full decoded expression, VERBATIM
  "optionRaw": "--lua-desync=circular:fails=2:time=30",
  "sourceSpan": { "start": 0, "end": 0 },
  "tokenIndex": 12,
  "catalogHints": {                                 // UI hints ONLY — not an AST,
    "functionName": "circular",                     // not a serializer input,
    "referencedBlobs": [],                          // not a validity verdict
    "fragmentCount": 3
  },
  "nativeValidation": {                             // filled ONLY by native.mjs
    "status": "not_checked",                        // not_checked | valid | invalid | unavailable
    "diagnostics": [],
    "bundleId": null,
    "nativeVersion": null,
    "luaCompatVer": null
  }
}
```

Hint extraction is documented heuristic: `functionName` = text up to the
first unescaped `:` (mirroring `parse_lua_call`'s `\:` handling);
`fragmentCount` = unescaped-colon fragment count; `referencedBlobs` =
segments matching `^(blob|seqovl_pattern|pattern|fallback)=(.+)$`, skipping
`0x…`/`#…`/`%…` refs. Hints never feed the serializer and never decide
validity.

### 3.5 NativeBundle

Versioned manifest (`tests/strategy/native-bundles/*.json`):

```jsonc
{
  "id": "target-v5-20260307",
  "role": "current-target",               // or "legacy"
  "binaryVersionFixture": "tests/fixtures-postinstall/nfqws2-version-long.out",
  "luaContentsFixture": "tests/fixtures-postinstall/opt-zapret2-lua-contents.out",
  "binaryVersion": "github version 0.9.20260307 (d3b3011...)",
  "binaryCommit": "d3b3011000f103c5af161cc4e3167e80fd6928a2",   // null when unknown
  "binarySha256": null,
  "luaCompatVer": 5,
  "upstreamCommit": "d3b3011...",
  "sameReleaseProven": false,             // never computed from co-location
  "sameReleaseEvidence": { "luaFileMatches": { "zapret-lib.lua": "byte-exact" } },
  "provenance": { "source": "…", "capturedAt": null, "target": "…", "notes": [] },
  "confidence": "high"
}
```

Bundles shipped:

| Bundle | lua_compat_ver | sameReleaseProven | Evidence |
|---|---|---|---|
| `target-v5-20260307` (current target) | **5** | **true** | binary self-reports commit d3b3011; all six captured Lua files are **byte-exact** to upstream d3b3011 (verified 2026-07-27); `zapret-lib.lua@d3b3011` requires compat 5 |
| `legacy-v6` | **6** | false | captured Lua is byte-exact to the pinned study commit 8a0f53f (2 of 6 files era-ambiguous); binary is a self-built artifact — its commit is unproven |

Rules:
- co-location of a binary fixture and a Lua fixture is **not** proof of same
  release;
- a bundle with `luaContentsFixture: null` → native validation `unavailable`
  ("current target Lua bundle not captured"); never substitute another
  release's Lua;
- manifest `luaCompatVer` is cross-checked live against the Lua fixture's own
  `NFQWS2_COMPAT_VER_REQUIRED` (mismatch → `NATIVE_LUA_COMPAT_MISMATCH`);
- mixing a v6 Lua with the v5 target is refused (`NATIVE_BINARY_LUA_MISMATCH`).

### 3.6 NativeValidation

```jsonc
{
  "status": "not_checked | valid | invalid | unavailable",
  "diagnostics": [ /* NATIVE_* codes only, sourced from an actual native run */ ],
  "bundleId": "target-v5-20260307",
  "nativeVersion": "github version 0.9.20260307 (d3b3011...)",
  "luaCompatVer": 5
}
```

- `not_checked` — default; nothing attempted.
- `unavailable` — no proven side-effect-free native entry point executed
  (reason recorded). **Never** reported as valid.
- `valid` / `invalid` — only from an actual native run result
  (`applyNativeResult`), always coverage-limited by the entry point used.

### 3.7 Diagnostic

```jsonc
{
  "severity": "error | warning",
  "code": "MANAGER_* | NATIVE_*",
  "message": "…",
  "tokenIndex": null,
  "profileIndex": null,
  "span": { "start": 0, "end": 0 },
  "related": [ /* token indexes */ ]
}
```

### 3.8 Diagnostic registry

**Manager codes** (manager-owned structure only):

| Code | Severity | Grounding |
|---|---|---|
| `MANAGER_UNTERMINATED_QUOTE` | error | tokenizer |
| `MANAGER_DANGLING_ESCAPE` | error | tokenizer |
| `MANAGER_CONTROL_CHARACTER` | error | tokenizer |
| `MANAGER_EMPTY_OPTION` | error | tokenizer (`--` / `--=x`) |
| `MANAGER_INVALID_TOP_LEVEL_PORT` | error | `pf_parse` (filter.c:12) — native exit(1) |
| `MANAGER_INVALID_TOP_LEVEL_RANGE` | error | `packet_range_parse`/`packet_pos_parse` (filter.c:115-171) — native exit(1); **bare numeric operands are rejected by the native parser** (message names the missing unit prefix) |
| `MANAGER_EMPTY_PROFILE` | warning | profile structure |
| `MANAGER_TRAILING_NEW_SEPARATOR` | warning | profile structure (separator preserved in `trailingTokens`) |
| `MANAGER_DUPLICATE_PROFILE_NAME` | warning | name bookkeeping |
| `MANAGER_CONFLICTING_PROFILE_NAMES` | warning | `--new=A` vs `--name=B` — both preserved |
| `MANAGER_UNKNOWN_OPTION` | warning | not in the pinned `long_options` table; raw preserved |
| `MANAGER_NOT_IN_CATALOG` | warning | function/blob hint absent from the manager catalog — **not a native verdict** |
| `MANAGER_LOSSY_ROUNDTRIP` | error | preserve serializer would lose tokens/content — emitted INSTEAD of silently changing the string |

**Native codes** (only inside `nativeValidation.diagnostics`, sourced from a
native run or the bundle layer):

| Code | Meaning |
|---|---|
| `NATIVE_NOT_CHECKED` | default state |
| `NATIVE_UNAVAILABLE` | no proven side-effect-free oracle executed |
| `NATIVE_REJECTED` | native parser rejected the options (message carries the native error) |
| `NATIVE_FUNCTION_NOT_FOUND` | `desync function '%s' does not exist` (function-existence oracle) |
| `NATIVE_LUA_COMPAT_MISMATCH` | compat mismatch (bundle cross-check or native run) |
| `NATIVE_BINARY_LUA_MISMATCH` | bundle selected for the wrong target release |
| `NATIVE_RUNTIME_ARGUMENT_ERROR` | runtime argument error (packet time — reported, never simulated) |

Removed with cause (superseded by the native-authority model):
`UNKNOWN_LUA_METHOD`/`UNDECLARED_BLOB` as manager-fatal errors (now
`MANAGER_NOT_IN_CATALOG` warnings + native oracle), the wide-range-without-
exclusion rule (community heuristic, docs/strategy-pack.md §6 — not native
grammar), and the controversial-parameter error codes (opaque-expression
internals — only native judges them).

---

## 4. Serializer

### 4.1 Preserve mode (default for round-trips)

Reconstructs the input **byte-identically**: every token emitted `raw`,
joined by the exact original whitespace gaps. If any original token would be
lost (dropped from the semantic model) or any non-whitespace content sits
outside emitted tokens, the serializer emits `MANAGER_LOSSY_ROUNDTRIP`
(error) naming the lost tokens — it never silently changes the string.

`--lua-desync` goes back **exactly** as it came: no fragment reordering, no
argument renaming, no auto-fixing.

### 4.2 Canonical mode

Stable documented order of the **manager-owned top-level structure**:
`--name`, `--lua-init`, `--blob`, then filters → payload → hostlists →
ipsets → ranges, then `lua-desync` (**raw, original order — never
reordered**), passthrough, unknown options. One option per line; values with
whitespace/quotes/backslashes are double-quoted with backslash doubling.

Semantics guard: if a profile interleaves stateful options (filters, payload,
ranges, lists, blobs, lua-init) with `lua-desync` entries, the whole profile
falls back to original relative order. Canonical makes no byte-identity
promise; re-parsing it must be semantically equivalent
(`semanticProjection` equality).

---

## 5. Corpus runner

`tests/strategy/lib/corpus.mjs` — reads a directory of strategy files;
one file's failure never stops the others. Per file: manager parse status
(`success | partial | failure`), preserve round-trip, diagnostics, catalog
warnings, native status (as recorded — the runner never invents native
verdicts). Totals: files, profiles, managerParseSuccess/Failure,
preserveRoundtripSuccess/Failure, catalogWarnings, nativeValid/Invalid/
Unavailable/NotChecked, bundleMismatches, diagnosticsByCode.

The 300-strategy community corpus is **[CORPUS:PENDING]** — not imported
(needs source, license, commit, provenance, target bundle, native oracle).
No support claims are made until a real run.

---

## 6. Reference implementation map

| File | Role |
|---|---|
| `tests/strategy/lib/tokenize.mjs` | safe shell tokenizer + `extractShellAssignment` |
| `tests/strategy/lib/catalog.mjs` | UI hint catalog (methods/blobs/options) with provenance |
| `tests/strategy/lib/parse.mjs` | profile split + top-level extraction + opaque lua-desync |
| `tests/strategy/lib/serialize.mjs` | preserve + canonical serializers |
| `tests/strategy/lib/validate.mjs` | MANAGER_* diagnostics |
| `tests/strategy/lib/native.mjs` | bundle loader + consistency checks + oracle adapter (no exec) |
| `tests/strategy/lib/semantics.mjs` | semantic projection for round-trip equality |
| `tests/strategy/lib/corpus.mjs` | corpus runner |
| `tests/strategy/native-bundles/*.json` | versioned bundle manifests |
| `tests/strategy/fixtures.expected.json` | per-fixture expectation manifest |

Run: `node --test "tests/strategy/*.test.mjs"` (standalone; wiring into the
repo-wide runner is the integrator's step).
