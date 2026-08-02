# Flowseal combo presets for OpenWrt

## Scope

The manager ships four pinned native OpenWrt translations from `Asterlike/zapret2UI`:

- Flowseal ALT10 Combo
- Flowseal ALT11 Combo
- Flowseal Multisplit Combo
- Flowseal ALT Fakedsplit Combo

Source revision: `Asterlike/zapret2UI@1d9bff25bace8d06ff29c7659322108e1f3f0ac1`, `Services/PresetService.cs` (MIT).

Definitions live in `tools/data/asterlike-flowseal-combos.json`; `tools/flowseal-combo.mjs` validates and generates `catalog/flowseal-combos.json`.

```sh
node tools/flowseal-combo.mjs --check
```

## Native conversion

Windows interception options never reach `nfqws2`:

- `--wf-tcp-out` becomes `NFQWS2_PORTS_TCP`.
- `--wf-udp-out` becomes `NFQWS2_PORTS_UDP`.
- `--wf-raw-part` and WinDivert paths are removed; native `--filter-*`, `--filter-l7` and `--payload` profiles replace them.
- blob paths are absolute Linux paths under `/opt/zapret2/files/fake/`.
- fallback TLS/QUIC profiles use `/opt/zapret2/ipset/zapret-hosts-user.txt`.

Each preset renders seven profiles: Discord TLS, YouTube TLS, fallback TLS, YouTube QUIC, Discord QUIC, fallback QUIC and Discord voice/STUN.

## Capture ranges

All presets are explicitly `wide`:

```text
NFQWS2_PORTS_TCP=80,443-65535
NFQWS2_PORTS_UDP=443,19294-19344,50000-65535
```

LuCI requires acknowledgement before apply; the backend repeats this check.

## Apply and rollback

The feature reuses `discord_profile_preview`, `discord_profile_apply` and `discord_profile_rollback` instead of adding a second RPC/writer path.

Before writing, the backend validates candidate identity, ports, dependencies, absence of Windows syntax, and `nfqws2 --dry-run --qnum=30999`.

Application order:

```text
NFQWS2_PORTS_TCP
NFQWS2_PORTS_UDP
NFQWS2_OPT through profiles_apply_candidate()
upstream restart and existing process/nft/NFQUEUE verification
```

`set_var()` and `restore_whole_file()` from `apply.uc` remain the only writers to `/opt/zapret2/config`. The true pre-transaction config becomes the last-good snapshot, so rollback restores all three variables together. No full firewall restart or nftables ruleset flush is used.

## Separation from Orchestra

Flowseal combos live in `flowseal-combos.json`. The existing large `orchestra-zapret2gui.json` and its single-probe Auto Strategy candidates are unchanged.

## Verification status

Host-side focused tests cover deterministic generation, strict ports, Windows-option removal, wide acknowledgement, transaction ordering, full rollback and LuCI no-auto-apply behavior.

Still required on a real router before calling the presets production-verified:

- target `ucode -c` compilation;
- native dry-run for all four candidates;
- one apply with process/nft/NFQUEUE verification;
- manual rollback proving restoration of TCP ports, UDP ports and `NFQWS2_OPT`;
- connectivity and load observation with wide capture.
