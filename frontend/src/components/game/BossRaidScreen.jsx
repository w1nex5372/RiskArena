import { useEffect, useRef, useState } from 'react';
import { Clock3, Coins, Gem, Skull, Swords, Trophy, Users, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import apiClient from '../../api/client';

const ATTACK_COOLDOWN = 8; // seconds between attacks

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

const PHASE_COLOR = { 1: 'text-blue-600', 2: 'text-amber-500', 3: 'text-rose-600' };

export default function BossRaidScreen({ user, socket, onLevelUp }) {
  const [bossState, setBossState] = useState(null);
  const [loadError, setLoadError] = useState(null); // 'no_raid' | 'failed' | null
  const [cooldown, setCooldown] = useState(0);
  const [myDamage, setMyDamage] = useState(0);
  const [topDealers, setTopDealers] = useState([]);
  const [raidTimer, setRaidTimer] = useState(null);
  const [lootResult, setLootResult] = useState(null);
  const [raidEnded, setRaidEnded] = useState(false);

  const cooldownInterval = useRef(null);
  const raidInterval = useRef(null);

  useEffect(() => {
    fetchBossState();
  }, []); // eslint-disable-line

  // Wire socket events via the shared socket from App.jsx
  useEffect(() => {
    if (!socket) return;

    const onBossUpdate = (data) => {
      setBossState((prev) => (prev ? { ...prev, ...data } : data));
      if (data.top_dealers) setTopDealers(data.top_dealers.slice(0, 3));
      // Only the attacker's client updates its own damage counter.
      // data.attacker_id is set by the backend on every attack broadcast.
      if (
        typeof data.my_damage === 'number' &&
        String(data.attacker_id) === String(user?.id)
      ) {
        setMyDamage(data.my_damage);
      }
    };

    const onRaidFinished = (data) => {
      setRaidEnded(true);
      // data.rewards is a per-participant list; find this client's own entry.
      if (Array.isArray(data.rewards) && user?.id) {
        const mine = data.rewards.find(
          (r) => String(r.user_id) === String(user.id)
        );
        if (mine) {
          setLootResult({
            coins: mine.coins,
            xp: mine.xp,
            item_drop: mine.item_drop ?? null,
          });
          if (mine.leveled_up) onLevelUp?.({ new_level: mine.new_level });
        }
      }
      clearInterval(raidInterval.current);
    };

    socket.on('boss_update', onBossUpdate);
    socket.on('raid_finished', onRaidFinished);

    return () => {
      socket.off('boss_update', onBossUpdate);
      socket.off('raid_finished', onRaidFinished);
      clearInterval(cooldownInterval.current);
      clearInterval(raidInterval.current);
    };
  }, [socket]); // eslint-disable-line

  const fetchBossState = async () => {
    setLoadError(null);
    setBossState(null);
    try {
      // TODO: Implement GET /api/boss-raid/current on backend
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
      // TODO: Implement POST /api/boss-raid/attack on backend
      const res = await apiClient.post('/boss-raid/attack', { user_id: user?.id });
      if (typeof res.data.damage === 'number') {
        const dmg = res.data.damage;
        setMyDamage((prev) => prev + dmg);
        setBossState((prev) =>
          prev ? { ...prev, boss_hp: Math.max(0, prev.boss_hp - dmg) } : prev
        );
      }
    } catch {
      // attack API not yet available — silent
    }
  };

  // ── No active raid ─────────────────────────────────────────────────────────
  if (loadError === 'no_raid') {
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)', boxShadow: '0 12px 30px rgba(0,0,0,0.3)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Skull className="w-8 h-8" style={{ color: '#64748b' }} />
          </div>
          <h2 className="text-xl font-extrabold mb-1" style={{ color: '#e8e0d0' }}>No Active Raid</h2>
          <p className="text-sm font-medium" style={{ color: '#64748b' }}>
            The next Boss Raid hasn't started yet. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (loadError === 'failed') {
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(139,0,0,0.3)' }}>
          <p className="text-sm font-bold mb-3" style={{ color: '#ef4444' }}>Failed to load raid. Tap to retry.</p>
          <Button
            onClick={fetchBossState}
            style={{ background: 'linear-gradient(135deg,#8b0000,#c0392b)', color: 'white', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 12, fontWeight: 800 }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (!bossState) {
    return (
      <div className="space-y-4 animate-pulse">
        {[112, 80, 64, 112].map((h, i) => (
          <div key={i} className="rounded-[24px]" style={{ height: h, background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.1)' }} />
        ))}
      </div>
    );
  }

  const hpPct = bossState.boss_max_hp
    ? Math.max(0, Math.min(100, Math.round((bossState.boss_hp / bossState.boss_max_hp) * 100)))
    : 0;
  const phase = phaseFromHp(bossState.boss_hp, bossState.boss_max_hp);

  // ── Loot result panel (raid finished) ─────────────────────────────────────
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
              <h2 className="text-xl font-extrabold" style={{ color: '#e8e0d0' }}>{bossState.boss_name || 'Boss'} Defeated</h2>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-2xl p-3 text-center" style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
              <Coins className="w-5 h-5 mx-auto mb-1" style={{ color: '#c9a84c' }} />
              <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}>
                {(lootResult.coins || 0).toLocaleString()}
              </p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>coins</p>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: 'rgba(74,144,217,0.08)', border: '1px solid rgba(74,144,217,0.2)' }}>
              <Zap className="w-5 h-5 mx-auto mb-1" style={{ color: '#4a90d9' }} />
              <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}>
                {(lootResult.xp || 0).toLocaleString()}
              </p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>XP</p>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: 'rgba(139,0,0,0.08)', border: '1px solid rgba(139,0,0,0.2)' }}>
              <Gem className="w-5 h-5 mx-auto mb-1" style={{ color: '#c0392b' }} />
              <p className="text-lg font-extrabold" style={{ color: '#e8e0d0' }}>
                {lootResult.item_drop ? '1' : '—'}
              </p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>drop</p>
            </div>
          </div>
          {lootResult.item_drop && (
            <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(139,0,0,0.1)', border: '1px solid rgba(139,0,0,0.25)' }}>
              <p className="text-xs font-extrabold" style={{ color: '#c0392b' }}>Item Drop</p>
              <p className="text-sm font-bold" style={{ color: '#e8e0d0' }}>{lootResult.item_drop}</p>
            </div>
          )}
          <div className="mt-4 rounded-2xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs" style={{ color: '#64748b' }}>Your damage this raid</p>
            <p className="text-base font-extrabold" style={{ color: '#e8e0d0' }}>{myDamage.toLocaleString()}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Active raid UI ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 text-slate-900">
      <style>{`
        @keyframes phasePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes attackPulse {
          0%, 100% { box-shadow: 0 4px 20px rgba(139,0,0,0.4); }
          50% { box-shadow: 0 4px 30px rgba(139,0,0,0.7), 0 0 40px rgba(139,0,0,0.25); }
        }
      `}</style>

      {/* Boss header */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)', boxShadow: '0 12px 30px rgba(0,0,0,0.3)' }}>
        <div className="flex items-start justify-between gap-3">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* Skull icon */}
            <div
              style={{
                width: 60,
                height: 60,
                background: 'linear-gradient(135deg, #3d0000, #8b0000)',
                borderRadius: 18,
                border: '1px solid rgba(139,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(139,0,0,0.4)',
                flexShrink: 0,
              }}
            >
              <Skull className="w-8 h-8" style={{ color: '#ef4444' }} />
            </div>
            {/* Text content */}
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>Boss Raid</p>
              <h2 className="text-2xl font-extrabold mt-1" style={{ color: '#e8e0d0' }}>
                {bossState.boss_name || 'Unknown Boss'}
              </h2>
              <p className="text-sm font-medium" style={{ color: '#64748b' }}>
                Level {bossState.boss_level || '?'} •{' '}
                <span className="font-extrabold" style={{ color: phase === 3 ? '#ef4444' : phase === 2 ? '#f59e0b' : '#c9a84c' }}>Phase {phase}</span>
              </p>
            </div>
          </div>
          <div className="rounded-2xl px-3 py-2 text-right shrink-0" style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
            <div className="flex items-center gap-1 font-extrabold justify-end" style={{ color: '#c9a84c' }}>
              <Users className="w-4 h-4" />
              {bossState.player_count ?? '—'}
            </div>
            <p className="text-[11px]" style={{ color: '#64748b' }}>raiders</p>
          </div>
        </div>
      </section>

      {/* HP bar */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(139,0,0,0.3)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-extrabold" style={{ color: '#e8e0d0' }}>Boss HP</h3>
            <p className="text-xs" style={{ color: '#64748b' }}>
              {(bossState.boss_hp || 0).toLocaleString()} / {(bossState.boss_max_hp || 0).toLocaleString()}
            </p>
          </div>
          <span className="text-2xl font-extrabold" style={{ color: phase === 3 ? '#ef4444' : phase === 2 ? '#f59e0b' : '#c9a84c' }}>
            {hpPct}%
          </span>
        </div>
        <div className="h-4 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${hpPct}%`,
              background: phase === 3
                ? 'linear-gradient(90deg, #8b0000, #ef4444)'
                : phase === 2
                ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                : 'linear-gradient(90deg, #8b6914, #c9a84c)',
              boxShadow: phase === 3
                ? '0 0 12px rgba(239,68,68,0.8)'
                : phase === 2
                ? '0 0 12px rgba(245,158,11,0.6)'
                : '0 0 8px rgba(201,168,76,0.5)',
            }}
          />
        </div>
        {/* Phase indicator */}
        <div className="flex gap-2 mt-3">
          {[1, 2, 3].map((p) => (
            <div
              key={p}
              className="flex-1 h-1.5 rounded-full"
              style={{
                background: p <= phase ? (p === 3 ? '#ef4444' : p === 2 ? '#f59e0b' : '#c9a84c') : 'rgba(255,255,255,0.1)',
                animation: p === phase ? 'phasePulse 1.5s ease-in-out infinite' : undefined,
              }}
            />
          ))}
        </div>
        <p className="text-xs mt-1" style={{ color: '#64748b' }}>Phase {phase} of 3</p>
      </section>

      {/* Cooldown + raid timer */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-[22px] p-4" style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.15)' }}>
          <Clock3 className="w-5 h-5 mb-2" style={{ color: '#c9a84c' }} />
          <p className="text-3xl font-extrabold" style={{ color: cooldown > 0 ? '#475569' : '#e8e0d0' }}>
            {cooldown > 0 ? fmt(cooldown) : 'Ready'}
          </p>
          <p className="text-xs font-medium" style={{ color: '#64748b' }}>attack cooldown</p>
        </div>
        <div className="rounded-[22px] p-4" style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(139,0,0,0.25)' }}>
          <Swords className="w-5 h-5 mb-2" style={{ color: '#c0392b' }} />
          <p className="text-3xl font-extrabold" style={{ color: '#e8e0d0' }}>
            {raidTimer != null ? fmt(raidTimer) : '--:--'}
          </p>
          <p className="text-xs font-medium" style={{ color: '#64748b' }}>raid timer</p>
        </div>
      </section>

      {/* Attack button */}
      <Button
        disabled={cooldown > 0 || raidEnded}
        onClick={handleAttack}
        style={{
          width: '100%', height: 56, borderRadius: 22, fontWeight: 800,
          color: cooldown > 0 || raidEnded ? '#475569' : 'white',
          background: cooldown > 0 || raidEnded
            ? 'rgba(255,255,255,0.05)'
            : 'linear-gradient(135deg, #8b0000, #c0392b)',
          border: cooldown > 0 || raidEnded ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(201,168,76,0.3)',
          boxShadow: cooldown > 0 || raidEnded ? 'none' : '0 4px 20px rgba(139,0,0,0.4)',
          cursor: cooldown > 0 || raidEnded ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'all 0.2s ease',
          animation: cooldown === 0 && !raidEnded ? 'attackPulse 2s ease-in-out infinite' : undefined,
        }}
      >
        <Swords className="w-5 h-5" />
        {cooldown > 0 ? `Cooldown ${fmt(cooldown)}` : 'Attack Boss'}
      </Button>

      {/* My damage */}
      <section className="rounded-[22px] p-4" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', boxShadow: '0 0 20px rgba(201,168,76,0.08)', display: 'flex', flexDirection: 'column' }}>
        <p className="text-xs font-extrabold uppercase tracking-wide mb-1" style={{ color: '#c9a84c' }}>My damage this raid</p>
        <p className="text-3xl font-extrabold" style={{ color: '#e8e0d0' }}>🔥{myDamage.toLocaleString()}</p>
      </section>

      {/* Top 3 damage dealers */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.15)' }}>
        <h3 className="font-extrabold mb-3" style={{ color: '#e8e0d0' }}>Top damage dealers</h3>
        {topDealers.length === 0 ? (
          <p className="text-xs text-center py-3" style={{ color: '#475569' }}>No damage recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {topDealers.slice(0, 3).map((dealer, i) => {
              const maxDmg = topDealers[0]?.damage || 1;
              const pct = Math.round((dealer.damage / maxDmg) * 100);
              const isMe = String(dealer.user_id) === String(user?.id);
              const medalColor = i === 0 ? '#c9a84c' : i === 1 ? '#94a3b8' : '#cd7f32';
              return (
                <div
                  key={dealer.user_id || i}
                  style={i === 0 ? {
                    background: 'rgba(201,168,76,0.06)',
                    border: '1px solid rgba(201,168,76,0.15)',
                    borderRadius: 8,
                    padding: '6px 8px',
                  } : undefined}
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-bold" style={{ color: isMe ? '#c9a84c' : '#e8e0d0' }}>
                      <span style={{ fontSize: 14 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>{' '}
                      {isMe ? 'You' : dealer.first_name || dealer.username || 'Unknown'}
                    </span>
                    <span className="font-semibold" style={{ color: '#64748b' }}>
                      {(dealer.damage || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: isMe ? '#c9a84c' : medalColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Loot preview */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)', boxShadow: '0 0 20px rgba(201,168,76,0.06)' }}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.25)' }}>
            <Trophy className="w-5 h-5" style={{ color: '#c9a84c' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold" style={{ color: '#e8e0d0' }}>Loot on boss kill</p>
            <p className="text-xs font-medium" style={{ color: '#64748b' }}>Coins, XP, possible item drop.</p>
          </div>
          <div className="flex items-center gap-1 font-extrabold" style={{ color: '#c9a84c' }}>
            <Coins className="w-4 h-4" />
            {bossState.loot_coins_preview ? `${bossState.loot_coins_preview}+` : '—'}
          </div>
        </div>
      </section>
    </div>
  );
}
