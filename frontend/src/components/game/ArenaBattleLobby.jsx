import { useEffect, useRef, useState } from 'react';
import { CLASS_INFO, getCharacterImage } from '../../utils/characters';

function CharSlot({ player, isYou, hasOpponent }) {
  const info = CLASS_INFO[player?.class_name] || CLASS_INFO.warrior;
  const imgSrc = getCharacterImage(player?.class_name);
  const joined = isYou ? true : hasOpponent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {isYou ? 'YOU' : 'OPPONENT'}
      </div>

      <div style={{ position: 'relative', width: 120, height: 160 }}>
        <img
          src={imgSrc}
          alt={info.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter: joined
              ? `drop-shadow(0 0 15px ${info.glow})`
              : 'grayscale(1) brightness(0.25)',
            transition: 'filter 0.5s ease',
            transform: isYou ? 'none' : 'scaleX(-1)',
          }}
        />
        {!joined && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, fontWeight: 700,
          }}>
            <span style={{ fontSize: 24 }}>???</span>
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'white' }}>
          {isYou
            ? (player?.first_name || 'You')
            : joined
            ? (player?.first_name || 'Opponent')
            : '???'}
        </div>
        {joined && (
          <div style={{ fontSize: 12, color: info.color, fontWeight: 700 }}>
            {info.icon} {info.name}
          </div>
        )}
        {!isYou && !joined && (
          <div style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Waiting...</div>
        )}
        {player?.level && (
          <div style={{ fontSize: 11, color: '#64748b' }}>Lv.{player.level}</div>
        )}
      </div>
    </div>
  );
}

export default function ArenaBattleLobby({ lobbyData, players, user, setConfirmLeave, toast }) {
  const stakeAmount = lobbyData.bet_amount || 0;
  const prizePool = stakeAmount * 2;
  const opponent = players.find((p) => String(p.user_id) !== String(user?.id));
  const isReady = players.length >= 2;

  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isReady) {
      setCountdown(5);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev == null || prev <= 1) { clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setCountdown(null);
    }
    return () => clearInterval(timerRef.current);
  }, [isReady]);

  const userPlayer = { ...(user || {}), class_name: user?.class_name };
  const opponentPlayer = opponent ? { ...opponent } : null;

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0a0a1a 0%, #16213e 50%, #0a0a1a 100%)',
      border: '1px solid rgba(201,168,76,0.3)',
      borderRadius: 20,
      overflow: 'hidden',
      maxWidth: 480,
      margin: '0 auto',
    }}>
      {/* Top shimmer bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #8b0000, #c9a84c, #4a90d9, #c9a84c, #8b0000)' }} />

      {/* Header */}
      <div style={{ padding: '18px 20px 14px', textAlign: 'center', borderBottom: '1px solid rgba(201,168,76,0.15)' }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#c9a84c', letterSpacing: '0.08em' }}>
          ⚔️ BRONZE ARENA ⚔️
        </div>
        <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', marginTop: 3 }}>
          "The Gods are watching"
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>PRIZE POOL</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#ffd700' }}>
            {prizePool.toLocaleString()} coins
          </div>
        </div>
      </div>

      {/* VS layout */}
      <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'flex-start', gap: 0 }}>
        <CharSlot player={userPlayer} isYou hasOpponent={isReady} />

        {/* VS divider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 12px 0', flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#c9a84c', textShadow: '0 0 16px rgba(201,168,76,0.6)' }}>
            VS
          </div>
        </div>

        <CharSlot player={opponentPlayer} isYou={false} hasOpponent={isReady} />
      </div>

      {/* Status bar */}
      <div style={{
        margin: '0 16px 16px',
        borderRadius: 12,
        padding: '12px 16px',
        background: isReady ? 'rgba(34,197,94,0.1)' : 'rgba(201,168,76,0.08)',
        border: `1px solid ${isReady ? 'rgba(34,197,94,0.3)' : 'rgba(201,168,76,0.2)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}>
        {isReady ? (
          <>
            <span style={{ fontSize: 16 }}>⚔️</span>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>
                Battle starts in {countdown ?? '...'}s
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Both warriors are ready</div>
            </div>
          </>
        ) : (
          <>
            <span className="arena-waiting-pulse" style={{ fontSize: 16 }}>⏳</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#c9a84c' }}>
                Waiting for opponent...
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Your stake: {stakeAmount} coins</div>
            </div>
          </>
        )}
      </div>

      {/* Leave button */}
      <div style={{ padding: '0 16px 16px' }}>
        <button
          onClick={() => setConfirmLeave(true)}
          style={{
            width: '100%', padding: '10px', borderRadius: 10, border: '1px solid rgba(220,38,38,0.3)',
            background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}
        >
          Leave Arena
        </button>
      </div>
    </div>
  );
}
