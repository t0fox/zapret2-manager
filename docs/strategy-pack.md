# Strategy Pack — nfqws2 desync catalog & strategy constructor reference

This document is the foundation of the (later) strategy editor. Every method,
parameter, filter, and blob name here is grounded in an upstream artifact — not
invented. An invented parameter here becomes a non-working button in the editor,
so the rule is: **nothing is listed unless an upstream source states it**.

> **Authority (2026-07-27 correction).** The authoritative parsers are the
> target's `nfqws2` binary (C option parser) plus the Lua bundle loaded with
> it — same release, matching `lua_compat_ver` (pinned `bol-van/zapret2`
> study commit `8a0f53f3cf2c92ddeaa66995ee63a35c1210c410`; target commit
> `d3b3011`). This catalog and the static validator are a **drift linter and
> UI hint source — not a native oracle**: final validity of any Lua strategy
> expression is decided only by the native parser/bundle. See
> `docs/contracts/strategy-model.md`.
>
> **Target compatibility.** The current target reports
> `github version 0.9.20260307 (d3b3011) lua_compat_ver 5`
> (`tests/fixtures-postinstall/nfqws2-version-long.out`). The older capture
> with `lua_compat_ver 6` (`tests/fixtures/nfqws2-version-long.out`) is a
> **legacy** fixture — do not use it as the current target. The v5 target Lua
> bundle is byte-exact to upstream commit `d3b3011` (verified by hash
> comparison of all six Lua files, 2026-07-27); the legacy v6 bundle is
> byte-exact to the pinned study commit `8a0f53f`. Bundle manifests live in
> `tests/strategy/native-bundles/`.
>
> **Provenance legend.**
> **[LUA]** confirmed by cross-check against the Lua fixture
> `tests/fixtures/opt-zapret2-lua-contents.out` (**legacy** capture,
> `lua_compat_ver 6`, byte-exact to upstream `8a0f53f`): the
> function exists as `function name(ctx, desync)` and its parameters match the
> `-- arg:` / `-- standard args :` comment block above it. The validator
> (`tools/validate-strategy.sh`) re-runs this cross-check automatically when the
> fixture is present — as a catalog-drift check, not a native verdict.
> **[HELP]** confirmed against the `nfqws2 -V` help output (option grammar).
> **[TARGET]** stated as community practice but **requires a run on the target
> before use** — not confirmed by fixture alone.
> **[PROMPT]** stated by the task spec; not yet confirmed in the Lua fixture.
>
> Nothing is marked confirmed on the strength of the validator alone. The
> validator's job is to catch drift; confirmation comes from the Lua fixture or
> a target run.

The upstream engine is **nfqws2** (bol-van/zapret2). Desync is driven by Lua:
each strategy is a `--lua-desync=<function>:param=val:param=val` instance, and
the functions live in `/opt/zapret2/lua/*.lua` loaded via `--lua-init=@...`.
This is a different generation from nfqws1 (`--dpi-desync=...`); see
§9 controversial #4.

---

## 1. Desynchronization methods (25) and their parameters

All 25 are **[LUA]** — present as `function name(ctx, desync)` in
`zapret-antidpi.lua`, with parameters documented in the comment block above
each function. Each method takes a fixed `(ctx, desync)` signature; the
parameters below are read from `desync.arg.<name>` inside the function.

"Standard args" are shared families (§2). "Method args" are specific to the
method. A parameter is valid for a method iff it is in the method's method-args
or in one of the standard-arg families the method uses (or is a global instance
marker: `strategy`, `final`, `cond`, `cond_neg`).

