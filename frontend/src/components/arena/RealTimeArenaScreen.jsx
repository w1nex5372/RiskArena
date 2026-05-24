import React, { useCallback, useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import BattleScene from './scenes/BattleScene';
import { CLASS_INFO, CLASS_MODIFIERS } from '../../utils/characters';
import CharacterPortrait from './CharacterPortrait';
import apiClient from '../../api/client';
import WeaponIcon from '../WeaponIcon';

// Base arena stats (mirrors ArenaRoom.ts constants)
const BASE_HP        = { warrior: 150, mage: 100, rogue: 120 };
const BASE_ATK_MIN   = 15;
const BASE_ATK_MAX   = 25;
const ABILITY_DMG    = { warrior: 20, mage: 25, rogue: null };
const ABILITY_NAMES  = { warrior: 'Bash', mage: 'Fireball', rogue: 'Blink' };

const GAME_SERVER_URL = process.env.REACT_APP_GAME_SERVER_URL || (() => {
  const override = new URLSearchParams(window.location.search).get('gameServerUrl');
  if (override) return override;

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (window.location.protocol === 'https:' || !isLocal) {
    return `${proto}//${window.location.host}/colyseus`;
  }

  return `${proto}//${window.location.hostname}:2567`;
})();

// Game world dimensions
const GAME_W = 800;
const GAME_H = 420;

// ── Touch control helpers ─────────────────────────────────────────────────────
function TouchButton({ label, color, onDown, onUp, style = {} }) {
  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); onDown(); }}
      onPointerUp={(e) => { e.preventDefault(); onUp(); }}
      onPointerLeave={(e) => { e.preventDefault(); onUp(); }}
      onPointerCancel={(e) => { e.preventDefault(); onUp(); }}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: color,
        border: '2px solid rgba(255,255,255,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 24,
        color: 'white',
        fontWeight: 900,
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
        cursor: 'pointer',
        ...style,
      }}
    >
      {label}
    </div>
  );
}

// ── Ability button with SVG circular cooldown timer ──────────────────────────
const CLASS_COOLDOWNS = { warrior: 8000, mage: 6000, rogue: 5000 };

