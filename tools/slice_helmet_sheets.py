"""
Slice LPC helmet single-sheet PNGs into per-animation files matching the
existing armor pattern in tools/lpc_spritesheets/torso/armour/<name>/male/<action>.png

Input layout (from lpc-helmets ZIP):
  tools/lpc_spritesheets/head/helmets/lpc-helmets/helmet/<HELMET>/male/<COLOR>.png  (832x1344)

Output layout (matches existing armor):
  tools/lpc_spritesheets/head/helmets/<HELMET>/male/<COLOR>/<ACTION>.png

The 832x1344 source sheet has 13 cols x 21 rows of 64x64 frames laid out as:
  rows  0-3   spellcast  (4 directions)
  rows  4-7   thrust     (4 directions)
  rows  8-11  walk       (4 directions)
  rows 12-15  slash      (4 directions)
  rows 16-19  shoot      (4 directions)
  rows 20     hurt       (1 direction)
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = ROOT / "tools" / "lpc_spritesheets" / "head" / "helmets" / "lpc-helmets" / "helmet"
DST_ROOT = ROOT / "tools" / "lpc_spritesheets" / "head" / "helmets"

FRAME = 64
COLS = 13

ACTIONS = [
    ("spellcast", 0, 4),
    ("thrust", 4, 4),
    ("walk", 8, 4),
    ("slash", 12, 4),
    ("shoot", 16, 4),
    ("hurt", 20, 1),
]


def slice_one(src_png: Path, dst_dir: Path) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(src_png) as im:
        sheet = im.convert("RGBA")
    expected_h = 21 * FRAME
    if sheet.size != (COLS * FRAME, expected_h):
        print(f"WARN: {src_png} unexpected size {sheet.size}")
    for action, row_start, rows in ACTIONS:
        top = row_start * FRAME
        bottom = (row_start + rows) * FRAME
        slice_img = sheet.crop((0, top, COLS * FRAME, bottom))
        out_path = dst_dir / f"{action}.png"
        slice_img.save(out_path)


def main() -> None:
    helmets = [p for p in SRC_ROOT.iterdir() if p.is_dir()]
    helmets.sort()
    if not helmets:
        raise SystemExit(f"No helmet folders found under {SRC_ROOT}")

    count = 0
    for helmet_dir in helmets:
        helmet_name = helmet_dir.name
        for body in ("male", "female"):
            color_dir = helmet_dir / body
            if not color_dir.is_dir():
                continue
            for color_png in sorted(color_dir.glob("*.png")):
                color_name = color_png.stem
                dst_dir = DST_ROOT / helmet_name / body / color_name
                slice_one(color_png, dst_dir)
                count += 1
                print(f"  sliced {helmet_name}/{body}/{color_name}")
    print(f"Done. {count} sheets sliced into {DST_ROOT}")


if __name__ == "__main__":
    main()
