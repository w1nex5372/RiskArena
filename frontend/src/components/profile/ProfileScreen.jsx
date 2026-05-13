import React from 'react';
import TokenPurchaseHistory from '../shop/TokenPurchaseHistory';
import { ROOM_LABELS, normalizeRoomType } from '../../utils/constants';
import apiClient from '../../api/client';
import { CLASS_INFO, getCharacterImage } from '../../utils/characters';

const PROGRESS_TTL = 60_000;

function ClassSelection({ user, onClassChange }) {
  const [selected, setSelected] = React.useState(user?.class_name || null);
  const [saving, setSaving] = React.useState(null);

  const select = async (className) => {
    if (saving) return;
    setSaving(className);
    try {
      await apiClient.post('/me/class', { class_name: className });
      setSelected(className);
      onClassChange?.(className);
    } catch (e) {
      // silently ignore
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 16, padding: '16px', marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: '#c9a84c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        Your Class
      </div>
      {!selected && (
        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 10, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.25)' }}>
          Choose your class to enter the Arena
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {Object.entries(CLASS_INFO).map(([key, info]) => {
          const isActive = selected === key;
          const isSaving = saving === key;
          return (
            <button
              key={key}
              onClick={() => select(key)}
              disabled={!!saving}
              style={{
                padding: '12px 6px',
                borderRadius: 12,
                border: isActive ? '2px solid #c9a84c' : '1px solid rgba(255,255,255,0.08)',
                background: isActive ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.03)',
                boxShadow: isActive ? '0 0 20px rgba(201,168,76,0.5)' : 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving && !isSaving ? 0.6 : 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                transition: 'all 0.2s ease',
              }}
            >
              <img
                src={getCharacterImage(key)}
                alt={info.name}
                style={{
                  height: 64, width: 64, objectFit: 'contain',
                  filter: isActive
                    ? `drop-shadow(0 0 10px ${info.glow})`
                    : 'grayscale(0.5) brightness(0.8)',
                  transition: 'filter 0.3s ease',
                }}
              />
              <div style={{ fontSize: 13, fontWeight: 800, color: isActive ? info.color : 'white' }}>
                {info.icon} {info.name}
              </div>
              <div style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic', lineHeight: 1.2 }}>
                {info.title}
              </div>
              {info.bonuses.map((b, i) => (
                <div key={i} style={{ fontSize: 9, color: isActive ? '#94a3b8' : '#475569', lineHeight: 1.3 }}>
                  {b}
                </div>
              ))}
              {isSaving ? (
                <div style={{ fontSize: 10, color: '#c9a84c', fontWeight: 700 }}>Saving...</div>
              ) : isActive ? (
                <div style={{ fontSize: 10, color: '#c9a84c', fontWeight: 800 }}>SELECTED ✓</div>
              ) : (
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>Select</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileScreen({ API, user, onUserUpdate }) {
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState(null);
  const [progressLoading, setProgressLoading] = React.useState(true);
  const [userClass, setUserClass] = React.useState(user?.class_name || null);

  // FIX 1 (was line 32): replaced raw axios with apiClient
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

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '—';

  const winRatePct = stats?.win_rate ?? 0;
  const isProfit = (stats?.net_profit ?? 0) >= 0;

  const StatCard = ({ label, value, sub, color }) => (
    <div style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || 'white', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: '0 4px 24px', maxWidth: 480, margin: '0 auto' }}>

      {/* Avatar + Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'linear-gradient(135deg, rgba(26,26,46,0.95) 0%, rgba(22,33,62,0.95) 100%)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 16, padding: '18px 16px', marginBottom: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(201,168,76,0.08)' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '2px solid rgba(201,168,76,0.6)', background: 'linear-gradient(135deg,#8b0000,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: 'white', boxShadow: '0 0 12px rgba(201,168,76,0.25)' }}>
          {user?.photo_url
            ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (user?.first_name?.charAt(0) || '?')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.first_name || 'Player'} {user?.last_name || ''}
          </div>
          {user?.telegram_username && (
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>@{user.telegram_username}</div>
          )}
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Member since {memberSince}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Balance</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b' }}>{(user?.token_balance || 0).toLocaleString()}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>tokens</div>
        </div>
      </div>

      {/* Stats section — independent of XP */}
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
            <StatCard label="Games Played" value={stats.games_played.toLocaleString()} />
            <StatCard label="Games Won" value={stats.games_won.toLocaleString()} color="#22c55e" />
            <StatCard label="Total Wagered" value={stats.total_wagered.toLocaleString()} sub="tokens bet" />
            <StatCard label="Total Won" value={stats.total_won.toLocaleString()} sub="tokens earned" color="#f59e0b" />
            <StatCard
              label="Net Profit / Loss"
              value={(isProfit ? '+' : '') + stats.net_profit.toLocaleString()}
              color={isProfit ? '#22c55e' : '#ef4444'}
            />
            <StatCard label="Biggest Win" value={stats.biggest_win.toLocaleString()} sub="single game" color="#a78bfa" />
            <StatCard label="Biggest Loss" value={stats.biggest_loss ? stats.biggest_loss.toLocaleString() : '0'} sub="single game" color="#ef4444" />
            <StatCard
              label="Best Win Streak"
              value={stats.best_win_streak ?? 0}
              sub={stats.current_win_streak > 0 ? `🔥 ${stats.current_win_streak} active` : 'in a row'}
              color="#f59e0b"
            />
          </div>

          {/* Favorite Room */}
          {stats.favorite_room && (
            <div style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 12, padding: '12px 16px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Favorite Room</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>{ROOM_LABELS[normalizeRoomType(stats.favorite_room)] || normalizeRoomType(stats.favorite_room)}</span>
            </div>
          )}

          {/* Recent Wins */}
          {stats.recent_wins?.length > 0 && (
            <div style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Recent Wins</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.recent_wins.map((w, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'rgba(34,197,94,0.07)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.15)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>{ROOM_LABELS[normalizeRoomType(w.room_type)] || normalizeRoomType(w.room_type)}</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{w.won_at ? new Date(w.won_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#22c55e' }}>+{w.total_pool.toLocaleString()}</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>bet {w.bet_amount.toLocaleString()}</div>
                    </div>
                  </div>
                ))}
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

      {/* FIX 2: XP Progress — outside stats conditional, fetched independently */}
      {progressLoading ? (
        <div style={{ background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.1)', borderRadius: 14, height: 76, marginBottom: 10 }} />
      ) : progress ? (
        <div style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 14, padding: '16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Level {progress.level} → Level {progress.level + 1}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#c9a84c' }}>
              {(progress.xp || 0).toLocaleString()} XP
            </span>
          </div>
          <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, Math.round(((progress.xp || 0) / ((progress.xp || 0) + (progress.xp_to_next_level || 1))) * 100))}%`,
              background: 'linear-gradient(90deg,#8b0000,#c9a84c)',
              borderRadius: 99,
              transition: 'width 0.8s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#64748b' }}>
            <span>{(progress.xp || 0).toLocaleString()} earned</span>
            <span>{(progress.xp_to_next_level || 0).toLocaleString()} to next level</span>
          </div>
        </div>
      ) : null}

      {/* Class Selection */}
      <ClassSelection
        user={{ ...user, class_name: userClass }}
        onClassChange={(cls) => {
          setUserClass(cls);
          onUserUpdate?.({ class_name: cls });
        }}
      />

      {/* Token Purchase History */}
      <TokenPurchaseHistory API={API} user={user} />
    </div>
  );
}

export default ProfileScreen;
