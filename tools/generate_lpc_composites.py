from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tools" / "lpc_manifest.json"

ANIMATION_LAYOUT = {
    "spellcast": {"row": 0, "directions": 4},
    "thrust": {"row": 4, "directions": 4},
    "walk": {"row": 8, "directions": 4},
    "slash": {"row": 12, "directions": 4},
    "shoot": {"row": 16, "directions": 4},
    "hurt": {"row": 20, "directions": 1},
    "climb": {"row": 21, "directions": 1},
    "idle": {"row": 22, "directions": 4},
    "jump": {"row": 26, "directions": 4},
    "sit": {"row": 30, "directions": 4},
    "emote": {"row": 34, "directions": 4},
    "run": {"row": 38, "directions": 4},
    "combat_idle": {"row": 42, "directions": 4},
    "backslash": {"row": 46, "directions": 4},
    "halfslash": {"row": 50, "directions": 4},
}

DEFAULT_ACTIONS = ("walk", "slash", "hurt", "idle", "jump", "run", "thrust", "spellcast")

ENCHANT_FX = [
    None,
    {"color": (153, 204, 255), "radius": 1.3, "alpha": 90},
    {"color": (85, 170, 255), "radius": 1.6, "alpha": 105},
    {"color": (34, 119, 255), "radius": 1.9, "alpha": 120},
    {"color": (0, 68, 221), "radius": 2.2, "alpha": 135},
    {"color": (0, 34, 153), "radius": 2.6, "alpha": 155},
    {"color": (136, 0, 255), "radius": 2.9, "alpha": 165},
    {"color": (204, 0, 238), "radius": 3.2, "alpha": 175},
    {"color": (255, 170, 0), "radius": 3.5, "alpha": 185},
    {"color": (255, 102, 0), "radius": 3.8, "alpha": 200},
    {"color": (255, 34, 0), "radius": 4.2, "alpha": 220},
]

HAIR_RECOLOR_PALETTE = {
    "raven": (30, 24, 28),
    "brown": (104, 64, 34),
    "blonde": (210, 165, 72),
    "red": (178, 64, 28),
    "white": (210, 214, 205),
    "blue": (48, 104, 190),
}


def frame_box(col: int, row: int, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
    left = col * frame_w
    top = row * frame_h
    return left, top, left + frame_w, top + frame_h


def enchant_fx_for_level(level: int | None) -> dict | None:
    try:
        n = max(0, min(10, int(level or 0)))
    except (TypeError, ValueError):
        return None
    return ENCHANT_FX[n]


def weapon_enchant_glow(src: Image.Image, level: int | None) -> Image.Image | None:
    fx = enchant_fx_for_level(level)
    if not fx:
        return None
    alpha = src.getchannel("A")
    if not alpha.getbbox():
        return None
    radius = float(fx["radius"])
    glow_alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(radius=radius))
    opacity = int(fx["alpha"])
    glow_alpha = glow_alpha.point(lambda p: min(255, int(p * opacity / 255)))
    glow = Image.new("RGBA", src.size, (*fx["color"], 0))
    glow.putalpha(glow_alpha)
    return glow


def paste_frame(
    output: Image.Image,
    overlay_sheet: Image.Image,
    *,
    body_col: int,
    body_row: int,
    weapon_col: int,
    weapon_row: int,
    frame_w: int,
    frame_h: int,
    source_frame_w: int | None = None,
    source_frame_h: int | None = None,
    dest_frame_w: int | None = None,
    dest_frame_h: int | None = None,
    x_off: int = 0,
    y_off: int = 0,
    enchant_level: int = 0,
) -> None:
    src_frame_w = source_frame_w or frame_w
    src_frame_h = source_frame_h or frame_h
    out_frame_w = dest_frame_w or frame_w
    out_frame_h = dest_frame_h or frame_h
    src = overlay_sheet.crop(frame_box(weapon_col, weapon_row, src_frame_w, src_frame_h))
    if not src.getbbox():
        return
    dest = (body_col * out_frame_w + x_off, body_row * out_frame_h + y_off)
    glow = weapon_enchant_glow(src, enchant_level)
    if glow:
        output.alpha_composite(glow, dest)
    output.alpha_composite(src, dest)


