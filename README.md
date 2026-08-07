# zapret2-manager

OpenWrt-native management stack for zapret2 with LuCI, optional Telegram proxy providers, and a narrow native filesystem helper.

## Repository layout

- `zapret2-manager/` — production backend package: ucode/shell OpenWrt integration plus `src/z2m-core-helper/`.
- `luci-app-zapret2-manager/` — LuCI JavaScript frontend and ACL/menu data.
- `zapret2-manager-full/` — target meta-package.
- `tg-ws-proxy-rs/`, `tg-ws-proxy-go/` — optional Telegram proxy provider packages.
- `tests/` — preserved repository test coverage, including the current `tests/native/` helper suite.
- `scripts/` — reusable repository tooling. One-off debugging, generated output and historical agent state do not belong in `main`.
- `docs/contracts/` — current frozen compatibility contracts. Architecture documentation is being rebuilt to match the real modular layout.

## Runtime rules

Production runtime remains OpenWrt-native: ucode, C, procd, ubus/rpcd, UCI, fw4/nftables, dnsmasq and native binaries. Python is not a production runtime dependency.

The C helper under `zapret2-manager/src/z2m-core-helper/` is a narrow privileged primitive layer. DNS, Telegram, routing, strategy and UI business logic stay outside the helper.

## Build

Use the normal OpenWrt package build flow. `zapret2-manager/Makefile` builds `z2m-core-helper` with `TARGET_CC` and links `libjson-c`.

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

The historical repository-local manual APK builder is not required by the current package Makefile.

## Tests

Canonical repository runner:

```sh
sh scripts/test/run-all-tests.sh
```

Focused native helper suite:

```sh
node --test "tests/native/**/*.test.mjs"
```

Ucode compile gate on a host/target with `ucode` installed:

```sh
sh scripts/test/gate-ucode-compile.sh
```

Source tests are not a substitute for OpenWrt SDK compilation or real-router validation.

## Contracts

- `docs/contracts/native-backend-v1.md`
- `docs/contracts/z2m-canonical-json-v1.md`

## Repository policy

Do not commit generated APK/IPK files, build directories, screenshots, agent state, temporary audit output or one-off debugging scripts. Structural refactors should preserve public RPC behavior and prefer `move + compatibility` over rewriting working subsystems.

## License

MIT. See `LICENSE`.
