"""
Slice Roman (Legion) armor combined 832x1344 sheets into per-animation files
matching the existing pattern in tools/lpc_spritesheets/torso/armour/<name>/male/<action>.png

Source: temp download of Legion armor.zip
  C:/Users/Puras/AppData/Local/Temp/legion_armor/Legion armor/

Old-format LPC sheet layout (832x1344 = 13 cols x 21 rows @ 64px):
  rows  0-3   spellcast  (4 directions)
  rows  4-7   thrust     (4 directions)
  rows  8-11  walk       (4 directions)
  rows 12-15  slash      (4 directions)
  rows 16-19  shoot      (4 directions)
  row  20     hurt       (1 direction)

For missing extended animations (idle, jump, run, combat_idle, etc.) we copy from
the existing torso/armour/legion/male/<action>.png as a neutral fallback — so the
character generator never gets a missing file.

Outputs (3 material variants):
  tools/lpc_spritesheets/torso/armour/roman_legion_bronze/male/<action>.png
  tools/lpc_spritesheets/torso/armour/roman_legion_steel/male/<action>.png
  tools/lpc_spritesheets/torso/armour/roman_legion_gold/male/<action>.png

  tools/lpc_spritesheets/head/helmets/roman_galea1/male/<material>/<action>.png
  tools/lpc_spritesheets/head/helmets/roman_galea2/male/<material>/<action>.png
  tools/lpc_spritesheets/head/helmets/roman_galea3/male/<material>/<action>.png

Attribution: Nila122, JaidynReiman, Matthew Krohn, Johannes Sjölund (CC-BY-SA 3.0)
"""
from __future__ import annotations

import shutil
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Install Pillow: pip install Pillow")

ROOT     = Path(__file__).resolve().parents[1]
SRC_BASE = Path("C:/Users/Puras/AppData/Local/Temp/legion_armor/Legion armor")
DST_BASE = ROOT / "tools" / "lpc_spritesheets"

# Fallback source for extended animations (idle, jump, run, …) not in old LPC sheets
FALLBACK_LEGION = DST_BASE / "torso" / "armour" / "legion" / "male"

FRAME = 64
COLS  = 13

# Animations present in the old 832×1344 format
OLD_FORMAT_ACTIONS = [
    ("spellcast", 0,  4),
    ("thrust",    4,  4),
    ("walk",      8,  4),
    ("slash",     12, 4),
    ("shoot",     16, 4),
    ("hurt",      20, 1),
]

# Extended animations only in newer full sheets — copy from existing legion fallback
EXTENDED_ACTIONS = [
    "climb", "idle", "jump", "sit", "emote", "run",
    "combat_idle", "backslash", "halfslash",
]


def slice_old_sheet(src: Path, dst_dir: Path) -> None:
    """Slice a 832×1344 combined sheet into per-animation PNGs."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        sheet = im.convert("RGBA")
    w, h = sheet.size
    if w != COLS * FRAME or h != 21 * FRAME:
        print(f"  WARN: unexpected size {w}x{h} for {src.name}")
    for action, row_start, rows in OLD_FORMAT_ACTIONS:
        top    = row_start * FRAME
        bottom = (row_start + rows) * FRAME
        crop   = sheet.crop((0, top, COLS * FRAME, bottom))
        crop.save(dst_dir / f"{action}.png")
    # Copy extended animations from legion fallback
    for action in EXTENDED_ACTIONS:
        fallback = FALLBACK_LEGION / f"{action}.png"
        if fallback.exists():
            shutil.copy2(fallback, dst_dir / f"{action}.png")


def slice_armor_variants() -> None:
    """Process Male legion plate + bauldron variants."""
    # Map: (source file stem, destination armor name)
    armor_map = [
        ("Male_legionplate_bronze", "roman_legion_bronze"),
        ("Male_legionplate_steel",  "roman_legion_steel"),
        ("Male_legionplate_gold",   "roman_legion_gold"),
    ]
    plate_dir  = SRC_BASE / "Plate"
    bald_dir   = SRC_BASE / "Bauldron"

    for stem, dst_name in armor_map:
        material = stem.split("_")[-1]  # bronze / steel / gold
        plate_src = plate_dir / f"{stem}.png"
        bald_src  = bald_dir  / f"Male_legionbauldron_{material}.png"

        if not plate_src.exists():
            print(f"  MISSING: {plate_src}")
            continue

        dst_torso = DST_BASE / "torso" / "armour" / dst_name / "male"
        print(f"  Slicing torso: {dst_name}")
        slice_old_sheet(plate_src, dst_torso)

        # Bauldron (shoulder layer) — composite on top of plate
        if bald_src.exists():
            # Save as a separate bauldron layer if needed later;
            # for now, composite bauldron onto plate to keep one layer per slot.
            dst_bald = DST_BASE / "torso" / "armour" / dst_name / "male_bauldron"
            print(f"  Slicing bauldron: {dst_name}")
            slice_old_sheet(bald_src, dst_bald)


def slice_helmet_variants() -> None:
    """Process the 3 legion helmet style variants (male, 3 materials each)."""
    helmet_dir = SRC_BASE / "Helmet"
    styles = [
        ("Male_legion1helmet", "roman_galea1"),
        ("Male_legion2helmet", "roman_galea2"),
        ("Male_legion3helmet", "roman_galea3"),
    ]
    materials = ["bronze", "steel", "gold"]
    for stem_prefix, dst_style in styles:
        for mat in materials:
            src = helmet_dir / f"{stem_prefix}_{mat}.png"
            if not src.exists():
                print(f"  MISSING: {src}")
                continue
            dst = DST_BASE / "head" / "helmets" / dst_style / "male" / mat
            print(f"  Slicing helmet: {dst_style}/{mat}")
            slice_old_sheet(src, dst)


def main() -> None:
    if not SRC_BASE.exists():
        raise SystemExit(
            f"Source not found: {SRC_BASE}\n"
            "Download Legion armor.zip and extract to C:/Users/Puras/AppData/Local/Temp/legion_armor/"
        )
    print("=== Slicing Roman armor torso variants ===")
    slice_armor_variants()
    print("=== Slicing Roman helmet variants ===")
    slice_helmet_variants()
    print("Done.")


if __name__ == "__main__":
    main()
