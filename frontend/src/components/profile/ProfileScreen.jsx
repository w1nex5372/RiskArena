import React from 'react';
import TokenPurchaseHistory from '../shop/TokenPurchaseHistory';
import { ROOM_LABELS, normalizeRoomType } from '../../utils/constants';
import apiClient from '../../api/client';

const PROGRESS_TTL = 60_000;

function ProfileScreen({ API, user, onUserUpdate }) {
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState(null);
  const [progressLoading, setProgressLoading] = React.useState(true);

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
