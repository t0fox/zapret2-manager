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

This checklist applies to a single RC release. All three APKs and the two verification files must come from the same GitHub Release.

## Package and checksum gate

1. Download `zapret2-manager`, `luci-app-zapret2-manager`, `zapret2-manager-full`, `SHA256SUMS`, and `build-manifest.json` from one RC release.
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
