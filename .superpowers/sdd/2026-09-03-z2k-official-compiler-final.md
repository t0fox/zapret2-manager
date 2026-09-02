# Final evidence — Official Z2K Compiler Import

Date: 2026-09-03
Repository: `G:/zapret2-manager`
Branch: `main`
Execution plan: `H:/down/z2k-official-compiler-plan-and-agent-prompt.md`

## Delivery

- Implementation commit: `88c454b2` (`feat: compile Z2K strategies with pinned official generator`).
- The commit was pushed with `git push origin main`.
- Release delivery commit: `c4874835` (`ci: publish APKs as one prerelease bundle`).
- `HEAD` and `origin/main` are both `c48748355fe99a7664c659a1512d503ce68a6302`.
- No router mutation, browser mutation, traffic acceptance, or reboot was performed.
- No agent or worktree was used; implementation stayed in the shared `main` checkout.

## Official source and semantic boundary

- Upstream source: `necronicle/z2k`, branch `z2k-enhanced`, commit
  `a7fa893ae79e91accffb7aec8652519e36c82689`.
- The compiler verifies the exact repository, commit, five required upstream
  files, their SHA-256 digests, bounded output, and a deterministic snapshot
  digest before import.
- The production harness calls the verified upstream generator functions for
  the strategy and QUIC configuration and for default strategy-file creation.
  Z2M no longer owns a fixed pool order, hand-composed all-in-one profile, or
  Discord argument patch.
- Official fixture parity produced seven profiles in upstream order, including
  Discord UDP with the upstream UDP ranges, `discord,stun` filters, payloads,
  circular recovery rule, and strategy sequence. Runtime adaptation is limited
  to declarative infrastructure resource binding and validation.

## Focused verification already completed

All commands below ran under WSL Ubuntu with the repository-native UCode
runtime; no unchanged test was rerun during final delivery:

- Official compiler: `6/6` pass.
- Official semantic parity: `2/2` pass.
- Z2K source adapter: `7/7` pass.
- Compiler package/install contract: `1/1` pass.
- Source refresh: `14/14` pass.
- Catalog source refresh: `10/10` pass.
- Catalog migration: `5/5` pass.
- Catalog generation plus source lifecycle: `12/12` pass.
- Prior baseline before implementation: `26/26` pass.
- `node scripts/validate-knowledge.mjs`: pass.
- `git diff --check`: pass before the implementation commit.

## APK gate

The first post-delivery GitHub Actions run passed all release gates:

- Run `33687761349` for commit `c48748355fe99a7664c659a1512d503ce68a6302`:
  `success` in `21m24s`.
- Release contract tests, real OpenWrt SDK package build, artifact verifier,
  single-asset bundling, upload, and prerelease publication all passed.
- `main-latest` is a prerelease with exactly one asset:
  `zapret2-manager-0.1.0-r154-filogic.tar.zst`.
- Extracting that asset produced the three APKs, `build-manifest.json`, and
  `SHA256SUMS`; all four checksum entries passed with `sha256sum -c`.

The earlier WSL-only SDK attempts remain environment diagnostics and are not
used as release evidence. No source release script was changed to conceal
those failures.
