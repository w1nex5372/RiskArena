import { memo, useEffect, useRef, useState } from 'react';
import { Shield, Sparkles, Sword, Swords, Users } from 'lucide-react';
import apiClient from '../../api/client';
import { useUser } from '../../context/UserContext';
import { CLASS_INFO } from '../../utils/characters';
import { getItemImageSrc, getItemStatRows, getPassiveText, getStatEntries, getTierKey, getTierTheme } from '../../utils/itemPresentation';
import CharacterPortrait from '../arena/CharacterPortrait';
import ClassStatRow from '../character/ClassStatRow';
import WeaponIcon from '../WeaponIcon';

function SlotImage({ item, FallbackIcon, size = 44 }) {
  const [failed, setFailed] = useState(false);
  if (!item) return null;

  const src = getItemImageSrc(item);
  const theme = getTierTheme(item);
  const imagePath = item?.image_path;
  const slot = String(item?.slot || item?.category || item?.type || '').toLowerCase();

  if (slot === 'weapon' && imagePath && !failed) {
    return (
      <div style={{ flexShrink: 0, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <WeaponIcon imagePath={imagePath} size={size} borderRadius={0} enchantLevel={item?.enchant_level || 0} />
      </div>
    );
  }

  if (!src || failed) {
    const Icon = FallbackIcon || Sword;
    return (
      <div style={{
        width: size, height: size, borderRadius: 10, flexShrink: 0,
        background: `linear-gradient(135deg, ${theme.soft}, rgba(255,255,255,0.02))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${theme.border}`,
      }}>
        <Icon style={{ width: size * 0.45, height: size * 0.45, color: theme.color }} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.name}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 10, flexShrink: 0 }}
    />
  );
}

const LOADOUT_SLOTS = [
  { key: 'weapon',    label: 'WEAPON',  Icon: Sword },
  { key: 'armor',     label: 'ARMOR',   Icon: Shield },
  { key: 'ability',   label: 'ABILITY', Icon: Sparkles },
];

