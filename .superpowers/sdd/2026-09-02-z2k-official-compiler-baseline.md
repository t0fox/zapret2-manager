# Baseline — Official Z2K Compiler Import

Date: 2026-09-02
Repository: `G:/zapret2-manager`
Branch: `main`
Execution plan: `H:/down/z2k-official-compiler-plan-and-agent-prompt.md`

## Git evidence

- `git status --short --branch`: `## main...origin/main` (clean)
- `git rev-parse HEAD`: `c29433197576682d20314777b6c69bcb986bb8f7`
- `git rev-parse origin/main`: `c29433197576682d20314777b6c69bcb986bb8f7`
- `git diff --check`: passed.
- The plan's reviewed anchor is older than the execution HEAD and was not used
  as a reset target.

## Current semantic ownership found

`strategy-source-z2k.uc` still owns the Z2K runtime reconstruction through:

- `SUPPORTED_POOL_ORDER` with exactly five fixed pools;
- `pool_key()` inference and fixed pool routing;
- `strategy_tokens()` and `slot_entries()` semantic expansion;
- `compose_all_in_one()` manual profile composition;
- a Z2M-side Discord argument patch (`DISCORD_OFFICIAL_ARGS` and `adapt_args`).

`strategy-source-refresh.uc` fetches only `strats_new2.txt` and
`quic_strats.ini`; it does not fetch the upstream shell compiler files.

## Focused baseline

Command (WSL Ubuntu, repository-native UCode runtime):

```text
node --test --test-concurrency=1 \
  tests/product/strategy-source-z2k.test.mjs \
  tests/product/strategy-source-refresh.test.mjs
```

Result: `26 tests / 26 pass / 0 fail`, exit code `0`.

The same command from Windows PowerShell was not used as product evidence:
the default `/opt/ucode/bin/ucode` is a Linux path and the Windows invocation
cannot load the target runtime. WSL is the supported host-side execution
boundary for these UCode suites.

## First implementation boundary

Production changes start after this evidence note. No router mutation or
reboot was performed during baseline discovery.
