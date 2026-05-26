import { useState } from 'react';
import { Sword, Shield, Sparkles, BatteryCharging, X } from 'lucide-react';
import {
  CLASS_THEME,
  formatClassLabel,
  formatSlotLabel,
  getClassKey,
  getItemImageSrc,
  getItemStatRows,
  getPassiveText,
  getSlotKey,
  getTierKey,
  getTierLabel,
  getTierTheme,
} from '../../utils/itemPresentation';
import WeaponIcon from '../WeaponIcon';
import ArmorIcon from '../ArmorIcon';

const SELL_PRICES = {
  common: 5,
  uncommon: 100,
  rare: 300,
  epic: 500,
  legendary: 1200,
};

const SLOT_ICON = {
  weapon: Sword,
  armor: Shield,
  ability: Sparkles,
  consumable: BatteryCharging,
};

function ItemImage({ item, size = 80 }) {
  const [failed, setFailed] = useState(false);
  const theme = getTierTheme(item);
  const src = getItemImageSrc(item);
  const slot = getSlotKey(item);
  const Icon = SLOT_ICON[slot] || Sword;
  const imagePath = item?.image_path;

  if (slot === 'weapon' && imagePath && !failed) {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: 18, flexShrink: 0,
          overflow: 'hidden', border: `2px solid ${theme.border}`,
          boxShadow: `0 0 14px ${theme.glow}`,
        }}
      >
        <WeaponIcon imagePath={imagePath} size={size} borderRadius={0} enchantLevel={item?.enchant_level || 0} />
      </div>
    );
  }

  if (slot === 'armor' && imagePath && !failed) {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: 18, flexShrink: 0,
          overflow: 'hidden', border: `2px solid ${theme.border}`,
          boxShadow: `0 0 14px ${theme.glow}`,
        }}
      >
        <ArmorIcon imagePath={imagePath} size={size} borderRadius={0} enchantLevel={item?.enchant_level || 0} />
      </div>
    );
  }

  if (!src || failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 18,
          backgroundColor: theme.soft,
          border: `2px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={Math.round(size * 0.45)} color={theme.color} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item?.name || ''}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: 18,
        objectFit: 'cover',
        border: `2px solid ${theme.border}`,
        boxShadow: `0 0 14px ${theme.glow}`,
        flexShrink: 0,
      }}
    />
  );
}

function MetaChip({ children, color, background, border }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        padding: '3px 8px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color,
        background,
        border: `1px solid ${border || 'transparent'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function StatChip({ children, color }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '4px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        color: color || '#cbd5e1',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: 'rgba(255,255,255,0.06)',
        margin: '14px 0',
      }}
    />
  );
}

