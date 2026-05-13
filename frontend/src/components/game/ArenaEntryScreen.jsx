import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Shield, Sparkles, Sword, Swords, Users } from 'lucide-react';
import apiClient from '../../api/client';
import { CLASS_INFO, getCharacterImage } from '../../utils/characters';

const BET_PRESETS = [200, 250, 300, 350, 400, 450];
const CLASS_KEYS = ['warrior', 'mage', 'rogue'];

const TIER_COLOR = {
  common:    '#94a3b8',
  uncommon:  '#22c55e',
  rare:      '#3b82f6',
  epic:      '#a855f7',
  legendary: '#c9a84c',
};
const TIER_BORDER = {
  common:    'rgba(148,163,184,0.25)',
  uncommon:  'rgba(34,197,94,0.3)',
  rare:      'rgba(59,130,246,0.3)',
  epic:      'rgba(168,85,247,0.3)',
  legendary: 'rgba(201,168,76,0.45)',
};

const LOADOUT_SLOTS = [
  { key: 'weapon',    label: 'WEAPON',  Icon: Sword },
  { key: 'armor',     label: 'ARMOR',   Icon: Shield },
  { key: 'ability',   label: 'ABILITY', Icon: Sparkles },
];

export default function ArenaEntryScreen({ user, rooms, onEnterBattle, onClassChange, onNavigateInventory }) {
  const [selectedBet, setSelectedBet] = useState(200);
  const [history, setHistory] = useState(null);
  const [entering, setEntering] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState(false);

  const [selectedClass, setSelectedClass] = useState(
    () => (user?.class_name || 'warrior').toLowerCase()
  );

  const classInfo = CLASS_INFO[selectedClass] || CLASS_INFO.warrior;
  const charImg = getCharacterImage(selectedClass);
  const isActiveClass = selectedClass === (user?.class_name || '').toLowerCase();

  useEffect(() => {
    apiClient
      .get('/game-history?limit=20')
      .then((res) => setHistory(res.data?.games || res.data || []))
      .catch(() => setHistory([]));
  }, []);

  const cycleClass = (dir) => {
    const idx = CLASS_KEYS.indexOf(selectedClass);
    const next = (idx + dir + CLASS_KEYS.length) % CLASS_KEYS.length;
    setSelectedClass(CLASS_KEYS[next]);
  };

  const handleSwitchClass = async () => {
    if (switching || isActiveClass) return;
    setSwitching(true);
    try {
      await apiClient.post('/me/class', { class_name: selectedClass });
      onClassChange?.(selectedClass);
      setSwitchFeedback(true);
      setTimeout(() => setSwitchFeedback(false), 1800);
    } catch {
      // silently ignore — backend validation may reject
    }
    setSwitching(false);
  };

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
  const prizePool = Math.floor(selectedBet * 2 * 0.9);

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
      bet: opp?.bet_amount || 0,
    };
  });

  const canEnter =
    !entering &&
    user?.token_balance >= selectedBet &&
    !!user?.class_name;

  const handleEnter = async () => {
    if (!canEnter) return;
    setEntering(true);
    try {
      await onEnterBattle(selectedBet);
    } finally {
      setEntering(false);
    }
  };

  // Equipped items from user data
  const equippedItems = user?.equipped_items || [];
  const getEquipped = (slotKey) =>
    equippedItems.find((i) =>
      (i.category || i.type || '').toLowerCase().startsWith(slotKey)
    ) || null;

  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, color: '#e8e0d0' }}>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div style={{
        margin: '12px 16px 0',
        borderRadius: 20,
        background: 'linear-gradient(135deg, #0d0d1a 0%, #1a0a0a 50%, #2d0000 100%)',
        border: '1px solid rgba(201,168,76,0.3)',
        borderBottom: '2px solid rgba(201,168,76,0.5)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: '20px 20px 16px',
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
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#c9a84c', margin: '0 0 8px', textTransform: 'uppercase' }}>
                The Arena
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 22 }}>{classInfo.icon}</span>
                <h2 style={{ color: 'white', fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
                  {classInfo.name}
                </h2>
              </div>
              <p style={{ color: classInfo.color, fontSize: 12, fontWeight: 700, margin: '0 0 4px' }}>
                {classInfo.title}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 500, margin: 0 }}>
                {classInfo.bonus}
              </p>
            </div>

            {/* Win / Loss pills */}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <div style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 20, padding: '4px 12px' }}>
                <span style={{ color: '#22c55e', fontWeight: 800, fontSize: 13 }}>
                  {history === null ? '—' : wins}W
                </span>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 20, padding: '4px 12px' }}>
                <span style={{ color: '#f87171', fontWeight: 800, fontSize: 13 }}>
                  {history === null ? '—' : losses}L
                </span>
              </div>
              {bronzeGames.length > 0 && (
                <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 20, padding: '4px 12px' }}>
                  <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12 }}>
                    {Math.round((wins / bronzeGames.length) * 100)}% WR
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: arrows + character image */}
          <div style={{ position: 'relative', flexShrink: 0, width: 140, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1 }}>
            {/* Left arrow */}
            <button
              onClick={() => cycleClass(-1)}
              style={{
                position: 'absolute', left: -12, top: '50%', transform: 'translateY(-50%)',
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 2, padding: 0,
              }}
            >
              <ChevronLeft style={{ width: 16, height: 16, color: 'white' }} />
            </button>

            {/* Glow behind image */}
            <div style={{ position: 'absolute', bottom: -16, right: -20, width: 120, height: 120, background: `radial-gradient(circle, ${classInfo.glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />

            <img
              src={charImg}
              alt={classInfo.name}
              style={{ height: 180, width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.7))', transition: 'opacity 0.15s ease' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />

            {/* Right arrow */}
            <button
              onClick={() => cycleClass(1)}
              style={{
                position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 2, padding: 0,
              }}
            >
              <ChevronRight style={{ width: 16, height: 16, color: 'white' }} />
            </button>
          </div>
        </div>

        {/* SWITCH / ACTIVE pill row */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, zIndex: 1, position: 'relative' }}>
          {switchFeedback ? (
            <span style={{ padding: '4px 14px', borderRadius: 20, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 11, fontWeight: 800 }}>
              Class changed!
            </span>
          ) : isActiveClass ? (
            <span style={{ padding: '4px 14px', borderRadius: 20, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', fontSize: 11, fontWeight: 800 }}>
              ACTIVE
            </span>
          ) : (
            <button
              onClick={handleSwitchClass}
              disabled={switching}
              style={{
                padding: '4px 14px', borderRadius: 20,
                background: switching ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #8b0000, #c0392b)',
                border: '1px solid rgba(201,168,76,0.3)',
                color: switching ? '#475569' : '#f5e6c0',
                fontSize: 11, fontWeight: 800,
                cursor: switching ? 'not-allowed' : 'pointer',
              }}
            >
              {switching ? '...' : `SWITCH TO ${classInfo.name.toUpperCase()}`}
            </button>
          )}
        </div>
      </div>

      {/* ── Loadout ─────────────────────────────────────────────── */}
      <div style={{ margin: '12px 16px 0', borderRadius: 18, background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.12)', padding: '14px 14px 16px' }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 10px' }}>
          Loadout
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {LOADOUT_SLOTS.map(({ key, label, Icon }) => {
            const item = getEquipped(key);
            const rarity = item?.rarity || null;
            const rarityColor = rarity ? (RARITY_COLOR[rarity] || RARITY_COLOR.Common) : null;
            const rarityBorder = rarity ? (RARITY_BORDER[rarity] || RARITY_BORDER.Common) : 'rgba(201,168,76,0.2)';
            return (
              <button
                key={key}
                onClick={onNavigateInventory}
                style={{
                  height: 80, borderRadius: 14, padding: '8px 4px',
                  background: item ? 'rgba(26,26,46,0.95)' : 'rgba(255,255,255,0.02)',
                  border: item ? `1px solid ${rarityBorder}` : '1px dashed rgba(201,168,76,0.2)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                  cursor: 'pointer',
                  boxShadow: item ? `0 0 10px ${rarityBorder}` : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon style={{ width: 22, height: 22, color: item ? rarityColor : '#334155', opacity: item ? 1 : 0.35 }} />
                <p style={{ color: '#475569', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', margin: 0 }}>{label}</p>
                {item && (
                  <p style={{ color: rarityColor, fontSize: 9, fontWeight: 700, margin: 0, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                    {item.name}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bet Selector ───────────────────────────────────────── */}
      <div style={{ margin: '12px 16px 0', borderRadius: 18, background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.15)', padding: '16px 16px 18px' }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 12px' }}>
          Select Wager
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {BET_PRESETS.map((bet) => {
            const active = selectedBet === bet;
            const affordable = (user?.token_balance || 0) >= bet;
            return (
              <button
                key={bet}
                onClick={() => affordable && setSelectedBet(bet)}
                style={{
                  borderRadius: 12, padding: '10px 4px', border: 'none', cursor: affordable ? 'pointer' : 'not-allowed',
                  background: active
                    ? 'linear-gradient(135deg, #8b0000, #c0392b)'
                    : affordable
                    ? 'rgba(255,255,255,0.05)'
                    : 'rgba(255,255,255,0.02)',
                  boxShadow: active ? '0 0 12px rgba(139,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)' : 'none',
                  outline: active ? '1px solid rgba(201,168,76,0.5)' : '1px solid rgba(255,255,255,0.07)',
                  transition: 'all 0.15s ease',
                  opacity: affordable ? 1 : 0.35,
                }}
              >
                <p style={{ color: active ? 'white' : '#94a3b8', fontWeight: 800, fontSize: 15, margin: 0 }}>
                  {bet}
                </p>
                <p style={{ color: active ? 'rgba(255,255,255,0.65)' : '#475569', fontSize: 10, margin: '1px 0 0', fontWeight: 600 }}>
                  coins
                </p>
              </button>
            );
          })}
        </div>

        {/* Prize pool row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '10px 14px', borderRadius: 12, background: 'rgba(201,168,76,0.07)', border: '1px solid rgba(201,168,76,0.18)' }}>
          <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>Prize Pool</span>
          <span style={{ color: '#c9a84c', fontWeight: 900, fontSize: 18 }}>
            {prizePool.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600 }}>coins</span>
          </span>
        </div>

        {/* Insufficient balance warning */}
        {(user?.token_balance || 0) < selectedBet && (
          <p style={{ color: '#f87171', fontSize: 11, fontWeight: 700, textAlign: 'center', margin: '10px 0 0' }}>
            Insufficient balance — need {selectedBet - (user?.token_balance || 0)} more coins
          </p>
        )}
      </div>

      {/* ── Enter Battle Button ─────────────────────────────────── */}
      <div style={{ margin: '14px 16px 0' }}>
        <button
          onClick={handleEnter}
          disabled={!canEnter}
          style={{
            width: '100%', height: 56, borderRadius: 16,
            border: canEnter ? '1px solid rgba(201,168,76,0.5)' : 'none',
            cursor: canEnter ? 'pointer' : 'not-allowed',
            background: canEnter
              ? 'linear-gradient(135deg, #8b0000 0%, #c0392b 50%, #8b0000 100%)'
              : 'rgba(255,255,255,0.05)',
            color: canEnter ? '#f5e6c0' : '#475569',
            fontWeight: 900, fontSize: 17, letterSpacing: '0.1em',
            boxShadow: canEnter ? '0 6px 24px rgba(139,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'all 0.2s ease',
          }}
        >
          {entering ? (
            <span style={{ opacity: 0.7 }}>Entering…</span>
          ) : !user?.class_name ? (
            <>
              <Swords style={{ width: 20, height: 20 }} />
              Choose a Class First
            </>
          ) : (
            <>
              <Swords style={{ width: 20, height: 20 }} />
              ENTER BATTLE
            </>
          )}
        </button>
      </div>

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
                  {opp.bet > 0 && (
                    <p style={{ color: '#475569', fontSize: 11, margin: '1px 0 0', fontWeight: 500 }}>{opp.bet} coins wagered</p>
                  )}
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
