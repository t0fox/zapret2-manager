---
id: operations-troubleshooting
title: "Troubleshooting"
type: operations
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [operations, troubleshooting, diagnostics]
---

# Troubleshooting

Troubleshooting zapret2-manager should begin with evidence and stay scoped to the application. The project is a prototype, so an unexpected result may come from packaging, LuCI integration, backend state, or a product path that is still being completed.

## LuCI page is not visible

Confirm that the backend package and `luci-app-zapret2-manager` were installed from the intended build. The LuCI package depends on the backend and registers the application under OpenWrt Services. Record the installed package versions before changing anything manually.

## Backend status is unavailable

Separate a frontend rendering problem from a backend problem. If the LuCI shell loads but application data does not, keep the visible error and the relevant system log lines from the same time window. The backend package reloads rpcd during post-install and enables its service, so package and service state are useful first diagnostics.

## Package dependency or build errors

Use the package Makefiles as the authority for dependencies. If an OpenWrt SDK build fails, keep the complete build message and target information. A host-side source test and a target package build provide different evidence.

## Strategy and Scanner issues

For Strategy, record the selected item plus the Preview, preflight, and validation information available before Apply. For Scanner, record the exact build revision, visible Scanner status, and the result or error information shown by the current interface.

Scanner is under active development, so an unfinished Scanner path should not be treated as evidence that durable Strategy state needs a broad reset.

## Useful diagnostics

A useful report normally includes repository revision, package versions, OpenWrt version and target, whether LuCI loads, the exact product action that failed, and the smallest relevant log excerpt. For documentation failures, include the exact `scripts/docs.mjs` command and generated-site error. Keep secrets and unrelated personal configuration out of reports.

## Safe recovery

Prefer the narrowest recovery action that matches the component which owns the failed state. Do not replace a specific application problem with a broad platform reset. Broad actions destroy evidence and can affect configuration outside zapret2-manager.

If the current code does not provide a verified recovery path, document the observed state rather than inventing a destructive workaround.

## Documentation diagnostics

The documentation workflow uses `node scripts/docs.mjs verify`, `node scripts/docs.mjs build internal`, `node scripts/docs.mjs build public`, and `node scripts/validate-knowledge.mjs`. Generated outputs belong under `.artifacts/docs-internal` and `.artifacts/docs-public`.

For normal first use, return to [Installation](./installation.md) and [First Run](./first-run.md). Developers should also read [Development](../08-development/index.md).
