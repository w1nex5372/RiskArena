import { useEffect, useState } from 'react';
import { Coins, Plus } from 'lucide-react';
import apiClient from '../../api/client';

const PROGRESS_TTL = 60_000;

function getCachedProgress() {
  try {
    const raw = localStorage.getItem('user_progress');
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < PROGRESS_TTL) return data;
  } catch {}
  return null;
}

function setCachedProgress(data) {
  try {
    localStorage.setItem('user_progress', JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export default function TopBar({ isMobile, user, isConnected, userPrizes, onBuyTokens, onOpenItems }) {
  const [progress, setProgress] = useState(() => getCachedProgress());

  useEffect(() => {
    const cached = getCachedProgress();
    if (cached) { setProgress(cached); return; }
    apiClient.get('/me/progress').then((res) => {
      setProgress(res.data);
      setCachedProgress(res.data);
    }).catch(() => {});
  }, []);

  const level = progress?.level || user?.level || 1;
  const xp = progress?.xp || 0;
  const xpToNext = progress?.xp_to_next_level || 100;
  const xpPct = Math.min(100, Math.round((xp / (xp + xpToNext)) * 100));
  const initials = (user?.first_name || user?.telegram_username || '?').charAt(0).toUpperCase();

  return (
    <header style={{
      background: 'rgba(26,26,46,0.95)',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(201,168,76,0.25)',
      padding: '12px 16px 10px',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      width: '100%',
      boxSizing: 'border-box',
    }}>

      {/* ROW 1 — Avatar + Username | Coins + Buy */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 10 }}>

        {/* Left: avatar + username */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            overflow: 'hidden',
            border: '2px solid rgba(201,168,76,0.6)',
            boxShadow: '0 0 12px rgba(201,168,76,0.25)',
          }}>
            {user?.photo_url ? (
              <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(135deg,#8b0000,#c9a84c)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 800, fontSize: 17,
              }}>
                {initials}
              </div>
            )}
          </div>
          <span style={{
            color: 'white', fontWeight: 700, fontSize: 16,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {user?.first_name || user?.telegram_username || 'Player'}
          </span>
        </div>

        {/* Right: coins + buy button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Coins style={{ width: 18, height: 18, color: '#f59e0b' }} />
            <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 16 }}>
              {(user?.token_balance || 0).toLocaleString()}
            </span>
          </div>
          <button
            onClick={onBuyTokens}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg,#8b0000,#c0392b)',
              border: 'none', color: 'white', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 10px rgba(139,0,0,0.4)', flexShrink: 0,
            }}
          >
            <Plus style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>

      {/* ROW 2 — Level + XP bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ color: '#c9a84c', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          Lv.{level}
        </span>
        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${xpPct}%`,
            background: 'linear-gradient(90deg,#8b0000,#c9a84c)',
            borderRadius: 999, transition: 'width 0.6s ease',
          }} />
        </div>
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: isConnected ? '#22c55e' : '#ef4444',
          boxShadow: isConnected ? '0 0 5px rgba(34,197,94,0.7)' : '0 0 5px rgba(239,68,68,0.7)',
        }} />
      </div>
    </header>
  );
}
