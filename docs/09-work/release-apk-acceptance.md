---
id: release-apk-acceptance
title: "OpenWrt APK Release Acceptance"
type: work
status: current
authority: evidence
updated: 2026-08-22
publish: false
tags: [release, apk, openwrt, acceptance]
---

# OpenWrt APK Release Acceptance

This checklist applies to a single RC release. The one release asset is a
bundle containing all three APKs and the two verification files from the same
build.

## Package and checksum gate

1. Download the single `zapret2-manager-<version>-<target>.tar.zst` asset from one RC release and extract it.
2. Run `sha256sum -c SHA256SUMS`.
3. Install the complete package set:

   ```sh
   apk add --allow-untrusted \
     ./zapret2-manager-<version>.apk \
     ./luci-app-zapret2-manager-<version>.apk \
     ./zapret2-manager-full-<version>.apk
   ```

4. Confirm all three packages are installed:

   ```sh
   apk info -e zapret2-manager
   apk info -e luci-app-zapret2-manager
   apk info -e zapret2-manager-full
   ```

## Runtime gate

1. Reload the browser and open Z2M.
2. Confirm the Components page loads.
3. Confirm backend RPC calls work and no runtime dependency is missing.
4. Confirm the Main, Strategies, DNS, Telegram Proxy, WARP, and Scanner pages that are in scope for the installed release load without package errors.
5. Reboot the router.
6. Confirm the manager UI, rpcd object, backend service, and package-provided dependencies still work after reboot.

The engine remains independently installable from System → Components. Telegram Proxy remains independently installable from Proxy and Routing → Telegram Proxy.

## Evidence status

- `HARDWARE_CLEAN_INSTALL`: NOT_YET_RUN
- `HARDWARE_UPGRADE`: NOT_YET_RUN

These statuses must be replaced only with evidence from a real router run. GitHub Actions must never SSH into a private router.
