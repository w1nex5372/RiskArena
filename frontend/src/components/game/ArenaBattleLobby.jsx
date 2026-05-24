import { useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Sparkles, Sword } from 'lucide-react';
import CharacterPortrait from '../arena/CharacterPortrait';
import { getClassInfo, normalizeCharacterClass } from '../../utils/characters';
import { getEnchantColor, getItemStatRows, getPassiveText } from '../../utils/itemPresentation';

const PANEL_BG = 'linear-gradient(180deg, #0c1120 0%, #111827 48%, #0b1220 100%)';

function getDisplayName(player, isYou) {
  if (!player) return 'Waiting';
  if (player.is_anonymous && !isYou) return player.first_name || 'Anonymous';
  return player.first_name || player.username || (isYou ? 'You' : 'Opponent');
}

function getLoadoutSummary(player) {
  return [
    { key: 'weapon', label: 'Weapon', gear: player?.weapon || null, value: player?.weapon?.name || 'None', Icon: Sword, color: '#60a5fa' },
    { key: 'ability', label: 'Ability', gear: player?.ability || null, value: player?.ability?.name || 'None', Icon: Sparkles, color: '#c084fc' },
    { key: 'armor', label: 'Armor', gear: player?.armor || null, value: player?.armor?.name || 'None', Icon: Shield, color: '#fbbf24' },
  ];
}

