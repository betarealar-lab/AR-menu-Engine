#!/usr/bin/env python3
"""Pull the platform's theme presets out of admin-app/lib/themePresets.ts into JSON.

    python menu/render/extract_presets.py

A preset is the other half of a template. `extract_css.py` takes the rules; this takes the
VALUES they consume - `night_bg_image`, `day_card_bg`, `accent`, and the rest - which the
platform maps onto CSS custom properties (`--bg-image`, `--card-bg`, `--accent`).

That mapping is the whole theming model, and it is why "a new template" can be data
instead of code (MENU-PLATFORM §2.2): the structural CSS never changes, only the numbers
poured into it. A tenant's own `theme` column then overrides individual keys on top.

Written to `ported/presets.json` and committed, so nothing at runtime needs this file or
the platform repo.

Read-only on their repo, always (DECISIONS §9.7).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

SRC = Path(r"C:\Users\temot\BetaReal scaleable\admin-app\lib\themePresets.ts")
OUT = Path(__file__).resolve().parent / "ported" / "presets.json"


def main() -> int:
    if not SRC.is_file():
        print(f"cannot read {SRC}")
        return 1
    text = SRC.read_text(encoding="utf-8", errors="replace")

    presets: dict[str, dict[str, str]] = {}
    # Each preset is `  name: {  ...  },` at one level of indentation. Values are single
    # or double quoted strings that may themselves contain commas and braces (gradients
    # are full of both), so the value is matched as a quoted run rather than split on
    # punctuation - splitting is what would break on
    # `linear-gradient(120deg, #25c265, #3b82f6)`.
    for block in re.finditer(r"^  ([a-z0-9_]+):\s*\{(.*?)^  \},", text, re.S | re.M):
        name, body = block.group(1), block.group(2)
        pairs = dict(re.findall(r"([a-z0-9_]+)\s*:\s*'([^']*)'", body))
        pairs.update(dict(re.findall(r'([a-z0-9_]+)\s*:\s*"([^"]*)"', body)))
        if pairs:
            presets[name] = pairs

    if not presets:
        print("no presets found - has themePresets.ts changed shape?")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(presets, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(presets)} presets -> {OUT.name} ({OUT.stat().st_size:,} bytes)")
    for n, v in sorted(presets.items()):
        night = sum(1 for k in v if k.startswith("night_"))
        day = sum(1 for k in v if k.startswith("day_"))
        print(f"  {n:24} {len(v):3} keys  ({night} night / {day} day)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
