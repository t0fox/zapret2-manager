# SDD ledger — plan: docs/superpowers/plans/2026-08-19-z2k-p0-engine-compatibility.md


Task 1: complete (001-z2k-tls-mod.patch, 002-z2k-antidpi-repeats-loop.patch, 003-z2k-auto-family-split.patch generated and verified against bol-van/zapret2 base)

Task 2: complete (native-preflight.json schema v2 with Z2K_TLS_MOD, ANTIDPI_REPEATS_LOOP, AUTO_FAMILY_SPLIT capabilities and signature rules)

Task 3: complete (native-preflight.uc dual-layer capability gating implemented and verified)

Task 4: complete (engine-smoke.uc isolated bounded Lua-init smoke runner with dummy queue implemented and verified)

Task 5: complete (Package upgrade & rollback invariants, single-writer control verified)

Slice Z2K-P0 complete: All 5 tasks verified clean.