function SectionLabel({ children, color }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: color || '#c9a84c',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function getStatsDelta(newItem, equippedItem) {
  if (!newItem || !equippedItem) return [];
  const newStats = newItem?.effective_stats || {};
  const equippedStats = equippedItem?.effective_stats || {};
  const allKeys = new Set([...Object.keys(newStats), ...Object.keys(equippedStats)]);
  const results = [];
  for (const key of allKeys) {
    const newVal = Number(newStats[key] || 0);
    const equippedVal = Number(equippedStats[key] || 0);
    const diff = newVal - equippedVal;
    if (Math.abs(diff) < 0.001) continue;
    const isPercent = ['defend_reduction', 'risk_win_chance', 'bonus_attack_percent', 'bonus_ability_percent', 'damage_reduction_percent', 'risk_success_bonus', 'boss_damage_percent', 'lifesteal_percent'].includes(key);
    const statLabels = { attack_bonus: 'ATK', ability_bonus: 'Ability', defend_reduction: 'Defense', hp_bonus: 'HP', risk_win_chance: 'Risk', bonus_attack_percent: 'ATK', bonus_ability_percent: 'Ability', damage_reduction_percent: 'Damage Reduction', risk_success_bonus: 'Risk', boss_damage_percent: 'Boss DMG', lifesteal_percent: 'Lifesteal' };
    const label = statLabels[key] || key;
    const formatted = isPercent
      ? `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}% ${label}`
      : `${diff > 0 ? '+' : ''}${Math.round(diff)} ${label}`;
    results.push({ key, diff, label: formatted, positive: diff > 0 });
  }
  return results;
}

export default function ItemDetailModal({
  item,
  userClass,
  equippedInventoryIds,
  equipping,
  unequipping,
  onEquip,
  onUnequip,
  onClose,
  onGoToUpgrade,
  onSell,
  selling,
  equippedBySlot,
}) {
  if (!item) return null;

  const theme = getTierTheme(item);
  const tierLabel = getTierLabel(item);
  const slotKey = getSlotKey(item);
  const classKey = getClassKey(item);
  const slotLabel = formatSlotLabel(slotKey);
  const classLabel = formatClassLabel(classKey);
  const passiveText = getPassiveText(item);

  const effectiveStatRows = getItemStatRows(item, { source: 'effective_stats' });
  const enchantStatRows = getItemStatRows(item, { source: 'enchant_stats' });

  const classTheme = CLASS_THEME[classKey] || null;

  const isEquipped =
    (equippedInventoryIds instanceof Set && equippedInventoryIds.has(String(item.inventory_id))) ||
    !!item.equipped;

  const isWrongClass = !!(userClass && classKey && userClass !== classKey);

  const enchantLevel = Number(item.enchant_level || 0);

  const isEquipping = equipping === String(item.inventory_id);
  const isUnequipping = unequipping === String(item.inventory_id);
  const isBusy = isEquipping || isUnequipping;

  const [confirmSell, setConfirmSell] = useState(false);
  const sellPrice = SELL_PRICES[getTierKey(item)] ?? 5;
  const isSelling = selling === String(item.inventory_id);

  const equippedInSameSlot = (!isEquipped && slotKey && equippedBySlot)
    ? (equippedBySlot[slotKey] || null)
    : null;
  const statsDelta = getStatsDelta(item, equippedInSameSlot);

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 100,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 101,
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(13,13,26,0.99) 0%, rgba(26,26,46,0.99) 100%)',
          borderTop: `2px solid ${theme.border}`,
          borderRadius: '24px 24px 0 0',
        }}
      >
        <div
          style={{
            height: 3,
            background: `linear-gradient(90deg, ${theme.color}, transparent)`,
            borderRadius: '24px 24px 0 0',
          }}
        />

        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#94a3b8',
            padding: 0,
          }}
        >
          <X size={16} />
        </button>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ItemImage item={item} size={80} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    color: '#e8e0d0',
                    lineHeight: 1.2,
                    wordBreak: 'break-word',
                  }}
                >
                  {item.name}
                </span>
                {enchantLevel > 0 && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: '#c9a84c',
                      background: 'rgba(201,168,76,0.14)',
                      border: '1px solid rgba(201,168,76,0.24)',
                      borderRadius: 999,
                      padding: '2px 8px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    +{enchantLevel}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  marginTop: 10,
                }}
              >
                <MetaChip
                  color={theme.color}
                  background={theme.soft}
                  border={theme.border}
                >
                  {tierLabel}
                </MetaChip>
                {slotLabel ? (
                  <MetaChip
                    color="#cbd5e1"
                    background="rgba(255,255,255,0.05)"
                    border="rgba(255,255,255,0.08)"
                  >
                    {slotLabel}
                  </MetaChip>
                ) : null}
                {classTheme && classLabel ? (
                  <MetaChip
                    color={classTheme.color}
                    background={classTheme.bg}
                    border="transparent"
                  >
                    {classLabel}
                  </MetaChip>
                ) : null}
              </div>
            </div>
          </div>

          <Divider />

          {effectiveStatRows.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel color={theme.color}>Stats</SectionLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {effectiveStatRows.map((row) => (
                  <StatChip key={row.key} color={theme.color}>
                    {row.label}
                  </StatChip>
                ))}
              </div>
            </div>
          )}

          {enchantStatRows.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel color="#c9a84c">Enchant Bonus</SectionLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {enchantStatRows.map((row) => (
                  <StatChip key={row.key} color="#c9a84c">
                    {row.label}
                  </StatChip>
                ))}
              </div>
            </div>
          )}

          {statsDelta.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#64748b',
                marginBottom: 8,
              }}>
                ▲ vs Equipped
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {statsDelta.map((d) => (
                  <span
                    key={d.key}
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '4px 10px',
                      borderRadius: 999,
                      color: d.positive ? '#4ade80' : '#f87171',
                      background: d.positive ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                      border: `1px solid ${d.positive ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {d.positive ? '▲' : '▼'} {d.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {passiveText ? (
            <div
              style={{
                background: theme.soft,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: '10px 12px',
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: theme.color,
                }}
              >
                Passive
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#e2e8f0',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {passiveText}
              </div>
            </div>
          ) : null}

          <Divider />

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {isEquipped ? (
              <>
                <button
                  disabled={isBusy}
                  onClick={() => onUnequip(item)}
                  style={{
                    height: 42,
                    flex: 1,
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                    background: 'rgba(239,68,68,0.12)',
                    color: '#f87171',
                    border: '1px solid rgba(239,68,68,0.25)',
                    opacity: isBusy ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {isUnequipping ? '...' : 'Unequip'}
                </button>
                <button
                  onClick={onGoToUpgrade}
                  style={{
                    height: 42,
                    flex: 1,
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                    background: 'rgba(201,168,76,0.1)',
                    color: '#c9a84c',
                    border: '1px solid rgba(201,168,76,0.3)',
                  }}
                >
                  Upgrade
                </button>
              </>
            ) : isWrongClass ? (
              <>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    color: '#94a3b8',
                    fontWeight: 600,
                    padding: '0 4px',
                    textAlign: 'center',
                    lineHeight: 1.4,
                  }}
                >
                  Switch to {formatClassLabel(classKey)} to equip
                </div>
                <button
                  onClick={onGoToUpgrade}
                  style={{
                    height: 42,
                    flex: 1,
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                    background: 'rgba(201,168,76,0.1)',
                    color: '#c9a84c',
                    border: '1px solid rgba(201,168,76,0.3)',
                  }}
                >
                  Upgrade
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={isBusy}
                  onClick={() => onEquip(item)}
                  style={{
                    height: 42,
                    flex: 1,
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                    background: 'linear-gradient(135deg,#8b0000,#c0392b)',
                    color: '#ffffff',
                    border: '1px solid rgba(201,168,76,0.25)',
                    opacity: isBusy ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {isEquipping ? '...' : 'Equip'}
                </button>
                <button
                  onClick={onGoToUpgrade}
                  style={{
                    height: 42,
                    flex: 1,
                    borderRadius: 12,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                    background: 'rgba(201,168,76,0.1)',
                    color: '#c9a84c',
                    border: '1px solid rgba(201,168,76,0.3)',
                  }}
                >
                  Upgrade
                </button>
              </>
            )}
          </div>

          {/* Sell section — always visible, disabled when equipped */}
          {!confirmSell && (
            <>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '12px 0 10px' }} />
              <button
                disabled={isEquipped}
                onClick={() => !isEquipped && setConfirmSell(true)}
                style={{
                  width: '100%',
                  height: 40,
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: isEquipped ? 'not-allowed' : 'pointer',
                  background: isEquipped ? 'rgba(255,255,255,0.03)' : 'rgba(251,146,60,0.08)',
                  color: isEquipped ? '#475569' : '#fb923c',
                  border: isEquipped ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(251,146,60,0.22)',
                  transition: 'all 0.15s',
                }}
              >
                {isEquipped ? '🔒 Unequip first to sell' : `Sell for ${sellPrice} coins`}
              </button>
            </>
          )}

          {confirmSell && (
            <div style={{
              marginTop: 12,
              borderRadius: 14,
              padding: '14px 14px 12px',
              background: 'rgba(251,146,60,0.08)',
              border: '1px solid rgba(251,146,60,0.3)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fed7aa', marginBottom: 4 }}>
                ⚠️ Sell {item.name}?
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
                You will receive <span style={{ color: '#fb923c', fontWeight: 800 }}>{sellPrice} coins</span>. This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setConfirmSell(false)}
                  disabled={isSelling}
                  style={{
                    flex: 1, height: 40, borderRadius: 12, fontWeight: 700, fontSize: 12,
                    cursor: isSelling ? 'not-allowed' : 'pointer',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#94a3b8',
                    border: '1px solid rgba(255,255,255,0.1)',
                    opacity: isSelling ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => onSell(item)}
                  disabled={isSelling}
                  style={{
                    flex: 2, height: 40, borderRadius: 12, fontWeight: 800, fontSize: 13,
                    cursor: isSelling ? 'not-allowed' : 'pointer',
                    background: isSelling ? 'rgba(251,146,60,0.3)' : 'rgba(251,146,60,0.2)',
                    color: '#fb923c',
                    border: '1px solid rgba(251,146,60,0.4)',
                    opacity: isSelling ? 0.7 : 1,
                  }}
                >
                  {isSelling ? 'Selling...' : `Confirm Sell — ${sellPrice} coins`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
