import React, { useCallback, useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import BattleScene from './scenes/BattleScene';
import { CLASS_INFO, CLASS_MODIFIERS } from '../../utils/characters';
import CharacterPortrait from './CharacterPortrait';
import apiClient from '../../api/client';
import { getStoredSessionToken } from '../../utils/storage';
import WeaponIcon from '../WeaponIcon';
import ArmorIcon from '../ArmorIcon';
import { BattleControlsOverlay, ABILITY_NAMES } from './BattleControls';

// Base arena stats (mirrors ArenaRoom.ts constants)
const BASE_HP        = { warrior: 150, mage: 100, rogue: 120 };
const BASE_ATK_MIN   = 15;
const BASE_ATK_MAX   = 25;
const ABILITY_DMG    = { warrior: 20, mage: 25, rogue: null };

const GAME_SERVER_URL = process.env.REACT_APP_GAME_SERVER_URL || (() => {
  const override = new URLSearchParams(window.location.search).get('gameServerUrl');
  if (override) return override;

  return `${window.location.origin}/colyseus`;
})();

function formatConnectionError(err) {
  if (!err) return 'Could not connect to game server';
  if (err.message) return err.message;
  if (err.type === 'error' && err.target?.responseURL) {
    return `Network error connecting to ${err.target.responseURL}`;
  }
  if (err.type === 'error') {
    return 'Network error while connecting to game server';
  }
  return String(err);
}

// Game world dimensions
const GAME_W = 800;
const GAME_H = 420;

// ─────────────────────────────────────────────────────────────────────────────

export default function RealTimeArenaScreen({ user, onLeave }) {
  const containerRef = useRef(null);   // div that holds Phaser canvas
  const gameRef = useRef(null);        // Phaser.Game instance
  const sceneRef = useRef(null);       // BattleScene instance
  const roomRef = useRef(null);        // Colyseus room
  const inputRef = useRef({ left: false, right: false, attack: false, ability: false, itemAbility: false, up: false, block: false });
  const inputIntervalRef = useRef(null);
  const actionTimersRef = useRef([]);
  const lastInputRef = useRef('');
  const roomActiveRef = useRef(false);
  const phaseRef = useRef('connecting');

  const [phase, setPhase] = useState('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);
  const [dotCount, setDotCount] = useState(1);
  const [abilityReady, setAbilityReady] = useState(true);
  const [itemAbilityReady, setItemAbilityReady] = useState(true);
  const [playerClass, setPlayerClass] = useState('warrior');
  const [activeAbilityKey, setActiveAbilityKey] = useState('');
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
          setItemAbilityReady((myPlayer.itemAbilityCharges ?? 1) > 0);
          setPlayerClass(myPlayer.characterClass || 'warrior');
          setActiveAbilityKey(String(myPlayer.activeAbilityKey || ''));
          myPlayer.onChange(() => {
            setAbilityReady(myPlayer.abilityCharges > 0);
            setItemAbilityReady((myPlayer.itemAbilityCharges ?? 1) > 0);
            setActiveAbilityKey(String(myPlayer.activeAbilityKey || ''));
          });
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
        const sessionToken = user?.session_token || getStoredSessionToken();
        if (!sessionToken) {
          throw new Error('No active session token. Refresh dev login and try again.');
        }

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
            setActiveAbilityKey(String(player.activeAbilityKey || ''));
            player.onChange(() => {
              setAbilityReady(player.abilityCharges > 0);
              setItemAbilityReady((player.itemAbilityCharges ?? 1) > 0);
              setActiveAbilityKey(String(player.activeAbilityKey || ''));
            });
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
          console.error('Failed to connect to game server', err);
          updatePhase('error');
          setErrorMsg(formatConnectionError(err));
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
    inputRef.current = { ...inputRef.current, [key]: value };
  }, []);

  const pulseKey = useCallback((key, ms = 150) => {
    setKey(key, true);
    const timer = setTimeout(() => {
      setKey(key, false);
      actionTimersRef.current = actionTimersRef.current.filter((id) => id !== timer);
    }, ms);
    actionTimersRef.current.push(timer);
  }, [setKey]);

  useEffect(() => () => {
    actionTimersRef.current.forEach(clearTimeout);
    actionTimersRef.current = [];
  }, []);

  const setDirectionalInput = useCallback((next) => {
    inputRef.current = {
      ...inputRef.current,
      left: Boolean(next.left),
      right: Boolean(next.right),
      up: Boolean(next.up),
    };
  }, []);

  // ── Keyboard support (desktop dev) ────────────────────────────────────────
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setKey('left', true);
      if (e.key === 'ArrowRight' || e.key === 'd') setKey('right', true);
      if (e.key === 'ArrowUp' || e.key === 'w') setKey('up', true);
      if (e.key === ' ' || e.key === 'z') setKey('attack', true);
      if (e.key === 'x') setKey('ability', true);
      if (e.key === 'v' && equipped?.ability?.ability_key && activeAbilityKey) setKey('itemAbility', true);
      if (e.key === 'Shift' || e.key === 'c') setKey('block', true);
    };
    const up = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setKey('left', false);
      if (e.key === 'ArrowRight' || e.key === 'd') setKey('right', false);
      if (e.key === 'ArrowUp' || e.key === 'w') setKey('up', false);
      if (e.key === ' ' || e.key === 'z') setKey('attack', false);
      if (e.key === 'x') setKey('ability', false);
      if (e.key === 'v') setKey('itemAbility', false);
      if (e.key === 'Shift' || e.key === 'c') setKey('block', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [activeAbilityKey, equipped?.ability?.ability_key, setKey]);

  const equippedAbility = equipped?.ability || null;
  const hasEquippedAbility = Boolean(equippedAbility?.ability_key && activeAbilityKey);

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
            Make sure the game server is running and reachable through /colyseus
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
                armor={equipped?.armor || null}
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
                      <WeaponIcon imagePath={slot.item.image_path} size={28} borderRadius={6} enchantLevel={slot.item?.enchant_level || 0} />
                    ) : slot.item?.image_path && slot.label === 'ARMOR' ? (
                      <ArmorIcon imagePath={slot.item.image_path} size={28} borderRadius={6} />
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

      {/* ── Battle touch controls ──────────────────────────────────────────── */}
      {phase === 'battle' && (
        <BattleControlsOverlay
          showBlock={true}
          playerClass={playerClass}
          abilityReady={abilityReady}
          itemAbilityReady={itemAbilityReady}
          equippedAbility={hasEquippedAbility ? equippedAbility : null}
          canAttack={true}
          onJoystick={setDirectionalInput}
          onAttack={() => pulseKey('attack')}
          onAbility={() => pulseKey('ability')}
          onItemAbility={() => pulseKey('itemAbility')}
          onBlockDown={() => setKey('block', true)}
          onBlockUp={() => setKey('block', false)}
        />
      )}

    </div>
  );
}
