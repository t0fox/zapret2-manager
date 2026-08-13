---
id: operations-first-run
title: "First Run"
type: operations
status: current
authority: index
updated: 2026-08-14
publish: true
tags: [operations, first-run, luci]
---

# First Run

Use this guide after completing [Installation](./installation.md). The current repository is a prototype, so the first session should focus on understanding application state and following the product review stages in order.

## Open the application

Open zapret2-manager in the OpenWrt LuCI interface and confirm that the page loads and the current application status can be read. If the page is missing or incomplete, switch to [Troubleshooting](./troubleshooting.md) before changing anything else.

## Inspect Strategy

Strategy is the product area responsible for durable configuration. Start by inspecting the current catalog and selected Strategy. A Strategy definition and an applied Strategy are different lifecycle states, so knowing what is selected is the first useful piece of context.

## Preview

Use **Preview** where it is available in the current build. Preview is intended to show the proposed result before durable application. Read warnings and preflight information rather than treating the preview itself as a successful application.

## Validate

Use **Validate** where the current Strategy path supports it. Validation provides another review point before Apply. Keep the result with the repository revision you are testing because the project is evolving and behavior can change between builds.

## Apply deliberately

**Apply is the Strategy authority boundary for durable state.** Use it only after the selected Strategy, Preview, and available validation output have been reviewed. The separation between inspection and durable application is a core product principle.

## Use Scanner for candidates

Scanner is a prototype under active development. When Scanner functionality is present in the build being evaluated, treat its results as candidate information. A useful candidate should move through the Strategy product path before it becomes durable configuration.

The repository contains several Scanner implementation components, but this public documentation does not label the full end-to-end Scanner workflow production-complete.

## Keep the tested revision

Record the repository revision and package release associated with the session. This makes later comparison, bug reports, and troubleshooting much more useful than a report that only says the latest build was used.

## What a successful first session looks like

A useful first session is intentionally simple: the LuCI application opens, current state is readable, Strategy can be inspected, Preview and Validate can be exercised where supported, and the difference between candidate evaluation and durable Apply is clear.

From here, continue with [Strategy](../03-products/strategy/index.md), [Scanner](../03-products/scanner/index.md), [Architecture](../02-architecture/index.md), or [Troubleshooting](./troubleshooting.md).
