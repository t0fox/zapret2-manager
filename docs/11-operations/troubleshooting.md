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

Troubleshooting zapret2-manager should start with evidence and stay scoped to the application. The project is a prototype, so an unexpected result may come from packaging, LuCI integration, backend state, or an unfinished product path. Avoid broad reset actions that can damage unrelated OpenWrt configuration.

## LuCI page is not visible

First confirm that both the backend package and `luci-app-zapret2-manager` were installed from the same intended build. The LuCI package depends on the backend and registers the application under **Services → Zapret 2 Manager**.

The package lifecycle clears LuCI caches during installation and removal. If the menu still does not appear, record the installed package versions and inspect normal LuCI/rpcd service state before changing files manually. A backend/package mismatch is more useful evidence than repeated reinstall attempts.

## Backend status is unavailable

Separate a frontend rendering problem from a backend problem. If the LuCI shell loads but application data does not, collect the browser-visible error, the application status shown by LuCI, and relevant system logs from the same time window.

The backend package reloads rpcd during post-install and enables the zapret2-manager service. If the package was just upgraded, verify that normal service initialization completed and compare the installed package revision with the source revision you intended to test.

## Package dependency or build errors

Use the package Makefiles as the authority for dependencies. The backend depends on ucode and several ucode modules plus its declared utility and JSON packages; the LuCI package depends on `luci-base` and the backend.

If an OpenWrt SDK build fails, keep the complete compiler or package-manager message and the target information. Do not replace a target-toolchain failure with a host-only source test and call it fixed. Host tests and OpenWrt package compilation prove different things.

## Strategy problems

Before Apply, capture the selected Strategy, Preview, preflight output, and validation result available in the current interface. That sequence helps distinguish an invalid definition from a later application problem.

If a durable Strategy change behaves unexpectedly, preserve the current application state and logs before attempting recovery. Use Strategy-owned lifecycle actions rather than manually changing broad groups of unrelated system state.

## Scanner problems

Scanner remains under active development. When reporting a Scanner failure, include the exact build revision, target or candidate being evaluated, visible Scanner status, and result or error information. Distinguish a candidate-generation issue from an execution, observation, result, or cleanup issue when the interface exposes that distinction.

Do not treat an unfinished Scanner path as proof that permanent Strategy state must be reset. The two product areas have different ownership responsibilities.

## Useful diagnostics to collect

A useful report normally includes the repository revision used to build the packages, package versions, OpenWrt target and version, whether the LuCI page loads, the visible application status, the exact product action that failed, and the smallest relevant log excerpt around the failure.

For build failures, include the exact build target and failing step. For documentation failures, include the exact `scripts/docs.mjs` command and generated-site error. Keep secrets and unrelated personal configuration out of reports.

## Safe recovery principles

Prefer the narrowest recovery action that matches the component which owns the failed state. Avoid system-wide reset commands, deleting every similarly named resource, or terminating unrelated processes. Those actions destroy evidence and can break configuration outside zapret2-manager.

If the current code does not provide a verified recovery path for a particular failure, document the observed state and stop short of inventing one. That is safer and more useful to development than an unverified destructive workaround.

## Documentation and build diagnostics

The documentation workflow has stable commands: `node scripts/docs.mjs verify`, `node scripts/docs.mjs build internal`, and `node scripts/docs.mjs build public`. Generated outputs belong under `.artifacts/docs-internal` and `.artifacts/docs-public`. Knowledge validation is run with `node scripts/validate-knowledge.mjs`.

For a normal first-use flow, return to [Installation](./installation.md) and [Quick Start](../../getting-started.md). Developers should also read [Development](../08-development/index.md).
