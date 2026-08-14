---
id: project-index
title: "Project Overview"
type: project
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [project, openwrt, overview]
---

# Project overview

zapret2-manager is an OpenWrt-native management project built around a LuCI frontend, a backend package, structured state, runtime adapters, and narrow native helpers. The project is intended to make router configuration lifecycle explicit instead of hiding it behind one opaque wrapper.

## Project goals

The project aims to provide a coherent management layer for OpenWrt. User-facing actions should pass through explicit contracts, validation, state ownership, and bounded runtime operations. Permanent configuration belongs to Strategy. Exploratory Scanner work should use transient resources and must not silently turn a candidate result into permanent router configuration.

A second goal is behavioral parity with useful workflows from the upstream reference project where that behavior fits. Parity means matching useful user outcomes; it does not mean copying the upstream Python control-plane architecture. zapret2-manager deliberately targets an OpenWrt-native implementation.

## Non-goals

zapret2-manager is not intended to be a generic privileged command runner. Native helpers expose narrow operations rather than an arbitrary execution surface. The project also does not claim that every designed feature is already implemented, and public documentation must not present plans as shipped functionality.

The public site is not a mirror of the internal engineering vault. Scratch notes, handoffs, private operating instructions and recovery records stay internal.

## Design principles

**OpenWrt-native control plane.** Package layout, LuCI integration, rpcd/ubus boundaries, ucode orchestration, service lifecycle and target-toolchain builds are first-class concerns.

**Explicit authority.** Previewing or testing a candidate is different from applying permanent state. That authority boundary stays visible in the product model.

**Bounded native operations.** Native code is used where a narrow helper provides a clear boundary, not as a reason to move the whole control plane into native code.

**Owned resources and cleanup.** Transient Scanner state should be attributable to its lifecycle and cleaned up through controlled paths. Recovery guidance avoids broad destructive actions.

**Evidence over aspiration.** Current code, tests, package metadata and current contracts outrank old plans. A detailed design can exist while the corresponding feature remains prototype, in development or planned.

## Product areas

[Strategy](../03-products/strategy/index.md) is the permanent configuration authority. [Scanner](../03-products/scanner/index.md) has substantial implementation pieces but remains an active prototype whose complete production lifecycle is still being completed. [BlockCheck](../03-products/blockcheck/index.md) and [Deep Search](../03-products/deep-search/index.md) remain planned product areas.

## Current maturity

The repository contains real OpenWrt package definitions, LuCI integration, ucode and shell runtime code, a native helper foundation, and active Strategy and Scanner implementation. It should still be treated as a prototype rather than a finished appliance. Source tests are useful evidence, while OpenWrt SDK compilation and router validation remain necessary for deployed-behavior claims.

Continue with [Installation](../11-operations/installation.md), [First Run](../11-operations/first-run.md), [Architecture](../02-architecture/index.md), or the compact [Status and roadmap](./status-roadmap.md).
