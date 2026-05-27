import { useEffect, useRef, useState } from 'react';
import { Clock3, Coins, Gem, Skull, Swords, Trophy, Users, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import apiClient from '../../api/client';
import Phaser from 'phaser';
import BossRaidScene from '../arena/scenes/BossRaidScene';

const ATTACK_COOLDOWN = 6; // must match backend ATTACK_COOLDOWN_S

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

// Loot table (mirrors boss_domain.py _LOOT_TIERS)
const LOOT_TIERS = [
  { pct: 25.0, label: 'Uncommon',  color: '#22c55e' },
  { pct: 12.0, label: 'Rare',      color: '#3b82f6' },
  { pct:  2.5, label: 'Epic',      color: '#a855f7' },
  { pct:  0.5, label: 'Legendary', color: '#f59e0b' },
  { pct: 60.0, label: 'No drop',   color: '#334155' },
];

export default function BossRaidScreen({ user, socket, onLevelUp }) {
  const [bossState,  setBossState]  = useState(null);
  const [loadError,  setLoadError]  = useState(null); // 'no_raid' | 'failed' | null
  const [view,       setView]       = useState('lobby'); // 'lobby' | 'battle'
  const [cooldown,   setCooldown]   = useState(0);
  const [myDamage,   setMyDamage]   = useState(0);
  const [topDealers, setTopDealers] = useState([]);
  const [raidTimer,  setRaidTimer]  = useState(null);
  const [lootResult, setLootResult] = useState(null);
  const [raidEnded,  setRaidEnded]  = useState(false);
  const [damageFeed, setDamageFeed] = useState([]);

  const cooldownInterval = useRef(null);
  const raidInterval     = useRef(null);
  const containerRef     = useRef(null);
  const gameRef          = useRef(null);
  const sceneRef         = useRef(null);

  useEffect(() => { fetchBossState(); }, []); // eslint-disable-line

  // ── Phaser init — only when entering battle view ─────────────────────────
  useEffect(() => {
    const shouldInit = view === 'battle' && !!bossState && !!containerRef.current;
    if (!shouldInit || gameRef.current) return;

    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800, height: 280,
      backgroundColor: '#0d0d1a',
      scene: [BossRaidScene],
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { antialias: false, pixelArt: false },
      input: { keyboard: false },
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
        myPlayer: {
          class_name: user?.class_name || 'warrior',
          sheetPath:  user?.character_spritesheet_path || null,
          username:   user?.first_name || 'You',
        },
        recentAttackers: bossState.recent_attackers || [],
      });
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [view === 'battle' && bossState != null]); // eslint-disable-line

  // Destroy Phaser when leaving battle or raid ends
  useEffect(() => {
    if (raidEnded && gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    }
  }, [raidEnded]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onBossUpdate = (data) => {
      setBossState((prev) => (prev ? { ...prev, ...data } : data));
      if (data.top_dealers) setTopDealers(data.top_dealers.slice(0, 3));
      if (typeof data.my_damage === 'number' && String(data.attacker_id) === String(user?.id)) {
        setMyDamage(data.my_damage);
      }
      sceneRef.current?.onBossUpdate(data);
    };

    const onRaidFinished = (data) => {
      setRaidEnded(true);
      if (Array.isArray(data.rewards) && user?.id) {
        const mine = data.rewards.find((r) => String(r.user_id) === String(user.id));
        if (mine) {
          setLootResult({ coins: mine.coins, xp: mine.xp, item_drop: mine.item_drop ?? null });
          if (mine.leveled_up) onLevelUp?.({ new_level: mine.new_level });
        }
      }
      clearInterval(raidInterval.current);
      sceneRef.current?.onRaidFinished(data);
    };

    const onDamageTick = (data) => {
      if (typeof data.damage === 'number') {
        sceneRef.current?.showDamageNumber(data.damage);
        setDamageFeed((prev) =>
          [{ id: Date.now(), text: `💥 ${data.damage}` }, ...prev].slice(0, 5)
        );
      }
    };

    const onBossSpawned = () => {
      setView('lobby');
      setRaidEnded(false);
      setLootResult(null);
      setMyDamage(0);
      setTopDealers([]);
      setDamageFeed([]);
      fetchBossState();
    };

    socket.on('boss_update',   onBossUpdate);
    socket.on('raid_finished', onRaidFinished);
    socket.on('damage_tick',   onDamageTick);
    socket.on('boss_spawned',  onBossSpawned);

    return () => {
      socket.off('boss_update',   onBossUpdate);
      socket.off('raid_finished', onRaidFinished);
      socket.off('damage_tick',   onDamageTick);
      socket.off('boss_spawned',  onBossSpawned);
      clearInterval(cooldownInterval.current);
      clearInterval(raidInterval.current);
    };
  }, [socket]); // eslint-disable-line

  const fetchBossState = async () => {
    setLoadError(null);
    setBossState(null);
    try {
      const res = await apiClient.get('/boss-raid/current');
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

  const handleAttack = async () => {
    if (cooldown > 0 || raidEnded || !bossState) return;
    setCooldown(ATTACK_COOLDOWN);
    cooldownInterval.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownInterval.current); return 0; }
        return prev - 1;
      });
    }, 1000);
    try {
      const res = await apiClient.post('/boss-raid/attack');
      if (res.data) {
        setBossState((prev) => prev ? { ...prev, ...res.data } : res.data);
        if (res.data.top_dealers) setTopDealers(res.data.top_dealers.slice(0, 3));
        if (typeof res.data.my_damage === 'number') setMyDamage(res.data.my_damage);
      }
    } catch { /* socket update arrives with accurate state */ }
  };

  // ── Error / loading states ─────────────────────────────────────────────────
  if (loadError === 'no_raid') {
    return (
      <div style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Skull className="w-8 h-8" style={{ color: '#64748b' }} />
          </div>
          <h2 className="text-xl font-extrabold mb-1" style={{ color: '#e8e0d0' }}>No Active Raid</h2>
          <p className="text-sm" style={{ color: '#64748b' }}>The next Boss Raid hasn't started yet. Check back soon.</p>
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

  // ── Raid ended — no loot (didn't participate) ─────────────────────────────
  if (raidEnded && !lootResult) {
    return (
      <div style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Skull className="w-8 h-8" style={{ color: '#64748b' }} />
          </div>
          <h2 className="text-xl font-extrabold mb-1" style={{ color: '#e8e0d0' }}>{bossState.name} defeated</h2>
          <p className="text-sm" style={{ color: '#64748b' }}>You didn't deal any damage this raid. No rewards.</p>
          <p className="text-xs mt-3" style={{ color: '#475569' }}>A new boss will spawn soon.</p>
        </div>
      </div>
    );
  }

  // ── Loot result panel ─────────────────────────────────────────────────────
  if (raidEnded && lootResult) {
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-5" style={{ background: 'rgba(26,26,46,0.95)', border: '1px solid rgba(201,168,76,0.35)', boxShadow: '0 0 30px rgba(201,168,76,0.12)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)' }}>
              <Trophy className="w-6 h-6" style={{ color: '#c9a84c' }} />
            </div>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>Raid Complete</p>
              <h2 className="text-xl font-extrabold" style={{ color: '#e8e0d0' }}>{bossState.name} Defeated</h2>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { icon: <Coins className="w-5 h-5 mx-auto mb-1" style={{ color: '#c9a84c' }} />, val: (lootResult.coins||0).toLocaleString(), label: 'coins', bg: 'rgba(201,168,76,0.08)', border: 'rgba(201,168,76,0.2)' },
              { icon: <Zap   className="w-5 h-5 mx-auto mb-1" style={{ color: '#4a90d9' }} />, val: (lootResult.xp||0).toLocaleString(),    label: 'XP',    bg: 'rgba(74,144,217,0.08)',  border: 'rgba(74,144,217,0.2)' },
              { icon: <Gem   className="w-5 h-5 mx-auto mb-1" style={{ color: '#c0392b' }} />, val: lootResult.item_drop ? '1' : '—',         label: 'drop',  bg: 'rgba(139,0,0,0.08)',     border: 'rgba(139,0,0,0.2)' },
            ].map(({ icon, val, label, bg, border }) => (
              <div key={label} className="rounded-2xl p-3 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                {icon}
                <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}>{val}</p>
                <p className="text-[11px]" style={{ color: '#64748b' }}>{label}</p>
              </div>
            ))}
          </div>
          {lootResult.item_drop && (
            <div className="rounded-2xl px-4 py-3 mb-3" style={{ background: 'rgba(139,0,0,0.1)', border: '1px solid rgba(139,0,0,0.25)' }}>
              <p className="text-xs font-extrabold" style={{ color: '#c0392b' }}>Item Drop</p>
              <p className="text-sm font-bold" style={{ color: '#e8e0d0' }}>{lootResult.item_drop}</p>
            </div>
          )}
          <div className="rounded-2xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs" style={{ color: '#64748b' }}>Your total damage</p>
            <p className="text-base font-extrabold" style={{ color: '#e8e0d0' }}>🔥 {myDamage.toLocaleString()}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── LOBBY VIEW ────────────────────────────────────────────────────────────
  if (view === 'lobby') {
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

        {/* ── Boss card ─────────────────────────────────────────────────── */}
        <section style={{
          borderRadius: 24, overflow: 'hidden',
          background: 'linear-gradient(150deg,#200808 0%,#0d0d1a 55%,#1a1a2e 100%)',
          border: `1px solid ${phaseColor}55`,
          animation: 'bossCardGlow 2.5s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 20px 0' }}>
            {/* Animated Wartotaur portrait — row 4 (idle south, 5 frames @ 128px) */}
            <div style={{
              width: 128, height: 128, flexShrink: 0,
              backgroundImage: `url('/characters/boss/wartotaur.png')`,
              backgroundSize: '896px 896px',
              backgroundRepeat: 'no-repeat',
              imageRendering: 'pixelated',
              transform: 'scaleX(-1)',
              animation: 'wartotaurIdle 1.0s steps(5) infinite',
              borderRadius: 12,
              filter: phase >= 3 ? 'drop-shadow(0 0 10px #ef4444)' : phase === 2 ? 'drop-shadow(0 0 8px #f59e0b)' : 'drop-shadow(0 0 6px #8b0000)',
            }} />

            {/* Boss info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 3, color: '#c9a84c', textTransform: 'uppercase' }}>Boss Raid</span>
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                  background: `${phaseColor}22`, color: phaseColor, border: `1px solid ${phaseColor}55`,
                }}>Phase {phase}</span>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: '#e8e0d0', margin: 0, lineHeight: 1.2 }}>{bossState.name}</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 10px' }}>Level {bossState.level}</p>

              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#64748b' }}>
                  <Users style={{ width: 15, height: 15 }} />
                  {bossState.player_count ?? 0} raiders
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#64748b' }}>
                  <Clock3 style={{ width: 15, height: 15 }} />
                  {raidTimer != null ? fmt(raidTimer) : '--:--'}
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
                <div key={p} style={{
                  flex: 1, height: 4, borderRadius: 999,
                  background: p <= phase ? (p===3?'#ef4444':p===2?'#f59e0b':'#c9a84c') : 'rgba(255,255,255,0.07)',
                }} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Loot table ────────────────────────────────────────────────── */}
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
              Coins = damage dealt × 2 · Top dealer earns +50% bonus
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#64748b' }}>
              <Zap style={{ width: 13, height: 13, color: '#4a90d9', flexShrink: 0, marginTop: 1 }} />
              XP based on damage dealt + bonus if boss is defeated
            </div>
          </div>
        </section>

        {/* ── Top raiders (if any) ──────────────────────────────────────── */}
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

        {/* ── Join CTA ──────────────────────────────────────────────────── */}
        <Button
          onClick={() => setView('battle')}
          style={{
            width: '100%', height: 62, borderRadius: 22, fontWeight: 900, fontSize: 18,
            color: 'white',
            background: 'linear-gradient(135deg,#8b0000,#c0392b)',
            border: '1px solid rgba(201,168,76,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            animation: 'joinBtnPulse 2s ease-in-out infinite',
          }}
        >
          <Swords style={{ width: 22, height: 22 }} />
          Join Raid
        </Button>
      </div>
    );
  }

  // ── BATTLE VIEW ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" style={{ color: '#e8e0d0' }}>
      <style>{`
        @keyframes phasePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes attackPulse {
          0%,100% { box-shadow: 0 4px 20px rgba(139,0,0,0.4); }
          50%     { box-shadow: 0 4px 30px rgba(139,0,0,0.7), 0 0 40px rgba(139,0,0,0.25); }
        }
        @keyframes feedSlide {
          from { opacity:1; transform:translateY(0); }
          to   { opacity:0; transform:translateY(-18px); }
        }
      `}</style>

      {/* Phaser canvas */}
      <div style={{ position: 'relative', width: '100%', height: 280, borderRadius: 16, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: 280, background: '#0d0d1a', borderRadius: 16, overflow: 'hidden' }} />
        {/* Damage feed top-right */}
        <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
          {damageFeed.map((item) => (
            <div key={item.id} style={{
              background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(251,191,36,0.4)',
              borderRadius: 8, padding: '2px 7px', fontSize: 12, fontWeight: 700,
              fontFamily: 'monospace', color: '#fbbf24',
              animation: 'feedSlide 1.8s ease forwards',
            }}>{item.text}</div>
          ))}
        </div>
        {/* Back to info */}
        <button
          onClick={() => setView('lobby')}
          style={{
            position: 'absolute', top: 8, left: 10,
            background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700,
            color: '#94a3b8', cursor: 'pointer',
          }}
        >← Info</button>
      </div>

      {/* Boss header — compact */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: 3, color: '#c9a84c', textTransform: 'uppercase' }}>Boss Raid</p>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: '#e8e0d0', margin: '2px 0' }}>{bossState.name}</h2>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Level {bossState.level} · <span style={{ fontWeight: 900, color: phaseColor }}>Phase {phase}</span>
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 800, color: '#c9a84c' }}>
              <Users style={{ width: 15, height: 15 }} />{bossState.player_count ?? 0}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: '#64748b' }}>
              <Clock3 style={{ width: 14, height: 14 }} />{raidTimer != null ? fmt(raidTimer) : '--:--'}
            </div>
          </div>
        </div>
      </section>

      {/* HP bar */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(139,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <p style={{ fontWeight: 900, color: '#e8e0d0' }}>Boss HP</p>
            <p style={{ fontSize: 12, color: '#64748b' }}>{(bossState.current_hp||0).toLocaleString()} / {(bossState.max_hp||0).toLocaleString()}</p>
          </div>
          <span style={{ fontSize: 24, fontWeight: 900, color: phaseColor }}>{hpPct}%</span>
        </div>
        <div style={{ height: 16, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ width: `${hpPct}%`, height: '100%', background: hpGrad, boxShadow: `0 0 12px ${phaseColor}88`, transition: 'width 0.5s' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[1,2,3].map((p) => (
            <div key={p} style={{
              flex: 1, height: 6, borderRadius: 999,
              background: p <= phase ? (p===3?'#ef4444':p===2?'#f59e0b':'#c9a84c') : 'rgba(255,255,255,0.1)',
              animation: p === phase ? 'phasePulse 1.5s ease-in-out infinite' : undefined,
            }} />
          ))}
        </div>
      </section>

      {/* Attack button */}
      <Button
        disabled={cooldown > 0 || raidEnded}
        onClick={handleAttack}
        style={{
          width: '100%', height: 56, borderRadius: 22, fontWeight: 800,
          color: cooldown > 0 || raidEnded ? '#475569' : 'white',
          background: cooldown > 0 || raidEnded ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#8b0000,#c0392b)',
          border: cooldown > 0 || raidEnded ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(201,168,76,0.3)',
          cursor: cooldown > 0 || raidEnded ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          animation: cooldown === 0 && !raidEnded ? 'attackPulse 2s ease-in-out infinite' : undefined,
        }}
      >
        <Swords style={{ width: 20, height: 20 }} />
        {cooldown > 0 ? `Cooldown  ${fmt(cooldown)}` : 'Attack Boss'}
      </Button>

      {/* My damage */}
      <section className="rounded-[22px] p-4" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)' }}>
        <p style={{ fontSize: 11, fontWeight: 900, letterSpacing: 2, color: '#c9a84c', textTransform: 'uppercase', marginBottom: 2 }}>My damage this raid</p>
        <p style={{ fontSize: 28, fontWeight: 900, color: '#e8e0d0' }}>🔥 {myDamage.toLocaleString()}</p>
      </section>

      {/* Top dealers */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.15)' }}>
        <h3 style={{ fontWeight: 900, color: '#e8e0d0', marginBottom: 12 }}>Top Damage Dealers</h3>
        {topDealers.length === 0 ? (
          <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '12px 0' }}>No damage recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topDealers.slice(0, 3).map((dealer, i) => {
              const maxDmg = topDealers[0]?.total_damage || 1;
              const pct    = Math.round((dealer.total_damage / maxDmg) * 100);
              const isMe   = String(dealer.user_id) === String(user?.id);
              return (
                <div key={dealer.user_id || i} style={i===0 ? { background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: 8, padding: '6px 8px' } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: isMe ? '#c9a84c' : '#e8e0d0' }}>
                      <span style={{ fontSize: 14 }}>{i===0?'🥇':i===1?'🥈':'🥉'}</span>{' '}
                      {isMe ? 'You' : dealer.first_name || 'Unknown'}
                    </span>
                    <span style={{ color: '#64748b' }}>{(dealer.total_damage||0).toLocaleString()}</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: isMe ? '#c9a84c' : '#475569' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Loot estimate */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 18, background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Trophy style={{ width: 20, height: 20, color: '#c9a84c' }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 900, color: '#e8e0d0' }}>Loot on kill</p>
            <p style={{ fontSize: 12, color: '#64748b' }}>Coins × 2 per damage · XP · item drop chance</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 900, color: '#c9a84c' }}>
            <Coins style={{ width: 16, height: 16 }} />
            {myDamage > 0 ? `${myDamage * 2}+` : '—'}
          </div>
        </div>
      </section>
    </div>
  );
}
