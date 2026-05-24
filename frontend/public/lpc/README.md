# LPC Asset Pipeline

This folder is reserved for source LPC layers that can be composited into
generated battle spritesheets.

Current v1 uses a minimal tracked LPC source subset under `tools/lpc_spritesheets`,
defined in `tools/lpc_character_catalog.json`.

Planned structure:

```text
lpc/
  base/
  equipment/
    weapons/
    armor/
    helmets/
    boots/
  cosmetics/
    hair/
    eyes/
    accessories/
```

Generated output is written to `/generated/characters`.
