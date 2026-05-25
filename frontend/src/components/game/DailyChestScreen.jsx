import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Coins,
  Gift,
  PackageOpen,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
} from 'lucide-react';
import apiClient from '../../api/client';
import {
  formatClassLabel,
  formatSlotLabel,
  getTierLabel,
  getTierTheme,
} from '../../utils/itemPresentation';

// Keep in sync with backend daily_chest.py ITEM_DROP_CHANCES
const ITEM_DROP_TABLE = [
  { tier: 'legendary', label: 'Legendary', chance: 0.003, color: '#fbbf24', bg: 'rgba(251,191,36,0.13)', border: 'rgba(251,191,36,0.3)'  },
  { tier: 'epic',      label: 'Epic',      chance: 0.02,  color: '#c084fc', bg: 'rgba(192,132,252,0.11)', border: 'rgba(192,132,252,0.28)' },
  { tier: 'rare',      label: 'Rare',      chance: 0.05,  color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.24)'  },
  { tier: 'uncommon',  label: 'Uncommon',  chance: 0.15,  color: '#4ade80', bg: 'rgba(74,222,128,0.09)', border: 'rgba(74,222,128,0.22)'  },
  { tier: 'common',    label: 'Common',    chance: 0.35,  color: '#94a3b8', bg: 'rgba(148,163,184,0.09)', border: 'rgba(148,163,184,0.2)'  },
];
const TOTAL_ITEM_CHANCE = ITEM_DROP_TABLE.reduce((s, r) => s + r.chance, 0);
const COIN_RANGE = { min: 20, max: 80 };
const XP_RANGE   = { min: 5,  max: 20 };

