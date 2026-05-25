"""
Extract first frame from LPC armor idle spritesheets and save as 128x128 icon PNGs.
"""
from PIL import Image
import os

BASE = r"C:\Users\Puras\OneDrive\Desktop\RiskArena"
SPRITE_BASE = os.path.join(BASE, "tools", "lpc_spritesheets", "torso", "armour")
OUT_DIR = os.path.join(BASE, "frontend", "public", "items")

ICONS = [
    ("warrior_armor_plate.png",     os.path.join(SPRITE_BASE, "plate",    "male", "idle.png")),
    ("warrior_armor_legion.png",    os.path.join(SPRITE_BASE, "legion",   "male", "idle.png")),
    ("warrior_armor_chainmail.png", os.path.join(SPRITE_BASE, "chainmail","male", "idle.png")),
    ("rogue_armor_leather.png",     os.path.join(SPRITE_BASE, "leather",  "male", "idle.png")),
    ("rogue_armor_bandit.png",      os.path.join(SPRITE_BASE, "leather",  "male", "idle.png")),
    ("rogue_armor_shadow.png",      os.path.join(SPRITE_BASE, "leather",  "male", "idle.png")),
    ("mage_armor_cloth.png",        os.path.join(SPRITE_BASE, "bandage",  "male", "spellcast", "white.png")),
    ("mage_armor_arcane.png",       os.path.join(SPRITE_BASE, "leather",  "male", "idle.png")),
    ("mage_armor_mystic.png",       os.path.join(SPRITE_BASE, "leather",  "male", "idle.png")),
]

created = []
skipped = []

for out_name, src_path in ICONS:
    if not os.path.exists(src_path):
        print(f"  SKIP  {out_name} — source not found: {src_path}")
        skipped.append(out_name)
        continue

    out_path = os.path.join(OUT_DIR, out_name)
    with Image.open(src_path) as img:
        frame = img.crop((0, 0, 64, 64))
        icon = frame.resize((128, 128), Image.NEAREST)
        icon.save(out_path, "PNG")
    print(f"  OK    {out_name}")
    created.append(out_name)

print(f"\nDone: {len(created)} created, {len(skipped)} skipped.")
if skipped:
    print("Skipped:", skipped)
