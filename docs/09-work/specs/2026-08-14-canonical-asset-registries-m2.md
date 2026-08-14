---
id: canonical-asset-registries-m2
title: "M2 — Canonical Asset Registries: implementation evidence"
type: work-spec
status: working
authority: implementation-evidence
updated: 2026-08-14
publish: true
tags: [m2, assets, registry, strategy, scanner, security]
---

# M2 — Canonical Asset Registries: implementation evidence

This slice replaces path-only dependency semantics at the manager boundary with a typed, server-owned asset registry. It deliberately does not implement unified routing, firewall application, or M5-specific behavior.

## Evidence matrix

| Asset type | Current location / writer | Current readers | Identity before M2 | Validation before M2 | M2 contract and remaining gap |
|---|---|---|---|---|---|
| Lua | `/opt/zapret2/lua`; package/engine owner | Strategy compiler, native preflight | filename/path and descriptor key | existence, native dry-run/function checks | `lua:<slug>`, provenance/hash/revision, structural-only validation; target ucode smoke still required |
| Blob | `/opt/zapret2/bin`; package/engine owner | Strategy compiler `--blob` | blob name/path | existence and compiler/native checks | exact byte-preserving `blob:<slug>` registry; generated/stats semantics remain outside this slice |
| IP-set | `/opt/zapret2/ipset`; list/runtime owners | Strategy `--ipset*`, list model | path/list key | list model and runtime checks | canonical IPv4/IPv6/CIDR entries, `ipset:<slug>`, bounded manager storage; runtime firewall application remains another owner |
| Hostlist/hosts | list model and `/opt/zapret2/ipset`; list/DNS/runtime owners | Strategy hostlist options, lists/DNS surfaces | path/list key | domain/list checks | `hostlist:<slug>` and `hosts:<slug>` with normalized domains, references and safe deletion; full DNS/routing migration remains open |
| Geosite | no approved live consumer found in current checkout | none proven | none | none | schema slot only; `NOT_REQUIRED_YET` |
| GeoIP | no approved live consumer found in current checkout | none proven | none | none | schema slot only; `NOT_REQUIRED_YET` |

## Contract

Records contain stable typed ID, type, name, ownership, provenance, SHA-256, byte size, revision, canonical server path, validation state and consumer references. Public RPCs accept typed IDs and bounded JSON/base64 content; arbitrary filesystem paths are not an API. Trusted legacy packaged paths can be registered or mapped only under the fixed canonical roots.

Mutable records use revision checks and staged atomic replacement. Registry metadata is atomically published separately; failed metadata publication restores the previous mutable bytes or removes a newly imported file. Package-owned records require a source and expected SHA-256 and are read-only. Referenced records cannot be deleted.

`asset_registry_environment()` is the only server-side bridge into Strategy and Scanner compiler environments. Compiler `asset://type/id` resolution validates type, availability, canonical regular-file safety, revision/hash when supplied, and returns a server-owned path. Existing legacy descriptors remain a compatibility path for current packaged consumers until their identity migration is separately approved.

## Native policy

No new native binary is required for this slice. ucode is the natural OpenWrt product/state authority for the registry and RPC boundary. If a later M2 requirement proves an independent native parser or performance-sensitive helper is necessary, Rust is the default for new native code; existing C is not rewritten merely for language purity.

## Verification boundary

Local evidence covers the registry model, hostile path/reference cases, binary round trips, normalization, provenance/hash guards, package inventory, LuCI/RPC/ACL shape and JavaScript syntax. The current Windows environment has no `ucode` executable and no target router session, so target ucode execution, package install/upgrade and canonical native/root gates remain explicit follow-up evidence rather than claims of completion.
