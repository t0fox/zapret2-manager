---
task: z2k-discord-live-traffic
status: runtime-applied-live-traffic-pending
base_sha: 6d1cc2ee79e16b545b2f4dac2f4f6f8ba3836e59
---

# Z2K Discord runtime correction

## Root cause

The direct Z2K source adapter was importing the Discord section from
`quic_strats.ini` as an experimental QUIC/morph profile. That definition used
`50000-50099`, `--in-range=-d100`, `--out-range=-d100`,
`quic_initial,discord_ip_discovery`, `key=discord_udp`, and
`z2k_quic_morph_v2`. It did not match the official Discord/STUN runtime flow
used by Z2K's `config_official.sh`. It also left the source and firewall
boundaries vulnerable to drifting apart.

The adapter now normalizes that upstream Discord shape to the official
runtime flow: UDP `50000-50100` plus the STUN ranges, `discord,stun`,
`--out-range=-d4`, `discord_ip_discovery,stun`, circular
`key=discord_udp` with `hostkey=z2k_nohost_key`, and the nine official
candidates using `active_discord_udp` / `quic_dbankcloud`. The adaptation is
kept in provenance so a later source refresh cannot silently restore the old
profile.

## Source and code evidence

- Z2K refresh source commit: `a7fa893ae79e91accffb7aec8652519e36c82689`.
- Source snapshot: `z2k-3022c28905a1fb90fa987a7c42f6005a4053599b4a721bbce04b9d79923e0a50`.
- Changed adapter SHA-256: `6f57938cd6aa838e33513e38ab5ab91d7654cee294b044d4052e6636480ec25f`.
- Local targeted source suite: `13/13` passed under WSL UCode.

## Router lifecycle evidence

- Router: OpenWrt 25.12.5, Cudy WBR3000UAX v1.
- Preview: canonical All-in-One, `5` profiles, complete effective command;
  Discord markers contain `50000-50100`, `--out-range=-d4`,
  `discord_ip_discovery,stun`, `key=discord_udp`, and no legacy morph arm.
- Validate: `verified`; `cliSyntax`, `luaLoad`, `luaCompatibility`,
  `functionExistence`, `blobExistence`, `runtimeArguments`, and
  `executionPlan` all `passed`.
- Apply: candidate `02265a920dd72e2011aabc7f31747d04ca72ee5f565cf7409f9f59e6ad0e671c`,
  config `52a582a0ecfa598adef259d60133e68edf628c3a9b556558c3c500a153d8aab7`.
- Postflight: `nfqws2` PID `32430`; single instance, owner match, rules
  present, and NFQUEUE `300` registered.
- Installed `NFQWS2_PORTS_UDP` and nft capture rules both contain
  `50000-50100`.
- No router reboot was performed. The only process reload was the required
  `rpcd` HUP to release its cached source-adapter module; Apply restarted only
  `nfqws2`.

## Traffic boundary

The pre-fix passthrough A/B established that the Samsung S24 FE is directly on
the router LAN (`192.168.1.186`) and generated queue traffic; the observed
`176.59.63.79:4500` flow is T2 Wi-Fi Calling, not a VPN. The post-Apply sample
contained no active phone Discord media flow, so real voice-media acceptance
is deliberately still `PENDING` rather than reported as PASS.

To close that boundary, the S24 FE must join the same Discord voice channel
once after this Apply and remain connected for 10–15 seconds. Router-side
conntrack and NFQUEUE counters can then confirm a real Discord UDP media flow
without using a browser or credentials.
