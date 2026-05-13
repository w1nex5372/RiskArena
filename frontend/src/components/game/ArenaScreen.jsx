import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Shield, Sparkles, Sword } from 'lucide-react';
import { fetchArenaMatch, resolveArenaTimeout, submitArenaAction } from '../../api/arenaApi';
import { getCharacterImage, getClassInfo, normalizeCharacterClass } from '../../utils/characters';

const MAX_ROUNDS = 20;

const ACTIONS = [
  {
    value: 'attack',
    label: 'Attack',
    hint: '~20 dmg',
    emoji: '\u2694\uFE0F',
    style: {
      background: 'linear-gradient(135deg, #991b1b, #b91c1c)',
      border: '1px solid rgba(248,113,113,0.42)',
      boxShadow: '0 8px 18px rgba(127,29,29,0.35)',
    },
  },
  {
    value: 'defend',
    label: 'Defend',
    hint: 'Reduce damage',
    emoji: '\uD83D\uDEE1\uFE0F',
    style: {
      background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
      border: '1px solid rgba(96,165,250,0.4)',
      boxShadow: '0 8px 18px rgba(30,64,175,0.28)',
    },
  },
  {
    value: 'ability',
    label: 'Ability',
    hint: 'Single burst',
    emoji: '\u26A1',
    style: {
      background: 'linear-gradient(135deg, #4c1d95, #7c3aed)',
      border: '1px solid rgba(192,132,252,0.42)',
      boxShadow: '0 8px 18px rgba(91,33,182,0.3)',
    },
    spentStyle: {
      background: 'linear-gradient(135deg, #111827, #1f2937)',
      border: '1px solid rgba(71,85,105,0.45)',
      boxShadow: 'none',
    },
  },
  {
    value: 'risk',
    label: 'Risk',
    hint: '50% for 35 dmg',
    emoji: '\uD83C\uDFB2',
    style: {
      background: 'linear-gradient(135deg, #111827, #334155)',
      border: '1px solid rgba(201,168,76,0.38)',
      boxShadow: '0 8px 18px rgba(15,23,42,0.4)',
    },
  },
];

const LOADOUT_SLOTS = [
  { key: 'weapon', label: 'Weapon', Icon: Sword, color: '#60a5fa' },
  { key: 'ability', label: 'Ability', Icon: Sparkles, color: '#c084fc' },
  { key: 'armor', label: 'Armor', Icon: Shield, color: '#fbbf24' },
];

const clampHp = (value) => Math.max(0, Math.min(150, Number(value) || 0));

function getRound(match) {
  return (match?.rounds || []).find((round) => Number(round.round_number) === Number(match.round_number));
}

function getLastResolvedRound(match) {
  return [...(match?.rounds || [])].reverse().find((round) => round.status === 'resolved');
}

function hasSubmitted(match, userId) {
  return (match?.actions || []).some(
    (action) => String(action.user_id) === String(userId) && Number(action.round_number) === Number(match.round_number)
  );
}

function getSecondsLeft(deadlineAt) {
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000));
}

function getHpColor(hpPercent) {
  if (hpPercent > 60) return '#22c55e';
  if (hpPercent > 30) return '#f59e0b';
  return '#ef4444';
}

function getLoadoutSummary(player) {
  return LOADOUT_SLOTS.map((slot) => ({
    ...slot,
    value: player?.[slot.key]?.name || 'None',
  }));
}

function getPlayerClass(player, fallbackClass = null) {
  return normalizeCharacterClass(player?.class_name) || fallbackClass;
}

function getPlayerName(player, fallbackLabel) {
  if (!player) return fallbackLabel;
  if (player.is_anonymous) return player.first_name || 'Anonymous';
  return player.first_name || player.username || fallbackLabel;
}

function HpBar({ hp, maxHp = 100 }) {
  const clamped = clampHp(hp);
  const percent = Math.max(0, Math.min(100, Math.round((clamped / maxHp) * 100)));
  const color = getHpColor(percent);
  return (
    <div style={{ width: '100%' }}>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
        <div
          className={percent <= 30 ? 'hp-pulse' : ''}
          style={{
            height: '100%',
            width: `${percent}%`,
            background: color,
            borderRadius: 999,
            transition: 'width 0.6s ease, background 0.3s ease',
            boxShadow: `0 0 10px ${color}66`,
          }}
        />
      </div>
    </div>
  );
}

