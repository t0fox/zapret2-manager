# zapret2-manager

OpenWrt management stack for zapret2 with a LuCI frontend and a native helper foundation.

## Current repository scope

The repository is intentionally kept small and current. Historical implementation notes, generated artifacts, legacy test suites, ad-hoc debug tools, and obsolete build helpers are not part of `main`.

### Packages

- `zapret2-manager` — backend package. It contains the ucode/shell runtime and builds the native `z2m-core-helper` with the OpenWrt target toolchain.
- `luci-app-zapret2-manager` — LuCI JavaScript frontend.
- `zapret2-manager-full` — target-specific meta-package for backend + LuCI. The zapret2 engine and Telegram proxy remain optional.
- `tg-ws-proxy-rs` / `tg-ws-proxy-go` — optional Telegram proxy providers.

## Native foundation

`zapret2-manager/src/z2m-core-helper/` contains the current native filesystem/helper foundation and protocol manifest. The implemented foundation includes bounded protocol parsing, descriptor-relative filesystem access, private directory creation, SHA-256 reads, and atomic writes.

The current compatibility contracts are:

- `docs/contracts/native-backend-v1.md`
- `docs/contracts/z2m-canonical-json-v1.md`

## Build

Use the normal OpenWrt package build flow. `zapret2-manager/Makefile` compiles `z2m-core-helper` with `TARGET_CC` and links `libjson-c`; no repository-local manual APK builder is required.

Typical SDK target:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

## Tests

Only tests for the current native foundation are kept in `tests/native/`.

On Linux with Node.js, a C compiler, `pkg-config`, and json-c development files installed:

```sh
node --test tests/native/**/*.test.mjs
```

These source tests are not a substitute for OpenWrt SDK compilation or router validation.

## Repository policy

Do not commit generated APK/IPK files, build directories, screenshots, agent state, temporary audit output, one-off debugging scripts, or historical task plans. `.gitignore` covers the common generated paths.

Large implementation experiments and recovery history belong on dedicated backup/feature branches, not in `main`.

## License

MIT. See `LICENSE`.
