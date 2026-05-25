from PIL import Image

FRAME = 64
ALPHA = 20

def bbox(path, row, col):
    img = Image.open(path).convert("RGBA")
    sx, sy = col*FRAME, row*FRAME
    fr = img.crop((sx, sy, sx+FRAME, sy+FRAME))
    px = [(x,y) for y in range(FRAME) for x in range(FRAME) if fr.getpixel((x,y))[3]>ALPHA]
    if not px:
        return None
    xs = [p[0] for p in px]
    ys = [p[1] for p in px]
    return min(xs), max(xs), min(ys), max(ys), sum(xs)//len(px), sum(ys)//len(px), len(px)

def hand(path, row, col):
    img = Image.open(path).convert("RGBA")
    sx, sy = col*FRAME, row*FRAME
    fr = img.crop((sx, sy, sx+FRAME, sy+FRAME))
    px = [(x,y) for y in range(20,50) for x in range(28,64) if fr.getpixel((x,y))[3]>ALPHA]
    if not px:
        return None
    rx = max(p[0] for p in px)
    rp = [(x,y) for x,y in px if x >= rx-3]
    return sum(p[0] for p in rp)//len(rp), sum(p[1] for p in rp)//len(rp)

base = "C:/Users/Puras/OneDrive/Desktop/RiskArena/frontend/public"

rh = hand(base+"/characters/rogue_sheet.png", 11, 0)
wh = hand(base+"/characters/warrior_sheet.png", 11, 0)
print("ROGUE hand pixel r11c0:", rh)
print("WARRIOR hand pixel r11c0:", wh)

print()
print("ROGUE scimitar frames (idle row 63, attack rows 65,67):")
for r in [63, 65, 67]:
    for c in [0, 1, 2, 4]:
        b = bbox(base+"/items/rogue_scimitar.png", r, c)
        if b and b[6] > 8:
            print(f"  r{r}c{c}: x=[{b[0]}-{b[1]}] y=[{b[2]}-{b[3]}] center=({b[4]},{b[5]}) px={b[6]}")

print()
print("WARRIOR katana frames:")
for r in [63, 65, 67]:
    for c in [0, 1, 2, 4]:
        b = bbox(base+"/items/warrior_katana.png", r, c)
        if b and b[6] > 8:
            print(f"  r{r}c{c}: x=[{b[0]}-{b[1]}] y=[{b[2]}-{b[3]}] center=({b[4]},{b[5]}) px={b[6]}")
