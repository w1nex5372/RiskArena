import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ClipboardList, Clock3, Gift, RefreshCw, Swords, Trophy, Zap } from 'lucide-react';
import apiClient from '../../api/client';

const GAME_MODES = [
  {
    id: 'arena',
    label: 'ARENA',
    sub: '1v1 Duels — High Stakes',
    Icon: Swords,
    live: true,
    bg: 'linear-gradient(135deg, #1a0a0a 0%, #3d0000 100%)',
    glow: '0 4px 24px rgba(139,0,0,0.45)',
    iconColor: '#f87171',
    arrowBg: 'rgba(139,0,0,0.6)',
    betRange: '200–450 coins',
    badge: null,
  },
  {
    id: 'boss',
    label: 'BOSS RAID',
    sub: 'Team up. Deal damage. Loot.',
    Icon: Zap,
    live: false,
    bg: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a5e 100%)',
    glow: '0 4px 20px rgba(74,144,217,0.35)',
    iconColor: '#93c5fd',
    arrowBg: 'rgba(74,144,217,0.3)',
    betRange: null,
    badge: 'SOON',
  },
  {
    id: 'tournament',
    label: 'TOURNAMENT',
    sub: 'Bracket competition for prizes.',
    Icon: Trophy,
    live: false,
    bg: 'linear-gradient(135deg, #1a1200 0%, #3d2d00 100%)',
    glow: '0 4px 20px rgba(201,168,76,0.35)',
    iconColor: '#fcd34d',
    arrowBg: 'rgba(201,168,76,0.3)',
    betRange: null,
    badge: 'SOON',
  },
];


const SectionLabel = ({ children }) => (
  <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 12px' }}>
    {children}
  </p>
);

