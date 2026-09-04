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

This checklist applies to one release. The release publishes one full APK and
the two verification files from the same build.

## Package and checksum gate

1. Download `zapret2-manager-full-<version>.apk`, `build-manifest.json`, and `SHA256SUMS` from one release.
2. Run `sha256sum -c SHA256SUMS`.
3. First simulate the transaction, then install the complete package:

   ```sh
   apk add --simulate --allow-untrusted ./zapret2-manager-full-<version>.apk
   apk add --allow-untrusted ./zapret2-manager-full-<version>.apk
   ```

4. Confirm the full package and its compatibility provides are installed:

   ```sh
   apk info -e zapret2-manager-full
   apk info zapret2-manager-full
   ```

## Runtime gate

1. Reload the browser and open Z2M.
2. Confirm the Components page loads.
3. Confirm backend RPC calls work and no runtime dependency is missing.
4. Confirm the Main, Strategies, DNS, Telegram Proxy, WARP, and Scanner pages that are in scope for the installed release load without package errors.
5. Restart only `/etc/init.d/zapret2-manager` and confirm the active strategy,
   RPC object, backend service, and logs remain healthy. Do not reboot the
   router as part of this checklist.

## Upgrade gate

On a router with the previous split manager package set installed, run the same
single-package command and verify that the compatibility provides migrate the
legacy package names without duplicate backend/LuCI files or a second runtime
process. Preserve the current/LKG runtime if the transaction or readiness gate
fails.

The engine remains independently installable from System → Components. Telegram Proxy remains independently installable from Proxy and Routing → Telegram Proxy.

## Evidence status

- `HARDWARE_CLEAN_INSTALL`: NOT_YET_RUN
- `HARDWARE_UPGRADE`: NOT_YET_RUN

These statuses must be replaced only with evidence from a real router run. GitHub Actions must never SSH into a private router.