function DamageFloat({ amount, action }) {
  const color =
    action === 'ability' ? '#60a5fa'
      : action === 'risk' ? '#fbbf24'
        : action === 'self' ? '#f87171'
          : '#fca5a5';
  const emoji =
    action === 'ability' ? '\u26A1'
      : action === 'risk' ? '\uD83C\uDFB2'
        : action === 'self' ? '\u2620'
          : '\u2694\uFE0F';
  const sign = action === 'self' ? '-' : '-';

  return (
    <div className="arena-damage-float" style={{ color, top: 14 }}>
      {sign}{amount} {emoji}
    </div>
  );
}

function GoldParticles() {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: 18 }).map((_, index) => (
        <div
          key={index}
          className="arena-gold-particle"
          style={{
            left: `${5 + Math.random() * 90}%`,
            top: `-${Math.random() * 10}%`,
            animationDuration: `${1.5 + Math.random() * 2}s`,
            animationDelay: `${Math.random() * 1}s`,
            width: `${4 + Math.random() * 6}px`,
            height: `${4 + Math.random() * 6}px`,
            background: Math.random() > 0.5 ? '#fbbf24' : '#c9a84c',
          }}
        />
      ))}
    </div>
  );
}

function LoadoutChips({ player }) {
  const items = getLoadoutSummary(player);
  return (
    <div style={{ display: 'grid', gap: 6, width: '100%' }}>
      {items.map(({ key, label, value, Icon, color }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            minWidth: 0,
            borderRadius: 10,
            padding: '6px 8px',
            background: 'rgba(15,23,42,0.72)',
            border: '1px solid rgba(148,163,184,0.12)',
          }}
        >
          <Icon style={{ width: 12, height: 12, color, flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#e2e8f0',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function FighterPanel({
  label,
  player,
  hp,
  imgSrc,
  classInfo,
  mirror,
  damageFloats,
  shakeClassName,
  extraClassName,
  hpLabel,
}) {
  return (
    <div
      style={{
        padding: '14px 14px 12px',
        borderRadius: 18,
        background: 'rgba(15,23,42,0.84)',
        border: '1px solid rgba(148,163,184,0.14)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.14em' }}>{label}</div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: '#f8fafc',
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {getPlayerName(player, label)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: classInfo?.color || '#94a3b8', marginTop: 4 }}>
            {classInfo ? `${classInfo.icon} ${classInfo.name}` : 'Class pending'}
            {player?.level ? `  Lv.${player.level}` : ''}
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#f8fafc' }}>{clampHp(hp)} HP</div>
      </div>

      <div style={{ position: 'relative', height: 154, display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={classInfo?.name || label}
            className={[shakeClassName, extraClassName].filter(Boolean).join(' ')}
            style={{
              height: '100%',
              objectFit: 'contain',
              transform: mirror ? 'scaleX(-1)' : 'none',
              filter: classInfo ? `drop-shadow(0 0 16px ${classInfo.glow})` : 'none',
            }}
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 120,
              borderRadius: 14,
              background: 'linear-gradient(180deg, rgba(51,65,85,0.95) 0%, rgba(15,23,42,0.95) 100%)',
              border: '1px solid rgba(100,116,139,0.28)',
            }}
          />
        )}
        {damageFloats.map((float) => (
          <DamageFloat key={float.id} amount={float.amount} action={float.action} />
        ))}
      </div>

      <HpBar hp={hp} />
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginTop: 8 }}>{hpLabel}</div>
      <div style={{ marginTop: 10 }}>
        <LoadoutChips player={player} />
      </div>
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

  useEffect(() => {
    loadMatch();
  }, [matchId]);

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
  const roundActions = (match?.actions || []).filter((action) => Number(action.round_number) === Number(match?.round_number));
  const enemySubmitted = match ? roundActions.length > (userSubmitted ? 1 : 0) : false;
  const isFinished = match?.status === 'finished' || match?.status === 'draw';
  const didWin = Boolean(match?.winner_user_id) && String(match.winner_user_id) === String(user?.id);
  const didDraw = match?.status === 'draw';
  const phase = !matchId ? 'entry' : loading ? 'loading' : error ? 'error' : isFinished ? 'finished' : userSubmitted ? 'submitted' : 'active';
  const userAbilityUsed = match ? (userIsPlayerOne ? match.player_one_ability_used : match.player_two_ability_used) : false;

  useEffect(() => {
    const update = () => setSecondsLeft(getSecondsLeft(currentRound?.deadline_at));
    update();
    const intervalId = setInterval(update, 1000);
    return () => clearInterval(intervalId);
  }, [currentRound?.deadline_at]);

  useEffect(() => {
    if (!currentRound?.deadline_at || phase !== 'active' || secondsLeft !== 0) return;
    resolveArenaTimeout(matchId)
      .then((response) => {
        setMatch(response.data);
        onMatchUpdate?.(response.data);
      })
      .catch(() => {});
  }, [secondsLeft, phase, currentRound?.deadline_at, matchId]);

  useEffect(() => {
    if (!socket || !matchId) return;
    const onUpdate = (data) => {
      if (data.arena_match_id === matchId || data.match_id === matchId) {
        loadMatch({ silent: true });
      }
    };
    socket.on('match_update', onUpdate);
    socket.on('arena_match_finished', onUpdate);
    return () => {
      socket.off('match_update', onUpdate);
      socket.off('arena_match_finished', onUpdate);
    };
  }, [socket, matchId]);

  useEffect(() => {
    if (!lastResolvedRound || lastResolvedRound.id === prevLastRoundIdRef.current) return;
    prevLastRoundIdRef.current = lastResolvedRound.id;

    const details = lastResolvedRound.resolution_details || {};
    const myDamage = userIsPlayerOne ? (details.player_one_damage_dealt || 0) : (details.player_two_damage_dealt || 0);
    const enemyDamage = userIsPlayerOne ? (details.player_two_damage_dealt || 0) : (details.player_one_damage_dealt || 0);
    const mySelfDamage = userIsPlayerOne ? (details.player_one_self_damage || 0) : (details.player_two_self_damage || 0);
    const myAction = userIsPlayerOne ? lastResolvedRound.player_one_action : lastResolvedRound.player_two_action;
    const enemyAction = userIsPlayerOne ? lastResolvedRound.player_two_action : lastResolvedRound.player_one_action;
    const myAbilityUsedNow = userIsPlayerOne ? details.player_one_ability_used_now : details.player_two_ability_used_now;

    const floats = [];
    if (myDamage > 0) {
      setShakeOpponent(true);
      setTimeout(() => setShakeOpponent(false), 450);
      floats.push({ id: Date.now(), target: 'opponent', amount: myDamage, action: myAction });
    }
    if (enemyDamage > 0) {
      setShakePlayer(true);
      setTimeout(() => setShakePlayer(false), 450);
      floats.push({ id: Date.now() + 1, target: 'player', amount: enemyDamage, action: 'attack' });
    }
    if (mySelfDamage > 0) {
      setFlashColor('red');
      setTimeout(() => setFlashColor(null), 350);
      floats.push({ id: Date.now() + 2, target: 'player', amount: mySelfDamage, action: 'self' });
    }
    if (myAction === 'risk' && myDamage >= 35) {
      setFlashColor('gold');
      setTimeout(() => setFlashColor(null), 350);
    }
    if (myAbilityUsedNow) {
      setGlowPlayer(true);
      setTimeout(() => setGlowPlayer(false), 650);
    }

    if (floats.length > 0) {
      setDamageFloats((prev) => [...prev, ...floats]);
      setTimeout(() => {
        const ids = new Set(floats.map((float) => float.id));
        setDamageFloats((prev) => prev.filter((float) => !ids.has(float.id)));
      }, 950);
    }

    const capitalize = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '?';
    let outcome = 'blocked';
    if (myDamage > 0 && mySelfDamage > 0) {
      outcome = `dealt ${myDamage}, lost ${mySelfDamage} HP`;
    } else if (myDamage > 0) {
      outcome = `dealt ${myDamage} dmg`;
    } else if (mySelfDamage > 0) {
      outcome = `lost ${mySelfDamage} HP`;
    } else if (enemyDamage > 0) {
      outcome = `took ${enemyDamage} dmg`;
    }

    setRoundBannerData({
      round: lastResolvedRound.round_number,
      myAction: capitalize(myAction),
      enemyAction: capitalize(enemyAction),
      outcome,
    });

    clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setRoundBannerData(null), 2500);
  }, [lastResolvedRound?.id, userIsPlayerOne]);

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

  const roomPlayers = roomContext?.players || [];
  const roomUser = roomPlayers.find((player) => String(player.user_id) === String(user?.id)) || null;
  const roomOpponent = roomPlayers.find((player) => String(player.user_id) !== String(user?.id)) || null;

  const userPlayer = roomUser || {
    user_id: user?.id,
    first_name: user?.first_name,
    username: user?.username || user?.telegram_username,
    photo_url: user?.photo_url,
    class_name: user?.class_name,
    level: user?.level,
  };
  const opponentPlayer = roomOpponent || null;

  const userClass = getPlayerClass(userPlayer, 'warrior');
  const opponentClass = getPlayerClass(opponentPlayer, null);
  const userInfo = getClassInfo(userClass, 'warrior');
  const opponentInfo = getClassInfo(opponentClass, null);
  const userImgSrc = getCharacterImage(userClass, 'warrior');
  const opponentImgSrc = getCharacterImage(opponentClass, null);

  if (phase === 'entry') {
    return (
      <div
        style={{
          background: 'linear-gradient(135deg, #0b1220, #172554)',
          borderRadius: 20,
          border: '1px solid rgba(201,168,76,0.24)',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 42, marginBottom: 12 }}>\u2694\uFE0F</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#c9a84c', margin: '0 0 8px' }}>Bronze Arena</h2>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>
          Join the Bronze room from the Arena tab to enter a 1v1 duel.
        </p>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div
        style={{
          background: 'linear-gradient(135deg, #0b1220, #172554)',
          borderRadius: 20,
          border: '1px solid rgba(201,168,76,0.24)',
          padding: 40,
          textAlign: 'center',
        }}
      >
        <Loader2 style={{ width: 32, height: 32, color: '#c9a84c', margin: '0 auto 12px', display: 'block' }} className="animate-spin" />
        <p style={{ color: '#94a3b8', fontWeight: 700 }}>Entering the arena...</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div
        style={{
          background: 'linear-gradient(135deg, #0b1220, #172554)',
          borderRadius: 20,
          border: '1px solid rgba(127,29,29,0.55)',
          padding: 24,
        }}
      >
        <p style={{ color: '#f87171', fontWeight: 800, marginBottom: 12 }}>{error}</p>
        <button
          onClick={() => loadMatch()}
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 12,
            background: '#991b1b',
            border: '1px solid rgba(248,113,113,0.36)',
            color: 'white',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
        {onExit ? (
          <button
            onClick={onExit}
            style={{
              width: '100%',
              marginTop: 8,
              padding: 12,
              borderRadius: 12,
              background: 'transparent',
              border: '1px solid rgba(71,85,105,0.72)',
              color: '#94a3b8',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Back to rooms
          </button>
        ) : null}
      </div>
    );
  }

  if (phase === 'finished') {
    const payout = match?.payout_amount || 0;
    const myXpData = match?.metadata?.xp_results?.[String(user?.id)];
    const xpGained = myXpData?.xp_gained || 0;

    if (didWin) {
      return (
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(180deg, #0b1220 0%, #132a13 52%, #0b1220 100%)',
            border: '2px solid rgba(201,168,76,0.72)',
            borderRadius: 22,
            padding: '32px 20px',
            textAlign: 'center',
            boxShadow: '0 0 40px rgba(201,168,76,0.28)',
          }}
        >
          <GoldParticles />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#c9a84c', letterSpacing: '0.18em', marginBottom: 8, textTransform: 'uppercase' }}>
              Victory
            </div>
            <img
              src={userImgSrc}
              alt={userInfo?.name || 'You'}
              className="arena-victory-glow"
              style={{ height: 160, objectFit: 'contain', margin: '0 auto 16px', display: 'block' }}
            />
            <div style={{ fontSize: 32, fontWeight: 900, color: '#fbbf24', marginBottom: 16 }}>Match won</div>
            <div
              style={{
                display: 'inline-flex',
                gap: 16,
                background: 'rgba(201,168,76,0.12)',
                border: '1px solid rgba(201,168,76,0.28)',
                borderRadius: 14,
                padding: '12px 20px',
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#fbbf24' }}>+{payout.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>coins</div>
              </div>
              {xpGained > 0 ? (
                <>
                  <div style={{ width: 1, background: 'rgba(201,168,76,0.24)' }} />
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#60a5fa' }}>+{xpGained}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>XP</div>
                  </div>
                </>
              ) : null}
            </div>
            {onExit ? (
              <button
                onClick={onExit}
                style={{
                  width: '100%',
                  padding: 14,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #991b1b, #dc2626)',
                  border: '1px solid rgba(201,168,76,0.42)',
                  color: 'white',
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                Back to Rooms
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          background: didDraw ? 'linear-gradient(135deg, #0b1220, #172554)' : 'linear-gradient(135deg, #180b12, #3f0d12)',
          border: `1px solid ${didDraw ? 'rgba(96,165,250,0.28)' : 'rgba(248,113,113,0.32)'}`,
          borderRadius: 20,
          padding: '32px 20px',
          textAlign: 'center',
        }}
      >
        <img
          src={userImgSrc}
          alt={userInfo?.name || 'You'}
          style={{ height: 120, objectFit: 'contain', margin: '0 auto 16px', display: 'block', opacity: 0.72 }}
        />
        <div style={{ fontSize: 28, fontWeight: 900, color: didDraw ? '#60a5fa' : '#f87171', marginBottom: 12 }}>
          {didDraw ? 'Draw' : 'Defeated'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 8 }}>
          {didDraw
            ? `Refund: ${(match?.metadata?.payout?.refund_each || match?.stake_amount || 0).toLocaleString()} coins`
            : `-${(match?.stake_amount || 0).toLocaleString()} coins`}
        </div>
        {xpGained > 0 ? (
          <div style={{ fontSize: 13, color: '#60a5fa', marginBottom: 16 }}>+{xpGained} XP</div>
        ) : null}
        {onExit ? (
          <>
            <button
              onClick={onExit}
              style={{
                width: '100%',
                padding: 14,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                border: '1px solid rgba(96,165,250,0.36)',
                color: 'white',
                fontWeight: 800,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Rematch Queue
            </button>
            <button
              onClick={onExit}
              style={{
                width: '100%',
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                background: 'transparent',
                border: '1px solid rgba(71,85,105,0.72)',
                color: '#94a3b8',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Back to Rooms
            </button>
          </>
        ) : null}
      </div>
    );
  }

  const lastMyAction = lastResolvedRound ? (userIsPlayerOne ? lastResolvedRound.player_one_action : lastResolvedRound.player_two_action) : null;
  const lastDetails = lastResolvedRound?.resolution_details || {};
  const lastMyDamage = userIsPlayerOne ? (lastDetails.player_one_damage_dealt || 0) : (lastDetails.player_two_damage_dealt || 0);
  const lastEnemyDamage = userIsPlayerOne ? (lastDetails.player_two_damage_dealt || 0) : (lastDetails.player_one_damage_dealt || 0);

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #0b1220 0%, #111827 38%, #0b1220 100%)',
        borderRadius: 22,
        overflow: 'hidden',
        border: '1px solid rgba(201,168,76,0.2)',
        maxWidth: 540,
        margin: '0 auto',
        position: 'relative',
        boxShadow: '0 18px 40px rgba(2,6,23,0.35)',
      }}
    >
      {flashColor === 'red' ? <div className="arena-flash-red" /> : null}
      {flashColor === 'gold' ? <div className="arena-flash-gold" /> : null}

      <div style={{ height: 3, background: 'linear-gradient(90deg, #7f1d1d, #c9a84c, #2563eb, #c9a84c, #7f1d1d)' }} />

      <div
        style={{
          padding: '12px 14px',
          background: 'rgba(0,0,0,0.22)',
          borderBottom: '1px solid rgba(201,168,76,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: '#c9a84c', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Bronze Arena
          </div>
          <div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 800, marginTop: 4 }}>
            Round {match.round_number} / {MAX_ROUNDS}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={secondsLeft <= 5 ? 'timer-urgent' : ''} style={{ fontSize: 18, fontWeight: 900, color: secondsLeft <= 10 ? '#f87171' : '#e2e8f0' }}>
            {secondsLeft}s
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            {userSubmitted ? (enemySubmitted ? 'Resolving round' : 'Waiting on opponent') : 'Choose your move'}
          </div>
        </div>
      </div>

      <div style={{ padding: 14, display: 'grid', gap: 12 }}>
        <FighterPanel
          label="Opponent"
          player={opponentPlayer}
          hp={enemyHp}
          imgSrc={opponentImgSrc}
          classInfo={opponentInfo}
          mirror
          damageFloats={damageFloats.filter((float) => float.target === 'opponent')}
          shakeClassName={shakeOpponent ? 'arena-shake-flip' : ''}
          extraClassName=""
          hpLabel="Opponent state"
        />

        <FighterPanel
          label="You"
          player={userPlayer}
          hp={userHp}
          imgSrc={userImgSrc}
          classInfo={userInfo}
          mirror={false}
          damageFloats={damageFloats.filter((float) => float.target === 'player')}
          shakeClassName={shakePlayer ? 'arena-shake' : ''}
          extraClassName={[
            glowPlayer ? 'arena-glow-char' : '',
            userSubmitted && !isFinished ? 'arena-idle-pulse' : '',
          ].filter(Boolean).join(' ')}
          hpLabel="Your state"
        />
      </div>

      <div
        style={{
          margin: '0 14px 14px',
          borderRadius: 14,
          padding: '12px 14px',
          background: 'rgba(15,23,42,0.76)',
          border: '1px solid rgba(148,163,184,0.12)',
        }}
      >
        <div style={{ fontSize: 12, color: '#f8fafc', fontWeight: 700 }}>
          {lastResolvedRound && lastMyAction
            ? `Last round: ${lastMyAction}${lastMyDamage > 0 ? `, dealt ${lastMyDamage}` : ''}${lastEnemyDamage > 0 ? `, took ${lastEnemyDamage}` : ''}`
            : 'First round live. Action lock resets every round.'}
        </div>
      </div>

      {userSubmitted && !isFinished ? (
        <div
          style={{
            margin: '0 14px 14px',
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(37,99,235,0.12)',
            border: '1px solid rgba(96,165,250,0.24)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span className="arena-waiting-pulse" style={{ fontSize: 16 }}>\u26A1</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>Move locked in</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              {enemySubmitted ? 'Both players ready. Resolving...' : 'Opponent is still choosing.'}
            </div>
          </div>
        </div>
      ) : null}

      {!isFinished ? (
        <div style={{ padding: '0 14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {ACTIONS.map((action) => {
            const isAbility = action.value === 'ability';
            const spent = isAbility && userAbilityUsed;
            const disabled = userSubmitted || Boolean(submittingAction);
            const buttonStyle = spent ? action.spentStyle : action.style;

            return (
              <button
                key={action.value}
                disabled={disabled || spent}
                onClick={() => handleSubmit(action.value)}
                style={{
                  ...buttonStyle,
                  borderRadius: 16,
                  padding: '14px 8px',
                  color: spent ? '#64748b' : 'white',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: disabled || spent ? 'not-allowed' : 'pointer',
                  opacity: disabled && submittingAction !== action.value ? 0.5 : spent ? 0.45 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  position: 'relative',
                }}
              >
                {submittingAction === action.value ? (
                  <Loader2 style={{ width: 22, height: 22 }} className="animate-spin" />
                ) : (
                  <span style={{ fontSize: 22 }}>{action.emoji}</span>
                )}
                <span>{action.label}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: spent ? '#f87171' : 'rgba(255,255,255,0.68)' }}>
                  {spent ? 'Used' : action.hint}
                </span>
                {selectedAction === action.value && !userSubmitted ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 16,
                      border: '2px solid rgba(255,255,255,0.45)',
                      pointerEvents: 'none',
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            margin: '0 14px 14px',
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(127,29,29,0.18)',
            border: '1px solid rgba(248,113,113,0.24)',
            color: '#f87171',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {roundBannerData ? (
        <div
          key={roundBannerData.round}
          className="round-result-banner"
          style={{
            position: 'fixed',
            bottom: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            maxWidth: 460,
            width: 'calc(100% - 32px)',
            background: 'rgba(10,15,28,0.94)',
            border: '1px solid rgba(201,168,76,0.36)',
            borderRadius: 14,
            padding: '10px 18px',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>
            Round {roundBannerData.round}
            <span style={{ color: '#c9a84c' }}> | </span>
            You: <span style={{ color: '#c9a84c' }}>{roundBannerData.myAction}</span>
            <span style={{ color: '#64748b' }}> vs </span>
            Opp: <span style={{ color: '#94a3b8' }}>{roundBannerData.enemyAction}</span>
          </span>
          {roundBannerData.outcome ? (
            <span style={{ fontSize: 11, color: '#c9a84c', display: 'block', marginTop: 3 }}>
              {roundBannerData.outcome}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
