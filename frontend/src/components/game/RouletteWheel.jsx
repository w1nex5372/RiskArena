import React from 'react';
import { Trophy } from 'lucide-react';
import { Button } from '../ui/button';

function RouletteWheel({ players, winner, onComplete, currentUser }) {
  const canvasRef = React.useRef(null);
  const wheelDivRef = React.useRef(null);
  const rotRef = React.useRef(0);
  const targetRotRef = React.useRef(null);
  const animatingRef = React.useRef(true);
  const rafRef = React.useRef(null);
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [showResult, setShowResult] = React.useState(false);

  // Vibrant segment colors
  const COLORS = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#06b6d4','#f97316','#ec4899'];

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

  // Draw wheel — segments + tick marks, no player names inside
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || playerData.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const cx = W / 2, cy = W / 2, R = W / 2 - 10;
    ctx.clearRect(0, 0, W, W);

    // Segments
    playerData.forEach(p => {
      const startRad = (p.startDeg * Math.PI) / 180;
      const endRad = ((p.startDeg + p.angleDeg) * Math.PI) / 180;
      const midRad = (startRad + endRad) / 2;

      // Radial gradient per segment
      const grd = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      grd.addColorStop(0, p.color + 'dd');
      grd.addColorStop(1, p.color + '88');

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, startRad, endRad);
      ctx.closePath();
      ctx.fillStyle = grd;
      ctx.fill();

      // Segment border
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Percentage label — only if segment is big enough
      if (p.angleDeg > 22) {
        const lr = R * 0.66;
        ctx.save();
        ctx.translate(cx + lr * Math.cos(midRad), cy + lr * Math.sin(midRad));
        ctx.rotate(midRad + Math.PI / 2);
        // White text shadow
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

    // Tick marks on outer edge
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

    // Outer rim
    ctx.beginPath();
    ctx.arc(cx, cy, R + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Inner decorative ring
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(168,85,247,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [playerData]);

  // Wheel rotates, pointer is fixed at top (270° in canvas coords)
  // For midDeg to land under top pointer: wheelRot = (270 - midDeg) mod 360
  React.useEffect(() => {
    if (winner && targetRotRef.current === null && playerData.length > 0) {
      const idx = playerData.findIndex(p =>
        String(p.user_id) === String(winner.user_id)
      );
      const i = idx >= 0 ? idx : 0;
      const midDeg = playerData[i].startDeg + playerData[i].angleDeg / 2;
      const wheelTargetMod = ((270 - midDeg) % 360 + 360) % 360;
      const currentMod = rotRef.current % 360;
      const delta = ((wheelTargetMod - currentMod) + 360) % 360;
      targetRotRef.current = rotRef.current + 360 * 5 + (delta === 0 ? 360 : delta);
    }
  }, [winner, playerData]);

  // Safety fallback
  React.useEffect(() => {
    const safeguard = setTimeout(() => {
      if (animatingRef.current) {
        animatingRef.current = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onCompleteRef.current();
      }
    }, 15000);
    return () => clearTimeout(safeguard);
  }, []);

  // Animation loop
  React.useEffect(() => {
    animatingRef.current = true;
    const animate = () => {
      if (!animatingRef.current) return;
      if (targetRotRef.current !== null) {
        const remaining = targetRotRef.current - rotRef.current;
        if (remaining <= 0.3) {
          rotRef.current = targetRotRef.current;
          if (wheelDivRef.current) {
            wheelDivRef.current.style.transform = `rotate(${rotRef.current}deg)`;
          }
          animatingRef.current = false;
          setTimeout(() => {
            setShowResult(true);
            setTimeout(() => onCompleteRef.current(), 3500);
          }, 300);
          return;
        }
        const speed = Math.max(0.2, Math.min(8, remaining / 25));
        rotRef.current += speed;
      } else {
        // Spin up gradually
        rotRef.current += Math.min(8, rotRef.current < 720 ? rotRef.current / 90 + 1 : 8);
      }
      if (wheelDivRef.current) {
        wheelDivRef.current.style.transform = `rotate(${rotRef.current}deg)`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      animatingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const isUserWinner = winner && currentUser &&
    String(currentUser.id) === String(winner.user_id);

  const WHEEL_SIZE = 240;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
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
            animation: `pulse ${1.5 + (i % 5) * 0.4}s ease-in-out infinite`,
            animationDelay: `${i * 0.12}s`
          }} />
        ))}
      </div>

      {/* Title */}
      <div className="z-10 mb-2 text-center">
        {showResult ? (
          <div>
            <h2 style={{
              fontSize: 24, fontWeight: 900, letterSpacing: '0.1em',
              background: 'linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.7))',
              animation: 'gradientShift 2s linear infinite',
            }}>🏆 WINNER!</h2>
          </div>
        ) : (
          <h2 style={{
            fontSize: 22, fontWeight: 900, letterSpacing: '0.18em',
            background: 'linear-gradient(90deg, #dc2626, #a855f7, #3b82f6, #a855f7, #dc2626)',
            backgroundSize: '300% auto',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            animation: 'gradientShift 2s linear infinite',
          }}>SPINNING...</h2>
        )}
      </div>

      {/* Wheel area */}
      <div className="relative z-10" style={{ width: WHEEL_SIZE + 20, height: WHEEL_SIZE + 20 }}>

        {/* Fixed top pointer (downward triangle) */}
        <div style={{
          position: 'absolute',
          top: 2,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          width: 0, height: 0,
          borderLeft: '11px solid transparent',
          borderRight: '11px solid transparent',
          borderTop: '24px solid #dc2626',
          filter: 'drop-shadow(0 2px 8px rgba(220,38,38,1)) drop-shadow(0 0 4px rgba(220,38,38,0.6))',
        }} />

        {/* Outer glow ring (static) */}
        <div style={{
          position: 'absolute',
          inset: 6,
          borderRadius: '50%',
          boxShadow: showResult
            ? '0 0 70px rgba(245,158,11,0.6), 0 0 140px rgba(245,158,11,0.2), inset 0 0 40px rgba(245,158,11,0.1)'
            : '0 0 50px rgba(124,58,237,0.5), 0 0 100px rgba(124,58,237,0.2)',
          transition: 'box-shadow 0.6s ease',
          pointerEvents: 'none',
        }} />

        {/* Rotating wheel canvas */}
        <div ref={wheelDivRef} style={{
          position: 'absolute',
          top: 10, left: 10,
          width: WHEEL_SIZE, height: WHEEL_SIZE,
          borderRadius: '50%',
          transformOrigin: '50% 50%',
          transform: 'rotate(0deg)',
        }}>
          <canvas ref={canvasRef} width={WHEEL_SIZE} height={WHEEL_SIZE}
            style={{ borderRadius: '50%', display: 'block', width: WHEEL_SIZE, height: WHEEL_SIZE }} />
        </div>

        {/* Center hub — static, does not rotate */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 20,
        }}>
          {/* Spinning conic ring */}
          <div style={{
            position: 'absolute',
            width: 60, height: 60, borderRadius: '50%',
            background: showResult
              ? 'conic-gradient(from 0deg, #f59e0b, #fbbf24, #f59e0b, #fbbf24, #f59e0b)'
              : 'conic-gradient(from 0deg, #dc2626, #a855f7, #3b82f6, #a855f7, #dc2626)',
            animation: 'spin 2s linear infinite',
          }} />
          {/* White separator ring */}
          <div style={{
            position: 'absolute',
            width: 52, height: 52, borderRadius: '50%',
            background: '#111',
          }} />
          {/* Inner hub face */}
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: 'radial-gradient(circle at 38% 32%, #2d1b69, #0d0d1a)',
            boxShadow: '0 0 16px rgba(124,58,237,0.9), inset 0 0 12px rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
            zIndex: 2,
          }}>
            {showResult && winner?.photo_url ? (
              <img src={winner.photo_url} alt="w"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={e => { e.target.style.display = 'none'; }} />
            ) : showResult && winner ? (
              <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: 18, lineHeight: 1 }}>
                {(winner.first_name || '?').charAt(0).toUpperCase()}
              </span>
            ) : (
              // Pulsing dot while spinning
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                background: 'radial-gradient(circle, #c084fc, #7c3aed)',
                boxShadow: '0 0 12px rgba(192,132,252,1)',
                animation: 'pulse 0.8s ease-in-out infinite',
              }} />
            )}
          </div>
        </div>
      </div>

      {/* Result text */}
      <div className="mt-4 text-center z-10 px-6" style={{ minHeight: 64 }}>
        {showResult && winner ? (
          <div>
            <p style={{
              fontSize: 19, fontWeight: 900,
              color: isUserWinner ? '#4ade80' : '#fbbf24',
              textShadow: isUserWinner ? '0 0 24px rgba(74,222,128,0.9)' : '0 0 24px rgba(251,191,36,0.9)',
              animation: 'pulse 0.6s ease-in-out infinite alternate',
            }}>
              {isUserWinner ? '🎉 You Won!' : currentUser ? '😔 You Lost!' : `🏆 ${winner.first_name} wins!`}
            </p>
            <p style={{ color: isUserWinner ? '#86efac' : '#94a3b8', fontSize: 13, marginTop: 6 }}>
              {isUserWinner ? 'Prize is being processed.' : currentUser ? `🏆 ${winner.first_name} wins! Better luck next time 🍀` : 'Better luck next spin! 🍀'}
            </p>
          </div>
        ) : (
          <p style={{ color: '#a78bfa', fontSize: 13, letterSpacing: '0.06em', animation: 'pulse 1.4s ease-in-out infinite' }}>
            Determining the winner...
          </p>
        )}
      </div>

      {/* Players list */}
      <div className="mt-1 w-full max-w-xs px-4 z-10">
        <div style={{
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(10px)',
          borderRadius: 14,
          padding: '10px 14px',
          border: '1px solid rgba(124,58,237,0.25)',
        }}>
          <p style={{ color: '#9333ea', fontSize: 10, textAlign: 'center', marginBottom: 10, fontWeight: 700, letterSpacing: '0.18em' }}>PLAYERS</p>
          {playerData.map((p, i) => {
            const isWinner = showResult && winner &&
              String(winner.user_id) === String(p.user_id);
            const isYou = currentUser && String(currentUser.id) === String(p.user_id);
            return (
              <div key={p.user_id || i} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0',
                opacity: showResult && !isWinner ? 0.35 : 1,
                transition: 'opacity 0.5s ease',
              }}>
                <div style={{
                  width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: p.color,
                  boxShadow: `0 0 ${isWinner ? 10 : 5}px ${p.color}`,
                  transition: 'box-shadow 0.4s',
                }} />
                <span style={{
                  color: isWinner ? '#fbbf24' : '#e2e8f0',
                  fontSize: 13, flex: 1,
                  fontWeight: isWinner ? 700 : 400,
                  transition: 'color 0.4s',
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
    </div>
  );
}

export default RouletteWheel;