function AbilityButton({ abilityReady, playerClass, onActivate }) {
  const [progress, setProgress] = React.useState(0); // 0..1, 1 = cooldown done
  const rafRef = React.useRef(null);
  const startRef = React.useRef(null);

  React.useEffect(() => {
    if (!abilityReady) {
      // Start filling arc from 0 to 1
      const duration = CLASS_COOLDOWNS[playerClass] || 6000;
      startRef.current = Date.now();
      setProgress(0);

      const tick = () => {
        const p = Math.min((Date.now() - startRef.current) / duration, 1);
        setProgress(p);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
    }
  }, [abilityReady, playerClass]);

  const r = 27;
  const circ = 2 * Math.PI * r;
  const dash = circ * progress; // filled arc length

  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); if (abilityReady) onActivate(); }}
      onPointerUp={(e) => e.preventDefault()}
      onPointerLeave={(e) => e.preventDefault()}
      onPointerCancel={(e) => e.preventDefault()}
      style={{
        position: 'relative',
        width: 64, height: 64,
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: abilityReady ? 'pointer' : 'default',
        flexShrink: 0,
      }}
    >
      {/* SVG ring */}
      <svg
        width={64} height={64}
        style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}
      >
        {/* Track */}
        <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={5} />
        {/* Cooldown fill arc */}
        {!abilityReady && (
          <circle
            cx={32} cy={32} r={r}
            fill="none"
            stroke="rgba(147,51,234,0.85)"
            strokeWidth={5}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        )}
        {/* Ready flash ring */}
        {abilityReady && (
          <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(196,105,255,0.55)" strokeWidth={5} />
        )}
      </svg>

      {/* Inner circle button */}
      <div style={{
        position: 'absolute',
        inset: 5,
        borderRadius: '50%',
        background: abilityReady ? 'rgba(147,51,234,0.88)' : 'rgba(40,40,55,0.75)',
        border: '2px solid rgba(255,255,255,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        color: 'white',
        fontWeight: 900,
        boxShadow: abilityReady ? '0 0 12px rgba(147,51,234,0.6), 0 4px 14px rgba(0,0,0,0.5)' : '0 4px 14px rgba(0,0,0,0.5)',
        opacity: abilityReady ? 1 : 0.55,
        transition: 'background 0.25s, opacity 0.25s, box-shadow 0.25s',
      }}>
        {abilityReady ? '✨' : '⏳'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RealTimeArenaScreen({ user, onLeave }) {
  const containerRef = useRef(null);   // div that holds Phaser canvas
  const gameRef = useRef(null);        // Phaser.Game instance
  const sceneRef = useRef(null);       // BattleScene instance
  const roomRef = useRef(null);        // Colyseus room
  const inputRef = useRef({ left: false, right: false, attack: false, ability: false, up: false });
  const inputIntervalRef = useRef(null);
  const lastInputRef = useRef('');
  const roomActiveRef = useRef(false);
  const phaseRef = useRef('connecting');

  const [phase, setPhase] = useState('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);
  const [dotCount, setDotCount] = useState(1);
  const [abilityReady, setAbilityReady] = useState(true);
  const [playerClass, setPlayerClass] = useState('warrior');
  const [isPortrait, setIsPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [loadoutStats, setLoadoutStats] = useState({});
  const [equipped, setEquipped] = useState({ weapon: null, armor: null, ability: null });
  const [equippedSheetPath, setEquippedSheetPath] = useState('');
  const updatePhase = useCallback((p) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // ── Fetch equipped item bonuses ───────────────────────────────────────────
  useEffect(() => {
    apiClient.get('/me/equipped')
      .then(res => {
        setLoadoutStats(res.data?.loadout_effective_stats || {});
        setEquipped(res.data?.equipped || { weapon: null, armor: null, ability: null });
        setEquippedSheetPath(res.data?.battle_spritesheet_path || '');
      })
      .catch(() => {
        setLoadoutStats({});
        setEquipped({ weapon: null, armor: null, ability: null });
        setEquippedSheetPath('');
      });
  }, [user?.id]); // eslint-disable-line

  // ── 0. Telegram expand + orientation tracking ────────────────────────────
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const safeTelegramCall = (fn) => {
      try {
        fn?.();
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Telegram.WebApp] optional method ignored', err?.message || err);
        }
      }
    };

    if (tg) {
      safeTelegramCall(() => tg.expand?.());
      safeTelegramCall(() => tg.enableClosingConfirmation?.());
      safeTelegramCall(() => tg.requestFullscreen?.());
    }
    try {
      const lockResult = window.screen?.orientation?.lock?.('landscape');
      lockResult?.catch?.(() => {});
    } catch {
      // Orientation lock is best-effort only; desktop/local browsers often reject it.
    }

    const onResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    return () => {
      if (tg) {
        safeTelegramCall(() => tg.exitFullscreen?.());
        safeTelegramCall(() => tg.disableClosingConfirmation?.());
      }
      try {
        window.screen?.orientation?.unlock?.();
      } catch {
        // Ignore unsupported orientation APIs during cleanup.
      }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []); // eslint-disable-line

  // ── 1. Init Phaser once container is mounted ──────────────────────────────
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: GAME_W,
      height: GAME_H,
      backgroundColor: '#0d0d1a',
      scene: [BattleScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: false,
        pixelArt: false,
        powerPreference: 'low-power',
      },
      input: { keyboard: false },
    };

    try {
      gameRef.current = new Phaser.Game(config);

      // Wait for scene to be ready
      gameRef.current.events.once('ready', () => {
        sceneRef.current = gameRef.current.scene.getScene('BattleScene');
      });
    } catch (err) {
      console.error('Failed to initialize battle renderer', err);
      updatePhase('error');
      setErrorMsg(err?.message || 'Could not start battle renderer');
    }

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [updatePhase]);

  // ── 2. Connect to Colyseus ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Attempt to rejoin a dropped room using stored reconnect info
    async function tryReconnect(client) {
      try {
        const stored = JSON.parse(sessionStorage.getItem('arena_reconnect') || '{}');
        if (!stored.roomId || !stored.sessionId) throw new Error('no data');

        const room = await client.reconnect(stored.roomId, stored.sessionId);

        roomRef.current = room;
        roomActiveRef.current = true;
        updatePhase(room.state.phase || 'battle');

        // Re-wire Phaser scene
        if (sceneRef.current) {
          sceneRef.current.setRoom(room, room.sessionId);
        }

        // Re-sync ability button state after reconnect
        const myPlayer = room.state.players.get(room.sessionId);
        if (myPlayer) {
          setAbilityReady(myPlayer.abilityCharges > 0);
          setPlayerClass(myPlayer.characterClass || 'warrior');
          myPlayer.onChange(() => setAbilityReady(myPlayer.abilityCharges > 0));
        }

        // Re-wire state listener
        room.state.onChange(() => {
          const s = room.state;
          updatePhase(s.phase);

          if (s.phase === 'finished') {
            sessionStorage.removeItem('arena_reconnect');
            const isWinner = s.winnerId === room.sessionId;
            const opponentEntry = [...s.players.entries()].find(([sid]) => sid !== room.sessionId);
            const opponentName = opponentEntry?.[1]?.username || 'Opponent';
            setResult({ won: isWinner, opponentName });
          }
        });

        // After reconnect, a further unexpected leave just ends the match
        room.onLeave(() => {
          roomActiveRef.current = false;
          updatePhase('finished');
        });

      } catch {
        updatePhase('error');
        setErrorMsg('Reconnection failed — opponent wins by forfeit');
        sessionStorage.removeItem('arena_reconnect');
      }
    }

    async function connect() {
      try {
        const sessionToken = (() => {
          try { return JSON.parse(localStorage.getItem('casino_user') || '{}')?.session_token || ''; }
          catch { return ''; }
        })();

        const client = new Colyseus.Client(GAME_SERVER_URL);
        const room = await client.joinOrCreate('arena_room', {
          sessionToken,
          devUsername: user?.first_name || user?.username || 'Player',
        });

        if (cancelled) { room.leave(); return; }

        // Persist reconnect info immediately after a successful join
        sessionStorage.setItem('arena_reconnect', JSON.stringify({
          roomId: room.roomId,
          sessionId: room.sessionId,
        }));

        roomRef.current = room;
        roomActiveRef.current = true;
        updatePhase('waiting');

        // Track ability cooldown for button state
        room.state.players.onAdd((player, sid) => {
          if (sid === room.sessionId) {
            setPlayerClass(player.characterClass || 'warrior');
            player.onChange(() => setAbilityReady(player.abilityCharges > 0));
          }
        });

        // Wire Phaser scene once both are ready
        const tryWireScene = () => {
          if (sceneRef.current) {
            sceneRef.current.setRoom(room, room.sessionId);
          } else {
            setTimeout(tryWireScene, 100);
          }
        };
        tryWireScene();

        // Phase sync to React
        room.state.onChange(() => {
          const s = room.state;
          updatePhase(s.phase);

          if (s.phase === 'finished') {
            sessionStorage.removeItem('arena_reconnect');
            const isWinner = s.winnerId === room.sessionId;
            const opponentEntry = [...s.players.entries()].find(([sid]) => sid !== room.sessionId);
            const opponentName = opponentEntry?.[1]?.username || 'Opponent';
            setResult({ won: isWinner, opponentName });
          }
        });

        // Start sending input state at ~15fps
        inputIntervalRef.current = setInterval(() => {
          if (roomActiveRef.current && roomRef.current?.state?.phase === 'battle') {
            const str = JSON.stringify(inputRef.current);
            if (str !== lastInputRef.current) {
              roomRef.current?.send('input', inputRef.current);
              lastInputRef.current = str;
            }
          }
        }, 66);

        room.onLeave((code) => {
          roomActiveRef.current = false;
          // code 1000 = clean/consensual close; anything else is an unexpected drop
          if (!cancelled && code !== 1000 && phaseRef.current !== 'finished') {
            updatePhase('reconnecting');
            tryReconnect(client);
          } else if (!cancelled) {
            updatePhase('finished');
          }
        });

        room.onError((code, message) => {
          if (!cancelled) {
            updatePhase('error');
            setErrorMsg(`Connection error (${code}): ${message}`);
          }
        });

      } catch (err) {
        if (!cancelled) {
          updatePhase('error');
          setErrorMsg(err?.message || 'Could not connect to game server');
        }
      }
    }

    // React dev/StrictMode can mount, unmount, then mount effects again.
    // Delay the actual socket join so the first dev-only mount is cancelled
    // before Colyseus receives a duplicate player.
    const connectTimer = setTimeout(connect, 100);

    return () => {
      cancelled = true;
      clearTimeout(connectTimer);
      clearInterval(inputIntervalRef.current);
      if (roomRef.current) {
        roomRef.current.leave();
        roomRef.current = null;
      }
    };
  }, []); // eslint-disable-line

  // ── Animated dots for waiting phase ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting') return;
    const id = setInterval(() => setDotCount(d => d % 3 + 1), 500);
    return () => clearInterval(id);
  }, [phase]);

  // ── Input helpers ─────────────────────────────────────────────────────────
  const setKey = useCallback((key, value) => {
    const wasPressed = Boolean(inputRef.current[key]);
    inputRef.current = { ...inputRef.current, [key]: value };
    if (value && !wasPressed && (key === 'attack' || key === 'ability')) {
      sceneRef.current?.playWeaponSwing?.(roomRef.current?.sessionId);
    }
  }, []);

  // ── Keyboard support (desktop dev) ────────────────────────────────────────
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setKey('left', true);
      if (e.key === 'ArrowRight' || e.key === 'd') setKey('right', true);
      if (e.key === 'ArrowUp' || e.key === 'w') setKey('up', true);
      if (e.key === ' ' || e.key === 'z') setKey('attack', true);
      if (e.key === 'x') setKey('ability', true);
    };
    const up = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setKey('left', false);
      if (e.key === 'ArrowRight' || e.key === 'd') setKey('right', false);
      if (e.key === 'ArrowUp' || e.key === 'w') setKey('up', false);
      if (e.key === ' ' || e.key === 'z') setKey('attack', false);
      if (e.key === 'x') setKey('ability', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [setKey]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={isPortrait ? {
      position: 'fixed', zIndex: 9999,
      top: 0, left: 0,
      width: '100vh', height: '100vw',
      transformOrigin: '0 0',
      transform: 'translateY(100vh) rotate(90deg)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: '#0d0d1a',
      userSelect: 'none', WebkitUserSelect: 'none',
    } : {
      position: 'fixed', zIndex: 9999,
      top: 0, left: 0,
      width: '100%', height: '100%',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: '#0d0d1a',
      userSelect: 'none', WebkitUserSelect: 'none',
    }}>

      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(201,168,76,0.15)',
      }}>
        <button
          onClick={onLeave}
          style={{
            background: 'none', border: '1px solid rgba(255,255,255,0.15)',
            color: '#94a3b8', padding: '4px 10px', borderRadius: 8,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          ← Leave
        </button>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
          color: '#c9a84c', textTransform: 'uppercase',
        }}>
          {phase === 'connecting' && '⏳ Connecting…'}
          {phase === 'waiting' && `👥 Waiting for opponent${'.'.repeat(dotCount)}`}
          {phase === 'countdown' && '⚡ Get ready!'}
          {phase === 'battle' && '⚔️ FIGHT'}
          {phase === 'finished' && '🏁 Match over'}
          {phase === 'error' && '❌ Error'}
          {phase === 'reconnecting' && '🔄 Reconnecting…'}
        </span>
        <div style={{ width: 60 }} />
      </div>

      {/* Phaser canvas container */}
      <div
        ref={containerRef}
        style={{ width: '100%', flex: 1, minHeight: 0, position: 'relative' }}
      />

      {/* ── Absolute overlays (float over canvas, don't affect layout) ──── */}

      {phase === 'reconnecting' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(13,13,26,0.85)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔄</div>
          <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Reconnecting...</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Connection lost — attempting to rejoin</div>
        </div>
      )}

      {phase === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(13,13,26,0.9)', padding: 24,
        }}>
          <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 14, marginBottom: 12, textAlign: 'center' }}>
            {errorMsg || 'Could not connect to game server'}
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 20, textAlign: 'center' }}>
            Make sure the game server is running on port 2567
          </div>
          <button onClick={onLeave} style={{
            background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)',
            color: '#c9a84c', padding: '10px 24px', borderRadius: 10,
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}>Back to Lobby</button>
        </div>
      )}

      {phase === 'finished' && result && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(13,13,26,0.93)',
        }}>
          {/* Result header */}
          <div style={{ fontSize: 52, marginBottom: 6 }}>{result.won ? '🏆' : '💀'}</div>
          <div style={{
            fontSize: 32, fontWeight: 900, letterSpacing: '0.1em', marginBottom: 4,
            color: result.won ? '#22c55e' : '#ef4444',
          }}>
            {result.won ? 'VICTORY' : 'DEFEAT'}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
            {result.won
              ? `You defeated ${result.opponentName}`
              : `Defeated by ${result.opponentName}`}
          </div>

          {/* Rewards */}
          <div style={{
            display: 'flex', gap: 12, marginBottom: 28,
          }}>
            {result.won && (
              <div style={{
                background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)',
                borderRadius: 10, padding: '10px 18px', textAlign: 'center', minWidth: 80,
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#c9a84c' }}>+60</div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>TOKENS</div>
              </div>
            )}
            <div style={{
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 10, padding: '10px 18px', textAlign: 'center', minWidth: 80,
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#818cf8' }}>
                +{result.won ? 120 : 30}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>XP</div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={onLeave} style={{
              background: 'linear-gradient(135deg, #c9a84c, #8b6914)',
              color: '#0d0d1a', fontWeight: 800, fontSize: 14,
              border: 'none', borderRadius: 12, padding: '12px 32px', cursor: 'pointer',
            }}>Back to Lobby</button>
          </div>
        </div>
      )}

      {/* ── Waiting / connecting panel ───────────────────────────────────── */}
      {(phase === 'waiting' || phase === 'connecting') && (() => {
        const cls = (user?.class_name || 'warrior').toLowerCase();
        const info = CLASS_INFO[cls] || CLASS_INFO.warrior;
        const loadoutSlots = [
          { icon: '🗡️', label: 'WEAPON', item: equipped.weapon },
          { icon: '🛡️', label: 'ARMOR',  item: equipped.armor  },
          { icon: '✨', label: 'ABILITY', item: equipped.ability },
        ];

        // Compute full stats: base + class modifier + item bonuses
        const classMods  = CLASS_MODIFIERS[cls] || {};
        const totalHp    = (BASE_HP[cls] || 100) + (classMods.hp_bonus || 0) + (loadoutStats.hp_bonus || 0);
        const totalAtkMin = BASE_ATK_MIN + (classMods.attack_bonus || 0) + (loadoutStats.attack_bonus || 0);
        const totalAtkMax = BASE_ATK_MAX + (classMods.attack_bonus || 0) + (loadoutStats.attack_bonus || 0);
        const baseAbilDmg = ABILITY_DMG[cls];
        const totalAbilDmg = baseAbilDmg !== null ? baseAbilDmg + (classMods.ability_bonus || 0) + (loadoutStats.ability_bonus || 0) : null;
        const abilName   = ABILITY_NAMES[cls];
        return (
          <div style={{
            flexShrink: 0,
            background: 'linear-gradient(180deg, #0d0d1a 0%, #1a1a2e 100%)',
            borderTop: '1px solid rgba(201,168,76,0.2)',
            padding: '10px 14px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>

            {/* Hero card — char preview + class info */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'linear-gradient(135deg, #0d0d1a 0%, #1a0a0a 55%, #2d0000 100%)',
              border: '1px solid rgba(201,168,76,0.25)',
              borderBottom: `2px solid ${info.color}55`,
              borderRadius: 14, padding: '8px 12px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', left: -20, bottom: -20, width: 100, height: 100, background: `radial-gradient(circle, ${info.glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />

              <CharacterPortrait
                cls={cls}
                size={72}
                weapon={equipped?.weapon || null}
                badgeSize={24}
                sheetPath={equippedSheetPath || user?.character_spritesheet_path || null}
              />

              <div style={{ flex: 1, zIndex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#c9a84c', textTransform: 'uppercase', marginBottom: 3 }}>Your Fighter</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 15 }}>{info.icon}</span>
                  <span style={{ color: 'white', fontSize: 17, fontWeight: 900 }}>{info.name}</span>
                </div>
                <div style={{ color: info.color, fontSize: 10, fontWeight: 700, marginBottom: 5 }}>{info.title}</div>
                <span style={{
                  color: '#c9a84c', background: 'rgba(201,168,76,0.1)',
                  border: '1px solid rgba(201,168,76,0.18)', borderRadius: 999,
                  padding: '2px 8px', fontSize: 9, fontWeight: 800,
                }}>{info.bonus}</span>
              </div>

              <div style={{ flexShrink: 0, zIndex: 1, textAlign: 'center' }}>
                <div style={{
                  background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.28)',
                  borderRadius: 12, padding: '6px 10px',
                }}>
                  <div style={{ color: '#c9a84c', fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', marginBottom: 2 }}>WAITING</div>
                  <div style={{ color: '#c9a84c', fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{'·'.repeat(dotCount)}</div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap',
            }}>
              {[
                { icon: '❤️', value: `${totalHp} HP`,                    color: '#f87171' },
                { icon: '⚔️', value: `${totalAtkMin}–${totalAtkMax} ATK`, color: '#fbbf24' },
                { icon: '✨', value: totalAbilDmg !== null ? `${abilName} ${totalAbilDmg} dmg` : abilName, color: '#a78bfa' },
              ].map(s => (
                <div key={s.icon} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20, padding: '4px 10px',
                }}>
                  <span style={{ fontSize: 12 }}>{s.icon}</span>
                  <span style={{ color: s.color, fontSize: 11, fontWeight: 700 }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Loadout */}
            <div style={{
              background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.12)',
              borderRadius: 14, padding: '8px 10px',
            }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: '0 0 6px' }}>Loadout</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                {loadoutSlots.map(slot => (
                  <div key={slot.label} style={{
                    borderRadius: 10, padding: '7px 4px', minHeight: 52,
                    background: slot.item ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.02)',
                    border: slot.item ? '1px solid rgba(201,168,76,0.3)' : '1px dashed rgba(201,168,76,0.2)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  }}>
                    {slot.item?.image_path && slot.label === 'WEAPON' ? (
                      <WeaponIcon imagePath={slot.item.image_path} size={28} borderRadius={6} />
                    ) : slot.item?.image_path ? (
                      <img src={slot.item.image_path} alt={slot.item.name}
                        style={{ width: 28, height: 28, objectFit: 'contain' }} />
                    ) : (
                      <span style={{ fontSize: 17, opacity: 0.28 }}>{slot.icon}</span>
                    )}
                    <span style={{ color: slot.item ? '#c9a84c' : '#334155', fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slot.item ? slot.item.name : slot.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave */}
            <button onClick={onLeave} style={{
              background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)',
              color: '#ef4444', padding: '9px', borderRadius: 10,
              fontWeight: 700, fontSize: 12, cursor: 'pointer', letterSpacing: '0.04em',
            }}>✕ Leave Queue</button>

          </div>
        );
      })()}

      {/* ── Mobile touch controls ─────────────────────────────────────────── */}
      {(phase === 'battle' || phase === 'countdown') && (
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 24px 16px',
          background: 'rgba(0,0,0,0.45)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {/* D-pad */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <TouchButton
              label="↑"
              color="rgba(30,58,95,0.85)"
              onDown={() => { setKey('up', true); setTimeout(() => setKey('up', false), 100); }}
              onUp={() => {}}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <TouchButton
                label="←"
                color="rgba(30,58,95,0.85)"
                onDown={() => setKey('left', true)}
                onUp={() => setKey('left', false)}
              />
              <TouchButton
                label="→"
                color="rgba(30,58,95,0.85)"
                onDown={() => setKey('right', true)}
                onUp={() => setKey('right', false)}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12 }}>
            <AbilityButton
              abilityReady={abilityReady}
              playerClass={playerClass}
              onActivate={() => {
                setKey('ability', true);
                setTimeout(() => setKey('ability', false), 150);
              }}
            />
            <TouchButton
              label="⚔️"
              color="rgba(139,0,0,0.85)"
              onDown={() => { setKey('attack', true); setTimeout(() => setKey('attack', false), 150); }}
              onUp={() => {}}
              style={{ width: 72, height: 72, fontSize: 28 }}
            />
          </div>
        </div>
      )}

    </div>
  );
}
