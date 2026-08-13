---
id: project-status-roadmap
title: "Status and Roadmap"
type: project
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [project, status, roadmap]
---

# Status and roadmap

This page is a compact maturity summary for the current repository. Status labels describe what the present code and documentation support; they are not promises about future release dates.

## Current

**Package and LuCI foundation.** The repository contains the backend OpenWrt package, the LuCI application package, a target-specific meta-package, runtime source, native helper source, tests, and the Quartz documentation pipeline.

**Strategy foundation.** Strategy is the current product area for durable configuration. Its lifecycle includes definition and selection plus review-oriented stages such as compile/preflight, Preview, Validate, and the explicit Apply boundary where supported by the current implementation.

**Documentation pipeline.** Public and internal Quartz build modes already exist. Public mode uses explicit publish filtering and the repository has automated checks for private-content leakage, broken public links, and GitHub Pages subpath behavior.

## Prototype / under active development

**Scanner.** The repository contains Scanner model, state, generator, transient lifecycle, probe, worker, result, runtime-adapter, and native-helper implementation pieces. The complete production end-to-end Scanner lifecycle is still active development, so the public site does not label it stable.

The practical consequence is simple: Scanner results should be treated as candidates and current verification should be consulted before claiming a particular end-to-end path is complete.

## Planned

**BlockCheck.** This product area is planned. The current public page documents purpose, relationship to Scanner, and expected workflow without inventing commands or interface controls.

**Deep Search.** This product area is also planned. Its intended role is a broader search workflow for cases that need more exploration than the normal Scanner path.

## What is not claimed

The project does not currently claim a public binary release channel, finished production maturity for all product areas, or complete parity with every upstream workflow. A detailed design or internal plan is not enough to promote a capability to current or stable status.

## How status changes

A product area should be promoted only when current implementation and fresh verification support the stronger claim. Source tests, OpenWrt package builds, generated-site checks, and target validation provide different kinds of evidence and should not be treated as interchangeable.

For the product model, see [Project overview](./index.md). For practical entry points, see [Installation](../11-operations/installation.md), [Strategy](../03-products/strategy/index.md), [Scanner](../03-products/scanner/index.md), and [Development](../08-development/index.md).
