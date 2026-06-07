import React from 'react';
import { toast } from 'sonner';
import TokenPurchaseHistory from '../shop/TokenPurchaseHistory';
import { ROOM_LABELS, normalizeRoomType } from '../../utils/constants';
import { CLASS_INFO } from '../../utils/characters';
import apiClient from '../../api/client';

const PROGRESS_TTL = 60_000;
// The Nth class slot unlocks at this level (slot 0 = starting class, always owned).
const CLASS_SLOT_LEVELS = [1, 10, 15];

function ProfileScreen({ API, user, onUserUpdate }) {
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState(null);
  const [progressLoading, setProgressLoading] = React.useState(true);
  const [switchingClass, setSwitchingClass] = React.useState(null);

  React.useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    apiClient.get(`/user-stats/${user.id}`)
      .then(r => setStats(r.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [user?.id]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('user_progress');
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < PROGRESS_TTL) {
          setProgress(data);
          setProgressLoading(false);
          return;
        }
      }
    } catch {}
    apiClient.get('/me/progress')
      .then((res) => {
        setProgress(res.data);
        try { localStorage.setItem('user_progress', JSON.stringify({ data: res.data, ts: Date.now() })); } catch {}
      })
      .catch(() => {})
      .finally(() => setProgressLoading(false));
  }, [user?.id]);

  const level = progress?.level || user?.level || 1;
  const xp = progress?.xp || 0;
  const xpToNext = progress?.xp_to_next_level || 100;
  const xpPct = Math.min(100, Math.round((xp / (xp + xpToNext)) * 100));

  const winRatePct = stats?.win_rate ?? 0;
  const isProfit = (stats?.net_profit ?? 0) >= 0;

  // ── Class slots ──────────────────────────────────────────────────────────
  const activeClass = String(user?.class_name || '').trim().toLowerCase();
  const unlockedClasses = (Array.isArray(user?.unlocked_classes) && user.unlocked_classes.length)
    ? user.unlocked_classes.map((c) => String(c).toLowerCase())
    : (activeClass ? [activeClass] : []);
  const pendingUnlocks = user?.pending_class_unlocks || 0;

  const handleSwitchClass = async (cls) => {
    if (switchingClass || cls === activeClass) return;
    setSwitchingClass(cls);
    try {
      const res = await apiClient.post('/me/class', { class_name: cls });
      onUserUpdate?.(res.data);
      toast.success(`Now playing as ${CLASS_INFO[cls]?.name || cls}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to switch class');
    } finally {
      setSwitchingClass(null);
    }
  };

  const StatCard = ({ label, value, sub, color, icon }) => (
    <div style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 4 }}>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || 'white', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: '0 4px 24px', maxWidth: 480, margin: '0 auto' }}>

      {/* 1. XP Progress */}
      {progressLoading ? (
        <div style={{ background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.1)', borderRadius: 14, height: 72, marginBottom: 10 }} />
      ) : progress ? (
        <div style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Level {level} → Level {level + 1}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#c9a84c' }}>
              {xp.toLocaleString()} XP
            </span>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${xpPct}%`, background: 'linear-gradient(90deg,#8b0000,#c9a84c)', borderRadius: 99, transition: 'width 0.8s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#64748b' }}>
            <span>{xp.toLocaleString()} earned</span>
            <span>{xpToNext.toLocaleString()} to next level</span>
          </div>
        </div>
      ) : null}

      {/* 2. Class slots — switch between unlocked classes */}
      {activeClass && (
        <div style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Class — tap to switch
            </span>
            {pendingUnlocks > 0 && (
              <span style={{ fontSize: 10, fontWeight: 800, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '2px 8px' }}>
                ✦ New class ready
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {CLASS_SLOT_LEVELS.map((reqLevel, slotIndex) => {
              // A slot is owned if the player has unlocked at least (slotIndex+1) classes.
              const ownedClass = unlockedClasses[slotIndex];
              if (ownedClass) {
                const info = CLASS_INFO[ownedClass] || {};
                const isActive = ownedClass === activeClass;
                const isSwitching = switchingClass === ownedClass;
                return (
                  <button
                    key={slotIndex}
                    type="button"
                    onClick={() => handleSwitchClass(ownedClass)}
                    disabled={isActive || !!switchingClass}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '12px 6px 10px', borderRadius: 12, cursor: isActive ? 'default' : 'pointer',
                      background: isActive ? `${info.color || '#c9a84c'}1f` : 'rgba(255,255,255,0.03)',
                      border: isActive ? `1.5px solid ${info.color || '#c9a84c'}` : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: isActive ? `0 0 16px ${info.glow || 'rgba(201,168,76,0.4)'}` : 'none',
                      color: 'inherit', transition: 'all 0.15s ease', appearance: 'none',
                    }}
                  >
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{info.icon || '✦'}</span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: isActive ? (info.color || '#c9a84c') : '#e8e0d0' }}>
                      {info.name || ownedClass}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: isActive ? '#22c55e' : '#64748b',
                    }}>
                      {isActive ? 'Active ✓' : isSwitching ? '…' : 'Switch'}
                    </span>
                  </button>
                );
              }
              // Locked / claimable slot
              const claimable = slotIndex < unlockedClasses.length + pendingUnlocks;
              return (
                <div
                  key={slotIndex}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '12px 6px 10px', borderRadius: 12,
                    background: claimable ? 'rgba(201,168,76,0.08)' : 'rgba(255,255,255,0.02)',
                    border: claimable ? '1px dashed rgba(201,168,76,0.4)' : '1px dashed rgba(148,163,184,0.18)',
                    opacity: claimable ? 1 : 0.7,
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1, filter: claimable ? 'none' : 'grayscale(1)' }}>
                    {claimable ? '✦' : '🔒'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: claimable ? '#c9a84c' : '#64748b' }}>
                    {claimable ? 'Ready!' : 'Locked'}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b' }}>
                    Lvl {reqLevel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Stats section */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>Loading stats...</div>
      ) : !stats ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>No stats yet — start playing!</div>
      ) : (
        <>
          {/* Win Rate Bar */}
          <div style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: 14, padding: '16px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Win Rate</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: winRatePct >= 40 ? '#22c55e' : winRatePct >= 25 ? '#f59e0b' : '#ef4444' }}>{winRatePct}%</span>
            </div>
            <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(winRatePct, 100)}%`, background: winRatePct >= 40 ? 'linear-gradient(90deg,#16a34a,#22c55e)' : winRatePct >= 25 ? 'linear-gradient(90deg,#d97706,#f59e0b)' : 'linear-gradient(90deg,#dc2626,#ef4444)', borderRadius: 99, transition: 'width 0.8s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#64748b' }}>
              <span>{stats.games_won} wins</span>
              <span>{stats.games_played} games total</span>
            </div>
          </div>

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <StatCard icon="🎮" label="Games Played" value={stats.games_played.toLocaleString()} />
            <StatCard icon="🏆" label="Games Won" value={stats.games_won.toLocaleString()} color="#22c55e" />
            <StatCard icon="⚔️" label="Total Wagered" value={stats.total_wagered.toLocaleString()} sub="tokens bet" />
            <StatCard icon="💰" label="Total Won" value={stats.total_won.toLocaleString()} sub="tokens earned" color="#f59e0b" />

            {/* Net P/L — full width, visually dominant */}
            <div style={{ gridColumn: '1 / -1', background: 'rgba(26,26,46,0.7)', border: `1px solid ${isProfit ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: 12, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{isProfit ? '📈' : '📉'}</span>
                <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Net Profit / Loss</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: isProfit ? '#22c55e' : '#ef4444' }}>
                {isProfit ? '+' : ''}{stats.net_profit.toLocaleString()}
              </div>
            </div>

            <StatCard icon="💎" label="Biggest Win" value={stats.biggest_win.toLocaleString()} sub="single game" color="#a78bfa" />
            <StatCard icon="💸" label="Biggest Loss" value={stats.biggest_loss ? stats.biggest_loss.toLocaleString() : '0'} sub="single game" color="#ef4444" />
            <StatCard icon="💀" label="Games Lost" value={(stats.games_lost ?? (stats.games_played - stats.games_won)).toLocaleString()} color="#ef4444" />
            <StatCard
              icon="🔥"
              label="Best Streak"
              value={stats.best_win_streak ?? 0}
              sub={stats.current_win_streak > 0 ? `🔥 ${stats.current_win_streak} active` : 'in a row'}
              color="#f59e0b"
            />
          </div>

          {/* Favorite Room */}
          {stats.favorite_room && (
            <div style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 12, padding: '12px 16px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>⭐</span>
                <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Favorite Room</span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>{ROOM_LABELS[normalizeRoomType(stats.favorite_room)] || normalizeRoomType(stats.favorite_room)}</span>
            </div>
          )}

          {/* Recent Games (wins + losses) */}
          {(stats.recent_games?.length > 0 || stats.recent_wins?.length > 0) && (
            <div style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Recent Games</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(stats.recent_games ?? stats.recent_wins.map(w => ({ ...w, won: true, finished_at: w.won_at }))).map((g, i) => {
                  const label = ROOM_LABELS[normalizeRoomType(g.room_type)] || normalizeRoomType(g.room_type);
                  const date = g.finished_at ? new Date(g.finished_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
                  const pnl = g.won ? `+${g.prize_pool.toLocaleString()}` : `-${g.bet_amount.toLocaleString()}`;
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: g.won ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)', borderRadius: 8, border: `1px solid ${g.won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>{g.won ? '🏆' : '💀'}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>{label}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>{date}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: g.won ? '#22c55e' : '#ef4444' }}>{pnl}</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>bet {g.bet_amount.toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats.games_played === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: 13 }}>
              Play your first game to start building your stats!
            </div>
          )}
        </>
      )}

      {/* 4. Token Purchase History */}
      <TokenPurchaseHistory API={API} user={user} />
    </div>
  );
}

export default ProfileScreen;
