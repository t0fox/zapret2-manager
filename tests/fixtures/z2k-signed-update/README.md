# Pinned r-80.1 fixture — IMMUTABLE

This fixture represents a fixed historical upstream snapshot (seq 46, current r-80.1, SHA 51c01887fc5ca3ac53b9db105d08d03eb156d75914705f316b7751fe4c79f3d9 for files/lua/z2k-state-persist.lua).

**Do not sync it automatically to current HEAD.** Future behavior is tested via synthetic fixtures under `tests/fixtures/z2k-update-transaction/` (r-80.2-known, r-80.3-unknown, incompatible candidates, digest-race).

- `UPDATES.json` — pinned manifest (seq 46, r-80.1, 143 files)
- `z2k-state-persist.lua` runtime is at `zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua` (exact-managed, byte-identical to manifest)

Future releases (r-80.2, etc.) are synthetic and do NOT require regenerating this fixture or `z2k-integration.json`. The `z2k-integration.json` is generated from this pinned fixture (143 files, 39 exact-managed) and remains the baseline for known files; unknown future files are handled as `review-required` (see `z2k-compat.uc` and `z2k-upstream.uc`).