function formatCountdown(targetAt) {
  if (!targetAt) return '--:--:--';
  const targetTime = new Date(targetAt).getTime();
  if (Number.isNaN(targetTime)) return '--:--:--';

  const diff = Math.max(0, targetTime - Date.now());
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function HomeScreen({
  isMobile,
  user,
  recentWinners,
  rooms,
  setActiveTab,
}) {
  const rank = user?.rank || null;
  const streak = user?.streak || 0;
  const arenaOnline = (rooms || []).reduce((sum, r) => sum + (r.players_count || 0), 0);
  const [chest, setChest] = useState(null);
  const [chestLoading, setChestLoading] = useState(true);
  const [chestError, setChestError] = useState(false);
  const [chestCountdown, setChestCountdown] = useState('--:--:--');
  const lastResetRefreshAtRef = useRef(0);

  const fetchChest = useCallback(async () => {
    try {
      const res = await apiClient.get('/daily-chest');
      setChest(res.data || null);
      setChestError(false);
    } catch (_) {
      setChest(null);
      setChestError(true);
    } finally {
      setChestLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChest();
    window.addEventListener('focus', fetchChest);
    return () => {
      window.removeEventListener('focus', fetchChest);
    };
  }, [fetchChest]);

  useEffect(() => {
    const targetAt = chest?.next_available_at || chest?.reset_at;
    const tick = () => {
      setChestCountdown(formatCountdown(targetAt));
      const targetTime = targetAt ? new Date(targetAt).getTime() : NaN;
      if (
        targetAt &&
        !Number.isNaN(targetTime) &&
        Date.now() >= targetTime &&
        chest &&
        !chest.available &&
        Date.now() - lastResetRefreshAtRef.current > 5000
      ) {
        lastResetRefreshAtRef.current = Date.now();
        fetchChest();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [chest, chest?.next_available_at, chest?.reset_at, fetchChest]);

  const chestCopy = useMemo(() => {
    if (chestLoading) {
      return {
        badge: 'Checking',
        title: 'Free chest status loading',
        sub: 'Coins, XP, and rare item drops.',
        cta: 'Open',
        ready: false,
      };
    }

    if (chestError) {
      return {
        badge: 'Offline',
        title: 'Chest status unavailable',
        sub: 'Open the chest screen to retry.',
        cta: 'Open',
        ready: false,
      };
    }

    if (chest?.available) {
      return {
        badge: 'Ready',
        title: 'Free Daily Chest ready',
        sub: 'Open now for coins, XP, and item drops.',
        cta: 'Open',
        ready: true,
      };
    }

    if (chest?.claimed_today) {
      return {
        badge: 'Claimed',
        title: `Next free chest in ${chestCountdown}`,
        sub: 'Come back after reset for another roll.',
        cta: 'View',
        ready: false,
      };
    }

    return {
      badge: 'Daily',
      title: `Available in ${chestCountdown}`,
      sub: 'Coins, XP, and rare item drops.',
      cta: 'View',
      ready: false,
    };
  }, [chest?.available, chest?.claimed_today, chestCountdown, chestError, chestLoading]);

  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100 }}>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(1.4); }
        }
      `}</style>

      {/* ── SECTION A: Season Banner ─────────────────────────── */}
      <div style={{
        margin: '12px 16px 0',
        borderRadius: 20,
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0d0d1a 100%)',
        padding: 20,
        minHeight: 140,
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid rgba(201,168,76,0.3)',
        borderBottom: '1px solid rgba(201,168,76,0.5)',
        boxShadow: '0 8px 32px rgba(201,168,76,0.12)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        {/* ambient glow accent */}
        <div style={{ position: 'absolute', right: -24, top: -24, width: 140, height: 140, background: 'radial-gradient(circle, rgba(201,168,76,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', color: '#c9a84c', margin: '0 0 6px', textTransform: 'uppercase' }}>
              Season 1
            </p>
            <h2 style={{ color: 'white', fontSize: 32, fontWeight: 900, margin: '0 0 5px', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              RISE TO RISK
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500, margin: 0 }}>
              Compete. Climb. Dominate.
            </p>
          </div>
          <div style={{ fontSize: 64, lineHeight: 1, filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.8))', marginLeft: 12, flexShrink: 0, userSelect: 'none' }}>
            ⚔️
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(0,0,0,0.22)', backdropFilter: 'blur(6px)', borderRadius: 20, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Trophy style={{ width: 13, height: 13, color: '#fbbf24' }} />
            <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>
              {rank ? `Rank #${rank}` : 'Unranked'}
            </span>
          </div>
          {streak > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.22)', backdropFilter: 'blur(6px)', borderRadius: 20, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 13 }}>🔥</span>
              <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>{streak} streak</span>
            </div>
          )}
        </div>
      </div>

      {/* ── DAILY QUESTS CARD ───────────────────────────────── */}
      <div style={{ margin: '16px 16px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div role="button" tabIndex={0} onClick={() => setActiveTab?.('quests')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab?.('quests'); }} aria-label="Open daily quests" style={{
          width: '100%',
          margin: '0 0 0px',
          padding: '14px 14px',
          borderRadius: 16,
          background: 'linear-gradient(135deg, rgba(42,31,9,0.92), rgba(15,23,42,0.9) 58%, rgba(34,197,94,0.12))',
          border: '1px solid rgba(201,168,76,0.42)',
          boxShadow: '0 10px 28px rgba(201,168,76,0.1)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          textAlign: 'left',
        }}>
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: 'rgba(201,168,76,0.12)',
            border: '1px solid rgba(201,168,76,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: '#c9a84c',
          }}>
            <ClipboardList size={22} strokeWidth={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: '#c9a84c', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Daily Quests
              </span>
              <span style={{
                background: 'rgba(34,197,94,0.14)',
                border: '1px solid rgba(34,197,94,0.22)',
                color: '#86efac',
                fontSize: 9,
                fontWeight: 900,
                padding: '2px 6px',
                borderRadius: 999,
                textTransform: 'uppercase',
              }}>
                Active
              </span>
            </div>
            <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 850, lineHeight: 1.15 }}>
              Tasks ready to complete
            </div>
            <div style={{ color: 'rgba(203,213,225,0.64)', fontSize: 11, fontWeight: 650, marginTop: 4 }}>
              Claim coins and XP before reset.
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            color: '#111827',
            background: 'linear-gradient(135deg, #facc15, #c9a84c)',
            borderRadius: 999,
            padding: '8px 10px',
            fontSize: 11,
            fontWeight: 950,
            boxShadow: '0 8px 18px rgba(201,168,76,0.18)',
          }}>
            Open
            <ChevronRight size={14} strokeWidth={3} />
          </div>
        </div>
        <div role="button" tabIndex={0} onClick={() => setActiveTab?.('dailyChest')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab?.('dailyChest'); }} aria-label="Open free daily chest" style={{
          width: '100%',
          padding: '14px 14px',
          borderRadius: 16,
          background: chestCopy.ready
            ? 'linear-gradient(135deg, rgba(42,31,9,0.98), rgba(15,23,42,0.92) 48%, rgba(250,204,21,0.2))'
            : 'linear-gradient(135deg, rgba(15,23,42,0.92), rgba(42,31,9,0.78))',
          border: `1px solid ${chestCopy.ready ? 'rgba(250,204,21,0.54)' : 'rgba(201,168,76,0.28)'}`,
          boxShadow: chestCopy.ready ? '0 12px 30px rgba(201,168,76,0.15)' : '0 8px 22px rgba(0,0,0,0.18)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          textAlign: 'left',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {chestCopy.ready && (
            <div style={{ position: 'absolute', right: -30, top: -42, width: 130, height: 130, background: 'radial-gradient(circle, rgba(250,204,21,0.2), transparent 68%)', pointerEvents: 'none' }} />
          )}
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: chestCopy.ready ? 'linear-gradient(135deg, #facc15, #c9a84c)' : 'rgba(201,168,76,0.12)',
            border: '1px solid rgba(201,168,76,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: chestCopy.ready ? '#111827' : '#c9a84c',
            position: 'relative',
          }}>
            {chestLoading ? <RefreshCw size={21} strokeWidth={2.4} /> : <Gift size={22} strokeWidth={2.4} />}
          </div>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: '#c9a84c', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Free Daily Chest
              </span>
              <span style={{
                background: chestCopy.ready ? 'rgba(34,197,94,0.14)' : 'rgba(201,168,76,0.12)',
                border: `1px solid ${chestCopy.ready ? 'rgba(34,197,94,0.22)' : 'rgba(201,168,76,0.2)'}`,
                color: chestCopy.ready ? '#86efac' : '#c9a84c',
                fontSize: 9,
                fontWeight: 900,
                padding: '2px 6px',
                borderRadius: 999,
                textTransform: 'uppercase',
              }}>
                {chestCopy.badge}
              </span>
            </div>
            <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 850, lineHeight: 1.15 }}>
              {chestCopy.title}
            </div>
            <div style={{ color: 'rgba(203,213,225,0.64)', fontSize: 11, fontWeight: 650, marginTop: 4 }}>
              {chestCopy.sub}
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            color: '#111827',
            background: chestCopy.ready ? 'linear-gradient(135deg, #facc15, #c9a84c)' : 'rgba(201,168,76,0.82)',
            borderRadius: 999,
            padding: '8px 10px',
            fontSize: 11,
            fontWeight: 950,
            boxShadow: chestCopy.ready ? '0 8px 18px rgba(201,168,76,0.2)' : 'none',
            position: 'relative',
          }}>
            {chest?.claimed_today ? <Clock3 size={13} strokeWidth={3} /> : null}
            {chestCopy.cta}
            <ChevronRight size={14} strokeWidth={3} />
          </div>
        </div>
        </div>
      </div>

      {/* ── SECTION B: Game Modes ────────────────────────────── */}
      <div style={{ margin: '24px 16px 0' }}>
        <SectionLabel>Game Modes</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GAME_MODES.map(({ id, label, sub, Icon, live, bg, glow, iconColor, arrowBg, betRange, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab?.(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: bg, borderRadius: 16, padding: 20,
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: id === 'arena'
                  ? '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)'
                  : '0 8px 32px rgba(0,0,0,0.4)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
              }}
            >
              {/* Icon */}
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: 'rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon style={{ width: 28, height: 28, color: iconColor }} />
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ color: 'white', fontWeight: 800, fontSize: 20, letterSpacing: '0.04em' }}>
                    {label}
                  </span>
                  {badge && (
                    <span style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, letterSpacing: '0.08em' }}>
                      {badge}
                    </span>
                  )}
                </div>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500, margin: 0 }}>
                  {sub}
                </p>
                {betRange && (
                  <span style={{
                    display: 'inline-block',
                    marginTop: 5,
                    background: 'rgba(201,168,76,0.1)',
                    border: '1px solid rgba(201,168,76,0.2)',
                    color: '#c9a84c',
                    fontSize: 11,
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontWeight: 700,
                  }}>
                    💰 {betRange}
                  </span>
                )}
                {live && arenaOnline > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#22c55e',
                      boxShadow: '0 0 8px rgba(34,197,94,0.8)',
                      animation: 'livePulse 1.2s ease-in-out infinite',
                      flexShrink: 0,
                    }} />
                    <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700 }}>
                      {arenaOnline} live
                    </span>
                  </div>
                )}
              </div>

              {/* CTA / Arrow */}
              {id === 'arena' ? (
                <div style={{
                  background: 'linear-gradient(135deg, #c0392b, #8b0000)',
                  color: 'white',
                  borderRadius: 999,
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 800,
                  border: '1px solid rgba(201,168,76,0.3)',
                  boxShadow: '0 4px 14px rgba(139,0,0,0.5)',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}>
                  JOIN →
                </div>
              ) : (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  opacity: 0.4,
                }}>
                  <ChevronRight style={{ width: 16, height: 16, color: 'white' }} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── SECTION C: Quick Stats ───────────────────────────── */}
      <div style={{ margin: '24px 16px 0' }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { icon: '📅', label: 'DAILY QUESTS', value: 'View Quests', muted: false, onClick: () => setActiveTab?.('quests') },
            { icon: '🎁', label: 'FREE CHEST', value: chestError ? 'Unavailable' : chest?.available ? 'Ready to open' : chest?.claimed_today ? chestCountdown : 'View Chest', muted: false, onClick: () => setActiveTab?.('dailyChest') },
            {
              icon: '🏆',
              label: 'SEASON 1',
              value: null,
              custom: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.7)', flexShrink: 0 }} />
                  <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 14 }}>Active</span>
                </div>
              ),
            },
            { icon: '📊', label: 'RANK', value: rank ? `#${rank}` : 'Unranked' },
          ].map(({ icon, label, value, muted, custom, onClick }) => (
            <div key={label} onClick={onClick} style={{
              background: 'rgba(26,26,46,0.6)',
              border: '1px solid rgba(201,168,76,0.1)',
              borderRadius: 12, padding: '12px 14px',
              cursor: onClick ? 'pointer' : 'default',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.07em' }}>{label}</span>
              </div>
              {custom || (
                <p style={{ color: muted ? '#475569' : 'white', fontWeight: muted ? 500 : 700, fontSize: 14, margin: 0, fontStyle: muted ? 'italic' : 'normal' }}>
                  {value}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
