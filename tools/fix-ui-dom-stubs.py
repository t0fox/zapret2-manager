#!/usr/bin/env python3
"""Teach the two UI harness DOM stubs about createElement/head.

Every zone view now calls injectCSS() at the top of render(); injectCSS does
document.getElementById(...) and, when absent, document.createElement('style')
plus document.head.appendChild(...).  The harness document stubs in
tests/ui/rpc-semantics.test.mjs and tests/ui/render-harness.test.mjs predate
that and expose only querySelector/querySelectorAll/getElementById/body, so the
very first line of every render() throws

    TypeError: document.createElement is not a function

which is what all 47 + 3 failures are -- one missing stub method, not fifty
broken pages.

The stub reuses the harness's own node factory (E), so a created <style> node
is an ordinary tracked node and nothing else in the harness changes.  This does
not weaken any gate: no assertion in either file is about CSS injection.

Idempotent -- re-running reports the stubs as already patched.
"""

import argparse
import pathlib
import re
import sys

TARGETS = [
    ("tests/ui/rpc-semantics.test.mjs", r"world\.documentStub\s*=\s*\{"),
    ("tests/ui/render-harness.test.mjs", r"const documentStub\s*=\s*\{"),
]

INSERT = (
    "\n\t\t// injectCSS() runs at the top of every render(): it looks for its"
    "\n\t\t// <style> node by id and creates one when missing."
    "\n\t\tcreateElement(tag) { return E(tag); },"
    "\n\t\thead: { appendChild(n) { return n; }, contains() { return false; } },"
)


def patch(path: pathlib.Path, anchor: str) -> str:
    text = path.read_text(encoding="utf-8")
    if "createElement(tag)" in text:
        return "ok already patched"
    m = re.search(anchor, text)
    if not m:
        return "MISS anchor not found"
    if len(re.findall(anchor, text)) > 1:
        return "MISS ambiguous anchor"
    text = text[: m.end()] + INSERT + text[m.end() :]
    path.write_text(text, encoding="utf-8")
    return "fix  documentStub taught createElement + head"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()
    root = pathlib.Path(args.repo).resolve()

    rc = 0
    for rel, anchor in TARGETS:
        path = root / rel
        if not path.exists():
            print(f"  MISS {rel}: file not found", file=sys.stderr)
            rc = 1
            continue
        result = patch(path, anchor)
        print(f"  {result}: {rel}")
        if result.startswith("MISS"):
            rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