function formatCountdown(targetAt) {
  if (!targetAt) return '--:--:--';
  const t = new Date(targetAt).getTime();
  if (Number.isNaN(t)) return '--:--:--';
  const diff = Math.max(0, t - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatChestDate(value) {
  if (!value) return 'Today';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RewardPill({ icon: Icon, label, value, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'rgba(15,23,42,0.72)',
      border: `1px solid ${color}40`,
      borderRadius: 16, padding: '12px 13px',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, color, fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.08em' }}>
        <Icon size={14} />{label}
      </div>
      <div style={{ color:'#f8fafc', fontSize:24, fontWeight:950, lineHeight:1.15, marginTop:4 }}>{value}</div>
    </div>
  );
}

function DroppedItemCard({ item }) {
  if (!item) return null;
  const tierTheme  = getTierTheme(item);
  const tierLabel  = getTierLabel(item);
  const tierKey    = String(item.tier || item.rarity || '').toLowerCase();
  const premium    = tierKey === 'epic' || tierKey === 'legendary';
  const classLabel = formatClassLabel(item.class_name) || 'Any class';
  const slotLabel  = formatSlotLabel(item.slot) || 'Gear';

  return (
    <article style={{
      position:'relative', overflow:'hidden',
      background: premium
        ? `linear-gradient(135deg, rgba(15,23,42,0.96), ${tierTheme.soft}, rgba(42,31,9,0.88))`
        : 'linear-gradient(135deg, rgba(15,23,42,0.94), rgba(30,41,59,0.76))',
      border: `1px solid ${tierTheme.border}`,
      borderRadius: 20, padding: 15,
      boxShadow: premium ? `0 18px 40px ${tierTheme.glow}` : 'none',
    }}>
      {premium && (
        <div style={{
          position:'absolute', inset:'-40px -30px auto auto',
          width:140, height:140,
          background:`radial-gradient(circle, ${tierTheme.glow}, transparent 68%)`,
          pointerEvents:'none',
        }} />
      )}
      <div style={{ display:'flex', gap:13, alignItems:'center', position:'relative' }}>
        <div style={{
          width:54, height:54, borderRadius:18,
          background: tierTheme.soft, border:`1px solid ${tierTheme.border}`,
          color: tierTheme.color,
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
        }}>
          <Shield size={27} strokeWidth={2.4} />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5, flexWrap:'wrap' }}>
            <span style={{
              background: tierTheme.soft, border:`1px solid ${tierTheme.border}`,
              color: tierTheme.color, borderRadius:999, padding:'3px 8px',
              fontSize:10, fontWeight:950, textTransform:'uppercase', letterSpacing:'0.08em',
            }}>{tierLabel}</span>
            {premium && (
              <span style={{
                color:'#111827', background:'linear-gradient(135deg, #facc15, #c9a84c)',
                borderRadius:999, padding:'3px 8px', fontSize:10, fontWeight:950, textTransform:'uppercase',
              }}>Rare drop</span>
            )}
          </div>
          <h3 style={{ color:'#f8fafc', fontSize:16, fontWeight:950, margin:'0 0 5px', lineHeight:1.15 }}>
            {item.name || item.item_id || 'Dropped item'}
            {(item.enchant_level || 0) > 0 ? ` +${item.enchant_level}` : ''}
          </h3>
          <p style={{ color:'rgba(203,213,225,0.7)', fontSize:12, fontWeight:700, margin:0 }}>
            {classLabel} / {slotLabel}
          </p>
        </div>
      </div>
    </article>
  );
}

function DropRatesPanel() {
  const noItemChance = 1 - TOTAL_ITEM_CHANCE;
  // normalize bars against the largest single value (no-item ~42.7% > common 35%)
  const maxChance = Math.max(...ITEM_DROP_TABLE.map((r) => r.chance), noItemChance);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Item drop table */}
      <div>
        <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>
          Item drop chances
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          {ITEM_DROP_TABLE.map(({ tier, label, chance, color, bg, border }) => {
            const barPct = Math.sqrt(chance / maxChance) * 100;
            const displayPct = chance < 0.01
              ? `${(chance * 100).toFixed(1)}%`
              : `${Math.round(chance * 100)}%`;
            return (
              <div key={tier} style={{
                display:'flex', alignItems:'center', gap:10,
                background: bg, border:`1px solid ${border}`,
                borderRadius:10, padding:'8px 12px',
              }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:color, flexShrink:0, boxShadow:`0 0 6px ${color}88` }} />
                <span style={{ color, fontWeight:800, fontSize:12, width:78, flexShrink:0 }}>{label}</span>
                <div style={{ flex:1, height:5, borderRadius:3, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
                  <div style={{ height:'100%', borderRadius:3, background:`linear-gradient(90deg, ${color}, ${color}88)`, width:`${barPct}%` }} />
                </div>
                <span style={{ color, fontWeight:900, fontSize:12, width:36, textAlign:'right', flexShrink:0 }}>{displayPct}</span>
              </div>
            );
          })}
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 12px' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#334155', flexShrink:0 }} />
            <span style={{ color:'#475569', fontWeight:700, fontSize:12, width:78, flexShrink:0 }}>No item</span>
            <div style={{ flex:1, height:5, borderRadius:3, background:'rgba(255,255,255,0.04)', overflow:'hidden' }}>
              <div style={{ height:'100%', borderRadius:3, background:'#334155', width:`${Math.sqrt(noItemChance / maxChance) * 100}%` }} />
            </div>
            <span style={{ color:'#475569', fontWeight:800, fontSize:12, width:36, textAlign:'right', flexShrink:0 }}>
              {Math.round(noItemChance * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height:1, background:'rgba(255,255,255,0.06)' }} />

      {/* Always guaranteed */}
      <div>
        <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>
          Always guaranteed
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ flex:1, background:'rgba(250,204,21,0.08)', border:'1px solid rgba(250,204,21,0.2)', borderRadius:10, padding:'9px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, color:'#facc15', fontSize:11, fontWeight:800, marginBottom:3 }}>
              <Coins size={12} /> COINS
            </div>
            <div style={{ color:'#f8fafc', fontSize:18, fontWeight:900 }}>{COIN_RANGE.min}–{COIN_RANGE.max}</div>
            <div style={{ color:'rgba(203,213,225,0.5)', fontSize:10, marginTop:1 }}>per open</div>
          </div>
          <div style={{ flex:1, background:'rgba(147,197,253,0.08)', border:'1px solid rgba(147,197,253,0.2)', borderRadius:10, padding:'9px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, color:'#93c5fd', fontSize:11, fontWeight:800, marginBottom:3 }}>
              <Star size={12} /> XP
            </div>
            <div style={{ color:'#f8fafc', fontSize:18, fontWeight:900 }}>{XP_RANGE.min}–{XP_RANGE.max}</div>
            <div style={{ color:'rgba(203,213,225,0.5)', fontSize:10, marginTop:1 }}>per open</div>
          </div>
        </div>
      </div>

      {/* Item types */}
      <div>
        <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>
          Item types that can drop
        </div>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
          {['Weapon', 'Armor', 'Ability'].map((type) => (
            <span key={type} style={{
              background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.2)',
              borderRadius:20, padding:'4px 12px',
              color:'#c9a84c', fontSize:12, fontWeight:700,
            }}>{type}</span>
          ))}
        </div>
        <p style={{ color:'rgba(203,213,225,0.45)', fontSize:11, margin:'8px 0 0', lineHeight:1.4 }}>
          Items roll from your class first. If none found, any class can drop.
        </p>
      </div>
    </div>
  );
}

