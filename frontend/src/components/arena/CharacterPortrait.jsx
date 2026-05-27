import WeaponIcon from '../WeaponIcon';
import ArmorIcon from '../ArmorIcon';
import CharPreview from './CharPreview';
import { getClassInfo, normalizeCharacterClass } from '../../utils/characters';

const PORTRAIT_SRC = {
  warrior: '/characters/portraits/warrior_portrait.png',
  mage: '/characters/portraits/mage_portrait.png',
  rogue: '/characters/portraits/rogue_portrait.png',
};

export default function CharacterPortrait({
  cls = 'warrior',
  weapon = null,
  armor = null,
  size = 150,
  badgeSize = 44,
  active = true,
  sheetPath = null,
  sheetLoading = false,
  showWeaponBadge = true,
  showArmorBadge = true,
  style = {},
}) {
  const classKey = normalizeCharacterClass(cls) || 'warrior';
  const info = getClassInfo(classKey);
  const weaponPath = weapon?.image_path || null;
  const previewSize = Math.max(72, Math.round(size * 0.96));

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 18,
        overflow: 'hidden',
        background: `radial-gradient(circle at 50% 36%, ${info?.glow || 'rgba(201,168,76,0.24)'} 0%, rgba(8,12,24,0.96) 68%)`,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.38)',
        opacity: active ? 1 : 0.65,
        ...style,
      }}
    >
      {sheetPath ? (
        <div
          aria-label={info?.name || classKey}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: Math.round(size * 0.08),
          }}
        >
          <CharPreview cls={classKey} sheetPath={sheetPath} size={previewSize} fitToContent />
        </div>
      ) : sheetLoading ? (
        <div style={{ width: '100%', height: '100%', background: 'rgba(0,0,0,0.2)' }} />
      ) : (
        <img
          src={PORTRAIT_SRC[classKey]}
          alt={info?.name || classKey}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      )}
      {showWeaponBadge && weaponPath ? (
        <div
          style={{
            position: 'absolute',
            right: 7,
            bottom: 7,
            width: badgeSize,
            height: badgeSize,
            borderRadius: 14,
            background: 'linear-gradient(180deg, rgba(15,23,42,0.94), rgba(5,8,16,0.98))',
            border: '1px solid rgba(201,168,76,0.36)',
            boxShadow: '0 8px 18px rgba(0,0,0,0.42), 0 0 14px rgba(201,168,76,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <WeaponIcon
            imagePath={weaponPath}
            size={Math.round(badgeSize * 0.78)}
            borderRadius={9}
            enchantLevel={weapon?.enchant_level || 0}
          />
        </div>
      ) : null}
      {showArmorBadge && armor?.image_path ? (
        <div
          style={{
            position: 'absolute',
            left: 7,
            bottom: 7,
            width: badgeSize,
            height: badgeSize,
            borderRadius: 14,
            background: 'linear-gradient(180deg, rgba(15,23,42,0.94), rgba(5,8,16,0.98))',
            border: '1px solid rgba(201,168,76,0.36)',
            boxShadow: '0 8px 18px rgba(0,0,0,0.42), 0 0 14px rgba(201,168,76,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <ArmorIcon
            imagePath={armor.image_path}
            size={Math.round(badgeSize * 0.78)}
            borderRadius={9}
          />
        </div>
      ) : null}
    </div>
  );
}
