import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import { CLASS_INFO, normalizeCharacterClass } from '../../utils/characters';

const TABS = [
  { key: 'coins', label: 'Coins', icon: '🪙' },
  { key: 'wins', label: 'Wins', icon: '⚔️' },
  { key: 'level', label: 'Level', icon: '⭐' },
];

const PODIUM_META = [
  { pos: 2, crown: '🥈', height: 72, order: 0 },
  { pos: 1, crown: '👑', height: 88, order: 1 },
  { pos: 3, crown: '🥉', height: 60, order: 2 },
];

function getClassMeta(className) {
  const key = normalizeCharacterClass(className);
  return key ? CLASS_INFO[key] : null;
}

function Avatar({ photoUrl, name, size = 40, fontSize = 16 }) {
  const letter = (name || '?')[0].toUpperCase();
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={(e) => { e.target.style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #1e3a5f, #2d1b69)',
        border: '1px solid rgba(148,163,184,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 800,
        color: '#c9a84c',
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

function formatValue(player, tab) {
  if (tab === 'coins') return `${(player.token_balance || 0).toLocaleString()} 🪙`;
  if (tab === 'wins') return `${player.wins || 0} wins`;
  return `Lv.${player.level || 1} · ${(player.xp || 0).toLocaleString()} XP`;
}

function PodiumSlot({ player, meta, tab }) {
  const cls = getClassMeta(player?.class_name);
  const name = (player?.first_name || player?.telegram_username || 'Player').slice(0, 12);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        flex: 1,
      }}
    >
      <div style={{ fontSize: meta.pos === 1 ? 24 : 18 }}>{meta.crown}</div>
      <Avatar photoUrl={player?.photo_url} name={name} size={meta.pos === 1 ? 52 : 42} fontSize={meta.pos === 1 ? 20 : 16} />
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 700,
          color: '#f8fafc',
          maxWidth: 80,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
      {cls && (
        <div style={{ fontSize: 10, color: cls.color, fontWeight: 700 }}>
          {cls.icon} {cls.name}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: '#fbbf24',
          textAlign: 'center',
          padding: '3px 8px',
          borderRadius: 999,
          background: 'rgba(201,168,76,0.12)',
          border: '1px solid rgba(201,168,76,0.24)',
          marginTop: 2,
        }}
      >
        {player ? formatValue(player, tab) : '—'}
      </div>
      {/* Platform block */}
      <div
        style={{
          width: '100%',
          borderRadius: '8px 8px 0 0',
          background: meta.pos === 1
            ? 'linear-gradient(180deg, rgba(201,168,76,0.3), rgba(201,168,76,0.1))'
            : 'rgba(255,255,255,0.06)',
          border: `1px solid ${meta.pos === 1 ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.08)'}`,
          height: meta.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: meta.pos === 1 ? '#c9a84c' : '#475569',
          }}
        >
          {meta.pos}
        </span>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(15,23,42,0.4)',
        marginBottom: 4,
      }}
    >
      <div style={{ width: 24, height: 14, borderRadius: 4, background: 'rgba(148,163,184,0.15)', animation: 'pulse 1.4s ease-in-out infinite' }} />
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(148,163,184,0.15)', animation: 'pulse 1.4s ease-in-out infinite' }} />
      <div style={{ flex: 1, height: 14, borderRadius: 4, background: 'rgba(148,163,184,0.15)', animation: 'pulse 1.4s ease-in-out infinite' }} />
      <div style={{ width: 60, height: 14, borderRadius: 4, background: 'rgba(148,163,184,0.15)', animation: 'pulse 1.4s ease-in-out infinite' }} />
    </div>
  );
}

