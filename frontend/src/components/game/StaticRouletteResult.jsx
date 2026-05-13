import React from 'react';

function StaticRouletteResult({ players, winner, currentUser, onClose, missedCount }) {
  const canvasRef = React.useRef(null);
  const COLORS = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#06b6d4','#f97316','#ec4899'];
  const WHEEL_SIZE = 270;

  const playerData = React.useMemo(() => {
    if (!players || players.length === 0) return [];
    const totalBets = players.reduce((sum, p) => sum + (Number(p.bet_amount) || 1), 0);
    let cum = 0;
    return players.map((p, i) => {
      const bet = Number(p.bet_amount) || 1;
      const angleDeg = (bet / totalBets) * 360;
      const start = cum;
      cum += angleDeg;
      return { ...p, bet, pct: ((bet / totalBets) * 100).toFixed(1), angleDeg, startDeg: start, color: COLORS[i % COLORS.length] };
    });
  }, [players]);

  // Calculate final rotation: winner segment midpoint lands at top (270°)
  const finalRot = React.useMemo(() => {
    if (!winner || playerData.length === 0) return 0;
    const idx = playerData.findIndex(p => String(p.user_id) === String(winner.user_id));
    const i = idx >= 0 ? idx : 0;
    const midDeg = playerData[i].startDeg + playerData[i].angleDeg / 2;
    return ((270 - midDeg) % 360 + 360) % 360;
  }, [winner, playerData]);

  // Draw wheel on canvas
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || playerData.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const cx = W / 2, cy = W / 2, R = W / 2 - 10;
    ctx.clearRect(0, 0, W, W);
    playerData.forEach(p => {
      const startRad = (p.startDeg * Math.PI) / 180;
      const endRad = ((p.startDeg + p.angleDeg) * Math.PI) / 180;
      const midRad = (startRad + endRad) / 2;
      const grd = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      grd.addColorStop(0, p.color + 'dd');
      grd.addColorStop(1, p.color + '88');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, startRad, endRad);
      ctx.closePath();
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (p.angleDeg > 22) {
        const lr = R * 0.66;
        ctx.save();
        ctx.translate(cx + lr * Math.cos(midRad), cy + lr * Math.sin(midRad));
        ctx.rotate(midRad + Math.PI / 2);
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = 'bold 12px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.pct + '%', 0, 0);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    });
    const tickCount = 48;
    for (let t = 0; t < tickCount; t++) {
      const angle = (t / tickCount) * Math.PI * 2;
      const isLong = t % 4 === 0;
      const outer = R + 2;
      const inner = outer - (isLong ? 8 : 4);
      ctx.beginPath();
      ctx.moveTo(cx + outer * Math.cos(angle), cy + outer * Math.sin(angle));
      ctx.lineTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
      ctx.strokeStyle = isLong ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = isLong ? 2 : 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [playerData]);

  const isUserWinner = winner && currentUser && String(currentUser.id) === String(winner.user_id);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-y-auto"
      style={{ background: 'radial-gradient(ellipse at center, #1a0a2e 0%, #0a0a14 60%, #000 100%)' }}>

      {/* Starfield */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(40)].map((_, i) => (
          <div key={i} className="absolute rounded-full" style={{
            width: i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1,
            height: i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1,
            background: i % 5 === 0 ? '#a855f7' : 'white',
            left: `${(i * 37 + 11) % 100}%`,
            top: `${(i * 53 + 7) % 100}%`,
            opacity: 0.1 + (i % 6) * 0.07,
          }} />
        ))}
      </div>

      {/* Close button */}
      <button onClick={onClose}
        className="absolute top-3 right-3 z-50 w-9 h-9 flex items-center justify-center rounded-full bg-slate-700/80 hover:bg-slate-600 text-white transition-colors"
      >✕</button>

      {/* Offline badge + counter */}
      <div className="z-10 mb-3 flex items-center gap-2 flex-wrap justify-center px-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/90 border border-slate-600 text-slate-300 text-xs font-medium">
          📵 You were offline — here's what happened
        </div>
        {missedCount > 1 && (
          <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-purple-800/80 border border-purple-500 text-purple-200 text-xs font-bold">
            {missedCount} missed
          </div>
        )}
      </div>

      {/* Title */}
      <div className="z-10 mb-4 text-center">
        <h2 style={{
          fontSize: 24, fontWeight: 900, letterSpacing: '0.1em',
          background: 'linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)',
          backgroundSize: '200% auto',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.7))',
        }}>🏆 WINNER!</h2>
      </div>

      {/* Wheel area - static at final position */}
      <div className="relative z-10" style={{ width: WHEEL_SIZE + 20, height: WHEEL_SIZE + 20 }}>
        {/* Top pointer */}
        <div style={{
          position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          width: 0, height: 0,
          borderLeft: '11px solid transparent', borderRight: '11px solid transparent',
          borderTop: '24px solid #dc2626',
          filter: 'drop-shadow(0 2px 8px rgba(220,38,38,1))',
        }} />
        {/* Gold glow ring */}
        <div style={{
          position: 'absolute', inset: 6, borderRadius: '50%',
          boxShadow: '0 0 70px rgba(245,158,11,0.6), 0 0 140px rgba(245,158,11,0.2)',
          pointerEvents: 'none',
        }} />
        {/* Wheel canvas - rotated to final position */}
        <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', transform: `rotate(${finalRot}deg)` }}>
          <canvas ref={canvasRef} width={WHEEL_SIZE} height={WHEEL_SIZE}
            style={{ borderRadius: '50%', display: 'block', width: '100%', height: '100%' }} />
        </div>
        {/* Center hub */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 20,
        }}>
          <div style={{
            position: 'absolute', width: 60, height: 60, borderRadius: '50%',
            background: 'conic-gradient(from 0deg, #f59e0b, #fbbf24, #f59e0b, #fbbf24, #f59e0b)',
            animation: 'spin 2s linear infinite',
          }} />
          <div style={{ position: 'absolute', width: 52, height: 52, borderRadius: '50%', background: '#111' }} />
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: 'radial-gradient(circle at 38% 32%, #2d1b69, #0d0d1a)',
            boxShadow: '0 0 16px rgba(124,58,237,0.9), inset 0 0 12px rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', position: 'relative', zIndex: 2,
          }}>
            {winner?.photo_url ? (
              <img src={winner.photo_url} alt="w"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: 18 }}>
                {(winner?.first_name || '?').charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Result text */}
      <div className="mt-4 text-center z-10 px-6">
        <p style={{
          fontSize: 19, fontWeight: 900,
          color: isUserWinner ? '#4ade80' : '#fbbf24',
          textShadow: isUserWinner ? '0 0 24px rgba(74,222,128,0.9)' : '0 0 24px rgba(251,191,36,0.9)',
        }}>
          {isUserWinner ? '🎉 You Won!' : '😔 You Lost!'}
        </p>
        <p style={{ color: isUserWinner ? '#86efac' : '#94a3b8', fontSize: 13, marginTop: 6 }}>
          {isUserWinner ? 'Prize is being processed.' : `🏆 ${winner?.first_name || 'Anonymous'} wins! Better luck next time 🍀`}
        </p>
      </div>

      {/* Players list */}
      <div className="mt-3 w-full max-w-xs px-4 z-10">
        <div style={{
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)',
          borderRadius: 14, padding: '10px 14px',
          border: '1px solid rgba(124,58,237,0.25)',
        }}>
          <p style={{ color: '#9333ea', fontSize: 10, textAlign: 'center', marginBottom: 10, fontWeight: 700, letterSpacing: '0.18em' }}>PLAYERS</p>
          {playerData.map((p, i) => {
            const isWinner = winner && String(winner.user_id) === String(p.user_id);
            const isYou = currentUser && String(currentUser.id) === String(p.user_id);
            return (
              <div key={p.user_id || i} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0',
                opacity: !isWinner ? 0.35 : 1,
              }}>
                <div style={{
                  width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: p.color, boxShadow: `0 0 ${isWinner ? 10 : 5}px ${p.color}`,
                }} />
                <span style={{
                  color: isWinner ? '#fbbf24' : '#e2e8f0', fontSize: 13, flex: 1,
                  fontWeight: isWinner ? 700 : 400,
                }} className="truncate">
                  {p.first_name || 'Player'}{p.last_name ? ` ${p.last_name}` : ''}
                  {isYou && <span style={{ color: '#60a5fa', fontSize: 10, marginLeft: 5 }}>(you)</span>}
                  {isWinner && <span style={{ marginLeft: 6 }}>👑</span>}
                </span>
                <span style={{ color: p.color, fontSize: 12, fontWeight: 700 }}>{p.pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Close / Next button */}
      <div className="mt-5 mb-6 z-10 w-full max-w-xs px-4">
        <button onClick={onClose}
          className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
        >
          {missedCount > 1 ? `Next (${missedCount - 1} more) →` : '🎮 Play Again'}
        </button>
      </div>
    </div>
  );
}

export default StaticRouletteResult;
