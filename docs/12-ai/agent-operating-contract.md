---
id: contract-agent-operating
title: "Agent Operating Contract"
type: contract
status: normative
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [ai, contract, operating]
---

# Agent Operating Contract

All autonomous agents operating in this repository must:

1. Load and follow the executing-plans or subagent-driven-development skill before any multi-step implementation.
2. Never modify files outside the isolated worktree when working on vault migration tasks.
3. Preserve concurrent Scanner work on main — no git reset/stash/checkout over dirty files.
4. Use WAITING_FOR_USER only when the two-line contract is satisfied.
5. Run validator after every file creation/move/modification.
6. Commit only the files created/updated by the current task.
7. Keep evidence-backed reports in the task handoff or current product docs;
   do not commit transient agent reports into the product tree.
