---
id: current-state
title: "Current State"
type: home
status: live
authority: evidence
updated: 2026-08-13
publish: false
tags: [state, baseline, vault]
---

# Current State (Evidence-Backed)

**Repository Root:** the active checkout selected by the operator (not a fixed machine path)

**Worktree:** main working tree; inspect actual git status, branch, and log for dynamic state.

**Evidence snapshot:** repository-root vault migration is integrated into main. This note is semantic project state, not a realtime HEAD record.

**Branch:** main is the intended integration branch.

**Active Work:** Knowledge Vault / Obsidian / Quartz repair and verification. Scanner parity and application implementation remain separate workstreams.

**Known Blockers:** Any current CI/build failures must be read from fresh command output and GitHub Actions logs; this note must not replace those sources.

**Pending Decisions:** none

**Do-Not-Touch:** Scanner, native ownership helper, NFQUEUE, Strategy, DNS, Telegram, LuCI, router, and unrelated runtime implementation while repairing knowledge infrastructure.

For exact dynamic Git state, inspect `git status --short --branch`, `git branch --show-current`, `git rev-parse HEAD`, `git log --oneline`, and `git worktree list` in the current repository. Actual Git tree/status/log outrank this durable semantic snapshot.
