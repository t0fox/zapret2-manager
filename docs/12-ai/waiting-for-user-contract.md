---
id: contract-waiting-for-user
title: "Waiting For User Contract"
type: contract
status: normative
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [ai, contract, waiting-for-user]
---

# Waiting For User Contract

`WAITING_FOR_USER` is allowed only for a concrete external dependency that available tools, repository evidence, history, tests, documentation, and safe inference cannot resolve and only the user can provide or decide.

Before waiting, identify both exact, non-empty fields immediately before the state marker:

```
REQUIRED_USER_INPUT:
<one concrete missing input or decision>
WHY_ONLY_USER_CAN_PROVIDE_IT:
<why only the user controls it>
[goal:blocked]
```

Difficulty, substantial refactoring, failed attempts, failing tests or CI, Critical/Important review findings, restoration of known-good behavior, history/caller/contract investigation, architectural uncertainty, token cost, or inconvenience are not user dependencies. If repository evidence can resolve the issue, remain `WORKING`. Failure count means change strategy, not ask the user to take over engineering. If an actionable todo remains, audit that exact todo for a user-only dependency; otherwise its state is `WORKING`.

## Goal Watchdog Safety

Keep autonomous goal runs bounded by configured turn, duration, token, no-progress, no-tool-call, and prompt-failure limits. Treat `[goal:complete]` as a claim: include adjacent `[goal:evidence]` naming commands, results, and files checked. Respect fresh user messages, rejected permissions, provider errors, compaction recovery, and explicit pauses.

Never put API keys, authorization headers, credentials, or private tokens in backups, traces, prompts, or reports.
