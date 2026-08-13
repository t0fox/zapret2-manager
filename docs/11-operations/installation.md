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

The current zapret2-manager repository is a development/prototype project. It does **not** document a public binary package URL, so this guide does not invent a download command. The verified path is to build the packages with an OpenWrt build tree or SDK that contains this package source.

## Supported environment

The package definitions target OpenWrt. The backend package is `zapret2-manager`; the browser interface is `luci-app-zapret2-manager`. A target-specific `zapret2-manager-full` meta-package installs the backend and LuCI application together and currently has a `mediatek_filogic` target constraint.

The backend Makefile declares its package dependencies, including ucode and the ucode modules used by the runtime, plus normal utility and JSON libraries. The LuCI package depends on `luci-base` and the backend package.

## Build the current packages

Use the normal OpenWrt package build flow. From a correctly prepared OpenWrt build tree or SDK, the repository README lists these package targets:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

Use only targets that are valid for your OpenWrt target. The `zapret2-manager-full` meta-package is target-specific; building the backend and LuCI packages separately is the more general development path.

Successful source tests are not a substitute for an OpenWrt target-toolchain build. The backend Makefile compiles its native components with `TARGET_CC`, so the SDK build is the evidence that those components compile for the selected router target.

## Install the locally built packages

After the OpenWrt build completes, locate the packages produced by that build system and install them using the normal package-management workflow for your OpenWrt version and target. This documentation intentionally does not hard-code an artifact directory or package-manager command because those details vary by OpenWrt build and repository state.

Install the backend before or together with the LuCI package so its dependency is satisfied. The LuCI package depends on the backend and exposes the application in the OpenWrt web interface.

## What post-install does

The backend package creates its managed Strategy storage when needed, initializes Strategy state when absent, reloads `rpcd`, and enables the zapret2-manager service. The LuCI package clears LuCI caches during package lifecycle hooks so the application can appear in the menu after installation.

After installation, open LuCI and look under **Services → Zapret 2 Manager**. If the page is not visible, continue with [Troubleshooting](./troubleshooting.md) rather than repeatedly reinstalling packages.

## First verification

Before making durable changes, confirm that the LuCI application loads, backend status can be read, and the expected package files are present. Then follow [Quick Start](./quick-start.md) and begin with inspection, Preview, and validation rather than immediately applying a configuration.

## Upgrade and uninstall

The repository currently defines package configuration files and standard OpenWrt package lifecycle hooks, but it does not document a separate public one-command upgrade or rollback release mechanism. Treat upgrades as development package upgrades built from a known repository revision. Preserve configuration according to your OpenWrt package-management policy and verify the service after upgrade.

For uninstall, use the normal OpenWrt package-manager behavior for packages you installed. Do not manually delete broad groups of system resources as a substitute for package removal.

## Next steps

- [Quick Start](./quick-start.md)
- [Troubleshooting](./troubleshooting.md)
- [Project status](../01-project/status-roadmap.md)
- [Development](../08-development/index.md)
