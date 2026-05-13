import { ChevronRight, Swords, Trophy, Zap } from 'lucide-react';

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
  },
];


const SectionLabel = ({ children }) => (
  <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 12px' }}>
    {children}
  </p>
);

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

  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100 }}>

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

      {/* ── SECTION B: Game Modes ────────────────────────────── */}
      <div style={{ margin: '24px 16px 0' }}>
        <SectionLabel>Game Modes</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GAME_MODES.map(({ id, label, sub, Icon, live, bg, glow, iconColor, arrowBg }) => (
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
                  {!live && (
                    <span style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, letterSpacing: '0.08em' }}>
                      SOON
                    </span>
                  )}
                </div>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500, margin: 0 }}>
                  {sub}
                </p>
                {live && arenaOnline > 0 && (
                  <p style={{ color: '#c9a84c', fontSize: 11, fontWeight: 700, margin: '4px 0 0' }}>
                    ⚡ {arenaOnline} online
                  </p>
                )}
              </div>

              {/* Arrow */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: live ? arrowBg : 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                opacity: live ? 1 : 0.4,
              }}>
                <ChevronRight style={{ width: 16, height: 16, color: 'white' }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── SECTION C: Quick Stats ───────────────────────────── */}
      <div style={{ margin: '24px 16px 0' }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { icon: '📅', label: 'DAILY QUESTS', value: 'Coming soon', muted: true },
            { icon: '🎁', label: 'FREE CHEST',   value: 'Coming soon', muted: true },
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
          ].map(({ icon, label, value, muted, custom }) => (
            <div key={label} style={{
              background: 'rgba(26,26,46,0.6)',
              border: '1px solid rgba(201,168,76,0.1)',
              borderRadius: 12, padding: '12px 14px',
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
