# Flowseal combo presets for OpenWrt

## Scope

The manager ships four pinned, native OpenWrt translations of multi-profile presets from `Asterlike/zapret2UI`:

- Flowseal ALT10 Combo
- Flowseal ALT11 Combo
- Flowseal Multisplit Combo
- Flowseal ALT Fakedsplit Combo

Source revision: `Asterlike/zapret2UI@1d9bff25bace8d06ff29c7659322108e1f3f0ac1`, `Services/PresetService.cs` (MIT).

The checked-in definitions are generated from `tools/data/asterlike-flowseal-combos.json` by `tools/flowseal-combo.mjs`. Run:

```sh
node tools/flowseal-combo.mjs --check
```

Use `--write` only when intentionally regenerating the packaged definitions.

## Native conversion

Windows interception options are not passed to `nfqws2`:

- `--wf-tcp-out` becomes `NFQWS2_PORTS_TCP`.
- `--wf-udp-out` becomes `NFQWS2_PORTS_UDP`.
- `--wf-raw-part` and WinDivert paths are removed; native `--filter-*`, `--filter-l7` and `--payload` profiles provide the OpenWrt replacement.
- blob paths are absolute Linux paths under `/opt/zapret2/files/fake/`.
- fallback TLS/QUIC profiles use `/opt/zapret2/ipset/zapret-hosts-user.txt`.

Each preset renders seven profiles: Discord TLS, YouTube TLS, fallback TLS, YouTube QUIC, Discord QUIC, fallback QUIC and Discord voice/STUN.

## Capture ranges

All four presets are deliberately marked `wide`:

```text
NFQWS2_PORTS_TCP=80,443-65535
NFQWS2_PORTS_UDP=443,19294-19344,50000-65535
```

The LuCI page requires explicit acknowledgement before applying a wide preset. The backend repeats this check and refuses an unacknowledged request.

## Apply and rollback

The feature reuses the existing `discord_profile_preview`, `discord_profile_apply` and `discord_profile_rollback` RPC path rather than adding a parallel writer.

Before any write, the backend verifies:

1. the candidate ID and source digest;
2. the TCP/UDP port grammar;
3. absence of Windows-only options and unresolved placeholders;
4. required Lua, blob and hostlist files;
5. `nfqws2 --dry-run --qnum=30999`.

Application order is:

```text
NFQWS2_PORTS_TCP
NFQWS2_PORTS_UDP
NFQWS2_OPT through profiles_apply_candidate()
upstream zapret2 restart and existing runtime verification
```

`set_var()` and `restore_whole_file()` from `apply.uc` remain the only writers to `/opt/zapret2/config`. The complete pre-transaction config replaces the last-good snapshot after a successful apply, so manual rollback restores all three variables together. No full firewall restart or nftables ruleset flush is used.

## Orchestra compatibility

The same packaged JSON is visible to Orchestra inventory. Every definition is marked `compatibilityStatus: incompatible` for the legacy single-probe path because it is a full seven-profile combo. It is applied only from **Combo presets**.

## Verification status

Host-side focused tests cover deterministic generation, strict ports, Windows-option removal, explicit wide acknowledgement, transaction ordering, complete rollback and LuCI no-auto-apply behavior.

A real router acceptance drill is still required before calling the presets production-verified:

- target `ucode -c` compilation;
- target `nfqws2 --dry-run` for all four candidates;
- one apply with process/nft/NFQUEUE verification;
- manual rollback proving byte-identical restoration of TCP ports, UDP ports and `NFQWS2_OPT`;
- connectivity and load observation with the wide capture ranges.