def centered_body_sheet(body: Image.Image, cfg: dict, frame_w: int, frame_h: int) -> Image.Image:
    body_cols = int(cfg.get("bodyCols", body.width // frame_w))
    out_frame_w = int(cfg.get("outputFrameWidth", frame_w))
    out_frame_h = int(cfg.get("outputFrameHeight", frame_h))
    body_x = int(cfg.get("bodyX", max(0, (out_frame_w - frame_w) // 2)))
    body_y = int(cfg.get("bodyY", max(0, (out_frame_h - frame_h) // 2)))
    rows = body.height // frame_h
    output = Image.new("RGBA", (body_cols * out_frame_w, rows * out_frame_h), (0, 0, 0, 0))
    for row in range(rows):
        for col in range(body_cols):
            src = body.crop(frame_box(col, row, frame_w, frame_h))
            if src.getbbox():
                output.alpha_composite(src, (col * out_frame_w + body_x, row * out_frame_h + body_y))
    return output


def resolve_layer_action_path(root: Path, layer: dict, action: str) -> Path | None:
    base = root / layer["base"] / action
    variant = layer.get("variant")
    candidates: list[Path] = []
    if variant:
        candidates.append(base / f"{variant}.png")
    candidates.append(base.with_suffix(".png"))
    candidates.append(base / f"{Path(layer['base']).name}.png")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def paste_action_sheet(
    output: Image.Image,
    sheet: Image.Image,
    *,
    action: str,
    frame_w: int,
    frame_h: int,
) -> None:
    layout = ANIMATION_LAYOUT[action]
    dest_row = int(layout["row"])
    directions = int(layout["directions"])
    src_cols = sheet.width // frame_w
    src_rows = min(directions, sheet.height // frame_h)
    if src_cols <= 0 or src_rows <= 0:
        return

    for src_row in range(src_rows):
        for col in range(src_cols):
            src = sheet.crop(frame_box(col, src_row, frame_w, frame_h))
            if src.getbbox():
                output.alpha_composite(src, (col * frame_w, (dest_row + src_row) * frame_h))


def recolor_hair_sheet(sheet: Image.Image, variant: str | None) -> Image.Image:
    target = HAIR_RECOLOR_PALETTE.get(str(variant or "").lower())
    if not target:
        return sheet

    rgba = sheet.convert("RGBA")
    pixels = rgba.load()
    target_r, target_g, target_b = target
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            brightness = max(r, g, b) / 255
            shadow = 0.48 + (brightness * 0.82)
            pixels[x, y] = (
                min(255, int(target_r * shadow)),
                min(255, int(target_g * shadow)),
                min(255, int(target_b * shadow)),
                a,
            )
    return rgba


def compose_recipe(cfg: dict, manifest: dict, frame_w: int, frame_h: int) -> Image.Image:
    sheet_cfg = manifest["sheet"]
    output = Image.new("RGBA", (int(sheet_cfg["width"]), int(sheet_cfg["height"])), (0, 0, 0, 0))
    lpc_root = ROOT / manifest["universalLpcRoot"]

    for layer in cfg["recipe"]["layers"]:
        for action in layer.get("actions", DEFAULT_ACTIONS):
            if action not in ANIMATION_LAYOUT:
                continue
            layer_path = resolve_layer_action_path(lpc_root, layer, action)
            if not layer_path:
                continue
            with Image.open(layer_path).convert("RGBA") as sheet:
                if layer.get("slot") == "hair":
                    sheet = recolor_hair_sheet(sheet, layer.get("variant"))
                paste_action_sheet(output, sheet, action=action, frame_w=frame_w, frame_h=frame_h)
    return output


def bake_weapon(output: Image.Image, weapon: Image.Image, cfg: dict, frame_w: int, frame_h: int, enchant_level: int = 0) -> None:
    out_frame_w = int(cfg.get("outputFrameWidth", frame_w))
    out_frame_h = int(cfg.get("outputFrameHeight", frame_h))
    source_frame_w = int(cfg.get("weaponFrameWidth", frame_w))
    source_frame_h = int(cfg.get("weaponFrameHeight", frame_h))
    for row_cfg in cfg["weaponRows"].values():
        body_row = int(row_cfg["bodyRow"])
        weapon_row = int(row_cfg["weaponRow"])
        x_off = int(row_cfg.get("xOff", 0))
        y_off = int(row_cfg.get("yOff", 0))
        row_source_frame_w = int(row_cfg.get("weaponFrameWidth", source_frame_w))
        row_source_frame_h = int(row_cfg.get("weaponFrameHeight", source_frame_h))
        if "weaponCols" in row_cfg:
            weapon_cols = [int(c) for c in row_cfg["weaponCols"]]
            for body_col, weapon_col in enumerate(weapon_cols):
                paste_frame(
                    output,
                    weapon,
                    body_col=body_col,
                    body_row=body_row,
                    weapon_col=weapon_col,
                    weapon_row=weapon_row,
                    frame_w=frame_w,
                    frame_h=frame_h,
                    source_frame_w=row_source_frame_w,
                    source_frame_h=row_source_frame_h,
                    dest_frame_w=out_frame_w,
                    dest_frame_h=out_frame_h,
                    x_off=x_off,
                    y_off=y_off,
                    enchant_level=enchant_level,
                )
        else:
            frames = int(row_cfg["frames"])
            start_col = int(row_cfg.get("weaponStartCol", 0))
            for body_col in range(frames):
                paste_frame(
                    output,
                    weapon,
                    body_col=body_col,
                    body_row=body_row,
                    weapon_col=start_col + body_col,
                    weapon_row=weapon_row,
                    frame_w=frame_w,
                    frame_h=frame_h,
                    source_frame_w=row_source_frame_w,
                    source_frame_h=row_source_frame_h,
                    dest_frame_w=out_frame_w,
                    dest_frame_h=out_frame_h,
                    x_off=x_off,
                    y_off=y_off,
                    enchant_level=enchant_level,
                )


def bake_weapon_layers(output: Image.Image, cfg: dict, phase: str, frame_w: int, frame_h: int, enchant_level: int = 0) -> None:
    out_frame_w = int(cfg.get("outputFrameWidth", frame_w))
    out_frame_h = int(cfg.get("outputFrameHeight", frame_h))
    for layer in cfg.get("weaponLayers", []):
        if layer.get("phase", "front") != phase:
            continue
        layer_path = ROOT / layer["path"]
        if not layer_path.exists():
            continue
        body_row = int(layer["bodyRow"])
        source_row = int(layer["sourceRow"])
        frames = int(layer["frames"])
        source_frame_w = int(layer.get("sourceFrameWidth", layer.get("frameWidth", out_frame_w)))
        source_frame_h = int(layer.get("sourceFrameHeight", layer.get("frameHeight", frame_h)))
        x_off = int(layer.get("xOff", 0))
        y_off = int(layer.get("yOff", 0))
        start_col = int(layer.get("sourceStartCol", 0))
        with Image.open(layer_path).convert("RGBA") as sheet:
            for body_col in range(frames):
                paste_frame(
                    output,
                    sheet,
                    body_col=body_col,
                    body_row=body_row,
                    weapon_col=start_col + body_col,
                    weapon_row=source_row,
                    frame_w=frame_w,
                    frame_h=frame_h,
                    source_frame_w=source_frame_w,
                    source_frame_h=source_frame_h,
                    dest_frame_w=out_frame_w,
                    dest_frame_h=out_frame_h,
                    x_off=x_off,
                    y_off=y_off,
                    enchant_level=enchant_level,
                )

def save_baked_sheet(body: Image.Image, cfg: dict, out_path: Path, frame_w: int, frame_h: int, enchant_level: int = 0) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    output = centered_body_sheet(body, cfg, frame_w, frame_h)
    bake_weapon_layers(output, cfg, "behind", frame_w, frame_h, enchant_level=enchant_level)
    if "weaponRows" in cfg and cfg.get("weapon"):
        with Image.open(ROOT / cfg["weapon"]).convert("RGBA") as weapon:
            bake_weapon(output, weapon, cfg, frame_w, frame_h, enchant_level=enchant_level)
    bake_weapon_layers(output, cfg, "front", frame_w, frame_h, enchant_level=enchant_level)
    output.save(out_path)
    return out_path


def generate_class(cls: str, cfg: dict, manifest: dict, frame_w: int, frame_h: int) -> list[Path]:
    generated: list[Path] = []

    body = Image.open(ROOT / cfg["body"]).convert("RGBA")
    generated.append(save_baked_sheet(body, cfg, ROOT / cfg["output"], frame_w, frame_h))

    if "recipe" in cfg and cfg.get("recipeOutput"):
        recipe_sheet = compose_recipe(cfg, manifest, frame_w, frame_h)
        generated.append(save_baked_sheet(recipe_sheet, cfg, ROOT / cfg["recipeOutput"], frame_w, frame_h))

    return generated


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    frame_w = int(manifest["frame"]["width"])
    frame_h = int(manifest["frame"]["height"])
    for cls, cfg in manifest["classes"].items():
        outs = generate_class(cls, cfg, manifest, frame_w, frame_h)
        for out in outs:
            print(f"{cls}: {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