| Method | Standard args | Method args | Notes |
|---|---|---|---|
| `drop` | direction, payload | — | Drops the packet. |
| `send` | direction, fooling, ip_id, ipfrag, rawsend, reconstruct | `delay=<msec>` | Sends the dissect (dup of the original); `delay` drops and sends delayed. |
| `pktmod` | direction, fooling, ip_id | — | Modifies the current packet in place. |
| `http_domcase` | direction | — | Alternating-case the HTTP host domain. |
| `http_hostcase` | direction | `spell=<str>` | Rewrite the `Host:` header spelling; `spell` must be exactly 4 chars (default `host`). |
| `http_methodeol` | direction | — | Insert CRLF before User-Agent; must be last among HTTP tampering. |
| `http_unixeol` | direction | — | Reconstruct HTTP request with Unix EOLs padded to original size. |
| `synack_split` | rawsend, reconstruct, ipfrag | `mode=syn\|synack\|acksyn` | Split the SYN/ACK; default `synack`. |
| `synack` | rawsend, reconstruct, ipfrag | — | Add ACK flag to a SYN. |
| `wsize` | — | `wsize=N`, `scale=N` | Rewrite TCP window size (+ scale option) on SYN/ACK. |
| `wssize` | direction | `wsize=N`, `scale=N`, `forced_cutoff=<list>` | Like wsize, applies to data packets; `forced_cutoff` = payloads that trigger cutoff (default any non-empty). |
| `tls_client_hello_clone` | direction | `blob`, `fallback`, `sni_snt`, `sni_snt_new`, `sni_del_ext`, `sni_del`, `sni_first`, `sni_last` | Clone the observed TLS ClientHello into a blob for later fakes; `blob` is required. |
| `syndata` | fooling, rawsend, reconstruct, ipfrag | `blob=<blob>`, `tls_mod=<list>` | Fake payload in the SYN; default blob = 16 zero bytes. |
| `rst` | direction, payload, fooling, ip_id, rawsend, reconstruct, ipfrag | `rstack` | Send RST (or RST+ACK if `rstack` set). |
| `fake` | direction, payload, fooling, ip_id, rawsend, reconstruct, ipfrag | `blob=<blob>`, `optional`, `tls_mod=<list>` | Send a fake payload; `blob` required; `optional` skips if blob absent; `tls_mod` mods (rnd, rndsni, sni=\<str\>, dupsid, padencap; `sni=%var` supported). Works on TCP and UDP. |
| `multisplit` | direction, payload, fooling, ip_id, rawsend, reconstruct, ipfrag | `pos=<posmarker list>`, `seqovl=N`, `seqovl_pattern=<blob>`, `blob=<blob>`, `optional`, `nodrop` | Split into ordered segments at the given positions. |
| `multidisorder` | direction, payload, fooling, ip_id, rawsend, reconstruct, ipfrag | `pos=<posmarker list>`, `seqovl=N`, `seqovl_pattern=<blob>`, `blob=<blob>`, `optional`, `nodrop` | Split and send segments out of order. |
| `multidisorder_legacy` | direction, payload, fooling, ip_id, rawsend, reconstruct, ipfrag | `pos=<posmarker list>`, `seqovl=N`, `seqovl_pattern=<blob>`, `optional` | nfqws1-compatible ordering. |
| `hostfakesplit` | direction, payload, fooling, ip_id, rawsend, reconstruct | `host=<str>`, `midhost=<posmarker>`, `nofake1`, `nofake2`, `disorder_after=<posmarker>`, `blob=<blob>`, `optional`, `nodrop` | Split around the Host, sandwich with fake hosts. Fooling/repeats apply only to fakes. |
| `fakedsplit` | direction, payload, fooling, ip_id, rawsend, reconstruct | `pos=<posmarker>`, `nofake1`, `nofake2`, `nofake3`, `nofake4`, `pattern=<blob>`, `seqovl=N`, `seqovl_pattern=<blob>`, `blob=<blob>`, `optional`, `nodrop` | Fake + real split at one position. |
| `fakeddisorder` | direction, payload, fooling, ip_id, rawsend, reconstruct | `pos=<posmarker>`, `nofake1..4`, `pattern=<blob>`, `seqovl=N`, `seqovl_pattern=<blob>`, `blob=<blob>`, `optional`, `nodrop` | Fake + real, disordered. |
| `tcpseg` | direction, payload, fooling, ip_id, rawsend, reconstruct, ipfrag | `pos=<posmarker list>`, `seqovl=N`, `seqovl_pattern=<blob>`, `blob=<blob>`, `optional` | Send a single segment defined by a 2-position range; `pos` required. |
| `oob` | fooling, ip_id, rawsend, reconstruct, ipfrag | `char`, `byte`, `urp` | Inject one out-of-band byte; `urp` = urgent pointer posmarker, or `b`/`e` (default 0). Must run from the SYN. |
| `udplen` | direction, payload | `min=N`, `max=N`, `increment=N`, `pattern=<blob>`, `pattern_offset=N` | Grow/shrink a UDP payload; `increment` default 2 (negative shrinks). |
| `dht_dn` | direction | `dn=N` | DHT tamper; rewrite the bencode prefix; `dn` default 3. |

### Position markers (`pos` / `seqovl` / `midhost` / `disorder_after` / `urp`)

