# zapret2.manager

OpenWrt management stack for zapret2 with a LuCI frontend and a native helper foundation.

## Current repository scope

`main` contains the current runtime source, release/build contracts, tests, and the Project Knowledge Vault. Historical material under `docs/09-work`, `docs/99-archive`, `.superpowers`, and old plans/reports is evidence only; current source code and tests outrank it for runtime behavior.

### Architecture authority

- **zapret2-manager (Z2M)** is the production runtime owner/coordinator.
- **Zapret2 Engine** and **Z2K Core** are the two mandatory System Components.
- **Avatar** is a Strategy/resource catalog authority and UX donor where verified, not a System Component or runtime writer.
- **Telegram Proxy** and **WARP / MASQUE** are optional products with their own lifecycle/ownership boundaries.
- **Strategy** owns permanent Preview → Validate → Apply. **Scanner** produces temporary evidence/candidates and hands permanent changes back to Strategy.
- Production traffic ownership is one persistent `nfqws2` instance on **NFQUEUE 300**. DNS follows the existing `dnsmasq` ownership path rather than creating a second resident DNS daemon.
- Resource Center / Asset Registry represent data and assets. Low-level Z2K assets do not create a separate user product called “Z2K Resources”.

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

The reproducible release build is pinned to the OpenWrt 25.12.5 `mediatek/filogic` SDK and builds exactly the three manager packages. The canonical local entrypoint is:

```sh
scripts/release/build-apk.sh
node scripts/release/verify-artifacts.mjs dist
```

The generated `dist/` contains the three APKs, `build-manifest.json`, and `SHA256SUMS`. The same entrypoint runs in the repository's sole GitHub Actions workflow on every push to `main` and can also be started manually; successful main builds publish the rolling `main-latest` prerelease.

For downloaded files, install all three packages from the same GitHub Release:

```sh
apk add --allow-untrusted \
  ./zapret2-manager-<version>.apk \
  ./luci-app-zapret2-manager-<version>.apk \
  ./zapret2-manager-full-<version>.apk
```

`zapret2-manager` is the backend, `luci-app-zapret2-manager` is the LuCI UI, and `zapret2-manager-full` is the `mediatek/filogic` convenience meta-package. The zapret2 engine is installed separately from System → Components. Telegram Proxy is installed separately from Proxy and Routing → Telegram Proxy; neither is bundled in these APKs. APK signing and a custom feed are intentionally out of scope.

Typical SDK target:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

## Tests

The repository keeps focused test families for the current implementation, including native/helper contracts, knowledge/docs projection, release contracts, product/UI behavior, and architecture invariants. Run the relevant family for the area being changed.

For the native foundation on Linux with Node.js, a C compiler, `pkg-config`, json-c development files, ucode, and passwordless `sudo` for the root-policy helper test:

```sh
scripts/test/native.sh
```

Set `UCODE_BIN` and `UCODE_LIBRARY_PATH` when ucode is not installed under `/opt/ucode`. The native test runner executes only `fs-helper.test.mjs` through `sudo`; all other native tests run as the invoking user.

Source/host tests are not substitutes for OpenWrt SDK compilation, router validation, or browser/runtime evidence.

## Documentation

Documentation has three deliberate responsibility levels:

- **User documentation — Quartz / GitHub Pages.** Installation, first start, actual LuCI navigation, page behavior, statuses/buttons, basic configuration, and supported platform/release information.
- **Technical/code documentation — DeepWiki.** Architecture, subsystem internals, source relationships, data flows, RPC/backend contracts, Strategy/Scanner/Engine/Z2K internals, assets, DNS/proxy lifecycle, and release engineering. Generation is steered by `.devin/wiki.json`; the public DeepWiki URL is added here only after indexing is verified.
- **Internal knowledge vault — `docs/`.** Contracts, ADRs, work evidence, research, parity evidence, AI/agent operating material, and historical records remain preserved even when DeepWiki covers the code-centric explanation.

Knowledge tooling:

- Open repository root as Obsidian vault.
- Verify and bootstrap the pinned Quartz checkout: `node scripts/docs.mjs verify`.
- Serve the internal vault with hot reload: `scripts/docs.ps1 serve` or `scripts/docs.sh serve`.
- Build public docs: `node scripts/docs.mjs build public` (legacy `--public --production` is supported).
- Build internal docs: `node scripts/docs.mjs build internal` (legacy `--internal` is supported).
- Canonical outputs: `.artifacts/docs-public` and `.artifacts/docs-internal`; remove them with `node scripts/docs.mjs clean`.
- Run knowledge validation: `node scripts/validate-knowledge.mjs`.
- Public documentation can be built locally into `.artifacts/docs-public`; publication is outside the repository's APK-only automation scope.

## Repository policy

Do not commit generated APK/IPK files, build directories, screenshots, agent state, temporary audit output, or one-off debugging scripts. `.gitignore` covers the common generated paths.

Preserve durable contracts and evidence in the knowledge vault. Do not treat historical plans/reports as proof of current runtime behavior.

## License

MIT. See `LICENSE`.
