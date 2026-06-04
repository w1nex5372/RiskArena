"""
Extract one icon PNG per (helmet, color) by cropping the south-facing standing
frame and trimming to non-empty pixels. Output goes to frontend/public/items/
so it can be referenced by item.image_path the same way armor icons are.

Source: tools/lpc_spritesheets/head/helmets/<HELMET>/male/<COLOR>/walk.png
  walk.png is 832x256 — row 0=N, row 1=W, row 2=S, row 3=E. Col 0 = standing.

Output: frontend/public/items/helmet_<HELMET>_<COLOR>.png
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = ROOT / "tools" / "lpc_spritesheets" / "head" / "helmets"
DST = ROOT / "frontend" / "public" / "items"

FRAME = 64
SOUTH_ROW = 2
STANDING_COL = 0
PAD = 2

# Which (helmet, color) combos to export — keyed to the rarity-tier assignment.
# Iron/steel for low tiers, silver for rare, bronze/gold for epic/legendary.
EXPORTS = [
    # common
    ("nasal", "iron"),
    ("flattop", "iron"),
    ("barbuta_simple", "iron"),
    ("sugarloaf_simple", "iron"),
    # uncommon
    ("spangenhelm", "steel"),
    ("barbarian", "steel"),
    ("close", "steel"),
    # rare
    ("barbuta", "silver"),
    ("sugarloaf", "silver"),
    ("barbarian_nasal", "silver"),
    # epic (boss only)
    ("spangenhelm_viking", "gold"),
    ("barbarian_viking", "gold"),
    # legendary (boss only)
    ("greathelm", "gold"),
]


def extract(helmet: str, color: str) -> Path:
    src = SRC_ROOT / helmet / "male" / color / "walk.png"
    if not src.exists():
        raise FileNotFoundError(src)
    with Image.open(src) as im:
        sheet = im.convert("RGBA")
    left = STANDING_COL * FRAME
    top = SOUTH_ROW * FRAME
    frame = sheet.crop((left, top, left + FRAME, top + FRAME))
    bbox = frame.getbbox()
    if not bbox:
        raise RuntimeError(f"frame is empty for {helmet}/{color}")
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - PAD)
    y0 = max(0, y0 - PAD)
    x1 = min(FRAME, x1 + PAD)
    y1 = min(FRAME, y1 + PAD)
    icon = frame.crop((x0, y0, x1, y1))
    DST.mkdir(parents=True, exist_ok=True)
    out = DST / f"helmet_{helmet}_{color}.png"
    icon.save(out)
    return out


def main() -> None:
    for helmet, color in EXPORTS:
        out = extract(helmet, color)
        print(f"  {out.relative_to(ROOT)}  ({Image.open(out).size})")
    print(f"Done. {len(EXPORTS)} icons exported.")


if __name__ == "__main__":
    main()
