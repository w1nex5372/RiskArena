import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchArenaMatch, resolveArenaTimeout, submitArenaAction } from '../../api/arenaApi';
import { CLASS_INFO, getCharacterImage } from '../../utils/characters';

const MAX_ROUNDS = 20;

const MYTH_ACTIONS = [
  {
    value: 'attack',
    label: 'Attack',
    hint: '~20 dmg',
    emoji: '⚔️',
    style: {
      background: 'linear-gradient(135deg, #8b0000, #c0392b)',
      border: '1px solid #c9a84c',
      boxShadow: '0 4px 16px rgba(139,0,0,0.5)',
    },
  },
  {
    value: 'defend',
    label: 'Defend',
    hint: 'Reduces incoming dmg',
    emoji: '🛡️',
    style: {
      background: 'linear-gradient(135deg, #1a3a5c, #2471a3)',
      border: '1px solid #4a90d9',
      boxShadow: '0 4px 16px rgba(74,144,217,0.4)',
    },
  },
  {
    value: 'ability',
    label: 'Ability',
    hint: 'Power strike (1× per match)',
    emoji: '⚡',
    style: {
      background: 'linear-gradient(135deg, #4a235a, #7d3c98)',
      border: '1px solid #ffd700',
      boxShadow: '0 4px 20px rgba(255,215,0,0.35)',
    },
    spentStyle: {
      background: 'linear-gradient(135deg, #1e1e1e, #2a2a2a)',
      border: '1px solid #334155',
      boxShadow: 'none',
    },
  },
  {
    value: 'risk',
    label: 'Risk',
    hint: '50% — 35 dmg OR −15 HP',
    emoji: '🎲',
    style: {
      background: 'linear-gradient(135deg, #1a1a2e, #2c2c54)',
      border: '1px solid #c9a84c',
      boxShadow: '0 4px 16px rgba(201,168,76,0.3)',
    },
  },
];

const clampHp = (value) => Math.max(0, Math.min(150, Number(value) || 0));

function getRound(match) {
  return (match?.rounds || []).find((r) => Number(r.round_number) === Number(match.round_number));
}

function getLastResolvedRound(match) {
  return [...(match?.rounds || [])].reverse().find((r) => r.status === 'resolved');
}

function hasSubmitted(match, userId) {
  return (match?.actions || []).some(
    (a) => String(a.user_id) === String(userId) && Number(a.round_number) === Number(match.round_number)
  );
}

function getSecondsLeft(deadlineAt) {
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000));
}

function getHpColor(hp) {
  if (hp > 60) return '#22c55e';
  if (hp > 30) return '#f59e0b';
  return '#ef4444';
}

function HpBar({ hp, maxHp = 100, label }) {
  const clamped = clampHp(hp);
  const pct = Math.max(0, Math.min(100, Math.round((clamped / maxHp) * 100)));
  const color = getHpColor(pct);
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color }}>{clamped} HP</span>
        </div>
      )}
      <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
        <div
          className={pct <= 30 ? 'hp-pulse' : ''}
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 99,
            transition: 'width 0.6s ease, background 0.3s ease',
            boxShadow: `0 0 8px ${color}80`,
          }}
        />
      </div>
    </div>
  );
}

function DamageFloat({ amount, action }) {
  const color =
    action === 'ability' ? '#4a90d9'
    : action === 'risk'    ? '#c9a84c'
    : action === 'self'    ? '#ef4444'
    : '#ef4444';
  const emoji =
    action === 'ability' ? '⚡'
    : action === 'risk'    ? '🎲'
    : action === 'self'    ? '💀'
    : '⚔️';
  const sign = action === 'self' ? '+' : '-';
  return (
    <div className="arena-damage-float" style={{ color, top: 10 }}>
      {sign}{amount} {emoji}
    </div>
  );
}

function GoldParticles() {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: 18 }).map((_, i) => (
        <div
          key={i}
          className="arena-gold-particle"
          style={{
            left: `${5 + Math.random() * 90}%`,
            top: `-${Math.random() * 10}%`,
            animationDuration: `${1.5 + Math.random() * 2}s`,
            animationDelay: `${Math.random() * 1}s`,
            width: `${4 + Math.random() * 6}px`,
            height: `${4 + Math.random() * 6}px`,
            background: Math.random() > 0.5 ? '#ffd700' : '#c9a84c',
          }}
        />
      ))}
    </div>
  );
}

