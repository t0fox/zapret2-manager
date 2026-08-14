---
id: development-index
title: "Development"
type: index
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [development, build, tests, docs]
---

# Development

The repository is organized around OpenWrt packages, application source, tests, and a repository-root documentation vault. Public development documentation focuses on the structure and verified project commands a contributor needs; private working notes and handoffs remain internal.

## Repository structure

The main areas are:

- `zapret2-manager/` — backend package and implementation source;
- `luci-app-zapret2-manager/` — LuCI JavaScript frontend and package data;
- `zapret2-manager-full/` — target-specific backend + LuCI meta-package;
- `tests/` — automated verification;
- `docs/` — the knowledge vault and Quartz content;
- `scripts/` — documentation and validation entry points.

Generated packages, build directories, temporary audit output, and local tool state do not belong in the normal source tree.

## OpenWrt package build

Use the normal OpenWrt build system. The repository README lists these package targets:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

A host-side source test and an OpenWrt target build provide different evidence. Do not report a target build as successful based only on a host test.

## Current tests

The repository README identifies `scripts/test/native.sh` as the current native-foundation test entry point. Run current test entry points from a clean revision and keep the exact failing command when reporting a regression.

## Documentation workflow

Quartz infrastructure already exists. Ordinary documentation work should extend the content and tests rather than starting another documentation site.

Verify the documentation environment:

```sh
node scripts/docs.mjs verify
```

Build the internal vault:

```sh
node scripts/docs.mjs build internal
```

Build the public site:

```sh
node scripts/docs.mjs build public
```

The stable outputs are `.artifacts/docs-internal` and `.artifacts/docs-public`. The Bash and PowerShell wrappers call the same `docs.mjs` entry point.

## Knowledge validation

Run:

```sh
node scripts/validate-knowledge.mjs
```

The validator checks the existing frontmatter contract, identifiers, dates, links, and other knowledge-base rules. Public-site tests additionally protect the publication boundary and generated links.

New public pages use the established fields: `id`, `title`, `type`, `status`, `authority`, `updated`, `publish`, and `tags`. Do not create a second metadata schema.

## Public and internal documentation

Public documentation explains what the product is, current maturity, supported prototype workflows, troubleshooting, and architecture at a useful level. Internal notes retain implementation evidence, working plans, private operating contracts, and recovery history.

A broken public link is not a reason to publish an internal target. Replace it with a public summary, remove it, or create a public-facing page.

## Testing documentation changes

A Markdown edit is not enough to prove the public site works. Validate metadata and links, build the public artifact, run the public tests, and inspect generated HTML. The public and internal builds are separate outputs and both matter when the change affects the documentation tree.

## Where to start

A new contributor should read [Project overview](../01-project/index.md), [Architecture](../02-architecture/index.md), and the relevant product page. For documentation work, also read [Installation](../11-operations/installation.md) and [Troubleshooting](../11-operations/troubleshooting.md) so new instructions stay consistent with the verified package workflow.
