---
id: single-apk-release-design
title: "Single APK Release Design"
type: spec
status: current
authority: release-engineering
updated: 2026-09-04
publish: false
tags: [release, apk, openwrt, packaging]
---

# Single APK Release Design

## Goal

Publish one user-facing `zapret2-manager-full-<version>.apk` that contains
the complete Z2M-owned backend, compiled helpers, LuCI frontend, ACL/menu and
runtime resources. OpenWrt system dependencies remain normal APK dependencies.

## Architecture

`zapret2-manager-full/Makefile` becomes the canonical release package. The
release build stages backend and LuCI source inputs beside that Makefile in the
SDK, then invokes only the full package target. It compiles all four native
helpers and installs both source trees directly; no previously built APK is
unpacked or merged.

The historical `zapret2-manager` and `luci-app-zapret2-manager` Makefiles stay
available for development and existing focused tests, but the release config,
workflow, manifest and verifier recognize exactly one install artifact.

## Dependencies and migration

The full package carries the union of the existing backend dependencies and
`luci-base`: ucode modules, LuCI base, NFQUEUE kernel modules, runtime command
packages, `libjson-c`, and the other declared OpenWrt packages already used by
the manager. Zapret2 Engine/Z2K downloaded assets and Telegram Proxy remain
outside the package when their current lifecycle owns them; no third-party
binary is vendored.

The full package declares versioned compatibility provides for the two legacy
manager package names. This lets APK replace the installed split package
owners while the final package has no split-package dependencies. The payload
contains the same persistent paths, and the one full-package post-install
script owns bootstrap, migration, LuCI cache invalidation, rpcd reload, enable,
restart and bounded readiness verification. Existing conffiles and Strategy
state are never overwritten.

## Release contract

The build produces exactly `zapret2-manager-full-*.apk`, `SHA256SUMS`, and
`build-manifest.json`. The manifest records repository commit/ref, package
identity, OpenWrt SDK identity and digest, artifact bytes/digest, declared
dependencies, and bundled component booleans. The workflow uploads the three
files and publishes the APK directly as the rolling `main-latest` prerelease.

## Verification

Release tests cover the single artifact, direct source build, payload paths and
modes, dependency/provides metadata, one lifecycle script, split-to-single
upgrade semantics, manifest/checksum shape, workflow and install instructions.
The real pinned SDK build then runs the SDK-native APK metadata/content checks;
host tests, knowledge validation, shell/Node syntax and `git diff --check`
remain separate evidence gates.