function LoadoutRow({ item }) {
  const { Icon } = item;
  const stats = getItemStatRows(item.gear).slice(0, 2);
  const passive = getPassiveText(item.gear);
  const enchantLevel = Number(item.gear?.enchant_level || 0);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        minWidth: 0,
        padding: '7px 9px',
        borderRadius: 10,
        background: 'rgba(15,23,42,0.72)',
        border: '1px solid rgba(148,163,184,0.12)',
      }}
    >
      <Icon style={{ width: 13, height: 13, color: item.color, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
            {item.label}
          </span>
          <span
            style={{
              fontSize: 11,
              color: '#e2e8f0',
              fontWeight: 700,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.value}
          </span>
          {item.gear && enchantLevel > 0 ? (
            <span style={{ color: getEnchantColor(enchantLevel), fontSize: 10, fontWeight: 900, flexShrink: 0 }}>+{enchantLevel}</span>
          ) : null}
        </div>
        {stats.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {stats.map((stat) => (
              <span key={`${item.key}-${stat.key || stat.label}`} style={{ color: item.color, fontSize: 9, fontWeight: 800 }}>
                {stat.label}
              </span>
            ))}
          </div>
        ) : null}
        {passive ? (
          <div style={{ color: '#cbd5e1', fontSize: 9, fontWeight: 650, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {passive}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CharacterCard({ player, label, isYou, ready }) {
  const className = normalizeCharacterClass(player?.class_name);
  const classInfo = getClassInfo(className, null);
  const loadout = getLoadoutSummary(player);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 18,
        padding: 14,
        background: ready ? 'rgba(15,23,42,0.86)' : 'rgba(15,23,42,0.55)',
        border: `1px solid ${ready ? 'rgba(201,168,76,0.22)' : 'rgba(71,85,105,0.24)'}`,
        boxShadow: ready ? '0 10px 24px rgba(2,6,23,0.32)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          {label}
        </span>
        {player?.level ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: '#f8fafc',
              padding: '4px 8px',
              borderRadius: 999,
              background: 'rgba(30,41,59,0.9)',
              border: '1px solid rgba(148,163,184,0.18)',
            }}
          >
            Lv.{player.level}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 94,
            height: 120,
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at 50% 30%, rgba(59,130,246,0.12) 0%, rgba(15,23,42,0.08) 55%, rgba(15,23,42,0.02) 100%)',
            border: '1px solid rgba(148,163,184,0.14)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {className ? (
            <CharacterPortrait
              cls={className}
              weapon={player?.weapon || null}
              sheetPath={player?.character_spritesheet_path || null}
              size={94}
              badgeSize={26}
              active={ready}
              showWeaponBadge={false}
              style={{
                border: 0,
                boxShadow: 'none',
                background: 'transparent',
                transform: isYou ? 'none' : 'scaleX(-1)',
              }}
            />
          ) : (
            <div
              style={{
                width: 56,
                height: 88,
                borderRadius: 12,
                background: 'linear-gradient(180deg, rgba(51,65,85,0.95) 0%, rgba(15,23,42,0.95) 100%)',
                border: '1px solid rgba(100,116,139,0.28)',
              }}
            />
          )}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: '#f8fafc',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {getDisplayName(player, isYou)}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: classInfo?.color || '#94a3b8' }}>
            {classInfo ? `${classInfo.icon} ${classInfo.name}` : ready ? 'Class pending' : 'Awaiting player'}
          </div>
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {loadout.map((item) => (
              <LoadoutRow key={item.key} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ArenaBattleLobby({ lobbyData, players, user, setConfirmLeave }) {
  const userId = String(user?.id || '');

  const { userPlayer, opponentPlayer } = useMemo(() => {
    const allPlayers = Array.isArray(players) ? players : [];
    const roomMe = allPlayers.find((player) => String(player.user_id) === userId);
    const me = roomMe
      ? {
          ...roomMe,
          character_spritesheet_path: roomMe.character_spritesheet_path || user?.character_spritesheet_path,
          character_spritesheet_hash: roomMe.character_spritesheet_hash || user?.character_spritesheet_hash,
        }
      : {
          ...(user || {}),
          user_id: user?.id,
          first_name: user?.first_name,
          username: user?.username || user?.telegram_username,
          photo_url: user?.photo_url,
          class_name: user?.class_name,
          character_spritesheet_path: user?.character_spritesheet_path,
          character_spritesheet_hash: user?.character_spritesheet_hash,
          level: user?.level,
        };
    const opponent = allPlayers.find((player) => String(player.user_id) !== userId) || null;
    return { userPlayer: me, opponentPlayer: opponent };
  }, [players, user, userId]);

  const isReady = Boolean(opponentPlayer);
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isReady) {
      setCountdown(5);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev == null || prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setCountdown(null);
    }
    return () => clearInterval(timerRef.current);
  }, [isReady]);

  return (
    <div
      style={{
        background: PANEL_BG,
        border: '1px solid rgba(201,168,76,0.24)',
        borderRadius: 22,
        overflow: 'hidden',
        maxWidth: 520,
        margin: '0 auto',
        boxShadow: '0 16px 36px rgba(2,6,23,0.32)',
      }}
    >
      <div style={{ height: 3, background: 'linear-gradient(90deg, #7f1d1d, #c9a84c, #2563eb, #c9a84c, #7f1d1d)' }} />

      <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(201,168,76,0.14)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
              Dueling Pit
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#f8fafc', marginTop: 4 }}>
              Pre-fight lobby
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              Confirm class, level, and loadout before the duel starts.
            </div>
          </div>

        </div>
      </div>

      <div style={{ padding: 14, display: 'grid', gap: 10 }}>
        <CharacterCard player={userPlayer} label="You" isYou ready />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              minWidth: 64,
              textAlign: 'center',
              padding: '6px 14px',
              borderRadius: 999,
              background: 'rgba(12,18,32,0.96)',
              border: '1px solid rgba(201,168,76,0.18)',
              color: '#c9a84c',
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: '0.16em',
            }}
          >
            VS
          </div>
        </div>
        <CharacterCard player={opponentPlayer} label="Opponent" isYou={false} ready={isReady} />
      </div>

      <div
        style={{
          margin: '0 14px 14px',
          borderRadius: 16,
          padding: '12px 14px',
          background: isReady ? 'rgba(22,101,52,0.18)' : 'rgba(30,41,59,0.7)',
          border: `1px solid ${isReady ? 'rgba(34,197,94,0.32)' : 'rgba(148,163,184,0.16)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: isReady ? '#4ade80' : '#f8fafc' }}>
            {isReady ? `Battle starts in ${countdown ?? '...'}s` : 'Waiting for opponent'}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            {isReady ? 'Both loadouts locked in for this match.' : 'Get your loadout ready.'}
          </div>
        </div>

        <button
          onClick={() => setConfirmLeave(true)}
          style={{
            height: 42,
            minWidth: 112,
            padding: '0 14px',
            borderRadius: 12,
            border: '1px solid rgba(239,68,68,0.28)',
            background: 'rgba(127,29,29,0.12)',
            color: '#f87171',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Leave Arena
        </button>
      </div>
    </div>
  );
}