function ArenaEntryScreen({ rooms, onEnterBattle, onEnterRealTime, onClassChange, onNavigateInventory, onEnergySpent }) {
  const { user } = useUser();
  const [history, setHistory] = useState(null);
  const [entering, setEntering] = useState(false);
  const [enteringRealTime, setEnteringRealTime] = useState(false);
  const [energyError, setEnergyError] = useState('');
  const [equipped, setEquipped] = useState({ weapon: null, armor: null, ability: null });
  const [loadoutEffectiveStats, setLoadoutEffectiveStats] = useState({});
  const [timeToNext, setTimeToNext] = useState('');
  const [localSheetPath, setLocalSheetPath] = useState(null);

  const [selectedClass, setSelectedClass] = useState(
    () => (user?.class_name || 'warrior').toLowerCase()
  );
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    setSelectedClass((user?.class_name || 'warrior').toLowerCase());
  }, [user?.class_name]);

  useEffect(() => {
    if (!user?.next_energy_at) { setTimeToNext(''); return; }
    const update = () => {
      const diff = new Date(user.next_energy_at) - Date.now();
      if (diff <= 0) { setTimeToNext(''); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeToNext(`${m}m ${s}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [user?.next_energy_at]);

  const classInfo = CLASS_INFO[selectedClass] || CLASS_INFO.warrior;

  useEffect(() => {
    apiClient
      .get('/game-history?limit=20')
      .then((res) => setHistory(res.data?.games || res.data || []))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadEquipped = () =>
      apiClient
        .get('/me/equipped')
        .then((res) => {
          if (!cancelled) {
            setEquipped(res.data?.equipped || { weapon: null, armor: null, ability: null });
            setLoadoutEffectiveStats(res.data?.loadout_effective_stats || {});
            if (res.data?.battle_spritesheet_path) {
              setLocalSheetPath(res.data.battle_spritesheet_path);
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            setEquipped({ weapon: null, armor: null, ability: null });
            setLoadoutEffectiveStats({});
          }
        });

    loadEquipped();
    // Re-sync equipped gear when returning to the app. visibilitychange is more
    // reliable than window 'focus' inside the Telegram WebView.
    const onVisible = () => { if (document.visibilityState === 'visible') loadEquipped(); };
    window.addEventListener('focus', loadEquipped);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', loadEquipped);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.class_name, user?.id]);

  const bronzeGames = (history || []).filter(
    (g) => (g.room_type || '').toLowerCase() === 'bronze'
  );
  const wins = bronzeGames.filter(
    (g) =>
      g.is_winner ||
      (user &&
        g.winner &&
        (String(g.winner.user_id) === String(user.id) ||
          String(g.winner_id) === String(user.id)))
  ).length;
  const losses = bronzeGames.length - wins;

  const bronzeRoom = (rooms || []).find((r) => r.room_type === 'bronze');
  const queueCount = bronzeRoom?.players_count || 0;
  const recentOpponents = bronzeGames.slice(0, 3).map((g) => {
    const opp = (g.players || []).find(
      (p) => String(p.user_id) !== String(user?.id)
    );
    const won =
      g.is_winner ||
      (user &&
        g.winner &&
        (String(g.winner.user_id) === String(user.id) ||
          String(g.winner_id) === String(user.id)));
    return {
      name: opp?.first_name || opp?.username || 'Anonymous',
      photo: opp?.photo_url,
      won,
    };
  });

  const canEnter = !entering && !!user?.class_name;

  const handleEnter = async () => {
    if (!canEnter) return;
    setEntering(true);
    try {
      await onEnterBattle(0);
    } finally {
      setEntering(false);
    }
  };

  const getEquipped = (slotKey) => equipped?.[slotKey] || null;
  // Base class identity (HP / ATK / Guard / Speed) is shown in ClassStatRow.
  // These chips surface only the bonuses contributed by equipped gear
  // (loadout_effective_stats = aggregated item modifiers), so the two displays
  // never duplicate the same number.
  const gearStatChips = getStatEntries(loadoutEffectiveStats || {});

  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, color: '#e8e0d0' }}>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div style={{
        margin: '10px 12px 0',
        borderRadius: 16,
        background: 'linear-gradient(135deg, #0d0d1a 0%, #1a0a0a 50%, #2d0000 100%)',
        border: '1px solid rgba(201,168,76,0.3)',
        borderBottom: '2px solid rgba(201,168,76,0.5)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        padding: '12px 14px 10px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* ambient glows */}
        <div style={{ position: 'absolute', left: -30, bottom: -30, width: 160, height: 160, background: 'radial-gradient(circle, rgba(139,0,0,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', right: 0, top: 0, width: 200, height: '100%', background: 'radial-gradient(circle at right top, rgba(201,168,76,0.07) 0%, transparent 60%)', pointerEvents: 'none' }} />

        {/* Content row */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>

          {/* Left: text */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 1 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 18 }}>{classInfo.icon}</span>
                <h2 style={{ color: 'white', fontSize: 17, fontWeight: 900, margin: 0, letterSpacing: '-0.01em' }}>
                  {classInfo.name}
                </h2>
                <span style={{ color: classInfo.color, fontSize: 10, fontWeight: 700, marginLeft: 2 }}>
                  {classInfo.role || classInfo.title}
                </span>
              </div>

              {/* Base class identity stats (HP / ATK / Guard / Speed) */}
              <ClassStatRow classInfo={classInfo} showNote={false} style={{ marginTop: 6 }} />

              {/* Bonuses from equipped gear (kept separate from base stats above) */}
              {gearStatChips.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 6 }}>
                  <span style={{ color: '#64748b', fontSize: 8, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Gear
                  </span>
                  {gearStatChips.slice(0, 4).map((chip) => (
                    <span
                      key={`${chip.key}-${chip.label}`}
                      style={{
                        color: '#c9a84c',
                        background: 'rgba(201,168,76,0.1)',
                        border: '1px solid rgba(201,168,76,0.18)',
                        borderRadius: 999,
                        padding: '2px 6px',
                        fontSize: 9,
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Win / Loss pills */}
            <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
              <div style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 20, padding: '2px 8px' }}>
                <span style={{ color: '#22c55e', fontWeight: 800, fontSize: 11 }}>
                  {history === null ? '—' : wins}W
                </span>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 20, padding: '2px 8px' }}>
                <span style={{ color: '#f87171', fontWeight: 800, fontSize: 11 }}>
                  {history === null ? '—' : losses}L
                </span>
              </div>
              {bronzeGames.length > 0 && (
                <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 20, padding: '2px 8px' }}>
                  <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 10 }}>
                    {Math.round((wins / bronzeGames.length) * 100)}% WR
                  </span>
                </div>
              )}
              {(user?.current_win_streak || 0) >= 2 && (
                <div style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 20, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 10 }}>🔥</span>
                  <span style={{ color: '#fb923c', fontWeight: 800, fontSize: 10 }}>
                    {user.current_win_streak}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: character portrait */}
          <div style={{ position: 'relative', flexShrink: 0, width: 96, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1 }}>
            <div style={{ position: 'absolute', bottom: -10, right: -10, width: 88, height: 88, background: `radial-gradient(circle, ${classInfo.glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />

            <CharacterPortrait
              cls={selectedClass}
              size={96}
              badgeSize={28}
              weapon={equipped?.weapon || null}
              helmet={equipped?.helmet || null}
              sheetPath={localSheetPath || user?.battle_spritesheet_path || user?.character_spritesheet_path || null}
              armor={equipped?.armor || null}
            />
          </div>
        </div>
      </div>

      {/* ── Energy ──────────────────────────────────────────────── */}
      {user?.energy !== undefined && (
        <div style={{ margin: '8px 12px 0', borderRadius: 12, background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.12)', padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase' }}>
              Energy{timeToNext ? ` · next ${timeToNext}` : ''}
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              color: user.energy === user.max_energy
                ? '#22c55e'
                : user.energy <= 3
                ? '#ef4444'
                : '#f59e0b',
            }}>
              ⚡ {user.energy} / {user.max_energy}
            </span>
          </div>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, Math.round((user.energy / (user.max_energy || 10)) * 100))}%`,
              background: user.energy === user.max_energy
                ? '#22c55e'
                : user.energy <= 3
                ? '#ef4444'
                : '#f59e0b',
              borderRadius: 999,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}

      {/* ── Loadout ─────────────────────────────────────────────── */}
      <div style={{ margin: '8px 12px 0', borderRadius: 14, background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.12)', padding: '8px 10px 10px' }}>
        <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 6px' }}>
          Loadout
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {LOADOUT_SLOTS.map(({ key, label, Icon }) => {
                const item = getEquipped(key);
                const tier = getTierKey(item);
                const tierTheme = item ? getTierTheme(item) : null;
            const rarityColor = tierTheme?.color || null;
            const rarityBorder = tierTheme?.border || 'rgba(201,168,76,0.2)';
                const statChips = getItemStatRows(item).slice(0, 1);
                const enchantLevel = Number(item?.enchant_level || 0);
                return (
              <button
                key={key}
                onClick={onNavigateInventory}
                style={{
                  borderRadius: 12, padding: '6px 6px 8px',
                  background: item
                    ? `linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(10,14,28,0.98) 100%)`
                    : 'rgba(255,255,255,0.02)',
                  border: item ? `1px solid ${rarityBorder}` : '1px dashed rgba(201,168,76,0.2)',
                  display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 4,
                  cursor: 'pointer',
                  boxShadow: item ? `0 0 10px ${tier === 'legendary' ? 'rgba(201,168,76,0.18)' : tier === 'epic' ? 'rgba(168,85,247,0.14)' : 'rgba(0,0,0,0.18)'}` : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{
                  height: 40,
                  borderRadius: 9,
                  border: item ? `1px solid ${rarityBorder}` : '1px solid rgba(255,255,255,0.06)',
                  background: item
                    ? `radial-gradient(circle at 50% 28%, ${tierTheme?.soft || 'rgba(201,168,76,0.12)'} 0%, rgba(8,12,24,0.95) 66%)`
                    : 'rgba(8,12,24,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {item
                    ? <SlotImage item={item} size={32} FallbackIcon={Icon} />
                    : <Icon style={{ width: 18, height: 18, color: '#334155', opacity: 0.35 }} />
                  }
                  {item && enchantLevel > 0 ? (
                    <span style={{
                      position: 'absolute',
                      top: 3,
                      right: 3,
                      color: '#c9a84c',
                      background: 'rgba(0,0,0,0.62)',
                      border: '1px solid rgba(201,168,76,0.28)',
                      borderRadius: 999,
                      padding: '1px 4px',
                      fontSize: 8,
                      fontWeight: 900,
                      lineHeight: 1,
                    }}>
                      +{enchantLevel}
                    </span>
                  ) : null}
                </div>
                {item ? (
                  <>
                    <p style={{ color: '#f8fafc', fontSize: 9, fontWeight: 850, lineHeight: 1.15, margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {item.name}
                    </p>
                    {statChips[0] ? (
                      <p style={{ color: rarityColor || '#c9a84c', fontSize: 8, fontWeight: 800, margin: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {statChips[0].label}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p style={{ color: '#64748b', fontSize: 8, fontWeight: 900, letterSpacing: '0.08em', margin: 0, textAlign: 'center', textTransform: 'uppercase' }}>{label}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Real-Time Battle Button (Colyseus) ─────────────────── */}
      {onEnterRealTime && (
        <div style={{ margin: '14px 16px 0' }}>
          <button
            disabled={enteringRealTime || (user?.energy !== undefined && user.energy < 1)}
            onClick={async () => {
              if (enteringRealTime) return;
              setEnergyError('');
              setEnteringRealTime(true);
              try {
                const res = await apiClient.post('/arena/energy/spend');
                onEnergySpent?.({ energy: res.data.energy, max_energy: res.data.max_energy, next_energy_at: res.data.next_energy_at });
                onEnterRealTime();
              } catch (err) {
                const msg = err?.response?.data?.detail?.message || err?.response?.data?.detail || 'No energy — wait for regen';
                setEnergyError(typeof msg === 'string' ? msg : 'No energy — wait for regen');
              } finally {
                if (mountedRef.current) setEnteringRealTime(false);
              }
            }}
            style={{
              width: '100%', height: 60, borderRadius: 16,
              border: (user?.energy !== undefined && user.energy < 1)
                ? '1px solid rgba(100,116,139,0.3)'
                : '1px solid rgba(34,197,94,0.5)',
              cursor: (enteringRealTime || (user?.energy !== undefined && user.energy < 1)) ? 'not-allowed' : 'pointer',
              background: (user?.energy !== undefined && user.energy < 1)
                ? 'rgba(255,255,255,0.04)'
                : 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #064e3b 100%)',
              color: (user?.energy !== undefined && user.energy < 1) ? '#475569' : '#6ee7b7',
              fontWeight: 900, fontSize: 16, letterSpacing: '0.08em',
              boxShadow: (user?.energy !== undefined && user.energy < 1)
                ? 'none'
                : '0 6px 24px rgba(34,197,94,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              opacity: enteringRealTime ? 0.7 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            <Swords style={{ width: 20, height: 20 }} />
            {enteringRealTime ? 'Entering…' : '⚡ REAL-TIME BATTLE'}
            {!enteringRealTime && (
              <>
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: '2px 6px',
                  borderRadius: 999, background: 'rgba(34,197,94,0.2)',
                  border: '1px solid rgba(34,197,94,0.3)', color: '#86efac',
                  letterSpacing: '0.1em',
                }}>BETA</span>
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: '2px 6px',
                  borderRadius: 999,
                  background: (user?.energy !== undefined && user.energy < 1) ? 'rgba(100,116,139,0.15)' : 'rgba(245,158,11,0.18)',
                  border: `1px solid ${(user?.energy !== undefined && user.energy < 1) ? 'rgba(100,116,139,0.3)' : 'rgba(245,158,11,0.35)'}`,
                  color: (user?.energy !== undefined && user.energy < 1) ? '#475569' : '#fbbf24',
                  letterSpacing: '0.08em',
                }}>1 energy</span>
              </>
            )}
          </button>
          {energyError && (
            <p style={{ color: '#f87171', fontSize: 11, fontWeight: 700, textAlign: 'center', margin: '8px 0 0' }}>
              {energyError}
            </p>
          )}
        </div>
      )}

      {/* ── Queue Status ────────────────────────────────────────── */}
      <div style={{ margin: '10px 16px 0', display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: queueCount > 0 ? '#22c55e' : '#475569', boxShadow: queueCount > 0 ? '0 0 6px rgba(34,197,94,0.8)' : 'none' }} />
          <Users style={{ width: 12, height: 12, color: '#64748b' }} />
          <span style={{ color: queueCount > 0 ? '#94a3b8' : '#475569', fontSize: 12, fontWeight: 600 }}>
            {queueCount > 0 ? `${queueCount} warrior${queueCount !== 1 ? 's' : ''} in queue` : 'Queue is empty'}
          </span>
        </div>
      </div>

      {/* ── Recent Duels ────────────────────────────────────────── */}
      {history !== null && recentOpponents.length > 0 && (
        <div style={{ margin: '20px 16px 0' }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 10px' }}>
            Recent Duels
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentOpponents.map((opp, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, background: 'rgba(26,26,46,0.7)', border: `1px solid ${opp.won ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.15)'}` }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #8b0000, #c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
                  {opp.photo ? (
                    <img src={opp.photo} alt={opp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>{opp.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: '#e8e0d0', fontWeight: 700, fontSize: 13, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opp.name}
                  </p>
                </div>
                <div style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 20, background: opp.won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)', border: `1px solid ${opp.won ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}` }}>
                  <span style={{ color: opp.won ? '#22c55e' : '#f87171', fontWeight: 800, fontSize: 11 }}>
                    {opp.won ? 'WIN' : 'LOSS'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Memoized: `user` now comes from context and all callbacks from App are stable,
// so ArenaEntryScreen only re-renders when its real data (user/rooms/equipped)
// changes — not on unrelated App.jsx state ticks (e.g. recent-winners poll).
export default memo(ArenaEntryScreen);
