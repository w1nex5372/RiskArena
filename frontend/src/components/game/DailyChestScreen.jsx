import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
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

function formatCountdown(targetAt) {
  if (!targetAt) return '--:--:--';
  const targetTime = new Date(targetAt).getTime();
  if (Number.isNaN(targetTime)) return '--:--:--';

  const diff = Math.max(0, targetTime - Date.now());
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatChestDate(value) {
  if (!value) return 'Today';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RewardPill({ icon: Icon, label, value, color }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      background: 'rgba(15,23,42,0.72)',
      border: `1px solid ${color}40`,
      borderRadius: 16,
      padding: '12px 13px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        <Icon size={14} />
        {label}
      </div>
      <div style={{ color: '#f8fafc', fontSize: 24, fontWeight: 950, lineHeight: 1.15, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function DroppedItemCard({ item }) {
  if (!item) return null;

  const tierTheme = getTierTheme(item);
  const tierLabel = getTierLabel(item);
  const tierKey = String(item.tier || item.rarity || '').toLowerCase();
  const premium = tierKey === 'epic' || tierKey === 'legendary';
  const classLabel = formatClassLabel(item.class_name) || 'Any class';
  const slotLabel = formatSlotLabel(item.slot) || 'Gear';

  return (
    <article style={{
      position: 'relative',
      overflow: 'hidden',
      background: premium
        ? `linear-gradient(135deg, rgba(15,23,42,0.96), ${tierTheme.soft}, rgba(42,31,9,0.88))`
        : 'linear-gradient(135deg, rgba(15,23,42,0.94), rgba(30,41,59,0.76))',
      border: `1px solid ${tierTheme.border}`,
      borderRadius: 20,
      padding: 15,
      boxShadow: premium ? `0 18px 40px ${tierTheme.glow}` : 'none',
    }}>
      {premium && (
        <div style={{
          position: 'absolute',
          inset: '-40px -30px auto auto',
          width: 140,
          height: 140,
          background: `radial-gradient(circle, ${tierTheme.glow}, transparent 68%)`,
          pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'flex', gap: 13, alignItems: 'center', position: 'relative' }}>
        <div style={{
          width: 54,
          height: 54,
          borderRadius: 18,
          background: tierTheme.soft,
          border: `1px solid ${tierTheme.border}`,
          color: tierTheme.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Shield size={27} strokeWidth={2.4} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{
              background: tierTheme.soft,
              border: `1px solid ${tierTheme.border}`,
              color: tierTheme.color,
              borderRadius: 999,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 950,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              {tierLabel}
            </span>
            {premium && (
              <span style={{
                color: '#111827',
                background: 'linear-gradient(135deg, #facc15, #c9a84c)',
                borderRadius: 999,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 950,
                textTransform: 'uppercase',
              }}>
                Rare drop
              </span>
            )}
          </div>
          <h3 style={{ color: '#f8fafc', fontSize: 16, fontWeight: 950, margin: '0 0 5px', lineHeight: 1.15 }}>
            {item.name || item.item_id || 'Dropped item'}
            {(item.enchant_level || 0) > 0 ? ` +${item.enchant_level}` : ''}
          </h3>
          <p style={{ color: 'rgba(203,213,225,0.7)', fontSize: 12, fontWeight: 700, margin: 0 }}>
            {classLabel} / {slotLabel}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function DailyChestScreen({ onBack, onUserUpdate }) {
  const [chest, setChest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [reward, setReward] = useState(null);
  const [countdown, setCountdown] = useState('--:--:--');
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

    const refreshOnFocus = () => fetchChest({ silent: true });
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') refreshOnFocus();
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [fetchChest]);

  useEffect(() => {
    const targetAt = chest?.next_available_at || chest?.reset_at;
    const tick = () => {
      setCountdown(formatCountdown(targetAt));
      const targetTime = targetAt ? new Date(targetAt).getTime() : NaN;
      if (
        targetAt &&
        !Number.isNaN(targetTime) &&
        Date.now() >= targetTime &&
        chest &&
        !chest.available &&
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

  const claimed = Boolean(chest?.claimed_today);
  const available = Boolean(chest?.available);
  const disabled = loading || claiming || claimed || !available;

  const statusCopy = useMemo(() => {
    if (loading) return 'Checking chest status...';
    if (available) return 'Your free chest is ready.';
    if (claimed) return `Next chest in ${countdown}`;
    return `Available in ${countdown}`;
  }, [available, claimed, countdown, loading]);

  const handleClaim = async () => {
    if (disabled) return;

    setClaiming(true);
    setError('');

    try {
      const res = await apiClient.post('/daily-chest/claim');
      const data = res.data || {};
      if (data.success === false) throw new Error('Chest was not claimed');

      setReward(data);

      const userPatch = {};
      if (data.new_balance !== undefined) userPatch.token_balance = data.new_balance;
      if (data.new_xp !== undefined) userPatch.xp = data.new_xp;
      if (data.new_level !== undefined) userPatch.level = data.new_level;
      if (Object.keys(userPatch).length) {
        try { localStorage.removeItem('user_progress'); } catch {}
        onUserUpdate?.(userPatch);
      }

      await fetchChest({ silent: true });
      toast.success('Daily chest claimed');
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to claim daily chest';
      setError(detail);
      toast.error(detail);
      if (/already claimed/i.test(detail)) {
        fetchChest({ silent: true });
      }
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div style={{
      maxWidth: 560,
      margin: '0 auto',
      padding: '0 14px 92px',
      minHeight: '100%',
    }}>
      <header style={{
        padding: '14px 0 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          style={{
            width: 38,
            height: 38,
            borderRadius: 13,
            background: 'rgba(15,23,42,0.78)',
            border: '1px solid rgba(148,163,184,0.16)',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={18} />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#f8fafc', fontSize: 19, fontWeight: 950, letterSpacing: '-0.03em', lineHeight: 1 }}>
            Free Daily Chest
          </div>
          <div style={{ color: 'rgba(203,213,225,0.62)', fontSize: 11, fontWeight: 700, marginTop: 4 }}>
            {formatChestDate(chest?.chest_date)} reward drop
          </div>
        </div>

        <div style={{
          background: available ? 'linear-gradient(135deg, #facc15, #c9a84c)' : 'rgba(15,23,42,0.78)',
          border: '1px solid rgba(201,168,76,0.25)',
          borderRadius: 14,
          padding: '7px 9px',
          color: available ? '#111827' : '#c9a84c',
          minWidth: 86,
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <Clock3 size={11} /> {available ? 'Ready' : 'Reset'}
          </div>
          <div style={{ color: available ? '#111827' : '#f8fafc', fontSize: 13, fontWeight: 950, fontVariantNumeric: 'tabular-nums' }}>
            {available ? 'Open' : countdown}
          </div>
        </div>
      </header>

      <section style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(42,31,9,0.94), rgba(15,23,42,0.95) 48%, rgba(201,168,76,0.2))',
        border: '1px solid rgba(201,168,76,0.28)',
        borderRadius: 24,
        padding: 18,
        marginBottom: 14,
        boxShadow: '0 18px 45px rgba(0,0,0,0.24)',
      }}>
        <div style={{
          position: 'absolute',
          right: -32,
          top: -36,
          width: 160,
          height: 160,
          background: 'radial-gradient(circle, rgba(250,204,21,0.2), transparent 68%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 76,
            height: 76,
            borderRadius: 24,
            background: available
              ? 'linear-gradient(135deg, #facc15, #c9a84c)'
              : 'rgba(201,168,76,0.12)',
            border: '1px solid rgba(250,204,21,0.32)',
            color: available ? '#111827' : '#c9a84c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: available ? '0 12px 30px rgba(201,168,76,0.24)' : 'none',
          }}>
            {claimed ? <CheckCircle2 size={38} /> : <Gift size={38} />}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ color: '#c9a84c', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                One free chest per day
              </span>
              {available && (
                <span style={{
                  color: '#86efac',
                  background: 'rgba(34,197,94,0.14)',
                  border: '1px solid rgba(34,197,94,0.24)',
                  borderRadius: 999,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 950,
                  textTransform: 'uppercase',
                }}>
                  Ready
                </span>
              )}
            </div>
            <h2 style={{ color: '#f8fafc', fontSize: 25, fontWeight: 950, letterSpacing: '-0.04em', lineHeight: 1.05, margin: '0 0 8px' }}>
              Open for coins, XP, and item drops.
            </h2>
            <p style={{ color: 'rgba(203,213,225,0.7)', fontSize: 12.5, lineHeight: 1.4, margin: 0 }}>
              Rare gear can drop from the chest. The exact reward is rolled by the server when you claim.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClaim}
          disabled={disabled}
          style={{
            width: '100%',
            marginTop: 16,
            border: 'none',
            borderRadius: 16,
            padding: '14px 16px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: disabled
              ? 'rgba(71,85,105,0.38)'
              : 'linear-gradient(135deg, #facc15, #c9a84c)',
            color: disabled ? 'rgba(203,213,225,0.56)' : '#111827',
            fontSize: 15,
            fontWeight: 950,
            boxShadow: disabled ? 'none' : '0 12px 26px rgba(201,168,76,0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {claiming ? <RefreshCw size={18} /> : claimed ? <CheckCircle2 size={18} /> : <PackageOpen size={18} />}
          {claiming ? 'Opening...' : claimed ? `Claimed - next in ${countdown}` : available ? 'Open Free Chest' : statusCopy}
        </button>
      </section>

      {error && (
        <div style={{
          background: 'rgba(127,29,29,0.18)',
          border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 18,
          padding: 14,
          color: '#fecaca',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
        }}>
          <AlertTriangle size={20} color="#f87171" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 13 }}>Chest unavailable</div>
            <div style={{ color: 'rgba(254,202,202,0.72)', fontSize: 12 }}>{error}</div>
          </div>
          <button
            type="button"
            onClick={() => fetchChest()}
            style={{
              border: '1px solid rgba(248,113,113,0.32)',
              background: 'rgba(15,23,42,0.72)',
              color: '#fee2e2',
              borderRadius: 999,
              padding: '7px 10px',
              fontWeight: 850,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div style={{
          background: 'rgba(15,23,42,0.84)',
          border: '1px solid rgba(148,163,184,0.14)',
          borderRadius: 18,
          padding: 18,
          color: 'rgba(203,213,225,0.68)',
          textAlign: 'center',
          fontWeight: 800,
        }}>
          Checking today's chest...
        </div>
      ) : reward ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'rgba(15,23,42,0.84)',
            border: '1px solid rgba(201,168,76,0.18)',
            borderRadius: 20,
            padding: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#f8fafc', fontSize: 15, fontWeight: 950, marginBottom: 12 }}>
              <Sparkles size={17} color="#c9a84c" />
              Reward revealed
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <RewardPill icon={Coins} label="Coins" value={`+${reward.reward_coins || 0}`} color="#facc15" />
              <RewardPill icon={Star} label="XP" value={`+${reward.reward_xp || 0}`} color="#93c5fd" />
            </div>
          </div>

          {reward.item_drop ? (
            <DroppedItemCard item={reward.item_drop} />
          ) : (
            <div style={{
              background: 'rgba(15,23,42,0.72)',
              border: '1px solid rgba(148,163,184,0.13)',
              borderRadius: 18,
              padding: 15,
              color: 'rgba(203,213,225,0.72)',
              fontSize: 12.5,
              lineHeight: 1.4,
            }}>
              No item this time, but your coins and XP were claimed.
            </div>
          )}
        </section>
      ) : chest?.last_reward ? (
        <section style={{
          background: 'rgba(15,23,42,0.78)',
          border: '1px solid rgba(148,163,184,0.14)',
          borderRadius: 20,
          padding: 15,
          color: 'rgba(203,213,225,0.72)',
        }}>
          <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 950, marginBottom: 9 }}>
            Today's chest claimed
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <RewardPill icon={Coins} label="Coins" value={`+${chest.last_reward.reward_coins || 0}`} color="#facc15" />
            <RewardPill icon={Star} label="XP" value={`+${chest.last_reward.reward_xp || 0}`} color="#93c5fd" />
          </div>
          {chest.last_reward.item_tier && (
            <p style={{ margin: '11px 0 0', fontSize: 12 }}>
              Item drop: <span style={{ color: '#c9a84c', fontWeight: 900 }}>{String(chest.last_reward.item_tier).toUpperCase()}</span>
              {chest.last_reward.item_id ? ` / ${chest.last_reward.item_id}` : ''}
            </p>
          )}
        </section>
      ) : (
        <section style={{
          background: 'rgba(15,23,42,0.78)',
          border: '1px solid rgba(148,163,184,0.14)',
          borderRadius: 20,
          padding: 15,
          color: 'rgba(203,213,225,0.72)',
        }}>
          <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 950, marginBottom: 5 }}>
            What can drop?
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.45, margin: 0 }}>
            Every claim grants coins and XP. Some chests also drop equipment, including rare, epic, or legendary items.
          </p>
        </section>
      )}
    </div>
  );
}
