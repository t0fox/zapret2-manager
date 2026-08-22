---
id: current-state
title: "Current State"
type: home
status: live
authority: evidence
updated: 2026-08-22
publish: false
tags: [state, baseline, vault]
---

# Current State (Evidence-Backed)

This page is a durable semantic snapshot. Dynamic Git, CI, package, and router
facts must always be refreshed from their source commands or reports.

## Product model

Z2M is the OpenWrt management layer and sole runtime owner. The user-facing
model is:

- **Zapret2 Engine** and **Z2K Core** are the two mandatory System → Components
  foundations. Z2K Core is the manager's engine/runtime integration, not a
  second user-installable product.
- **Avatar Catalog** is an imported strategy/catalog source and donor reference,
  not a system component.
- **Strategy** owns permanent Preview → Validate → Apply lifecycle. Scanner
  results enter that same Strategy workflow; the scanner-orchestrator module is
  present but not production authority.
- **Telegram Proxy** and **WARP/MASQUE** are optional products with their own
  owners. They are not bundled into the manager package set.
- **Services/Domains**, **Resources**, and **DNS** are data/routing surfaces;
  they do not create a second firewall, engine, or asset owner.

## Current information architecture

The canonical navigation groups are Home; DPI (Management, Strategies,
Scanner); Proxy/Routing (WARP/MASQUE, Telegram Proxy); Lists/Data
(Services/Domains, Resources, DNS); Diagnostics (Monitoring, Logs); and System
(Components, Backups, Settings). Compatibility routes may remain, but they do
not create duplicate product lifecycles.

## Release readiness

The repository contains the pinned OpenWrt SDK release contract and the three
manager package definitions: `zapret2-manager`,
`luci-app-zapret2-manager`, and `zapret2-manager-full`. Main-push build and RC
workflow definitions are present. A release is not considered ready until a
fresh real SDK build produces exactly those three APKs plus
`build-manifest.json` and `SHA256SUMS`, and the artifact verifier passes. No
stable release or RC is implied by source/workflow presence alone.

## Active workstreams

- Documentation inventory, canonical routing, validator, and Quartz Pages
  deployment hardening.
- Release Engineering: real OpenWrt SDK build, artifact manifest/checksum
  verification, and RC workflow evidence.
- Product/runtime acceptance: router and browser evidence remains separate from
  host-only source tests.

## Known blockers and evidence boundaries

Fresh validator/build output and GitHub Actions logs outrank this note. A local
source test is not proof of OpenWrt SDK packaging or router E2E behavior. A
router update is not proof of a public release artifact. Any missing evidence
must remain explicitly marked NOT_RUN or NOT_YET_RUN in the relevant report.

## Do not touch in this documentation slice

Preserve Scanner, native ownership helper, NFQUEUE, Strategy, DNS, Telegram,
LuCI runtime behavior, router state, and unrelated release-owned changes.

For exact dynamic state, inspect `git status --short --branch`,
`git branch --show-current`, `git rev-parse HEAD`, `git log --oneline`, and
`git worktree list`. Actual Git state and fresh runtime evidence outrank this
durable snapshot.

## Internal vault routing

The private operating contracts remain reachable from the internal state root:

- [Agent operating contract](../12-ai/agent-operating-contract.md)
- [Knowledge maintenance contract](../12-ai/knowledge-maintenance-contract.md)
- [Verification contract](../12-ai/verification-contract.md)
- [Waiting for user contract](../12-ai/waiting-for-user-contract.md)
- [Handoff template](../12-ai/handoff-template.md)
