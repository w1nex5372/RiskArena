"""Patch BossRaidScreen: show equipped HELMET in 3rd lobby loadout slot."""
import os

BASE = os.path.dirname(__file__)

def patch(filename, old, new, label):
    path = os.path.join(BASE, filename)
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        src = f.read()
    if old not in src:
        print(f"  SKIP {label}: block not found")
        return
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(src.replace(old, new, 1))
    print(f"  OK   {label}")

TARGET = "components/game/BossRaidScreen.jsx"

# 1. Initial state + fetch fallback: add helmet: null
patch(TARGET,
    "const [equipped,         setEquipped]         = useState({ weapon: null, armor: null, ability: null });",
    "const [equipped,         setEquipped]         = useState({ weapon: null, armor: null, ability: null, helmet: null });",
    "equipped initial state")

patch(TARGET,
    "setEquipped(res.data?.equipped || { weapon: null, armor: null, ability: null });",
    "setEquipped(res.data?.equipped || { weapon: null, armor: null, ability: null, helmet: null });",
    "setEquipped fetch fallback")

patch(TARGET,
    "        setEquipped({ weapon: null, armor: null, ability: null });",
    "        setEquipped({ weapon: null, armor: null, ability: null, helmet: null });",
    "setEquipped catch fallback")

# 2. Lobby loadout slots: 3rd slot ITEM SKILL -> HELMET
patch(TARGET,
    """    const loadoutSlots = [
      { icon: '🗡️', label: 'WEAPON',  item: equipped.weapon  },
      { icon: '🛡️', label: 'ARMOR',   item: equipped.armor   },
      { icon: '✨', label: 'ITEM SKILL', item: equipped.ability },
    ];""",
    """    const loadoutSlots = [
      { icon: '🗡️', label: 'WEAPON',  item: equipped.weapon  },
      { icon: '🛡️', label: 'ARMOR',   item: equipped.armor   },
      { icon: '⛑️', label: 'HELMET',  item: equipped.helmet  },
    ];""",
    "loadoutSlots 3rd slot helmet")

# 3. Slot render: add HELMET branch (uses <img> like generic image_path branch)
#    Replace the label==='ITEM SKILL' check with HELMET variant that uses ArmorIcon-style img
patch(TARGET,
    """                {slot.item?.image_path && slot.label === 'WEAPON' ? (
                  <WeaponIcon imagePath={slot.item.image_path} size={30} borderRadius={6} enchantLevel={slot.item?.enchant_level || 0} />
                ) : slot.item?.image_path && slot.label === 'ARMOR' ? (
                  <ArmorIcon imagePath={slot.item.image_path} size={30} borderRadius={6} />
                ) : slot.item?.image_path ? (
                  <img src={slot.item.image_path} alt={slot.item.name} style={{ width: 30, height: 30, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 18, opacity: 0.25 }}>{slot.icon}</span>
                )}""",
    """                {slot.item?.image_path && slot.label === 'WEAPON' ? (
                  <WeaponIcon imagePath={slot.item.image_path} size={30} borderRadius={6} enchantLevel={slot.item?.enchant_level || 0} />
                ) : slot.item?.image_path && slot.label === 'ARMOR' ? (
                  <ArmorIcon imagePath={slot.item.image_path} size={30} borderRadius={6} />
                ) : slot.item?.image_path && slot.label === 'HELMET' ? (
                  <ArmorIcon imagePath={slot.item.image_path} size={30} borderRadius={6} />
                ) : slot.item?.image_path ? (
                  <img src={slot.item.image_path} alt={slot.item.name} style={{ width: 30, height: 30, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 18, opacity: 0.25 }}>{slot.icon}</span>
                )}""",
    "slot render helmet branch")

print("Done")
