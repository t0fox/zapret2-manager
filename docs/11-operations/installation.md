---
id: operations-installation
title: "Installation"
type: operations
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [operations, installation, openwrt]
---

# Installation

zapret2-manager is currently a development/prototype project. The repository does **not** document a public binary package URL, so the supported documentation path is to build packages from source with an OpenWrt build tree or SDK.

## Packages

The backend package is `zapret2-manager`. The browser interface is `luci-app-zapret2-manager` and depends on the backend. A target-specific `zapret2-manager-full` meta-package installs both and currently has a `mediatek_filogic` target constraint.

The backend Makefile declares the ucode modules, utilities, and JSON-related package dependencies required by the current build. Use the Makefiles as the source of truth rather than copying an old dependency list from external notes.

## Build

From a prepared OpenWrt build tree or SDK, the repository README lists these targets:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

Use only targets valid for the selected OpenWrt target. Building the backend and LuCI packages separately is the general development path; the full meta-package is target-specific.

A host-side source test is not a substitute for a target-toolchain package build. The current backend package builds native components with the OpenWrt target compiler, so SDK compilation is important deployment evidence.

## Install the built packages

After the build completes, install the packages produced by your OpenWrt build system using the normal package-management workflow for that OpenWrt version and target. This guide does not hard-code a generated artifact path because it depends on the build environment.

Install the backend before or together with the LuCI package. After installation, open LuCI and look for **Zapret 2 Manager** under Services.

The backend package initializes its managed Strategy storage when needed, reloads rpcd during post-install, and enables its service. The LuCI package clears its normal caches during package lifecycle hooks.

## First verification

Confirm that the LuCI application loads and that application status can be read before making durable changes. Then continue with [First Run](./first-run.md), beginning with Strategy inspection, Preview, and validation where the current build supports them.

If the page is missing or the backend status is unavailable, use [Troubleshooting](./troubleshooting.md).

## Upgrade and uninstall

The repository does not document a separate public one-command release upgrade or universal rollback mechanism. Treat upgrades as development package upgrades from a known revision and verify the application after the package operation.

For uninstall, use normal OpenWrt package-management behavior. Do not replace package removal with broad manual deletion of unrelated platform state.

## Next steps

- [First Run](./first-run.md)
- [Troubleshooting](./troubleshooting.md)
- [Project status](../01-project/status-roadmap.md)
- [Development](../08-development/index.md)
