from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

from generate_lpc_composites import compose_recipe, save_baked_sheet


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "tools" / "lpc_character_catalog.json"

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_user_id(user_id: str) -> str:
    if not SAFE_ID.match(user_id):
        raise ValueError("user_id may only contain letters, numbers, underscore, and dash")
    return user_id


def normalize_build(build: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    if build.get("schemaVersion") != "character_build.v1":
        raise ValueError("Unsupported character build schemaVersion")
    class_name = str(build.get("className") or "").lower()
    if class_name not in {"warrior", "mage", "rogue"}:
        raise ValueError("className must be warrior, mage, or rogue")
    body_type = str(build.get("bodyType") or "male").lower()
    if body_type != "male":
        raise ValueError("Only bodyType=male is supported in v1")

    catalog_assets = catalog.get("assets") or {}
    layers = build.get("layers")
    if not isinstance(layers, list) or not layers:
        raise ValueError("Build must contain at least one layer")

    normalized_layers: list[dict[str, Any]] = []
    for layer in layers:
        if not isinstance(layer, dict):
            raise ValueError("Every build layer must be an object")
        asset_id = layer.get("asset")
        asset = catalog_assets.get(asset_id)
        if not asset:
            raise ValueError(f"Unknown LPC asset id: {asset_id}")
        base = (asset.get("pathsByBodyType") or {}).get(body_type)
        if not base:
            raise ValueError(f"Asset {asset_id} does not support bodyType={body_type}")
        variant = layer.get("variant")
        allowed_variants = asset.get("variants")
        if variant is not None and allowed_variants is not None and variant not in allowed_variants:
            raise ValueError(f"Unsupported variant {variant!r} for asset {asset_id}")
        normalized_layers.append({
            "base": base,
            "variant": variant,
            "zPos": int(asset.get("zPos", 100)),
            "asset": asset_id,
            "slot": layer.get("slot") or asset.get("slot"),
        })

    normalized_layers.sort(key=lambda item: item["zPos"])

    weapon_cfg = build.get("weapon") or {"enabled": False}
    weapon_layers: list[dict[str, Any]] = []
    if weapon_cfg.get("enabled"):
        weapon_id = weapon_cfg.get("asset")
        weapon = (catalog.get("weapons") or {}).get(weapon_id)
        if not weapon:
            raise ValueError(f"Weapon {weapon_id} is not supported by the v1 LPC bake pipeline")
        weapon_layers = list(weapon.get("layers") or [])

    return {
        "schemaVersion": "character_build.v1",
        "className": class_name,
        "bodyType": body_type,
        "layers": normalized_layers,
        "weaponLayers": weapon_layers,
    }


def generate_user_sheet(user_id: str, build: dict[str, Any], catalog: dict[str, Any], out_path: Path | None = None) -> Path:
    validate_user_id(user_id)
    frame_w = int(catalog["frame"]["width"])
    frame_h = int(catalog["frame"]["height"])
    output_frame = catalog.get("outputFrame") or {}
    sheet = catalog["sheet"]
    normalized = normalize_build(build, catalog)

    cfg = {
        "bodyCols": int(sheet["cols"]),
        "outputFrameWidth": int(output_frame.get("width", frame_w)),
        "outputFrameHeight": int(output_frame.get("height", frame_h)),
        "bodyX": int(output_frame.get("bodyX", 0)),
        "bodyY": int(output_frame.get("bodyY", 0)),
        "recipe": {"layers": normalized["layers"]},
        "weaponLayers": normalized["weaponLayers"],
    }
    manifest = {
        "universalLpcRoot": catalog["universalLpcRoot"],
        "sheet": {"width": int(sheet["width"]), "height": int(sheet["height"])},
    }

    body = compose_recipe(cfg, manifest, frame_w, frame_h)
    if out_path is None:
        out_path = ROOT / "frontend" / "public" / "generated" / "users" / user_id / "active_character.png"
    out_path = out_path.resolve()
    if ROOT not in out_path.parents:
        raise ValueError("Output path must stay inside the RiskArena workspace")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(".tmp.png")
    save_baked_sheet(body, cfg, tmp_path, frame_w, frame_h)
    os.replace(tmp_path, out_path)

    meta_path = out_path.with_suffix(".credits.json")
    meta = {
        "schemaVersion": "generated_character.v1",
        "source": "Universal LPC Spritesheet Character Generator",
        "className": normalized["className"],
        "bodyType": normalized["bodyType"],
        "assets": [
            {"slot": layer["slot"], "asset": layer["asset"], "variant": layer.get("variant")}
            for layer in normalized["layers"]
        ],
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a RiskArena user LPC spritesheet from character_build.v1 JSON.")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--build-json", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    catalog = load_json(CATALOG_PATH)
    build = load_json(args.build_json)
    out = generate_user_sheet(args.user_id, build, catalog, args.out)
    print(out.relative_to(ROOT))


if __name__ == "__main__":
    main()