**[LUA]** Position markers are resolved by `resolve_pos` / `resolve_multi_pos`.
A `pos` list is comma-separated markers. Forms observed in the live config and
the Lua tests:

- Absolute byte offset: `1`, `2`, `10`, `234`.
- Named markers: `host`, `endhost`, `sld`, `midsld`, `endsld`, `sniext`,
  `extlen`, `method` (marker set depends on payload type — `host`/`endhost`/
  `sld`/`midsld` for HTTP and TLS; `sniext`/`extlen` for TLS).
- Offset from a marker: `host+2`, `sld+5`, `endhost-2`, `midsld-2`, `-5`,
  `-10` (negative = bytes before the end / before a marker).

Example from the live config: `pos=1,host+2,sld+2,sld+5,sniext+1,sniext+2,endhost-2`.

---

## 2. Standard function-arg families

**[LUA]** from the `STANDARD FUNCTION ARGS` block in `zapret-antidpi.lua`. These
are shared parameter families; a method lists which families it uses (§1).

**direction** — `dir=in|out|any`.

**fooling** (DPI deception; each is an independent flag — see controversial #4):
`ip_ttl=N`, `ip6_ttl=N`, `ip_autottl=delta,min-max`, `ip6_autottl=delta,min-max`,
`ip6_hopbyhop[=hex]`, `ip6_hopbyhop2[=hex]`, `ip6_destopt[=hex]`,
`ip6_destopt2[=hex]`, `ip6_routing[=hex]`, `ip6_ah[=hex]`, `tcp_seq=N`,
`tcp_ack=N`, `tcp_ts=N`, `tcp_md5[=hex]`, `tcp_flags_set=<list>`,
`tcp_flags_unset=<list>`, `tcp_ts_up`, `tcp_nop_del`, `fool=<fool_function>`.

**reconstruct**: `badsum` (invalidate the L4 checksum).

**rawsend**: `repeats` (how many times to send), `ifout` (override outbound
interface), `fwmark` (override fwmark).

**payload**: `payload=<type[,type]>` — restricts the following functions to these
payload types (§4 for the type list).

**ip_id**: `ip_id=seq|rnd|zero|none`, `ip_id_conn` (persist id in conntrack for
`seq` mode).

**ipfrag**: `ipfrag[=frag_function]` (default `ipfrag2`), `ipfrag_disorder`,
`ipfrag_pos_tcp`, `ipfrag_pos_udp`, `ipfrag_pos_icmp`, `ipfrag_pos`,
`ipfrag_next` (positions must be a multiple of 8; defaults 32/8/8/32).

---

## 3. Automation mechanisms (orchestrators, conditions, detectors)

All **[LUA]**, in `zapret-auto.lua`. Orchestrators are called via
`--lua-desync=<orchestrator>:...` and take over the execution plan of the
following instances.

### `circular` — strategy rotation
Rotates strategy numbers when the failure count reaches `fails`. Each following
instance must carry `strategy=N` (N starts at 1, no gaps); an instance carrying
`final` stops rotation at that number. Requires incoming-traffic redirection
(to cache RST / HTTP replies for the failure detector).

Parameters: `fails=N` (default 3), `time=<sec>` (failure-window reset, default
60), `success_detector=<fn>`, `failure_detector=<fn>`, `hostkey=<fn>`,
`key=<name>` (autostate storage table name — distinct from `hostkey`; see
controversial #2), `nld`, `reqhost` (host-key-formation params, passed through
to `standard_hostkey`). Inherits the detector params (§Detectors) and the
per-instance markers `strategy`, `final`.

> **Controversial #1 / #2 live here** — see §9. The time parameter is `time`,
> not `maxtime`; `hostkey`/`nld`/`reqhost` are host-key-formation, not rotation.

### `repeater` — repeat following instances
Parameters: `instances=N` (default 1), `repeats=N` (required), `iff=<cond_fn>`
(default `cond_true`), `neg`, `stop`, `clear`.

> **Controversial #3** — the parameter is `repeats` (plural), not `repeat`.

### `condition` — conditional execution of following instances
Parameters: `iff=<cond_fn>` (required), `neg`, `instances=N`.

### `per_instance_condition` — per-instance conditions
Parameters: `instances=N`. Each following instance may carry `cond=<cond_fn>`
and `cond_neg`.

### `stopif` — clear the plan if a condition holds
Parameters: `iff=<cond_fn>` (required), `neg`.

### Conditions (`iff=` / `cond=` values) — **[LUA]**
`cond_true`, `cond_false`, `cond_random` (arg `percent`, default 50),
`cond_payload_str` (arg `pattern`, required), `cond_tcp_has_ts`,
`cond_lua` (arg `cond_code` — Lua source for the condition).

### Detectors — **[LUA]**
**`standard_success_detector`** — resets the failure counter on success.
Params: `maxseq` (default 32768), `inseq` (default 4096), `udp_out`, `udp_in`.

**`standard_failure_detector`** — detects incoming RST, HTTP DPI redirect,
outgoing retransmissions, UDP too-much-out/too-little-in. Params: `maxseq`
(default 32768), `retrans` (default 3), `reset` (send RST to retransmitter),
`inseq` (default 4096), `no_rst` (disable RST trigger), `no_http_redirect`
(disable redirect trigger), `udp_out` (default 4), `udp_in` (default 1).

> The live config also uses `circular_quality` (orchestra-extra) with
> `combined_success_detector` / `combined_failure_detector`. These are
> orchestra-extra functions **[LUA]** (present in `orchestra-extra/*.lua`) but
> are **not** in the base catalog the editor exposes by default; the validator
> recognises them only when the Lua fixture confirms them.

### Host-key generator — **[LUA]**
**`standard_hostkey`** — params `nld` (use the last N NLD levels of the
hostname as the key), `reqhost` (fall back to the request host). Selected by
`hostkey=<fn>` on the orchestrator; the storage key is `key=<name>`.

---

## 4. Filters and profile structure

**[HELP]** from `nfqws2 -V`. Filters are stateful: each applies to the following
`--lua-desync=` functions until changed.

| Filter | Grammar | Notes |
|---|---|---|
| `--filter-tcp` | `[~]port1[-port2]\|*` (comma list) | `~` = negation. Setting tcp and no other denies others. |
| `--filter-udp` | `[~]port1[-port2]\|*` (comma list) | as above |
| `--filter-l7` | `proto[,proto]` | `all unknown known http tls dtls quic wireguard dht discord stun xmpp dns mtproto bt utp_bt`. `unknown` = intercept unclassified traffic — **mandatory for game profiles**. |
| `--filter-ipp` | `proto` | IP protocol filter. |
| `--filter-l3` | `ipv4\|ipv6` | comma list. |
| `--payload` | `type[,type]` | `all unknown empty known ipv4 ipv6 icmp http_req http_reply tls_client_hello tls_server_hello dtls_client_hello dtls_server_hello quic_initial wireguard_* dht discord_ip_discovery stun xmpp_* dns_* mtproto_initial bt_handshake utp_bt_handshake`. `unknown` = unclassified. |
| `--out-range` | `[(n\|a\|d\|s\|p\|b\|x)<int>](-\|<)[(n\|a\|d\|s\|p\|b\|x)<int>]` | Outgoing packet range. Prefixes: n=packet#, d=data-packet#, s=relative seq, p=data-pos rel-seq, b=byte count, x=never, a=always. `-` includes end, `<` excludes. |
| `--in-range` | as `--out-range` | Incoming packet range. |
| `--ctrack-disable` | `[0\|1]` | Disable conntrack. |
| `--server` | `[0\|1]` | Incoming-connection src/dst handling. |
| `--ipcache-lifetime` | `<int>` | seconds (default 7200; 0 = no expiry). |
| `--ipcache-hostname` | `[0\|1]` | Enable ip→hostname caching. |
| `--reasm-disable` | `type[,type]` | `tls_client_hello`, `quic_initial`; no arg = all. |

**Exclusion lists** (required for any profile with a wide port range, §6):
`--ipset-exclude=<file>`, `--ipset-exclude-ip=<list>`,
`--hostlist-exclude=<file>`, `--hostlist-exclude-domains=<list>`. Include lists:
`--ipset=<file>`, `--ipset-ip=<list>`, `--hostlist=<file>`,
`--hostlist-domains=<list>`, `--hostlist-auto=<file>`.

### Range forms observed in live configs
**[HELP]** + live config: `--out-range=-d10`, `--in-range=-d10000`,
`--in-range=-s4096` (incoming, relative-sequence 4096). The task's enumerated
forms — `-n3`, `<n2`, `<n3`, `-s4096` (incoming) — all fit the
`--out-range`/`--in-range` grammar with an optional left operand.
**Correction (2026-07-27, pinned `nfq2/filter.c:115-117`):** a **bare integer
operand** (e.g. `-10`, no prefix letter) is **rejected** by the native parser
— `packet_pos_parse` requires the first character to be one of
`n/d/s/p/b/x/a`, so `--out-range=-10` fails with `invalid packet range value`
and exit(1). Earlier text claiming `-10` is "accepted because it appears in
live configs" was wrong. The editor must always emit the prefixed form
(`-n10`).

### Profile separator vs name — a data-model distinction
**[HELP]** `--new[=<name>]` **begins a new profile** (and may name it).
`--name=<name>` **sets the name of the current profile** without starting a new
one. `name` is therefore an **independent property of the data model**, not a
synonym for the `new` separator. The editor must model `new` (boundary) and
`name` (property) separately.
**Pinned confirmation (nfq2/nfqws.c @8a0f53f):** `IDX_NEW` (:2706) begins the
profile and, when a value is present, assigns `dp->name` (:2738); `IDX_NAME`
(:2756) assigns `dp->name` of the current profile, so with `--new=One` +
`--name=Two` the **last** naming event wins — the manager model records every
naming event and raises `MANAGER_CONFLICTING_PROFILE_NAMES` on conflicting
values while preserving both source forms byte-for-byte.
Other profile-structural options: `--skip`
(disable the profile), `--template[=<name>]`, `--import=<name>`, `--cookie[=<str>]`.

---

## 5. Built-in binary templates (blobs)

**[LUA]** from the `BLOBS` section of `zapret-antidpi.lua` and the blob globals
defined in `init_vars.lua`. A blob is one of: inline `0xHEX`, a field name in
`desync` (a dynamic blob produced by an earlier function), or a global variable
loaded by `--blob=<name>:@<file>` or `--blob=<name>:0xHEX`.

**C-builtin base blobs** (referenced in the Lua/config but not assigned in any
Lua file, so provided by the binary itself): `fake_default_tls`,
`fake_default_http`, `fake_default_quic`. *(Inferred from usage — **[PROMPT]**
for the exact name list; not enumerable from the Lua fixture alone.)*

**Lua-global blobs** defined in `init_vars.lua` via
`tls_mod(fake_default_tls, 'sni=…')` **[LUA]**:

| Global | SNI | Maps to task's category |
|---|---|---|
| `tls_google` | www.google.com | "search domain" TLS |
| `bin_max`, `fake_max` | web.max.ru | Russian-domain TLS |
| `tls_vk` | vk.com | Russian-domain TLS |
| `tls_sber` | sberbank.ru | **banking-domain** TLS |
| `tls_yandex` | yandex.ru | Russian-domain TLS |
| `tls_mail` | mail.ru | Russian-domain TLS |
| `tls_cloudflare` | cloudflare.com | CDN |
| `tls_discord` | discord.com | messenger |
| `tls_youtube` | youtube.com | video |
| `tls_rnd`, `tls_rndsni`, `tls_rnd_google`, `tls_rnd_dupsid`, `tls_rnd_dupsid_google`, `tls_padencap`, `tls_padencap_google` | randomized | signature-analysis evasion |
| `fake_inverted_tls` | inverted `fake_default_tls` | — |

**Custom blobs** are declared inline with `--blob=<name>:@<file>` (or
`--blob=<name>:0xHEX`, or `--blob=<name>:+ofs@<file>`). Such names are **not**
in this catalog — they belong to the profile that declares them — but the
**declaration rule is**: any blob name referenced by a strategy must be either
in the built-in set above or declared with `--blob=` in the same options string.
The validator enforces this (controversial #5 when it is neither).

**Not found as a Lua global** (**[PROMPT]**, needs target confirmation): the
task names a `quic_initial` blob and quic_initial variants for the search domain
and the banking domain, and a `stun` blob. The live config loads stun from a
file (`--blob=stun_pat:@/opt/zapret2/bin/stun.bin`) rather than referencing a
built-in `stun` global, and no `quic_*` globals are defined in `init_vars.lua`.
These may be C builtins not visible in the Lua, or file-loaded in practice; the
editor must not expose them as built-in until a target confirms them.

---

## 6. Recipes (community-tested — each **[TARGET]**: run on the target before use)

Each recipe below is community practice. **None is confirmed working by the
validator or the fixture alone** — a strategy that parses cleanly can still fail
against a specific DPI. Confirm on the target before adopting. Sample options
strings for each live in `tests/fixtures/strategies/g0X-*.txt`.

### 6.1 Universal profile — encrypted + open web **[TARGET]**
One profile covering HTTPS and plain HTTP on the reference web ports, with a
fake + a multisplit. See `g01-universal-web.txt`.
```
--filter-tcp=80,443,2053,2083,2087,2096,8443
--hostlist-domains=…
--payload=all
--in-range=-d10000
--out-range=-d10
--lua-desync=fake:blob=fake_default_tls:tls_mod=rnd,dupsid,sni=www.google.com:repeats=8
--lua-desync=multisplit:pos=2:seqovl=681:seqovl_pattern=tls_google:repeats=8
```

### 6.2 Video platform with circular rotation **[TARGET]**
TLS ClientHello strategies rotated by `circular` when the failure detector
fires. See `g02-video-circular.txt`. `time=60` (not `maxtime` — §9 #1);
`strategy=N` on each instance; `final` on the last.

### 6.3 Aggressive video — growing sequence overlap **[TARGET]**
Same as 6.2 but `seqovl` is stepped through **4096, 8192, 16384, 20000** across
strategies to widen the overlap window. See `g03-video-aggressive.txt`.

### 6.4 UDP protocol — repeated fake, with TTL cut **[TARGET]**
A UDP (QUIC) profile sending the fake packet multiple times: **6, 11, 12, 15**
repeats; the 15-repeat variant additionally decreases the packet TTL by 2
(`ip_autottl=2,…`). See `g04-udp-repeats.txt`.

### 6.5 Messenger voice **[TARGET]**
UDP voice (STUN + voice ports) with `udplen` and a short fake. See
`g05-messenger-voice.txt`.

### 6.6 Hoster address ranges with mandatory exclusions **[TARGET]**
Profile keyed by hoster IP ranges (`--ipset=<file>`) with an exclusion list
(`--ipset-exclude=<file>`). See `g06-hostlist-ranges.txt`. The exclusion list is
mandatory (the validator enforces it for wide captures).

### 6.7 Game profiles (TCP and UDP) — wide capture, low CPU **[TARGET]**
Both game profiles capture the wide port range **1024–65535**, apply a **hard
limit on outgoing packets** (`--out-range=-n20` — only the first 20 outgoing
packets are tampered), require `--payload=unknown` (intercept unclassified
game traffic), and carry a **mandatory exclusion list**. The combination gives
wide coverage at low CPU load. See `g07-game-tcp.txt` and `g08-game-udp.txt`.
```
--filter-tcp=1024-65535
--hostlist-exclude=<file>
--payload=unknown
--out-range=-n20
--lua-desync=fake:blob=fake_default_tls:repeats=2
```

---

## 7. Reference ports

**TCP**: 80, 443, 1984, 2053, 2083, 2087, 2096, 5222–5228, 7790, 8443.
**UDP**: 590–600, 1400, 3478–3481, 5349, 19294–19344, 32000–32050, 45395,
49152–65535, 51372–51400.

These are the ports the live config and community recipes treat as reference
endpoints (web, video, voice/STUN, game, ephemeral). They are **not** a
complete list of ports nfqws2 can filter.

---

## 8. Non-obvious but editor-critical: one profile, two rotation regimes

**[PROMPT]** The payload section for the **open request** (plain HTTP) can be
placed **after the strategy block and operate outside the rotation mechanism**.
Concretely: within a **single profile**, some instances are under the
`circular` orchestrator (they carry `strategy=N` and are rotated), while others
are **not** under rotation (the open-HTTP section, which runs unconditionally on
`http_req`).

**The data-model consequence is the point.** "Is this instance under rotation?"
is a **per-instance** property, not a per-profile property. The editor must not
model rotation as a profile-level toggle; it must model, for each instance,
whether it belongs to the orchestrator's plan (has `strategy=N`) or stands
outside it. A profile that flattens this into one flag will silently drop either
the rotated strategies or the open-HTTP section.

The exact placement semantics (how an instance following `circular` escapes its
plan, or whether the open-HTTP section precedes the orchestrator) are
**[TARGET]** — confirm on the router before the editor encodes a specific
ordering. The per-instance rotation membership is the part the data model must
express regardless.

---

## 9. Controversial parameters — six constructs that parse but silently fail

Each of the six below appears in live community configs but **contradicts the
upstream documentation** (the Lua / the `-V` help). Blindly copying them into
the editor yields strategies that are **silently non-working**: the config is
accepted, but the parameter is ignored or errors only at runtime. **Until each
is confirmed on a target, it does not enter the editor UI.** The validator
flags each (overridable with `--allow=<id>`) with a message naming the
contradiction.

### #1 — `maxtime` is the wrong form of `time` (`--allow=rotation-maxtime`)
Live configs write `circular:maxtime=60`. The Lua reads `desync.arg.time`
(`circular`, line: `local maxtime = tonumber(desync.arg.time) or 60`). `maxtime`
is **silently ignored** (the default 60 is used). The correct parameter is
`time=<sec>`. The name `maxtime` comes from the unrelated `AUTOHOSTLIST_FAIL_TIME`
env var; do not carry it into the orchestrator.

### #2 — host-key-formation params on the rotation orchestrator (`--allow=hostkey-as-rotation`)
`hostkey`, `nld`, `reqhost` are parameters of `standard_hostkey` (host-key
**formation**), not rotation. `key=<name>` is the rotation storage key. Writing
`hostkey=tls` intending the storage key makes nfqws2 look for a hostkey
**generator function** named `tls` and error at runtime
(`automate: invalid hostkey function 'tls'`). `nld`/`reqhost` on the orchestrator
tune host-key granularity, not rotation. The editor must not expose
hostkey-formation params as rotation knobs.

### #3 — `repeat` (singular) is a typo for `repeats` (`--allow=repeat-singular`)
The repeater parameter is `repeats` (plural; `repeater:repeats=N`). `repeat=2`
is silently ignored and `repeater` then errors `missing 'repeats'`.

### #4 — nfqws1 combined desync syntax (`--allow=old-fooling-syntax`)
Live configs carry `--dpi-desync-fooling=md5sig,badseq` and other `--dpi-desync-*`
options from the previous generation. nfqws2 has **no `--dpi-desync-*` family**
(absent from the `-V` help); fooling is split into **separate independent flags**
(§2 fooling family: `tcp_md5`, `ip_autottl`, `tcp_seq`, `repeats`, …). The old
combined option is silently dropped.

### #5 — built-in blob name used but not declared (`--allow=undeclared-blob`)
A strategy references `blob=<name>` (or `seqovl_pattern=`/`pattern=`/`fallback=`)
where `<name>` is **neither declared with `--blob=` in the same string nor in
the built-in catalog** (§5). The name is assumed built-in but isn't. `fake`
errors `blob arg required` / the blob resolves to nothing. Declare it with
`--blob=<name>:@<file>` or use a confirmed built-in name.

### #6 — desync method absent from the release (`--allow=unknown-method`)
A `--lua-desync=<fn>` references a function that does not exist in the loaded
Lua. The known community error: "such a desync function does not exist" — cause:
**the binary and the Lua files are from different releases** (a method present
in one release's Lua is absent in another's).
**Correction (2026-07-27):** absence from a *static catalog* is only a
**manager warning** (`MANAGER_NOT_IN_CATALOG`) — never a fatal error by
itself. The definitive check is native: `lua_desync_functions_exist()`
(`nfq2/lua.c` @d3b3011:3891 / @8a0f53f:4023) resolves every `--lua-desync`
function against the actually loaded bundle at init time
(`nfqws2 --intercept=0`, side-effect-free per static analysis —
`docs/contracts/strategy-model.md` §2.2; because it executes Lua init code,
it is gated by a trusted-bundle policy and never runs untrusted candidate
`--lua-init`). The validator's Lua-fixture
cross-check remains a drift linter, not an oracle.

### Derived rule — binary and Lua must be from one release
From #6: **the nfqws2 binary and the `/opt/zapret2/lua/*.lua` files must be from
the same release.** The validator checks this **before** validating the
strategies themselves: it requires both the binary-version fixture and the
Lua-contents fixture to be present (co-captured from the same target), reads
`lua_compat_ver` from the version fixture, and only then runs the signature
cross-check that detects #6. If either fixture is absent, the cross-check is
**skipped (not an error)**; the static catalog checks still run.

> **Correction (2026-07-27).** Co-capture of the two fixtures in one directory
> is **not** proof of same release. Proof requires a versioned bundle manifest
> with hashes: see `tests/strategy/native-bundles/`. For the current target
> the proof EXISTS: the binary self-reports upstream commit `d3b3011` and
> `lua_compat_ver 5`, and all six captured Lua files are byte-exact to
> upstream `d3b3011` (SHA-256 comparison, 2026-07-27) whose `zapret-lib.lua`
> declares `NFQWS2_COMPAT_VER_REQUIRED=5` — a three-way match. For the legacy
> v6 capture the Lua bundle is byte-exact to pinned `8a0f53f` but the binary
> is a self-built artifact with an unproven commit, so same-release remains
> **unproven** there.
>
> **Limitation, stated honestly.** The method cross-check in
> `tools/validate-strategy.sh` is a drift linter, not a native oracle: a
> method absent from the catalog is a **manager warning**
> (`MANAGER_NOT_IN_CATALOG`), and the authoritative existence check is the
> native one — `lua_desync_functions_exist()` in `nfq2/lua.c`
> (@d3b3011:3891, @8a0f53f:4023), executed via `nfqws2 --intercept=0`
> (side-effect-free per static analysis, `docs/contracts/strategy-model.md`
> §2.2; allowed only for a trusted immutable bundle under an explicit policy).

---

## 10. Not added — the prompt named these but the data was insufficient

The following were named in the task spec but could not be confirmed in the Lua
fixture, so they are **not** in the validator's static catalog and **not**
exposed as editor entries:

- **`quic_initial` as a built-in blob name** and the quic_initial variants for
  the search domain and the banking domain. No `quic_*` globals are defined in
  `init_vars.lua`; only `fake_default_quic` is inferred (used, not assigned).
  *(The TLS analogue `tls_sber` for the banking domain is confirmed; the quic
  one is not.)*
- **`stun` as a built-in blob.** The live config loads stun from a file
  (`--blob=stun_pat:@stun.bin`); a built-in `stun` global was not found.
- **`lua_compat_ver` cross-version matrix.** The current target is ver 5
  (proven, see the header correction); ver 6 appears only in the legacy
  capture (byte-exact to pinned `8a0f53f`). A full version matrix still needs
  more target-side captures.
- **Custom/orchestra-extra methods** (`circular_quality`, `http_aggressive`,
  `combined_*_detector`, etc.) are real **[LUA]** but are **not** in the base
  25+5 catalog the editor exposes by default; the validator accepts them only
  when the Lua fixture confirms them (or via `--allow=unknown-method`).

---

## 11. Decisions made under incomplete information

1. **Wide-port threshold = 1024 ports.** The task mandates an exclusion list
   for "wide" captures but does not define "wide". 1024 cleanly separates the
   game range (1024–65535) and the ephemeral range (49152–65535) from the
   narrow reference ranges (5222–5228, 19294–19344, 3478–3481, etc.). Negated
   ranges (`~N-M`) and `*` are treated as wide only for `*`; a negated range is
   not flagged (it captures the complement).
2. **~~Bare-integer range operand (`-10`).~~ RESOLVED (2026-07-27).** Pinned
   `nfq2/filter.c:115-117` (`packet_pos_parse`) requires the first character
   of an operand to be one of `n/d/s/p/b/x/a`; a bare integer is **rejected**
   by the native parser (`invalid packet range value`, exit 1). The old
   decision to accept bare integers is revoked; the new manager model
   diagnoses them as `MANAGER_INVALID_TOP_LEVEL_RANGE` with a message naming
   the missing unit prefix.
3. **C-builtin blob names (`fake_default_tls/http/quic`).** Inferred from usage
   in the Lua/config (they are read but never assigned in any Lua file); listed
   as built-in so the validator does not false-positive on them, but marked
   **[PROMPT]** because the Lua fixture cannot enumerate C builtins.
4. **Same-release check.** No Lua-side version marker exists, so the check
   verifies fixture co-presence + `lua_compat_ver` and uses the method
   cross-check as the real mismatch detector (§9 derived rule).
5. **Controversial #2 scope.** Flagged `hostkey`, `nld`, `reqhost` on the
   orchestrator. `hostkey=` is technically a valid orchestrator param (it
   selects the generator); the controversy is its confusion with `key=` and the
   mislabeling of `nld`/`reqhost` as rotation knobs. Allow-flagged if the intent
   is a real generator.
6. **Param validation of unknown methods.** When a method is not in the static
   catalog and is `--allow`-ed, its parameters are not checked (the catalog
   cannot describe a method it does not know). The Lua cross-check, when
   available, confirms the method exists; param-level checks for custom methods
   are a documented gap.