export default function DailyChestScreen({ onBack, onUserUpdate }) {
  const [chest,    setChest]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error,    setError]    = useState('');
  const [reward,   setReward]   = useState(null);
  const [countdown, setCountdown] = useState('--:--:--');
  const [showRates, setShowRates] = useState(false);
  const lastResetRefreshAtRef = useRef(0);

  const fetchChest = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/daily-chest');
      setChest(res.data || null);
      return res.data || null;
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Daily chest is temporarily unavailable.';
      setError(detail);
      if (!silent) toast.error('Failed to load daily chest');
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChest();
    const onFocus   = () => fetchChest({ silent: true });
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchChest]);

  useEffect(() => {
    const targetAt = chest?.next_available_at || chest?.reset_at;
    const tick = () => {
      setCountdown(formatCountdown(targetAt));
      const targetTime = targetAt ? new Date(targetAt).getTime() : NaN;
      if (
        targetAt && !Number.isNaN(targetTime) &&
        Date.now() >= targetTime && chest && !chest.available &&
        Date.now() - lastResetRefreshAtRef.current > 5000
      ) {
        lastResetRefreshAtRef.current = Date.now();
        fetchChest({ silent: true });
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [chest, chest?.next_available_at, chest?.reset_at, fetchChest]);

  const claimed  = Boolean(chest?.claimed_today);
  const available = Boolean(chest?.available);
  const disabled = loading || claiming || claimed || !available;

  const statusCopy = useMemo(() => {
    if (loading)   return 'Checking chest status...';
    if (available) return 'Your free chest is ready.';
    if (claimed)   return `Next chest in ${countdown}`;
    return `Available in ${countdown}`;
  }, [available, claimed, countdown, loading]);

  const handleClaim = async () => {
    if (disabled) return;
    setClaiming(true);
    setError('');
    try {
      const res  = await apiClient.post('/daily-chest/claim');
      const data = res.data || {};
      if (data.success === false) throw new Error('Chest was not claimed');
      setReward(data);
      const patch = {};
      if (data.new_balance !== undefined) patch.token_balance = data.new_balance;
      if (data.new_xp      !== undefined) patch.xp            = data.new_xp;
      if (data.new_level   !== undefined) patch.level         = data.new_level;
      if (Object.keys(patch).length) {
        try { localStorage.removeItem('user_progress'); } catch {}
        onUserUpdate?.(patch);
      }
      await fetchChest({ silent: true });
      toast.success('Daily chest claimed');
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to claim daily chest';
      setError(detail);
      toast.error(detail);
      if (/already claimed/i.test(detail)) fetchChest({ silent: true });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div style={{ maxWidth:560, margin:'0 auto', padding:'0 14px 92px', minHeight:'100%' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <header style={{ padding:'14px 0 12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
        <button
          type="button" onClick={onBack} aria-label="Back"
          style={{
            width:38, height:38, borderRadius:13,
            background:'rgba(15,23,42,0.78)', border:'1px solid rgba(148,163,184,0.16)',
            color:'#f8fafc', display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', flexShrink:0,
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#f8fafc', fontSize:19, fontWeight:950, letterSpacing:'-0.03em', lineHeight:1 }}>
            Free Daily Chest
          </div>
          <div style={{ color:'rgba(203,213,225,0.62)', fontSize:11, fontWeight:700, marginTop:4 }}>
            {formatChestDate(chest?.chest_date)} reward drop
          </div>
        </div>
        <div style={{
          background: available ? 'linear-gradient(135deg, #facc15, #c9a84c)' : 'rgba(15,23,42,0.78)',
          border:'1px solid rgba(201,168,76,0.25)', borderRadius:14, padding:'7px 9px',
          color: available ? '#111827' : '#c9a84c', minWidth:86, textAlign:'center',
        }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4, fontSize:10, fontWeight:900, textTransform:'uppercase', letterSpacing:'0.06em' }}>
            <Clock3 size={11} /> {available ? 'Ready' : 'Reset'}
          </div>
          <div style={{ color: available ? '#111827' : '#f8fafc', fontSize:13, fontWeight:950, fontVariantNumeric:'tabular-nums' }}>
            {available ? 'Open' : countdown}
          </div>
        </div>
      </header>

      {/* ── Chest hero card ────────────────────────────────── */}
      <section style={{
        position:'relative', overflow:'hidden',
        background:'linear-gradient(135deg, rgba(42,31,9,0.94), rgba(15,23,42,0.95) 48%, rgba(201,168,76,0.18))',
        border:`1px solid ${available ? 'rgba(250,204,21,0.45)' : 'rgba(201,168,76,0.28)'}`,
        borderRadius:24, padding:18, marginBottom:10,
        boxShadow: available ? '0 18px 45px rgba(201,168,76,0.18), 0 0 0 1px rgba(250,204,21,0.12)' : '0 18px 45px rgba(0,0,0,0.24)',
      }}>
        {/* glow blob */}
        <div style={{
          position:'absolute', right:-32, top:-36, width:180, height:180,
          background:`radial-gradient(circle, ${available ? 'rgba(250,204,21,0.26)' : 'rgba(250,204,21,0.12)'}, transparent 68%)`,
          pointerEvents:'none',
        }} />

        <div style={{ position:'relative', display:'flex', alignItems:'center', gap:14 }}>
          {/* Chest icon */}
          <div style={{
            width:80, height:80, borderRadius:24, flexShrink:0,
            background: available
              ? 'linear-gradient(135deg, #facc15, #c9a84c)'
              : claimed
                ? 'rgba(34,197,94,0.14)'
                : 'rgba(201,168,76,0.12)',
            border: available ? '2px solid rgba(255,255,255,0.18)' : '1px solid rgba(201,168,76,0.22)',
            color: available ? '#111827' : claimed ? '#4ade80' : '#c9a84c',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow: available ? '0 12px 30px rgba(201,168,76,0.35)' : 'none',
          }}>
            {claimed ? <CheckCircle2 size={40} /> : <Gift size={40} />}
          </div>

          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5, flexWrap:'wrap' }}>
              <span style={{ color:'#c9a84c', fontSize:11, fontWeight:950, textTransform:'uppercase', letterSpacing:'0.1em' }}>
                One free chest per day
              </span>
              {available && (
                <span style={{
                  color:'#86efac', background:'rgba(34,197,94,0.14)', border:'1px solid rgba(34,197,94,0.24)',
                  borderRadius:999, padding:'2px 7px', fontSize:10, fontWeight:950, textTransform:'uppercase',
                }}>Ready</span>
              )}
            </div>
            <h2 style={{ color:'#f8fafc', fontSize:22, fontWeight:950, letterSpacing:'-0.03em', lineHeight:1.08, margin:'0 0 6px' }}>
              {claimed ? 'Chest claimed today' : 'Open for coins, XP & items'}
            </h2>
            <p style={{ color:'rgba(203,213,225,0.65)', fontSize:12, lineHeight:1.4, margin:0 }}>
              {claimed
                ? `Next chest resets in ${countdown}`
                : 'Reward is rolled server-side when you open.'}
            </p>
          </div>
        </div>

        {/* Open button */}
        <button
          type="button" onClick={handleClaim} disabled={disabled}
          style={{
            width:'100%', marginTop:16, border:'none', borderRadius:16,
            padding:'15px 16px', cursor: disabled ? 'not-allowed' : 'pointer',
            background: disabled
              ? 'rgba(71,85,105,0.38)'
              : 'linear-gradient(135deg, #facc15 0%, #c9a84c 100%)',
            color: disabled ? 'rgba(203,213,225,0.56)' : '#111827',
            fontSize:16, fontWeight:950,
            boxShadow: disabled ? 'none' : '0 8px 24px rgba(201,168,76,0.3)',
            display:'flex', alignItems:'center', justifyContent:'center', gap:9,
            transition:'opacity 0.15s',
          }}
        >
          {claiming ? <RefreshCw size={18} /> : claimed ? <CheckCircle2 size={18} /> : <PackageOpen size={19} />}
          {claiming ? 'Opening...' : claimed ? `Claimed — next in ${countdown}` : available ? 'Open Free Chest' : statusCopy}
        </button>
      </section>

      {/* ── "See what's inside" toggle ─────────────────────── */}
      <button
        type="button"
        onClick={() => setShowRates((v) => !v)}
        style={{
          width:'100%', marginBottom:10, border:'1px solid rgba(201,168,76,0.18)',
          borderRadius:14, padding:'11px 16px', cursor:'pointer',
          background:'rgba(26,26,46,0.7)',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
        }}
      >
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Sparkles size={15} color="#c9a84c" />
          <span style={{ color:'#c9a84c', fontWeight:800, fontSize:14 }}>
            See what's inside
          </span>
          <div style={{ display:'flex', gap:4 }}>
            {ITEM_DROP_TABLE.map((r) => (
              <div key={r.tier} style={{ width:8, height:8, borderRadius:'50%', background:r.color, boxShadow:`0 0 4px ${r.color}99` }} />
            ))}
          </div>
        </div>
        {showRates
          ? <ChevronUp size={16} color="#94a3b8" />
          : <ChevronDown size={16} color="#94a3b8" />}
      </button>

      {showRates && (
        <div style={{
          background:'rgba(15,23,42,0.86)', border:'1px solid rgba(201,168,76,0.15)',
          borderRadius:18, padding:'16px 16px 18px', marginBottom:10,
        }}>
          <DropRatesPanel />
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────── */}
      {error && (
        <div style={{
          background:'rgba(127,29,29,0.18)', border:'1px solid rgba(248,113,113,0.25)',
          borderRadius:18, padding:14, color:'#fecaca',
          display:'flex', alignItems:'center', gap:10, marginBottom:10,
        }}>
          <AlertTriangle size={20} color="#f87171" />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:900, fontSize:13 }}>Chest unavailable</div>
            <div style={{ color:'rgba(254,202,202,0.72)', fontSize:12 }}>{error}</div>
          </div>
          <button
            type="button" onClick={() => fetchChest()}
            style={{
              border:'1px solid rgba(248,113,113,0.32)', background:'rgba(15,23,42,0.72)',
              color:'#fee2e2', borderRadius:999, padding:'7px 10px',
              fontWeight:850, cursor:'pointer', flexShrink:0,
            }}
          >Retry</button>
        </div>
      )}

      {/* ── Result states ───────────────────────────────────── */}
      {loading ? (
        <div style={{
          background:'rgba(15,23,42,0.84)', border:'1px solid rgba(148,163,184,0.14)',
          borderRadius:18, padding:18, color:'rgba(203,213,225,0.68)',
          textAlign:'center', fontWeight:800,
        }}>
          Checking today's chest...
        </div>
      ) : reward ? (
        <section style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{
            background:'rgba(15,23,42,0.84)', border:'1px solid rgba(201,168,76,0.18)',
            borderRadius:20, padding:14,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, color:'#f8fafc', fontSize:15, fontWeight:950, marginBottom:12 }}>
              <Sparkles size={17} color="#c9a84c" /> Reward revealed
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <RewardPill icon={Coins} label="Coins" value={`+${reward.reward_coins || 0}`} color="#facc15" />
              <RewardPill icon={Star}  label="XP"    value={`+${reward.reward_xp    || 0}`} color="#93c5fd" />
            </div>
          </div>
          {reward.item_drop ? (
            <DroppedItemCard item={reward.item_drop} />
          ) : (
            <div style={{
              background:'rgba(15,23,42,0.72)', border:'1px solid rgba(148,163,184,0.13)',
              borderRadius:18, padding:15,
              color:'rgba(203,213,225,0.72)', fontSize:12.5, lineHeight:1.4,
            }}>
              No item drop this time — coins and XP were added to your account.
            </div>
          )}
        </section>
      ) : chest?.last_reward ? (
        <section style={{
          background:'rgba(15,23,42,0.78)', border:'1px solid rgba(148,163,184,0.14)',
          borderRadius:20, padding:15, color:'rgba(203,213,225,0.72)',
        }}>
          <div style={{ color:'#f8fafc', fontSize:14, fontWeight:950, marginBottom:9 }}>
            Today's chest claimed
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <RewardPill icon={Coins} label="Coins" value={`+${chest.last_reward.reward_coins || 0}`} color="#facc15" />
            <RewardPill icon={Star}  label="XP"    value={`+${chest.last_reward.reward_xp    || 0}`} color="#93c5fd" />
          </div>
          {chest.last_reward.item_tier && (
            <p style={{ margin:'11px 0 0', fontSize:12 }}>
              Item dropped: <span style={{ color:'#c9a84c', fontWeight:900 }}>
                {String(chest.last_reward.item_tier).toUpperCase()}
              </span>
              {chest.last_reward.item_id ? ` — #${chest.last_reward.item_id}` : ''}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
