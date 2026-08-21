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

- `docs/04-contracts/native-backend-v1.md`
- `docs/04-contracts/z2m-canonical-json-v1.md`

## Build

The reproducible release build is pinned to the OpenWrt 25.12.5 mediatek/filogic SDK and builds exactly the three manager packages. The canonical local entrypoint is:

```sh
scripts/release/build-apk.sh
node scripts/release/verify-artifacts.mjs dist
```

The generated `dist/` contains the three APKs, `build-manifest.json`, and `SHA256SUMS`. The same entrypoint runs in GitHub Actions on every push to `main`; explicit tags matching `v<version>-r<release>-rc<N>` publish immutable GitHub prereleases.

For downloaded files, install all three packages from the same GitHub Release:

```sh
apk add --allow-untrusted \
  ./zapret2-manager-<version>.apk \
  ./luci-app-zapret2-manager-<version>.apk \
  ./zapret2-manager-full-<version>.apk
```

`zapret2-manager` is the backend, `luci-app-zapret2-manager` is the LuCI UI, and `zapret2-manager-full` is the mediatek/filogic convenience meta-package. The zapret2 engine is installed separately from System → Components. Telegram Proxy is installed separately from Proxy and Routing → Telegram Proxy; neither is bundled in these APKs. APK signing and a custom feed are intentionally out of scope.

Typical SDK target:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

## Tests

Only tests for the current native foundation are kept in `tests/native/`.

On Linux with Node.js, a C compiler, `pkg-config`, json-c development files,
ucode, and passwordless `sudo` for the root-policy helper test:

```sh
scripts/test/native.sh
```

Set `UCODE_BIN` and `UCODE_LIBRARY_PATH` when ucode is not installed under
`/opt/ucode`. The gate runs only `fs-helper.test.mjs` through `sudo`; all other
native tests run as the invoking user.

These source tests are not a substitute for OpenWrt SDK compilation or router validation.

## Repository policy

Do not commit generated APK/IPK files, build directories, screenshots, agent state, temporary audit output, one-off debugging scripts, or historical task plans. `.gitignore` covers the common generated paths.

Large implementation experiments and recovery history belong on dedicated backup/feature branches, not in `main`.

## License

MIT. See `LICENSE`.

## Knowledge Base

- Open repository root as Obsidian vault
- Verify and bootstrap the pinned Quartz checkout: `node scripts/docs.mjs verify`
- Serve the internal vault with hot reload: `scripts/docs.ps1 serve` or `scripts/docs.sh serve`
- Build public docs: `node scripts/docs.mjs build public` (legacy `--public --production` is supported)
- Build internal docs: `node scripts/docs.mjs build internal` (legacy `--internal` is supported)
- Canonical outputs: `.artifacts/docs-public` and `.artifacts/docs-internal`; remove them with `node scripts/docs.mjs clean`
- Run knowledge validation: `node scripts/validate-knowledge.mjs`
- Public Pages uploads `.artifacts/docs-public` after the public leak smoke test.