export default function LeaderboardScreen({ user }) {
  const [tab, setTab] = useState('coins');
  const [data, setData] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLeaderboard = (activeTab) => {
    setLoading(true);
    setError(null);
    apiClient.get('/leaderboard?tab=' + activeTab)
      .then((res) => { setData(res.data?.leaderboard || []); })
      .catch(() => { setError(true); })
      .finally(() => { setLoading(false); });
  };

  useEffect(() => { fetchLeaderboard(tab); }, [tab]);

  useEffect(() => {
    if (!user) return;
    apiClient.get('/leaderboard/my-rank')
      .then((res) => { setMyRank(res.data); })
      .catch(() => {});
  }, [user]);

  const podiumPlayers = data.slice(0, 3);
  const listPlayers = data.slice(3, 20);
  const currentUserId = String(user?.id || '');

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px 12px 32px', fontFamily: 'inherit' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(201,168,76,0.08) 0%, transparent 100%)',
          borderRadius: 16,
          padding: '16px 12px 12px',
          marginBottom: 18,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>🏆</div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 900,
            color: '#c9a84c',
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
          }}
        >
          LEADERBOARD
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, fontWeight: 600 }}>Season 1 Rankings</div>
        <div
          style={{
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.4), transparent)',
            margin: '12px 0 0',
          }}
        />
      </div>

      {/* My Rank banner */}
      {user && (
        <div
          style={{
            borderRadius: 14,
            padding: '12px 16px',
            background: 'rgba(201,168,76,0.08)',
            border: '1px solid rgba(201,168,76,0.2)',
            boxShadow: '0 0 20px rgba(201,168,76,0.08)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Your rank
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { icon: '🪙', value: myRank?.coins_rank },
              { icon: '⚔️', value: myRank?.wins_rank },
              { icon: '⭐', value: myRank?.level_rank },
            ].map(({ icon, value }) => (
              <div
                key={icon}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(15,23,42,0.7)',
                  border: '1px solid rgba(201,168,76,0.3)',
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#f8fafc',
                }}
              >
                <span>{icon}</span>
                <span style={{ color: '#c9a84c' }}>#{myRank ? value ?? '—' : '...'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div
        style={{
          display: 'flex',
          borderRadius: 12,
          background: 'rgba(15,23,42,0.6)',
          border: '1px solid rgba(148,163,184,0.14)',
          marginBottom: 20,
          overflow: 'hidden',
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: '10px 4px',
                border: 'none',
                borderBottom: active ? '2px solid #c9a84c' : '2px solid transparent',
                background: 'transparent',
                color: active ? '#c9a84c' : '#94a3b8',
                fontWeight: active ? 800 : 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'color 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div>
          {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ color: '#f87171', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
            Could not load leaderboard
          </div>
          <button
            onClick={() => fetchLeaderboard(tab)}
            style={{
              padding: '8px 20px',
              borderRadius: 10,
              border: '1px solid rgba(201,168,76,0.3)',
              background: 'rgba(201,168,76,0.1)',
              color: '#c9a84c',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '40px 0' }}>
          No players yet
        </div>
      )}

      {/* Podium */}
      {!loading && !error && podiumPlayers.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 20,
            padding: '16px 8px 0',
            background: 'rgba(15,23,42,0.5)',
            border: '1px solid rgba(148,163,184,0.1)',
            borderRadius: 18,
            position: 'relative',
            minHeight: 200,
          }}
        >
          {PODIUM_META.map((meta) => {
            const player = podiumPlayers[meta.pos - 1];
            return (
              <PodiumSlot key={meta.pos} player={player} meta={meta} tab={tab} />
            );
          })}
          {/* Podium base line */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.4), transparent)',
              borderRadius: '0 0 18px 18px',
            }}
          />
        </div>
      )}

      {/* Rank list (positions 4–20) */}
      {!loading && !error && listPlayers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {listPlayers.map((player, i) => {
            const rank = i + 4;
            const isMe = String(player.id) === currentUserId;
            const cls = getClassMeta(player.class_name);
            const name = player.first_name || player.telegram_username || 'Player';
            const even = i % 2 === 0;

            return (
              <div
                key={player.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: isMe ? '9px 12px 9px 9px' : '9px 12px',
                  borderRadius: 10,
                  background: isMe
                    ? 'rgba(201,168,76,0.1)'
                    : even
                    ? 'rgba(15,23,42,0.4)'
                    : 'transparent',
                  border: isMe ? '1px solid rgba(201,168,76,0.3)' : '1px solid transparent',
                  borderLeft: isMe ? '3px solid #c9a84c' : '1px solid transparent',
                }}
              >
                {/* Rank */}
                <div
                  style={{
                    width: 26,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {rank <= 10 ? (
                    <span
                      style={{
                        display: 'inline-block',
                        background: 'rgba(255,255,255,0.06)',
                        color: '#94a3b8',
                        borderRadius: 6,
                        padding: '2px 6px',
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {rank}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: '#64748b',
                      }}
                    >
                      {rank}
                    </span>
                  )}
                </div>

                {/* Avatar */}
                <Avatar photoUrl={player.photo_url} name={name} size={32} fontSize={13} />

                {/* Name + class */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: isMe ? '#fbbf24' : '#f8fafc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {name}
                  </div>
                  {cls && (
                    <div style={{ fontSize: 10, color: cls.color, fontWeight: 600, marginTop: 1 }}>
                      {cls.icon} {cls.name}
                    </div>
                  )}
                </div>

                {/* Value */}
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: '#94a3b8',
                    textAlign: 'right',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatValue(player, tab)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
