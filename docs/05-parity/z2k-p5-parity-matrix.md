---
id: z2k-p5-parity-matrix
title: "Z2K P5 staged prober parity matrix"
type: parity
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [parity, z2k, scanner, p5]
---

# Z2K-P5 staged prober parity matrix

Source of truth: `necronicle/z2k`, `z2k-enhanced`, commit
`99be613303e00d42ed027d5197f6e353995bb353` (r-77.2), primarily
`z2k-detect/internal/prober/prober.go`, `failures.go`, and `h2.go`.

| Upstream behavior | Manager boundary | P5 implementation | Evidence |
| --- | --- | --- | --- |
| DNS resolution; retain bounded IPv4 answer set | Existing Scanner worker and server-owned target profile | `resolve` native operation, max 3 IPv4 addresses | unit + router smoke |
| TCP:443 reachability before TLS | Existing native scanner probe transport | staged curl probe over each resolved address; first path-active address is selected | unit + router smoke |
| Target TLS SNI; unrestricted version first | Existing scanner probe executor | curl `--resolve` with target SNI and bounded deadline | unit + router smoke |
| Conditional TLS 1.2 retry | Existing candidate probe executor | retry only after target TLS failure, with `--tls-max 1.2` | classifier unit |
| Bounded HTTP cutoff probe | Existing Scanner result classifier | HTTP/1.1 GET, output cap 32 KiB for P5 staged transport | parser/classifier unit |
| Optional H2 probe | Existing native probe transport; no new daemon | fixed curl `--http2` probe, recorded and enforced only when profile requires it | unit + router smoke |
| Neutral SNI on the same reachable IP | Existing target profile authority | `example.com` through the same `--resolve` address | classifier unit + router smoke |
| `PathSNI`, `PathIP`, `PathServer` | Existing candidate verdict boundary | stable `pathVerdict`, `pathReason`, and `failureCode` evidence | classifier unit |
| Bounded candidate execution | Existing planner/worker | hard cap 20 shortlisted candidates, with plan counters | planner unit + plan report |
| A1 long-lived helper lifecycle | `scanner-runtime-adapter.sh` and firewall helper | unchanged; staged transport does not own firewall/NFQUEUE state | A1 regression suite |

P5 does not add a daemon, persistent prober database, or second firewall owner.
The staged network observations remain transient candidate evidence; Strategy
remains the only persistent Apply owner.
