#!/usr/bin/env python3
"""One-shot mechanical migration for the LuCI loader contract fix branch."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEW_DIR = ROOT / "luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager"
HELPERS = [
    "z2m-api",
    "z2m-store",
    "z2m-shell",
    "z2m-overview",
    "z2m-strategy-page",
    "z2m-strategy",
    "z2m-auto",
    "z2m-runs",
    "z2m-services",
    "z2m-lists",
    "z2m-dns",
    "z2m-proxy",
    "z2m-qr",
    "z2m-monitor",
    "z2m-maintenance",
]


def convert_helper(path: Path) -> None:
    source = path.read_text(encoding="utf-8")

    if "'require baseclass';" not in source and '"require baseclass";' not in source:
        marker = "'use strict';\n"
        if marker not in source:
            raise RuntimeError(f"{path}: missing strict-mode header")
        source = source.replace(marker, marker + "'require baseclass';\n", 1)

    if "return baseclass.extend({" not in source:
        matches = list(re.finditer(r"\nreturn\s+\{", source))
        if not matches:
            raise RuntimeError(f"{path}: final plain-object module return not found")

        match = matches[-1]
        source = source[: match.start()] + "\nreturn baseclass.extend({" + source[match.end() :]

        source, replacements = re.subn(r"};\s*$", "});\n", source, count=1)
        if replacements != 1:
            raise RuntimeError(f"{path}: final module terminator not found")

    path.write_text(source, encoding="utf-8")


def rewrite_menu() -> None:
    path = ROOT / "luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json"
    menu = {
        "admin/services/zapret2-manager": {
            "title": "Zapret 2 Manager",
            "order": 90,
            "action": {"type": "view", "path": "zapret2-manager/app"},
            "depends": {"acl": ["zapret2-manager"]},
        }
    }
    path.write_text(json.dumps(menu, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def bump_release(relative: str, old: int, new: int) -> None:
    path = ROOT / relative
    source = path.read_text(encoding="utf-8")
    needle = f"PKG_RELEASE:={old}"
    replacement = f"PKG_RELEASE:={new}"
    if replacement in source:
        return
    if needle not in source:
        raise RuntimeError(f"{path}: expected {needle}")
    path.write_text(source.replace(needle, replacement, 1), encoding="utf-8")


def main() -> None:
    for name in HELPERS:
        convert_helper(VIEW_DIR / f"{name}.js")

    rewrite_menu()
    bump_release("luci-app-zapret2-manager/Makefile", 137, 138)
    bump_release("zapret2-manager-full/Makefile", 136, 138)


if __name__ == "__main__":
    main()