export default function ArenaScreen({ user, matchId, roomContext, onExit, onMatchUpdate, socket }) {
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(!!matchId);
  const [error, setError] = useState('');
  const [submittingAction, setSubmittingAction] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [roundBannerData, setRoundBannerData] = useState(null);

  // Animation state
  const [damageFloats, setDamageFloats] = useState([]);
  const [shakePlayer, setShakePlayer] = useState(false);
  const [shakeOpponent, setShakeOpponent] = useState(false);
  const [flashColor, setFlashColor] = useState(null);
  const [glowPlayer, setGlowPlayer] = useState(false);
  const prevLastRoundIdRef = useRef(null);
  const bannerTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(bannerTimerRef.current), []);

  const loadMatch = async ({ silent = false } = {}) => {
    if (!matchId) return;
    if (!silent) setLoading(true);
    try {
      const response = await fetchArenaMatch(matchId);
      setMatch(response.data);
      onMatchUpdate?.(response.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Arena match unavailable');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { loadMatch(); }, [matchId]);

  useEffect(() => {
    if (!matchId || match?.status === 'finished' || match?.status === 'draw') return;
    const interval = setInterval(() => loadMatch({ silent: true }), 1500);
    return () => clearInterval(interval);
  }, [matchId, match?.status]);

  const currentRound = useMemo(() => getRound(match), [match]);
  const lastResolvedRound = useMemo(() => getLastResolvedRound(match), [match]);
  const userIsPlayerOne = match && String(match.player_one_id) === String(user?.id);
  const userHp = match ? (userIsPlayerOne ? match.player_one_hp : match.player_two_hp) : 100;
  const enemyHp = match ? (userIsPlayerOne ? match.player_two_hp : match.player_one_hp) : 100;
  const userSubmitted = match ? hasSubmitted(match, user?.id) : false;
  const roundActions = (match?.actions || []).filter((a) => Number(a.round_number) === Number(match?.round_number));
  const enemySubmitted = match ? roundActions.length > (userSubmitted ? 1 : 0) : false;
  const isFinished = match?.status === 'finished' || match?.status === 'draw';
  const didWin = match?.winner_user_id && String(match.winner_user_id) === String(user?.id);
  const didDraw = match?.status === 'draw';
  const phase = !matchId ? 'entry' : loading ? 'loading' : error ? 'error' : isFinished ? 'finished' : userSubmitted ? 'submitted' : 'active';
  const userAbilityUsed = match ? (userIsPlayerOne ? match.player_one_ability_used : match.player_two_ability_used) : false;

  useEffect(() => {
    const update = () => setSecondsLeft(getSecondsLeft(currentRound?.deadline_at));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [currentRound?.deadline_at]);

  useEffect(() => {
    if (!currentRound?.deadline_at || phase !== 'active') return;
    if (secondsLeft !== 0) return;
    resolveArenaTimeout(matchId).then((r) => {
      setMatch(r.data);
      onMatchUpdate?.(r.data);
    }).catch(() => {});
  }, [secondsLeft, phase, currentRound?.deadline_at, matchId]);

  useEffect(() => {
    if (!socket || !matchId) return;
    const onUpdate = (d) => {
      if (d.arena_match_id === matchId || d.match_id === matchId) loadMatch({ silent: true });
    };
    socket.on('match_update', onUpdate);
    socket.on('arena_match_finished', onUpdate);
    return () => { socket.off('match_update', onUpdate); socket.off('arena_match_finished', onUpdate); };
  }, [socket, matchId]);

  // Damage float / animation trigger on round resolution
  useEffect(() => {
    if (!lastResolvedRound || lastResolvedRound.id === prevLastRoundIdRef.current) return;
    prevLastRoundIdRef.current = lastResolvedRound.id;

    const rd = lastResolvedRound.resolution_details || {};
    const myDmgDealt   = userIsPlayerOne ? (rd.player_one_damage_dealt  || 0) : (rd.player_two_damage_dealt  || 0);
    const enemyDmgDealt= userIsPlayerOne ? (rd.player_two_damage_dealt  || 0) : (rd.player_one_damage_dealt  || 0);
    const mySelfDmg    = userIsPlayerOne ? (rd.player_one_self_damage   || 0) : (rd.player_two_self_damage   || 0);
    const myAct        = userIsPlayerOne ? lastResolvedRound.player_one_action : lastResolvedRound.player_two_action;
    const myAbilityUsedNow = userIsPlayerOne ? rd.player_one_ability_used_now : rd.player_two_ability_used_now;

    const floats = [];

    if (myDmgDealt > 0) {
      setShakeOpponent(true);
      setTimeout(() => setShakeOpponent(false), 450);
      const f = { id: Date.now(), target: 'opponent', amount: myDmgDealt, action: myAct };
      floats.push(f);
    }
    if (enemyDmgDealt > 0) {
      setShakePlayer(true);
      setTimeout(() => setShakePlayer(false), 450);
      const f = { id: Date.now() + 1, target: 'player', amount: enemyDmgDealt, action: 'attack' };
      floats.push(f);
    }
    if (mySelfDmg > 0) {
      setFlashColor('red');
      setTimeout(() => setFlashColor(null), 350);
      floats.push({ id: Date.now() + 2, target: 'player', amount: mySelfDmg, action: 'self' });
    }
    if (myAct === 'risk' && myDmgDealt >= 35) {
      setFlashColor('gold');
      setTimeout(() => setFlashColor(null), 350);
    }
    if (myAbilityUsedNow) {
      setGlowPlayer(true);
      setTimeout(() => setGlowPlayer(false), 650);
    }

    if (floats.length > 0) {
      setDamageFloats((p) => [...p, ...floats]);
      setTimeout(() => {
        const ids = new Set(floats.map((f) => f.id));
        setDamageFloats((p) => p.filter((f) => !ids.has(f.id)));
      }, 950);
    }

    // ── Round-result banner ────────────────────────────────────────────────
    const enemyAct = userIsPlayerOne
      ? lastResolvedRound.player_two_action
      : lastResolvedRound.player_one_action;
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '?';
    let outcome = '';
    if (myDmgDealt > 0 && mySelfDmg > 0) {
      outcome = `dealt ${myDmgDealt}, lost ${mySelfDmg} HP`;
    } else if (myDmgDealt > 0) {
      outcome = `dealt ${myDmgDealt} dmg`;
    } else if (mySelfDmg > 0) {
      outcome = `lost ${mySelfDmg} HP`;
    } else if (enemyDmgDealt > 0) {
      outcome = `blocked (took ${enemyDmgDealt})`;
    } else {
      outcome = 'blocked!';
    }
    setRoundBannerData({
      round: lastResolvedRound.round_number,
      myAction: cap(myAct),
      enemyAction: cap(enemyAct),
      outcome,
    });
    clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setRoundBannerData(null), 2500);
  }, [lastResolvedRound?.id]);

  const handleSubmit = async (action) => {
    if (!match || !user?.id || userSubmitted || submittingAction) return;
    setSelectedAction(action);
    setSubmittingAction(action);
    try {
      const response = await submitArenaAction({
        matchId: match.id,
        userId: user.id,
        roundNumber: match.round_number,
        action,
      });
      setMatch(response.data);
      onMatchUpdate?.(response.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not submit action');
    } finally {
      setSubmittingAction('');
    }
  };

  const userClass = user?.class_name || 'warrior';
  const userInfo = CLASS_INFO[userClass] || CLASS_INFO.warrior;
  const userImgSrc = getCharacterImage(userClass);
  const opponentImgSrc = getCharacterImage('warrior'); // default until we surface opponent class

  // ── Entry (no match) ──────────────────────────────────────────────────────
  if (phase === 'entry') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #0a0a1a, #16213e)',
        borderRadius: 20, border: '1px solid rgba(201,168,76,0.25)',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚔️</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#c9a84c', margin: '0 0 8px' }}>Bronze Arena</h2>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
          Join the Bronze room from the Home tab to enter a 1v1 duel.
        </p>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #0a0a1a, #16213e)',
        borderRadius: 20, border: '1px solid rgba(201,168,76,0.25)',
        padding: 40, textAlign: 'center',
      }}>
        <Loader2 style={{ width: 32, height: 32, color: '#c9a84c', margin: '0 auto 12px', display: 'block' }} className="animate-spin" />
        <p style={{ color: '#94a3b8', fontWeight: 700 }}>Entering the arena...</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #0a0a1a, #16213e)',
        borderRadius: 20, border: '1px solid rgba(139,0,0,0.4)',
        padding: 24,
      }}>
        <p style={{ color: '#ef4444', fontWeight: 800, marginBottom: 12 }}>{error}</p>
        <button
          onClick={() => loadMatch()}
          style={{ width: '100%', padding: 12, borderRadius: 10, background: '#8b0000', border: '1px solid #c9a84c', color: 'white', fontWeight: 800, cursor: 'pointer' }}
        >
          Retry
        </button>
        {onExit && (
          <button
            onClick={onExit}
            style={{ width: '100%', marginTop: 8, padding: 12, borderRadius: 10, background: 'transparent', border: '1px solid #334155', color: '#94a3b8', fontWeight: 700, cursor: 'pointer' }}
          >
            Back to rooms
          </button>
        )}
      </div>
    );
  }

  // ── Finished ──────────────────────────────────────────────────────────────
  if (phase === 'finished') {
    const payout = match?.payout_amount || 0;
    const myXpData = match?.metadata?.xp_results?.[String(user?.id)];
    const xpGained = myXpData?.xp_gained || 0;

    if (didWin) {
      return (
        <div style={{
          position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(180deg, #0a0a1a 0%, #1a2a0a 50%, #0a0a1a 100%)',
          border: '2px solid #c9a84c',
          borderRadius: 20, padding: '32px 20px', textAlign: 'center',
          boxShadow: '0 0 40px rgba(201,168,76,0.4)',
        }}>
          <GoldParticles />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#c9a84c', letterSpacing: '0.2em', marginBottom: 8 }}>
              ⚔️ VICTORY ⚔️
            </div>
            <img
              src={userImgSrc}
              alt={userInfo.name}
              className="arena-victory-glow"
              style={{ height: 160, objectFit: 'contain', margin: '0 auto 16px', display: 'block' }}
            />
            <div style={{ fontSize: 32, fontWeight: 900, color: '#ffd700', textShadow: '0 0 20px rgba(255,215,0,0.6)', marginBottom: 16 }}>
              VICTORY
            </div>
            <div style={{
              display: 'inline-flex', gap: 16, background: 'rgba(201,168,76,0.12)',
              border: '1px solid rgba(201,168,76,0.3)', borderRadius: 12, padding: '12px 24px', marginBottom: 20,
            }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#ffd700' }}>+{payout.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>coins</div>
              </div>
              {xpGained > 0 && (
                <>
                  <div style={{ width: 1, background: 'rgba(201,168,76,0.3)' }} />
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#60a5fa' }}>+{xpGained}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>XP</div>
                  </div>
                </>
              )}
            </div>
            {onExit && (
              <button
                onClick={onExit}
                style={{ width: '100%', padding: 14, borderRadius: 12, background: 'linear-gradient(135deg, #8b0000, #c0392b)', border: '1px solid #c9a84c', color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 0 20px rgba(139,0,0,0.5)' }}
              >
                Back to Rooms
              </button>
            )}
          </div>
        </div>
      );
    }

    // Draw or Loss
    return (
      <div style={{
        background: didDraw
          ? 'linear-gradient(135deg, #0a0a1a, #1a1a2e)'
          : 'linear-gradient(135deg, #0a0008, #1a0008)',
        border: `1px solid ${didDraw ? 'rgba(74,144,217,0.3)' : 'rgba(139,0,0,0.5)'}`,
        borderRadius: 20, padding: '32px 20px', textAlign: 'center',
        filter: 'saturate(0.7)',
      }}>
        <img
          src={userImgSrc}
          alt={userInfo.name}
          style={{ height: 120, objectFit: 'contain', margin: '0 auto 16px', display: 'block', opacity: 0.7 }}
        />
        <div style={{ fontSize: 28, fontWeight: 900, color: didDraw ? '#4a90d9' : '#8b0000', marginBottom: 12 }}>
          {didDraw ? 'DRAW' : 'DEFEATED'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444', marginBottom: 8 }}>
          {didDraw
            ? `Refund: ${match?.metadata?.payout?.refund_each || match?.stake_amount || 0} coins`
            : `-${match?.stake_amount || 0} coins`}
        </div>
        {xpGained > 0 && (
          <div style={{ fontSize: 13, color: '#60a5fa', marginBottom: 16 }}>+{xpGained} XP</div>
        )}
        {onExit && (
          <button
            onClick={onExit}
            style={{ width: '100%', padding: 14, borderRadius: 12, background: 'linear-gradient(135deg, #1a3a5c, #2471a3)', border: '1px solid #4a90d9', color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer', animation: 'arenaWaiting 2s ease-in-out infinite' }}
          >
            🔄 Rematch
          </button>
        )}
        {onExit && (
          <button
            onClick={onExit}
            style={{ width: '100%', marginTop: 8, padding: 12, borderRadius: 12, background: 'transparent', border: '1px solid #334155', color: '#64748b', fontWeight: 700, cursor: 'pointer' }}
          >
            Back to Rooms
          </button>
        )}
      </div>
    );
  }

  // ── Active / Submitted ────────────────────────────────────────────────────
  const lastMyAction   = lastResolvedRound ? (userIsPlayerOne ? lastResolvedRound.player_one_action : lastResolvedRound.player_two_action) : null;
  const lastRd         = lastResolvedRound?.resolution_details || {};
  const lastMyDmg      = userIsPlayerOne ? (lastRd.player_one_damage_dealt || 0) : (lastRd.player_two_damage_dealt || 0);
  const lastEnemyDmg   = userIsPlayerOne ? (lastRd.player_two_damage_dealt || 0) : (lastRd.player_one_damage_dealt || 0);

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0a0a1a 0%, #16213e 40%, #0a0a1a 100%)',
      borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(201,168,76,0.2)',
      maxWidth: 480, margin: '0 auto',
      position: 'relative',
    }}>
      {/* Screen flash overlay */}
      {flashColor === 'red'  && <div className="arena-flash-red" />}
      {flashColor === 'gold' && <div className="arena-flash-gold" />}

      {/* Top bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #8b0000, #c9a84c, #4a90d9, #c9a84c, #8b0000)' }} />

      {/* ── OPPONENT SECTION ──────────────────────────────────────── */}
      <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
        {/* Opponent info row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: '0.08em' }}>OPPONENT</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
            {clampHp(enemyHp)} HP
          </div>
        </div>

        {/* Opponent character + damage floats */}
        <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', height: 160, marginBottom: 8 }}>
          <img
            src={opponentImgSrc}
            alt="Opponent"
            className={shakeOpponent ? 'arena-shake-flip' : ''}
            style={{
              height: '100%',
              objectFit: 'contain',
              transform: 'scaleX(-1)',
              filter: 'drop-shadow(0 0 12px rgba(139,0,0,0.4))',
              transition: 'filter 0.3s ease',
            }}
          />
          {damageFloats.filter((f) => f.target === 'opponent').map((f) => (
            <DamageFloat key={f.id} amount={f.amount} action={f.action} />
          ))}
        </div>

        <HpBar hp={enemyHp} label={null} />
      </div>

      {/* ── ROUND INFO BANNER ─────────────────────────────────────── */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid rgba(201,168,76,0.1)',
        display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#c9a84c' }}>
            ⚔️ Round {match.round_number} / {MAX_ROUNDS}
          </span>
          <span
            className={secondsLeft <= 5 ? 'timer-urgent' : ''}
            style={{ fontSize: 13, fontWeight: 700, color: secondsLeft <= 10 ? '#f87171' : '#94a3b8' }}
          >
            ⏱ {secondsLeft}s
          </span>
        </div>
        {lastResolvedRound && lastMyAction && (
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Last: You {lastMyAction}d
            {lastMyDmg > 0 ? ` — dealt ${lastMyDmg} dmg` : ''}
            {lastEnemyDmg > 0 ? ` — took ${lastEnemyDmg} dmg` : ''}
          </div>
        )}
      </div>

      {/* ── PLAYER SECTION ────────────────────────────────────────── */}
      <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
        {/* Player character + damage floats */}
        <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', height: 160, marginBottom: 8 }}>
          <img
            src={userImgSrc}
            alt={userInfo.name}
            className={[
              shakePlayer ? 'arena-shake' : '',
              glowPlayer  ? 'arena-glow-char' : '',
              userSubmitted && !isFinished ? 'arena-idle-pulse' : '',
            ].filter(Boolean).join(' ')}
            style={{
              height: '100%',
              objectFit: 'contain',
              filter: `drop-shadow(0 0 12px ${userInfo.glow})`,
              transition: 'filter 0.3s ease',
            }}
          />
          {damageFloats.filter((f) => f.target === 'player').map((f) => (
            <DamageFloat key={f.id} amount={f.amount} action={f.action} />
          ))}
        </div>

        <HpBar hp={userHp} label={null} />

        {/* Player info row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: userInfo.color, fontWeight: 700 }}>
            {userInfo.icon} {userInfo.name} — YOU
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
            {clampHp(userHp)} HP
          </div>
        </div>
      </div>

      {/* ── WAITING MESSAGE ───────────────────────────────────────── */}
      {userSubmitted && !isFinished && (
        <div style={{
          margin: '12px 16px 0',
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(74,144,217,0.1)',
          border: '1px solid rgba(74,144,217,0.25)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span className="arena-waiting-pulse" style={{ fontSize: 16 }}>⚡</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#4a90d9' }}>Waiting for opponent...</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {enemySubmitted ? 'Both ready — resolving...' : 'Opponent is choosing'}
            </div>
          </div>
        </div>
      )}

      {/* ── ACTION BUTTONS ────────────────────────────────────────── */}
      {!isFinished && (
        <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {MYTH_ACTIONS.map((action) => {
            const isAbility = action.value === 'ability';
            const spent = isAbility && userAbilityUsed;
            const btnStyle = spent ? action.spentStyle : action.style;
            const disabled = userSubmitted || !!submittingAction;
            return (
              <button
                key={action.value}
                disabled={disabled}
                onClick={() => !spent && handleSubmit(action.value)}
                style={{
                  ...btnStyle,
                  borderRadius: 14,
                  padding: '14px 8px',
                  color: spent ? '#475569' : 'white',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: spent ? 'not-allowed' : disabled ? 'not-allowed' : 'pointer',
                  opacity: spent ? 0.35 : disabled ? 0.4 : 1,
                  pointerEvents: spent ? 'none' : undefined,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  transition: 'opacity 0.2s ease',
                  position: 'relative',
                }}
              >
                {submittingAction === action.value ? (
                  <Loader2 style={{ width: 22, height: 22 }} className="animate-spin" />
                ) : (
                  <span style={{ fontSize: 22 }}>{action.emoji}</span>
                )}
                <span>{action.label}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: spent ? '#f87171' : 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                  {spent ? 'USED' : action.hint}
                </span>
                {selectedAction === action.value && !userSubmitted && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 14,
                    border: '2px solid rgba(255,255,255,0.5)', pointerEvents: 'none',
                  }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Error inline */}
      {error && (
        <div style={{ margin: '0 16px 12px', padding: '8px 12px', borderRadius: 8, background: 'rgba(139,0,0,0.2)', border: '1px solid rgba(139,0,0,0.4)', color: '#ef4444', fontSize: 12, fontWeight: 700 }}>
          {error}
        </div>
      )}

      {/* ── Round-result banner (fixed bottom) ───────────────────────────── */}
      {roundBannerData && (
        <div
          key={roundBannerData.round}
          className="round-result-banner"
          style={{
            position: 'fixed',
            bottom: 72,
            left: '50%',
            zIndex: 200,
            maxWidth: 460,
            width: 'calc(100% - 32px)',
            background: 'rgba(10,10,26,0.92)',
            border: '1px solid rgba(201,168,76,0.4)',
            borderRadius: 14,
            padding: '10px 18px',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>
            Round {roundBannerData.round}
            <span style={{ color: '#c9a84c' }}> • </span>
            {'You: '}
            <span style={{ color: '#c9a84c' }}>{roundBannerData.myAction}</span>
            <span style={{ color: '#475569' }}> vs </span>
            {'Opp: '}
            <span style={{ color: '#94a3b8' }}>{roundBannerData.enemyAction}</span>
          </span>
          {roundBannerData.outcome && (
            <span style={{ fontSize: 11, color: '#c9a84c', display: 'block', marginTop: 3 }}>
              → {roundBannerData.outcome}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
