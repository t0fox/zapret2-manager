---
id: resource-center-avatar-transplant
title: "Resource Center Avatar donor transplant"
type: task-report
status: verification-partial
updated: 2026-08-21
publish: false
---

# Donor matrix

Primary donor: `avatarDD/zapret-gui` at `8c44df2bed98872d1348db053623ee6bf2902408`.
License checked in donor `LICENSE`: MIT, Copyright 2026 avatarDD.

| Feature | Donor file | Donor functions/algorithms | Can transplant? | Z2M adapter | Status |
|---|---|---|---|---|---|
| Hostlist editor/import | `core/hostlist_manager.py`, `api/hostlists.py`, `web/js/pages/hostlists.js` | `normalize_domain`, `import_from_text`, `import_from_url`, CRUD/copy/reset workflow | Yes, semantics only | `lib/asset-tooling.mjs`, `z2m-asset-tooling.js`, `z2m-assets.js`, Asset Registry `normalize_content` | Adapted; one canonical writer |
| IPSet/CIDR | `core/ipset_manager.py`, `web/js/pages/ipsets.js` | `validate_ip_entry`, `_is_valid_ipv6`, `load_by_asn`, RIPE response shape | Yes, bounded | `lib/asset-tooling.mjs`, `asset-registry.uc`, `z2m-assets.js` | Adapted; ASN is preview-only until Save |
| Blob binary editor | `core/blob_manager.py`, `web/js/pages/blobs.js` | binary size guard, hex parsing/serialization, bounded display | Yes, without filesystem ownership | `z2m-asset-tooling.js`, `z2m-assets.js`, Asset Registry content RPC | Adapted; binary payloads use base64/hex |
| Fake TLS | `core/blob_manager.py::generate_fake_tls` | TLS record, ClientHello, SNI, supported versions/groups, ciphers | Yes | `lib/asset-tooling.mjs`, `z2m-asset-tooling.js` | Byte parity test PASS for deterministic two-`urandom(32)` input |
| Fake HTTP | `core/blob_manager.py::generate_fake_http` | exact request line and donor headers | Yes | `lib/asset-tooling.mjs`, `z2m-asset-tooling.js` | Byte parity test PASS |
| Lua editor | `web/js/utils/lua_syntax.js`, `web/js/pages/lua_scripts.js`, `api/lua_scripts.py` | `LuaSyntax.highlight`, overlay, gutter, line diagnostics, save/check workflow | Yes, no third-party editor | `z2m-asset-tooling.js`, `z2m-assets.js`, `asset-registry.uc` | Adapted; `luac` PASS or explicit unavailable state |

## Architecture boundary

Only `ctx.api.assets.*` is used by the Resource Center. Specialized workspaces use lazy `assets_content`; list RPC remains metadata-only. Mutations go through Asset Registry import/update/delete with revision, ownership, provenance, reference, and package protection checks.

URL import is a preview operation: bounded public-host resolution, HTTPS/HTTP-only curl, no redirects, bounded response, normalization, and validation return to the UI. Explicit Save performs the only Asset Registry mutation.

## Focused evidence

- `node --test tests/product/resource-center-tooling.test.mjs tests/product/resource-center-transaction.test.mjs tests/ui/resources-update-center.test.mjs tests/knowledge/validator.test.mjs`: PASS (32 tests at last run).
- `node --check` for `z2m-assets.js` and `z2m-asset-tooling.js`: PASS.
- `git diff --check`: PASS at last run.
- Donor parity SHA-256, deterministic TLS (`example.com`, two 32-byte sequences `00..1f`): `acbe4bd95e9f3d7aaf9784f67f4655831704253e6604ead96d54faa02db720f5`.
- Donor parity SHA-256, fake HTTP `GET /`, `example.com`: `eb27e2c0fe7e4093dfd7f21fd778587c1ba679366888e5c85638e599b78ead15`.

## Router/browser evidence

- Target: `root@192.168.1.1`, OpenWrt 25.12.5, aarch64; deployment used staging plus SHA-256 verification and atomic live replacement.
- `rpcd reload` completed; live `zapret2-manager` exposes `assets_content`, `assets_validate_content`, `assets_import_url`, and `assets_asn`.
- In-app browser route: `/cgi-bin/luci/admin/services/zapret2-manager#/resources`; Resource Center loaded through the LuCI UI with Updates, Installed, User, and Sources panes.
- Installed workspace browser acceptance: 7 Lua resources and 2 IP sets rendered; Lua preview displayed the 24,878-byte asset; Preview/Editor/Usage tabs switched correctly; editor textarea contained the Lua source and donor-style syntax overlay was visible; final browser console log set was empty.
- Live UI follow-up fixes verified in browser: Resource Center cards now follow the Strategies card rhythm and the Lua editor writes textarea content through the DOM property required by LuCI.

## Verification boundary

The complete project suite is not claimed green. Knowledge validation still has pre-existing unrelated RED findings in the documented knowledge tree; those files were not changed. Do not label this task PASS++ until the complete project suite and knowledge gate are green.
