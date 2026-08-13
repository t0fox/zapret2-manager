---
id: knowledge-home
title: "zapret2-manager Documentation"
type: home
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [home, documentation, openwrt]
---

# zapret2-manager

zapret2-manager is an OpenWrt-native management application with a LuCI frontend and a structured backend. The project brings its main product areas, package lifecycle, state model, and developer workflow into one coherent interface and repository.

This repository is an active prototype. Some foundations and product paths are implemented today, while other areas remain under development or planned. The public documentation uses those maturity labels deliberately so a reader can distinguish current code from future direction.

## Get started

A new visitor should begin with [Installation](./11-operations/installation.md) and [Quick Start](./11-operations/quick-start.md). The installation guide is based on the package Makefiles and build instructions that exist in the current repository. It does not invent a public package download that is not present.

If the application is already installed, [Troubleshooting](./11-operations/troubleshooting.md) explains how to collect useful diagnostics and how to approach recovery conservatively.

## Core capabilities

### Strategy — current, evolving

[Strategy](./03-products/strategy/index.md) is the product area for durable configuration. Its documentation explains the definition, compile, preflight, Preview, Validate, and Apply concepts and makes the permanent-application boundary visible.

### Scanner — prototype / under active development

[Scanner](./03-products/scanner/index.md) is the product area for evaluating candidate configurations. The repository already contains several Scanner implementation components, but the complete production lifecycle is still active development. The public page therefore documents both the current foundation and the remaining maturity boundary.

### BlockCheck — planned

[BlockCheck](./03-products/blockcheck/index.md) is a planned diagnostic product area. Its page explains why it exists, how it relates to Scanner, and what a future user workflow is expected to look like without presenting nonexistent commands as available.

### Deep Search — planned

[Deep Search](./03-products/deep-search/index.md) is also planned. It represents a broader search workflow for cases that need more exploration than the normal Scanner path.

## Architecture

The project is layered rather than monolithic. The LuCI frontend talks to backend services; orchestration works with structured state and runtime adapters; native helpers are kept narrow. The [Architecture](./02-architecture/index.md) page explains those layers, the ownership model, and the distinction between durable Strategy state and temporary Scanner work.

## Safety

Safety is treated as a product property rather than a troubleshooting afterthought. The design favors explicit ownership, bounded helper responsibilities, validation before durable changes, and cleanup for temporary work. Public recovery guidance avoids broad reset actions and focuses on evidence first.

## Project status

The repository contains real OpenWrt package definitions, a LuCI application, backend runtime components, native helper code, Strategy work, Scanner work, tests, and a Quartz documentation pipeline. It should still be evaluated as a prototype, not as a finished appliance. Build and router validation remain important evidence for deployed behavior.

For goals and non-goals, read [Project overview](./01-project/index.md). For the current maturity summary, read [Status and roadmap](./01-project/status-roadmap.md). Developers can start with [Development](./08-development/index.md).

## Main documentation

- [Installation](./11-operations/installation.md)
- [Quick Start](./11-operations/quick-start.md)
- [Project overview](./01-project/index.md)
- [Strategy](./03-products/strategy/index.md)
- [Scanner](./03-products/scanner/index.md)
- [Architecture](./02-architecture/index.md)
- [Troubleshooting](./11-operations/troubleshooting.md)
- [Development](./08-development/index.md)
- [Status and roadmap](./01-project/status-roadmap.md)

This site is the public explanation layer. Internal working notes, engineering handoffs, and private operating instructions remain outside public navigation.
