---
id: adr-002-blockcheck-execution-boundary
title: "BlockCheck Execution Boundary"
type: adr
status: planned
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [adr, blockcheck, architecture]
---

# BlockCheck Execution Boundary

ucode owns product semantics and orchestration; Rust owns bounded typed network execution; C is only an exceptional narrow systems primitive. This is accepted target architecture, not a claim of complete implementation.
