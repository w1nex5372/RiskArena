import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Coins, Gem, Skull, Swords, Trophy, Users, Zap } from 'lucide-react';
import * as Colyseus from 'colyseus.js';
import { Button } from '../ui/button';
import apiClient from '../../api/client';
import Phaser from 'phaser';
import BossRaidScene from '../arena/scenes/BossRaidScene';
import WeaponIcon from '../WeaponIcon';
import ArmorIcon from '../ArmorIcon';
import { BattleControlsOverlay, CLASS_COOLDOWNS } from '../arena/BattleControls';
import { getStoredSessionToken } from '../../utils/storage';
import { toast } from 'sonner';

const GAME_SERVER_URL = process.env.REACT_APP_GAME_SERVER_URL || (() => {
  const override = new URLSearchParams(window.location.search).get('gameServerUrl');
  if (override) return override;
  return `${window.location.origin}/colyseus`;
})();

const ATTACK_ANIM_LOCK = 600;  // ms — button locked only during animation
const RESPAWN_SECONDS  = 60;   // must match gameserver REVIVE_MS (BossRaidRoom.ts)

const fmt = (secs) => {
  if (secs == null) return '--:--';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const phaseFromHp = (hp, maxHp) => {
  if (!maxHp) return 1;
  const pct = hp / maxHp;
  if (pct > 0.66) return 1;
  if (pct > 0.33) return 2;
  return 3;
};

const LOOT_TIERS = [
  { pct: 25.0, label: 'Uncommon',  color: '#22c55e' },
  { pct: 12.0, label: 'Rare',      color: '#3b82f6' },
  { pct:  2.5, label: 'Epic',      color: '#a855f7' },
  { pct:  0.5, label: 'Legendary', color: '#f59e0b' },
  { pct: 60.0, label: 'No drop',   color: '#334155' },
];

const TIER_COLORS = { uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
const tierColor = (tier) => TIER_COLORS[String(tier || '').toLowerCase()] || '#c9a84c';

// Animuotas skaičiavimas 0 → value (~900ms, easeOutCubic) — rewards reveal momentui.
function CountUp({ value = 0, duration = 900, style }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf; const start = performance.now(); const to = Number(value) || 0;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span style={style}>{n.toLocaleString()}</span>;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BossRaidScreen({ user, socket, onLevelUp }) {
  const [bossState,       setBossState]       = useState(null);
  const [loadError,       setLoadError]       = useState(null);
  const [nextSpawnIn,     setNextSpawnIn]     = useState(null); // sek iki kito boso (downtime countdown)
  const nextSpawnAtRef    = useRef(null);                       // kito boso spawn laikas (ms)
  const viewRef           = useRef('lobby');                    // dabartinis view be stale closure (socket handler'iams)
  viewRef.current = view;                                       // latest-value (skaitomas tik async socket callback'uose)
  const [view,            setView]            = useState('lobby');
  const [attackLocked,    setAttackLocked]    = useState(false);
  const [myDamage,        setMyDamage]        = useState(0);
  const [topDealers,      setTopDealers]      = useState([]);
  const [raidTimer,       setRaidTimer]       = useState(null);
  const [lootResult,      setLootResult]      = useState(null);
  const [raidEnded,       setRaidEnded]       = useState(false);
  const [damageFeed,      setDamageFeed]      = useState([]);
  const [myRank,          setMyRank]          = useState(null);
  // Death overlay — local player nokautuotas (serveris yra autoritetas; countdown kosmetinis)
  const [myDowned,        setMyDowned]        = useState(false);
  const [respawnIn,       setRespawnIn]       = useState(0);

  // Equipment state — mirrors RealTimeArenaScreen
  const [equipped,         setEquipped]         = useState({ weapon: null, armor: null, ability: null });
  const [equippedSheet,    setEquippedSheet]    = useState('');
  const [abilityReady,     setAbilityReady]     = useState(true);
  const [itemAbilityReady, setItemAbilityReady] = useState(true);
  const playerClass = (user?.class_name || 'warrior').toLowerCase();

  const attackLockTimer    = useRef(null);
  const abilityCdTimer     = useRef(null);
  const itemAbilityCdTimer = useRef(null);
  const raidInterval       = useRef(null);
  const respawnTimerRef    = useRef(null); // death overlay countdown interval
  const myReviveRef        = useRef(RESPAWN_SECONDS); // likęs revive laikas (sync iš serverio)
  const containerRef       = useRef(null);
  const gameRef            = useRef(null);
  const sceneRef           = useRef(null);
  const colyseusRoomRef    = useRef(null);
  const equippedSheetRef   = useRef(''); // always holds latest value — avoids stale closure in Phaser 'ready'

  // ── Fetch equipment on mount ───────────────────────────────────────────────
  useEffect(() => {
    apiClient.get('/me/equipped')
      .then((res) => {
        const sheet = res.data?.battle_spritesheet_path || '';
        setEquipped(res.data?.equipped || { weapon: null, armor: null, ability: null });
        setEquippedSheet(sheet);
        equippedSheetRef.current = sheet;
        // If scene is already running (user loaded fast), refresh the player sprite
        if (sceneRef.current && sheet) {
          sceneRef.current.setRaidData({
            myUserId: user?.id,
            myPlayer: {
              class_name: (user?.class_name || 'warrior').toLowerCase(),
              sheetPath:  sheet,
              username:   user?.first_name || 'You',
            },
          });
        }
      })
      .catch(() => {
        setEquipped({ weapon: null, armor: null, ability: null });
        setEquippedSheet('');
      });
  }, [user?.id]); // eslint-disable-line

  useEffect(() => { fetchBossState(); }, []); // eslint-disable-line

  // Downtime countdown — kol nėra boso, tiksim iki kito spawn; pasibaigus perkraunam state.
  useEffect(() => {
    if (loadError !== 'no_raid' || !nextSpawnAtRef.current) { setNextSpawnIn(null); return; }
    let id;
    const tick = () => {
      const remaining = Math.max(0, Math.round((nextSpawnAtRef.current - Date.now()) / 1000));
      setNextSpawnIn(remaining);
      if (remaining <= 0) { clearInterval(id); fetchBossState(); }
    };
    tick();
    id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [loadError]); // eslint-disable-line

  // ── Phaser init — only when entering battle view ──────────────────────────
  useEffect(() => {
    const shouldInit = view === 'battle' && !!bossState && !!containerRef.current;
    if (!shouldInit || gameRef.current) return;

    const config = {
      type:            Phaser.AUTO,
      parent:          containerRef.current,
      width:           800,
      height:          420,
      backgroundColor: '#04020e',
      scene:           [BossRaidScene],
      scale:           { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render:          { antialias: false, pixelArt: false, powerPreference: 'low-power' },
      input:           { keyboard: false },
    };

    gameRef.current = new Phaser.Game(config);
    gameRef.current.events.once('ready', () => {
      sceneRef.current = gameRef.current.scene.getScene('BossRaidScene');
      sceneRef.current?.setRaidData({
        raidId:          bossState.id,
        bossName:        bossState.name,
        bossHp:          bossState.current_hp,
        bossMaxHp:       bossState.max_hp,
        bossPhase:       bossState.phase,
        myUserId:        user?.id,
        myPlayer: {
          class_name: playerClass,
          sheetPath:  equippedSheetRef.current || user?.character_spritesheet_path || null,
          username:   user?.first_name || 'You',
        },
        recentAttackers: bossState.recent_attackers || [],
      });
      // Phase 5: scena siunčia mano poziciją serveriui (room iš colyseusRoomRef)
      sceneRef.current?.setMoveCallback((d) => colyseusRoomRef.current?.send('move', d));
      // AoE dodge: scena praneša serveriui kai esu ore (šuolio metu) — ore AoE manęs nepataiko
      sceneRef.current?.setAirborneCallback((up) => colyseusRoomRef.current?.send('airborne', { up }));
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current  = null;
      sceneRef.current = null;
    };
  }, [view === 'battle' && bossState != null]); // eslint-disable-line

  // Destroy Phaser when raid ends
  useEffect(() => {
    if (raidEnded && gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current  = null;
      sceneRef.current = null;
    }
  }, [raidEnded]);

  // ── Colyseus connection — active only while in battle view ────────────────
  useEffect(() => {
    if (view !== 'battle' || !bossState) return;

    let cancelled = false;

    const token  = user?.session_token || getStoredSessionToken();
    const client = new Colyseus.Client(GAME_SERVER_URL);
    let reconnectToken = null;

    // Attaches all live handlers to a room — reused for the initial join AND after a
    // reconnect, so a network drop transparently resumes the SAME raid session (the
    // server holds the seat ~20s: HP/damage/downed preserved, no "disconnect = heal").
    function wireRoom(room) {
      reconnectToken = room.reconnectionToken;

        // HP / phase / playerCount — live from Colyseus delta-sync
        room.state.onChange(() => {
          const s = room.state;
          setBossState((prev) => prev ? {
            ...prev,
            current_hp:   s.currentHp,
            max_hp:        s.maxHp,
            phase:         s.phase,
            player_count:  s.playerCount,
            enraged:       s.enraged,
          } : prev);
          sceneRef.current?.onBossUpdate({
            current_hp: s.currentHp,
            max_hp:      s.maxHp,
            phase:       s.phase,
          });
          // Enrage — vėluojantiems prisijungiantiems (praleido boss_enrage broadcast'ą).
          // onBossEnrage idempotentas: ekrano wash 1×, banneris 1× (_enrageBannerShown).
          if (s.enraged) sceneRef.current?.onBossEnrage();

          // Fallback: if raid_finished message never arrives, show "no loot" after 4s.
          // Covers both defeat and time-based expiry (Phase 6).
          if (s.status === 'defeated' || s.status === 'expired') {
            setTimeout(() => setRaidEnded((was) => was ? was : true), 4000);
            clearInterval(raidInterval.current);
          }
        });

        // Live players (Phase 4) — server holds each player's action state,
        // the scene renders it. We skip our own session (rendered separately).
        const pushPlayer = (player, sessionId) => {
          if (sessionId === room.sessionId) return;
          sceneRef.current?.upsertRaidPlayer({
            sessionId,
            userId:          player.userId,
            username:        player.username,
            characterClass:  player.characterClass,
            spritesheetPath: player.spritesheetPath,
            state:           player.state,
            x:               player.x,
            facingRight:     player.facingRight,
            // Group A: kitų žaidėjų vitalai → scena renderina jų HP barą / skydą / nokautą
            hp:              player.hp,
            maxHp:           player.maxHp,
            blocking:        player.blocking,
            guardBroken:     player.guardBroken,
            reviveSeconds:   player.reviveSeconds,
          });
        };
        room.state.players.onAdd((player, sessionId) => {
          if (sessionId === room.sessionId) {
            // My own vitals (Group A) — HP bar + downed state from server
            const pushMine = () => {
              sceneRef.current?.setMyVitals?.({
                hp: player.hp, maxHp: player.maxHp, state: player.state, moveSpeed: player.moveSpeed,
                guard: player.guard, maxGuard: player.maxGuard, guardBroken: player.guardBroken,
              });
              // Likęs revive laikas iš serverio (rejoin atveju < 60) — countdown'ui
              myReviveRef.current = player.reviveSeconds || RESPAWN_SECONDS;
              // Reflect downed state into React → death overlay (serveris autoritetas)
              setMyDowned(player.state === 'downed');
            };
            pushMine();
            player.onChange(pushMine);
            return;
          }
          pushPlayer(player, sessionId);
          // Re-render on any field change (state, x, facingRight) — Phase 4 + 5
          player.onChange(() => pushPlayer(player, sessionId));
        });
        room.state.players.onRemove((_player, sessionId) => {
          sceneRef.current?.removeRaidPlayer(sessionId);
        });

        // boss_telegraph — server signals an incoming attack (windup). Scene shows
        // a warning for telegraphMs: AoE → red danger zone + "JUMP!"; melee → boss windup.
        room.onMessage('boss_telegraph', (data) => {
          sceneRef.current?.onBossTelegraph(data);
        });

        // boss_enrage — boss entered burn phase (one-time): banner + red screen wash.
        // Late-joiners (who missed this broadcast) get the wash via state.enraged below.
        room.onMessage('boss_enrage', () => {
          sceneRef.current?.onBossEnrage();
        });

        // boss_attack — server decides who gets hit (after telegraph); play impact in sync.
        // data.type: 'melee' | 'aoe'. AoE is dodged by being airborne (jumping) when it lands.
        room.onMessage('boss_attack', (data) => {
          sceneRef.current?.onBossAttack(data);
          // Knockback: stumiame TIK jei mane pataikė be block'o, tai nenokautavo
          // ir aš neišvengiau (dodged). block/dodge apsaugo nuo knockback.
          const mine = (data.targets || []).find((t) => t.sid === room.sessionId);
          if (mine && !mine.blocked && !mine.downed && !mine.dodged) sceneRef.current?.knockbackMyPlayer?.();
        });

        // damage_dealt — sent only to the attacker by BossRaidRoom.ts
        room.onMessage('damage_dealt', (data) => {
          sceneRef.current?.showDamageNumber(data.damage);
          setDamageFeed((prev) =>
            [{ id: Date.now(), text: `💥 ${data.damage}` }, ...prev].slice(0, 5)
          );
          // totalDamage is authoritative in room.state (accumulated server-side)
          const me = room.state.players.get(room.sessionId);
          if (me) {
            setMyDamage(me.totalDamage);
            // Live rank — kiek žaidėjų padarė daugiau žalos už mane
            let ahead = 0;
            room.state.players.forEach((pl) => { if ((pl.totalDamage || 0) > me.totalDamage) ahead += 1; });
            setMyRank({ rank: ahead + 1, total: room.state.players.size });
          }
        });

        // raid_finished — broadcast by BossRaidRoom.ts after FastAPI settles rewards
        room.onMessage('raid_finished', (data) => {
          setRaidEnded(true);
          clearInterval(raidInterval.current);
          if (Array.isArray(data.rewards) && user?.id) {
            const mine = data.rewards.find((r) => String(r.user_id) === String(user.id));
            if (mine) {
              setLootResult({
                coins: mine.coins, xp: mine.xp,
                item_drop: mine.item_drop ?? null,
                item_drop_tier: mine.item_drop_tier ?? null,
                leveled_up: !!mine.leveled_up, new_level: mine.new_level ?? null,
              });
              if (mine.leveled_up) onLevelUp?.({ new_level: mine.new_level });
            }
          }
          sceneRef.current?.onRaidFinished(data);
        });

      // Disconnect: code 1000 = consented (navigation/unmount) → done. Anything else =
      // a network drop → try to reconnect within the server's hold window.
      room.onLeave((code) => {
        colyseusRoomRef.current = null;
        if (cancelled || code === 1000) return;
        attemptReconnect();
      });
    }

    async function attemptReconnect() {
      if (!reconnectToken) return;
      try {
        const room = await client.reconnect(reconnectToken);
        if (cancelled) { room.leave(); return; }
        colyseusRoomRef.current = room;
        wireRoom(room);
        toast.success('Reconnected to the raid', { id: 'raid-reconnect', duration: 2000 });
      } catch (err) {
        console.warn('[BossRaid] reconnect failed:', err?.message);
        toast.error('Lost connection to the raid', { id: 'raid-reconnect-fail', duration: 3000 });
      }
    }

    async function connectBossRoom() {
      try {
        const room = await client.joinOrCreate('boss_raid_room', {
          sessionToken: token,
          devUsername:  user?.first_name || 'Raider',
        });
        if (cancelled) { room.leave(); return; }
        colyseusRoomRef.current = room;
        wireRoom(room);
      } catch (err) {
        console.warn('[BossRaid] Colyseus connect failed:', err?.message);
      }
    }

    connectBossRoom();

    return () => {
      cancelled = true;
      colyseusRoomRef.current?.leave();
      colyseusRoomRef.current = null;
    };
  }, [view === 'battle']); // eslint-disable-line

  // ── Socket events — only boss_spawned (raid_finished now via Colyseus) ──────
  useEffect(() => {
    if (!socket) return;

    const onBossSpawned = () => {
      setView('lobby');
      setRaidEnded(false);
      setLootResult(null);
      setMyDamage(0);
      setMyRank(null);
      setTopDealers([]);
      setDamageFeed([]);
      fetchBossState();
    };

    // Boso mirtis (global) — lobby žiūrovai (nekovoję) atsinaujina į downtime countdown.
    // Kovojantys mato victory panelį per Colyseus raid_finished, tad jų netrikdom.
    const onBossDefeated = () => { if (viewRef.current === 'lobby') fetchBossState(); };

    socket.on('boss_spawned', onBossSpawned);
    socket.on('boss_defeated', onBossDefeated);

    return () => {
      socket.off('boss_spawned', onBossSpawned);
      socket.off('boss_defeated', onBossDefeated);
      clearTimeout(attackLockTimer.current);
      clearInterval(raidInterval.current);
    };
  }, [socket]); // eslint-disable-line

  // ── Death overlay countdown — kosmetinis (serveris atgaivina po REVIVE_MS) ──
  // Kai myDowned tampa true, skaičiuojame respawnIn nuo RESPAWN_SECONDS iki 0.
  // Overlay dingsta kai serveris perjungia state atgal į idle (myDowned=false),
  // nepriklausomai nuo šio lokalaus laikmačio.
  useEffect(() => {
    clearInterval(respawnTimerRef.current);
    if (!myDowned) { setRespawnIn(0); return; }
    // Pradedam nuo serverio likusio laiko (rejoin atveju < 60), ne visada 60
    setRespawnIn(myReviveRef.current || RESPAWN_SECONDS);
    respawnTimerRef.current = setInterval(() => {
      setRespawnIn((s) => {
        if (s <= 1) { clearInterval(respawnTimerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(respawnTimerRef.current);
  }, [myDowned]);

  const fetchBossState = async () => {
    setLoadError(null);
    setBossState(null);
    try {
      const res = await apiClient.get('/boss-raid/current');
      // Downtime tarp bosų — serveris grąžina {active:false, next_spawn_at} → countdown.
      if (res.data && res.data.active === false) {
        setBossState(null);
        nextSpawnAtRef.current = res.data.next_spawn_at ? new Date(res.data.next_spawn_at).getTime() : null;
        setLoadError('no_raid');
        return;
      }
      setBossState(res.data);
      if (res.data.top_dealers) setTopDealers(res.data.top_dealers.slice(0, 3));
      if (typeof res.data.my_damage === 'number') setMyDamage(res.data.my_damage);
      if (res.data.raid_end_at) {
        const endMs = new Date(res.data.raid_end_at).getTime();
        const tick = () => {
          const remaining = Math.max(0, Math.round((endMs - Date.now()) / 1000));
          setRaidTimer(remaining);
          if (remaining <= 0) clearInterval(raidInterval.current);
        };
        tick();
        raidInterval.current = setInterval(tick, 1000);
      }
    } catch (err) {
      if (err.response?.status === 404) setLoadError('no_raid');
      else setLoadError('failed');
    }
  };

  const handleAttack = () => {
    if (attackLocked || raidEnded || !bossState) return;
    sceneRef.current?.triggerPlayerAttack();
    setAttackLocked(true);
    clearTimeout(attackLockTimer.current);
    attackLockTimer.current = setTimeout(() => setAttackLocked(false), ATTACK_ANIM_LOCK);
    // Colyseus handles the attack — server-side cooldown guards spam
    colyseusRoomRef.current?.send('attack');
  };

  const handleJoystick = useCallback(({ left, right, up }) => {
    sceneRef.current?.setJoystickInput({ left, right });
    if (up) sceneRef.current?.triggerJump();
  }, []);

  const handleAbility = useCallback(() => {
    if (!abilityReady || raidEnded) return;
    const abilityKey = `${playerClass}_default`;
    sceneRef.current?.triggerAbility(playerClass, abilityKey);
    // Serveris pritaiko žalą bosui (server-authoritative — žala/cooldown iš shared metadata)
    colyseusRoomRef.current?.send('ability', { abilityKey });
    setAbilityReady(false);
    clearTimeout(abilityCdTimer.current);
    const cd = CLASS_COOLDOWNS[playerClass] ?? 6000;
    abilityCdTimer.current = setTimeout(() => setAbilityReady(true), cd);
  }, [abilityReady, raidEnded, playerClass]);

  const handleItemAbility = useCallback(() => {
    if (!itemAbilityReady || raidEnded) return;
    const abilityKey = equipped?.ability?.ability_key || equipped?.ability?.key || `${playerClass}_default`;
    sceneRef.current?.triggerAbility(playerClass, abilityKey);
    // Serveris pritaiko žalą bosui (server-authoritative — žala/cooldown iš shared metadata)
    colyseusRoomRef.current?.send('ability', { abilityKey });
    setItemAbilityReady(false);
    clearTimeout(itemAbilityCdTimer.current);
    const cd = Number(
      equipped?.ability?.ability_cooldown_ms ||
      equipped?.ability?.cooldown_ms ||
      CLASS_COOLDOWNS[playerClass] ||
      6000
    );
    itemAbilityCdTimer.current = setTimeout(() => setItemAbilityReady(true), cd);
  }, [itemAbilityReady, raidEnded, equipped?.ability, playerClass]);

  // ── Error / loading states ────────────────────────────────────────────────
  if (loadError === 'no_raid') {
    return (
      <div style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Skull className="w-8 h-8" style={{ color: '#64748b' }} />
          </div>
          <h2 className="text-xl font-extrabold mb-1" style={{ color: '#e8e0d0' }}>{nextSpawnIn != null ? 'Boss Slain' : 'No Active Raid'}</h2>
          {nextSpawnIn != null ? (
            <>
              <p className="text-sm" style={{ color: '#64748b' }}>The next boss rises in</p>
              <p style={{ fontSize: 34, fontWeight: 900, color: '#c9a84c', margin: '6px 0', letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{fmt(nextSpawnIn)}</p>
              <p className="text-xs" style={{ color: '#475569' }}>Sharpen your blade — a new raid begins soon.</p>
            </>
          ) : (
            <p className="text-sm" style={{ color: '#64748b' }}>The next Boss Raid hasn't started yet. Check back soon.</p>
          )}
        </div>
      </div>
    );
  }

  if (loadError === 'failed') {
    return (
      <div style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(139,0,0,0.3)' }}>
          <p className="text-sm font-bold mb-3" style={{ color: '#ef4444' }}>Failed to load raid.</p>
          <Button onClick={fetchBossState} style={{ background: 'linear-gradient(135deg,#8b0000,#c0392b)', color: 'white', borderRadius: 12, fontWeight: 800 }}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!bossState) {
    return (
      <div className="space-y-4 animate-pulse">
        {[160, 180, 64].map((h, i) => (
          <div key={i} className="rounded-[24px]" style={{ height: h, background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.1)' }} />
        ))}
      </div>
    );
  }

  const hpPct      = bossState.max_hp ? Math.max(0, Math.min(100, Math.round((bossState.current_hp / bossState.max_hp) * 100))) : 0;
  const phase      = phaseFromHp(bossState.current_hp, bossState.max_hp);
  const phaseColor = phase === 3 ? '#ef4444' : phase === 2 ? '#f59e0b' : '#c9a84c';
  const hpGrad     = phase === 3 ? 'linear-gradient(90deg,#8b0000,#ef4444)' : phase === 2 ? 'linear-gradient(90deg,#d97706,#f59e0b)' : 'linear-gradient(90deg,#8b6914,#c9a84c)';

  // ── Raid ended — no loot ──────────────────────────────────────────────────
  if (raidEnded && !lootResult) {
    return (
      <div style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Skull className="w-8 h-8" style={{ color: '#64748b' }} />
          </div>
          <h2 className="text-xl font-extrabold mb-1" style={{ color: '#e8e0d0' }}>{bossState?.name || 'Boss'} defeated</h2>
          <p className="text-sm" style={{ color: '#64748b' }}>You didn't deal any damage this raid. No rewards.</p>
          <Button
            onClick={() => { setRaidEnded(false); setLootResult(null); setView('lobby'); fetchBossState(); }}
            style={{ width: '100%', height: 48, borderRadius: 16, marginTop: 16, fontWeight: 800, color: '#e8e0d0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(201,168,76,0.3)', cursor: 'pointer' }}
          >
            Back to Lobby
          </Button>
        </div>
      </div>
    );
  }

  // ── Loot result panel ─────────────────────────────────────────────────────
  if (raidEnded && lootResult) {
    const defeated  = (bossState?.current_hp ?? 1) <= 0;
    const dropTier  = lootResult.item_drop_tier;
    const dropColor = tierColor(dropTier);
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <style>{`
          @keyframes victorySlam { 0% { transform: scale(2.2); opacity: 0; } 60% { transform: scale(0.92); opacity: 1; } 100% { transform: scale(1); } }
          @keyframes victoryGlow { 0%,100% { text-shadow: 0 0 18px rgba(201,168,76,0.5); } 50% { text-shadow: 0 0 34px rgba(201,168,76,0.9), 0 0 60px rgba(201,168,76,0.3); } }
          @keyframes lootCardIn { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          @keyframes dropShine  { 0% { background-position: -120% 0; } 100% { background-position: 220% 0; } }
          @keyframes lvlPop     { 0% { transform: scale(0); } 70% { transform: scale(1.15); } 100% { transform: scale(1); } }
        `}</style>

        {/* VICTORY / RAID OVER banner */}
        <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
          <div style={{
            fontSize: 34, fontWeight: 900, letterSpacing: 4,
            color: defeated ? '#c9a84c' : '#64748b',
            animation: defeated
              ? 'victorySlam 0.55s cubic-bezier(.2,1.2,.3,1) both, victoryGlow 2.2s ease-in-out 0.55s infinite'
              : 'victorySlam 0.55s ease-out both',
          }}>
            {defeated ? 'VICTORY' : 'RAID OVER'}
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {defeated ? `${bossState.name} defeated` : `${bossState.name} survived — time expired`}
          </p>
        </div>

        <div className="rounded-[24px] p-5" style={{ background: 'rgba(26,26,46,0.95)', border: '1px solid rgba(201,168,76,0.35)', boxShadow: '0 0 30px rgba(201,168,76,0.12)', animation: 'lootCardIn 0.45s ease-out both' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)' }}>
              <Trophy className="w-6 h-6" style={{ color: '#c9a84c' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>Raid Complete</p>
              <h2 className="text-xl font-extrabold" style={{ color: '#e8e0d0' }}>Your Rewards</h2>
            </div>
            {lootResult.leveled_up && (
              <div style={{ fontSize: 11, fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: 'rgba(74,144,217,0.18)', color: '#4a90d9', border: '1px solid rgba(74,144,217,0.4)', animation: 'lvlPop 0.5s ease-out 0.7s both', whiteSpace: 'nowrap' }}>
                ⬆ LEVEL {lootResult.new_level}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-2xl p-3 text-center" style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
              <Coins className="w-5 h-5 mx-auto mb-1" style={{ color: '#c9a84c' }} />
              <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}><CountUp value={lootResult.coins || 0} /></p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>coins</p>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: 'rgba(74,144,217,0.08)', border: '1px solid rgba(74,144,217,0.2)' }}>
              <Zap className="w-5 h-5 mx-auto mb-1" style={{ color: '#4a90d9' }} />
              <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}><CountUp value={lootResult.xp || 0} /></p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>XP</p>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: `${dropColor}14`, border: `1px solid ${dropColor}33` }}>
              <Gem className="w-5 h-5 mx-auto mb-1" style={{ color: lootResult.item_drop ? dropColor : '#c0392b' }} />
              <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}>{lootResult.item_drop ? '1' : '—'}</p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>drop</p>
            </div>
          </div>
          {lootResult.item_drop && (
            <div className="rounded-2xl px-4 py-3 mb-3" style={{ position: 'relative', overflow: 'hidden', background: `${dropColor}1a`, border: `1px solid ${dropColor}55` }}>
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(105deg, transparent 35%, ${dropColor}55 50%, transparent 65%)`, backgroundSize: '220% 100%', animation: 'dropShine 2.4s ease-in-out infinite' }} />
              <div style={{ position: 'relative' }}>
                <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: dropColor }}>{dropTier || 'Item'} Drop</p>
                <p className="text-sm font-bold" style={{ color: '#e8e0d0' }}>{lootResult.item_drop}</p>
              </div>
            </div>
          )}
          <div className="rounded-2xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs" style={{ color: '#64748b' }}>Your total damage</p>
            <p className="text-base font-extrabold" style={{ color: '#e8e0d0' }}>🔥 {myDamage.toLocaleString()}</p>
          </div>
        </div>
        <Button
          onClick={() => { setRaidEnded(false); setLootResult(null); setView('lobby'); fetchBossState(); }}
          style={{ width: '100%', height: 50, borderRadius: 16, fontWeight: 800, color: '#e8e0d0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(201,168,76,0.3)', cursor: 'pointer' }}
        >
          Back to Lobby
        </Button>
      </div>
    );
  }

  // ── LOBBY VIEW ────────────────────────────────────────────────────────────
  if (view === 'lobby') {
    const loadoutSlots = [
      { icon: '🗡️', label: 'WEAPON',  item: equipped.weapon  },
      { icon: '🛡️', label: 'ARMOR',   item: equipped.armor   },
      { icon: '✨', label: 'ABILITY', item: equipped.ability },
    ];
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <style>{`
          @keyframes wartotaurIdle {
            from { background-position: 0px -512px; }
            to   { background-position: -640px -512px; }
          }
          @keyframes bossCardGlow {
            0%,100% { box-shadow: 0 0 24px rgba(139,0,0,0.35); }
            50%     { box-shadow: 0 0 40px rgba(139,0,0,0.6), 0 0 60px rgba(139,0,0,0.2); }
          }
          @keyframes joinBtnPulse {
            0%,100% { box-shadow: 0 4px 20px rgba(139,0,0,0.4); }
            50%     { box-shadow: 0 4px 32px rgba(139,0,0,0.8), 0 0 50px rgba(139,0,0,0.25); }
          }
        `}</style>

        {/* Boss card */}
        <section style={{
          borderRadius: 24, overflow: 'hidden',
          background: 'linear-gradient(150deg,#200808 0%,#0d0d1a 55%,#1a1a2e 100%)',
          border: `1px solid ${phaseColor}55`,
          animation: 'bossCardGlow 2.5s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 20px 0' }}>
            <div style={{
              width: 128, height: 128, flexShrink: 0,
              backgroundImage: `url('/characters/boss/wartotaur.png')`,
              backgroundSize: '896px 896px', backgroundRepeat: 'no-repeat',
              imageRendering: 'pixelated', transform: 'scaleX(-1)',
              animation: 'wartotaurIdle 1.0s steps(5) infinite', borderRadius: 12,
              filter: phase >= 3 ? 'drop-shadow(0 0 10px #ef4444)' : phase === 2 ? 'drop-shadow(0 0 8px #f59e0b)' : 'drop-shadow(0 0 6px #8b0000)',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 3, color: '#c9a84c', textTransform: 'uppercase' }}>Boss Raid</span>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${phaseColor}22`, color: phaseColor, border: `1px solid ${phaseColor}55` }}>
                  Phase {phase}
                </span>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: '#e8e0d0', margin: 0, lineHeight: 1.2 }}>{bossState.name}</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 10px' }}>Level {bossState.level}</p>
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#64748b' }}>
                  <Users style={{ width: 15, height: 15 }} />{bossState.player_count ?? 0} raiders
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#64748b' }}>
                  <Clock3 style={{ width: 15, height: 15 }} />{raidTimer != null ? fmt(raidTimer) : '--:--'}
                </div>
              </div>
            </div>
          </div>
          {/* HP bar */}
          <div style={{ padding: '14px 20px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {(bossState.current_hp||0).toLocaleString()} / {(bossState.max_hp||0).toLocaleString()} HP
              </span>
              <span style={{ fontSize: 14, fontWeight: 900, color: phaseColor }}>{hpPct}%</span>
            </div>
            <div style={{ height: 12, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.07)' }}>
              <div style={{ width: `${hpPct}%`, height: '100%', background: hpGrad, boxShadow: `0 0 8px ${phaseColor}66`, transition: 'width 0.5s' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[1,2,3].map((p) => (
                <div key={p} style={{ flex: 1, height: 4, borderRadius: 999, background: p <= phase ? (p===3?'#ef4444':p===2?'#f59e0b':'#c9a84c') : 'rgba(255,255,255,0.07)' }} />
              ))}
            </div>
          </div>
        </section>

        {/* Your loadout */}
        <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, color: '#c9a84c', textTransform: 'uppercase', marginBottom: 10 }}>Your Loadout</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {loadoutSlots.map((slot) => (
              <div key={slot.label} style={{
                borderRadius: 12, padding: '8px 6px', minHeight: 60,
                background: slot.item ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.02)',
                border: slot.item ? '1px solid rgba(201,168,76,0.3)' : '1px dashed rgba(201,168,76,0.18)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                {slot.item?.image_path && slot.label === 'WEAPON' ? (
                  <WeaponIcon imagePath={slot.item.image_path} size={30} borderRadius={6} enchantLevel={slot.item?.enchant_level || 0} />
                ) : slot.item?.image_path && slot.label === 'ARMOR' ? (
                  <ArmorIcon imagePath={slot.item.image_path} size={30} borderRadius={6} />
                ) : slot.item?.image_path ? (
                  <img src={slot.item.image_path} alt={slot.item.name} style={{ width: 30, height: 30, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 18, opacity: 0.25 }}>{slot.icon}</span>
                )}
                <span style={{
                  color: slot.item ? '#c9a84c' : '#334155', fontSize: 9, fontWeight: 800,
                  letterSpacing: '0.06em', textAlign: 'center',
                  maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {slot.item ? slot.item.name : slot.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Loot table */}
        <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Gem style={{ width: 16, height: 16, color: '#c9a84c' }} />
            <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#c9a84c', textTransform: 'uppercase' }}>Loot Drops</span>
            <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>rolled for everyone</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {LOOT_TIERS.map(({ pct, label, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 70, height: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}>
                  <div style={{ width: `${Math.min(100, pct * (label === 'No drop' ? 1 : 4))}%`, height: '100%', background: color }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', width: 36, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                <span style={{ fontSize: 12, fontWeight: 800, color }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#64748b', marginBottom: 4 }}>
              <Coins style={{ width: 13, height: 13, color: '#c9a84c', flexShrink: 0, marginTop: 1 }} />
              Coins = damage × 2 · Top dealer earns +50% bonus
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#64748b' }}>
              <Zap style={{ width: 13, height: 13, color: '#4a90d9', flexShrink: 0, marginTop: 1 }} />
              XP based on damage dealt + bonus if boss is defeated
            </div>
          </div>
        </section>

        {/* Top raiders */}
        {topDealers.length > 0 && (
          <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.15)' }}>
            <h3 style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#c9a84c', textTransform: 'uppercase', marginBottom: 10 }}>Top Raiders</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topDealers.slice(0, 3).map((dealer, i) => {
                const maxDmg = topDealers[0]?.total_damage || 1;
                const pct    = Math.round((dealer.total_damage / maxDmg) * 100);
                const isMe   = String(dealer.user_id) === String(user?.id);
                return (
                  <div key={dealer.user_id || i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{i===0?'🥇':i===1?'🥈':'🥉'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, flex: 1, color: isMe ? '#c9a84c' : '#e8e0d0' }}>
                      {isMe ? 'You' : dealer.first_name || 'Unknown'}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{(dealer.total_damage||0).toLocaleString()}</span>
                    <div style={{ width: 50, height: 5, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: isMe ? '#c9a84c' : '#475569' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Join CTA — contextual: urgent "finish the kill" framing once the boss is in
            its burn phase (phase 3 ≈ enrage), plus a live raiders/HP subtitle. */}
        <Button
          onClick={() => setView('battle')}
          style={{
            width: '100%', minHeight: 62, borderRadius: 22, fontWeight: 900,
            color: 'white',
            background: phase >= 3 ? 'linear-gradient(135deg,#b00000,#ef4444)' : 'linear-gradient(135deg,#8b0000,#c0392b)',
            border: '1px solid rgba(201,168,76,0.4)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
            padding: '9px 0',
            animation: `joinBtnPulse ${phase >= 3 ? '1.1s' : '2s'} ease-in-out infinite`,
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
            <Swords style={{ width: 22, height: 22 }} />
            {phase >= 3 ? 'Finish the Kill' : 'Join Raid'}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>
            {(bossState.player_count ?? 0)} raider{(bossState.player_count ?? 0) === 1 ? '' : 's'} battling · {hpPct}% HP left
          </span>
        </Button>
      </div>
    );
  }

  // ── BATTLE VIEW — full-screen ─────────────────────────────────────────────
  const canAttack = !attackLocked && !raidEnded;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 1000, display: 'flex', flexDirection: 'column',
      background: '#04020e', color: '#e8e0d0',
      userSelect: 'none', WebkitUserSelect: 'none',
    }}>
      <style>{`
        @keyframes phasePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes enragePulse { 0%,100%{opacity:1; box-shadow:0 0 8px rgba(239,68,68,0.55)} 50%{opacity:0.55; box-shadow:0 0 2px rgba(239,68,68,0.2)} }
        @keyframes feedFade {
          0%   { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(-14px); }
        }
      `}</style>

      {/* ── Top HUD bar ──────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px 6px',
        background: 'rgba(0,0,0,0.55)', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Back */}
        <button
          onClick={() => setView('lobby')}
          style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700,
            color: '#94a3b8', cursor: 'pointer', flexShrink: 0,
          }}
        >← Lobby</button>

        {/* Boss name + phase */}
        <div style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#e8e0d0' }}>{bossState.name}</span>
          <span style={{
            marginLeft: 6, fontSize: 10, fontWeight: 800, padding: '1px 6px',
            borderRadius: 10, background: `${phaseColor}25`, color: phaseColor,
            border: `1px solid ${phaseColor}50`,
            animation: 'phasePulse 1.5s ease-in-out infinite',
          }}>P{phase}</span>
          {bossState.enraged && (
            <span style={{
              marginLeft: 6, fontSize: 10, fontWeight: 900, padding: '1px 6px',
              borderRadius: 10, background: 'rgba(239,68,68,0.22)', color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.55)', animation: 'enragePulse 0.8s ease-in-out infinite',
            }}>⚡ ENRAGED</span>
          )}
        </div>

        {/* HP bar */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>
              {(bossState.current_hp||0).toLocaleString()} / {(bossState.max_hp||0).toLocaleString()}
            </span>
            <span style={{ fontSize: 11, fontWeight: 900, color: phaseColor }}>{hpPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
            <div style={{ width: `${hpPct}%`, height: '100%', background: hpGrad, transition: 'width 0.5s', boxShadow: `0 0 6px ${phaseColor}88` }} />
          </div>
        </div>

        {/* Timer + raiders */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}>
            <Clock3 style={{ width: 12, height: 12 }} />{raidTimer != null ? fmt(raidTimer) : '--:--'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#c9a84c', fontWeight: 700 }}>
            <Users style={{ width: 12, height: 12 }} />{bossState.player_count ?? 0}
          </div>
        </div>
      </div>

      {/* ── Phaser canvas + overlaid controls ────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Damage feed */}
        <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
          {damageFeed.map((item) => (
            <div key={item.id} style={{
              background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(251,191,36,0.4)',
              borderRadius: 8, padding: '2px 8px', fontSize: 12, fontWeight: 700,
              fontFamily: 'monospace', color: '#fbbf24',
              animation: 'feedFade 2s ease forwards',
            }}>{item.text}</div>
          ))}
        </div>

        {/* My damage chip — top-left so it doesn't overlap joystick */}
        {myDamage > 0 && (
          <div style={{
            position: 'absolute', top: 8, left: 10,
            background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(201,168,76,0.3)',
            borderRadius: 10, padding: '4px 10px', pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>MY DMG </span>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#c9a84c' }}>🔥 {myDamage.toLocaleString()}</span>
            {myRank && myRank.total > 1 && (
              <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', marginLeft: 6 }}>
                {myRank.rank === 1 ? '🥇' : myRank.rank === 2 ? '🥈' : myRank.rank === 3 ? '🥉' : `#${myRank.rank}`}
                <span style={{ color: '#475569' }}>/{myRank.total}</span>
              </span>
            )}
          </div>
        )}

        {/* Death overlay — kai mane nokautavo (serveris autoritetas; countdown kosmetinis) */}
        {myDowned && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'auto', // vizualiai blokuoja input kol nokautuotas (dingsta po revive)
          }}>
            <div style={{
              fontSize: 44, fontWeight: 900, letterSpacing: 4,
              fontFamily: 'monospace', color: '#ef4444',
              textShadow: '0 0 18px rgba(139,0,0,0.7)',
            }}>YOU DIED</div>
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: '#64748b' }}>
              Respawn in <span style={{ color: '#e8e0d0', fontWeight: 900 }}>{respawnIn}s</span>
            </div>
          </div>
        )}

        <BattleControlsOverlay
          showBlock={true}
          playerClass={playerClass}
          abilityReady={abilityReady}
          itemAbilityReady={itemAbilityReady}
          equippedAbility={equipped?.ability || null}
          canAttack={canAttack}
          onJoystick={handleJoystick}
          onAttack={handleAttack}
          onAbility={handleAbility}
          onItemAbility={handleItemAbility}
          onBlockDown={() => { sceneRef.current?.setBlock(true);  colyseusRoomRef.current?.send('block', { down: true }); }}
          onBlockUp={() =>   { sceneRef.current?.setBlock(false); colyseusRoomRef.current?.send('block', { down: false }); }}
        />
      </div>
    </div>
  );
}
