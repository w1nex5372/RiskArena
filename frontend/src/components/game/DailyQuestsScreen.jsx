import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clock3,
  Coins,
  Flame,
  Gift,
  RefreshCw,
  Sparkles,
  Star,
  Target,
  Trophy,
} from 'lucide-react';
import apiClient from '../../api/client';

const QUEST_ICONS = [
  { test: /win|victory|winner/i, Icon: Trophy, color: '#f59e0b' },
  { test: /play|match|game|room/i, Icon: Target, color: '#38bdf8' },
  { test: /streak|daily|login|return/i, Icon: Flame, color: '#ef4444' },
  { test: /claim|reward|coin|token/i, Icon: Coins, color: '#facc15' },
];

function getQuestIcon(quest) {
  const haystack = `${quest?.key || ''} ${quest?.label || ''} ${quest?.description || ''}`;
  return QUEST_ICONS.find((item) => item.test.test(haystack)) || { Icon: CircleDot, color: '#c9a84c' };
}

function cleanText(value, fallback) {
  if (!value) return fallback;
  const cleaned = String(value)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function formatCountdown(resetAt) {
  if (!resetAt) return '--:--:--';
  const resetTime = new Date(resetAt).getTime();
  if (Number.isNaN(resetTime)) return '--:--:--';

  const diff = Math.max(0, resetTime - Date.now());
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatResetDate(questDate) {
  if (!questDate) return 'Today';
  const parsed = new Date(`${questDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return questDate;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SkeletonCard() {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(15,23,42,0.92), rgba(30,41,59,0.72))',
      border: '1px solid rgba(148,163,184,0.12)',
      borderRadius: 18,
      padding: 14,
      display: 'grid',
      gridTemplateColumns: '42px 1fr 70px',
      gap: 12,
      alignItems: 'center',
      marginBottom: 10,
    }}>
      <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(148,163,184,0.12)' }} />
      <div>
        <div style={{ height: 13, width: '65%', borderRadius: 999, background: 'rgba(148,163,184,0.12)', marginBottom: 9 }} />
        <div style={{ height: 9, width: '88%', borderRadius: 999, background: 'rgba(148,163,184,0.08)', marginBottom: 10 }} />
        <div style={{ height: 6, width: '100%', borderRadius: 999, background: 'rgba(148,163,184,0.08)' }} />
      </div>
      <div style={{ height: 30, borderRadius: 999, background: 'rgba(148,163,184,0.1)' }} />
    </div>
  );
}

function StatPill({ label, value, accent = '#c9a84c' }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      background: 'rgba(15,23,42,0.72)',
      border: '1px solid rgba(148,163,184,0.13)',
      borderRadius: 16,
      padding: '10px 12px',
    }}>
      <div style={{ color: 'rgba(203,213,225,0.72)', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: accent, fontSize: 18, fontWeight: 900, lineHeight: 1.25 }}>
        {value}
      </div>
    </div>
  );
}

function RewardLine({ coins, xp, muted }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {(coins || 0) > 0 && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: muted ? 'rgba(148,163,184,0.54)' : '#facc15',
          fontSize: 11,
          fontWeight: 900,
        }}>
          <Coins size={12} /> +{coins}
        </span>
      )}
      {(xp || 0) > 0 && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: muted ? 'rgba(148,163,184,0.54)' : '#93c5fd',
          fontSize: 11,
          fontWeight: 900,
        }}>
          <Star size={12} /> +{xp} XP
        </span>
      )}
    </div>
  );
}

function QuestCard({ quest, onClaim, claiming }) {
  const key = quest.key;
  const goal = Number(quest.goal || 0);
  const progress = Math.min(Number(quest.progress || 0), goal || Number(quest.progress || 0));
  const pct = goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : (quest.completed ? 100 : 0);
  const completed = Boolean(quest.completed);
  const claimed = Boolean(quest.claimed);
  const claimable = completed && !claimed;
  const isClaiming = claiming === key;
  const { Icon, color } = getQuestIcon(quest);
  const title = cleanText(quest.label, 'Daily quest');
  const description = cleanText(quest.description, 'Complete the objective to earn rewards.');

  return (
    <article style={{
      position: 'relative',
      overflow: 'hidden',
      background: claimable
        ? 'linear-gradient(135deg, rgba(42,31,9,0.96), rgba(15,23,42,0.94) 58%, rgba(21,128,61,0.26))'
        : 'linear-gradient(135deg, rgba(15,23,42,0.94), rgba(30,41,59,0.68))',
      border: `1px solid ${claimable ? 'rgba(201,168,76,0.52)' : 'rgba(148,163,184,0.13)'}`,
      boxShadow: claimable ? '0 14px 34px rgba(201,168,76,0.12)' : 'none',
      borderRadius: 18,
      padding: 14,
      marginBottom: 10,
    }}>
      {claimable && (
        <div style={{
          position: 'absolute',
          inset: '0 0 auto auto',
          width: 92,
          height: 92,
          background: 'radial-gradient(circle, rgba(250,204,21,0.18), transparent 68%)',
          pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr auto', gap: 12, alignItems: 'start', position: 'relative' }}>
        <div style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${color}24, rgba(15,23,42,0.75))`,
          border: `1px solid ${color}55`,
          color,
          flexShrink: 0,
        }}>
          <Icon size={22} strokeWidth={2.4} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: 14, fontWeight: 900, letterSpacing: '-0.01em' }}>
              {title}
            </h3>
            {claimed && <CheckCircle2 size={14} color="#64748b" />}
          </div>
          <p style={{ margin: '0 0 10px', color: 'rgba(203,213,225,0.68)', fontSize: 11.5, lineHeight: 1.35 }}>
            {description}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 999, background: 'rgba(148,163,184,0.12)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${pct}%`,
                borderRadius: 999,
                background: claimed
                  ? 'rgba(148,163,184,0.35)'
                  : completed
                    ? 'linear-gradient(90deg, #22c55e, #c9a84c)'
                    : 'linear-gradient(90deg, #8b0000, #c9a84c)',
                transition: 'width 0.35s ease',
              }} />
            </div>
            <span style={{ color: 'rgba(226,232,240,0.74)', fontSize: 11, fontWeight: 800, minWidth: 44, textAlign: 'right' }}>
              {progress}/{goal || '-'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, minWidth: 74 }}>
          <RewardLine coins={quest.reward_coins} xp={quest.reward_xp} muted={claimed} />
          {claimable ? (
            <button
              type="button"
              onClick={() => onClaim(key)}
              disabled={isClaiming}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: isClaiming ? 'rgba(201,168,76,0.56)' : 'linear-gradient(135deg, #facc15, #c9a84c)',
                color: '#111827',
                border: 'none',
                borderRadius: 999,
                padding: '7px 11px',
                fontSize: 12,
                fontWeight: 950,
                cursor: isClaiming ? 'not-allowed' : 'pointer',
                boxShadow: '0 8px 22px rgba(201,168,76,0.24)',
                whiteSpace: 'nowrap',
              }}
            >
              {isClaiming ? <RefreshCw size={13} /> : <Gift size={13} />}
              {isClaiming ? 'Claiming' : 'Claim'}
            </button>
          ) : (
            <span style={{
              color: claimed ? 'rgba(148,163,184,0.52)' : 'rgba(203,213,225,0.62)',
              fontSize: 11,
              fontWeight: 850,
              whiteSpace: 'nowrap',
            }}>
              {claimed ? 'Claimed' : completed ? 'Ready' : `${100 - pct}% left`}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export default function DailyQuestsScreen({ user, onBack, onUserUpdate }) {
  const [quests, setQuests] = useState([]);
  const [questDate, setQuestDate] = useState(null);
  const [resetAt, setResetAt] = useState(null);
  const [countdown, setCountdown] = useState('--:--:--');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(null);
  const refetchedResetRef = useRef(null);
  const refetchingResetRef = useRef(null);
  const resetRetryAfterRef = useRef(0);

  const fetchQuests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const res = await apiClient.get('/daily-quests');
      setQuests(Array.isArray(res.data?.quests) ? res.data.quests : []);
      setQuestDate(res.data?.quest_date || null);
      setResetAt(res.data?.reset_at || null);
      refetchedResetRef.current = null;
      return res.data || {};
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Daily quests are temporarily unavailable.';
      setError(detail);
      if (!silent) toast.error('Failed to load daily quests');
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  useEffect(() => {
    const tick = () => {
      setCountdown(formatCountdown(resetAt));
      if (!resetAt) return;

      const resetTime = new Date(resetAt).getTime();
      if (
        !Number.isNaN(resetTime) &&
        resetTime <= Date.now() &&
        refetchedResetRef.current !== resetAt &&
        refetchingResetRef.current !== resetAt &&
        resetRetryAfterRef.current <= Date.now()
      ) {
        refetchingResetRef.current = resetAt;
        fetchQuests({ silent: true }).then((data) => {
          refetchingResetRef.current = null;
          if (data?.reset_at && data.reset_at !== resetAt) {
            refetchedResetRef.current = resetAt;
            resetRetryAfterRef.current = 0;
          } else {
            resetRetryAfterRef.current = Date.now() + 5000;
          }
        });
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [fetchQuests, resetAt]);

  const summary = useMemo(() => {
    const total = quests.length;
    const completed = quests.filter((quest) => quest.completed).length;
    const claimed = quests.filter((quest) => quest.claimed).length;
    const claimable = quests.filter((quest) => quest.completed && !quest.claimed).length;
    const pct = total ? Math.round((completed / total) * 100) : 0;

    return { total, completed, claimed, claimable, pct };
  }, [quests]);

  const handleClaim = async (questKey) => {
    setClaiming(questKey);

    try {
      const res = await apiClient.post(`/daily-quests/${questKey}/claim`);
      const data = res.data || {};
      if (data.success === false) throw new Error('Reward was not claimed');

      setQuests((prev) =>
        prev.map((quest) => quest.key === questKey ? { ...quest, completed: true, claimed: true } : quest)
      );

      const userPatch = {};
      if (data.new_balance !== undefined) userPatch.token_balance = data.new_balance;
      if (data.new_xp !== undefined) userPatch.xp = data.new_xp;
      if (data.new_level !== undefined) userPatch.level = data.new_level;
      if (Object.keys(userPatch).length) {
        try { localStorage.removeItem('user_progress'); } catch {}
        onUserUpdate?.(userPatch);
      }

      const parts = [];
      if ((data.reward_coins || 0) > 0) parts.push(`+${data.reward_coins} tokens`);
      if ((data.reward_xp || 0) > 0) parts.push(`+${data.reward_xp} XP`);
      toast.success(parts.length ? `Reward claimed: ${parts.join(', ')}` : 'Reward claimed');
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to claim reward';
      toast.error(detail);
    } finally {
      setClaiming(null);
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
          aria-label="Back to rooms"
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
            Daily Quests
          </div>
          <div style={{ color: 'rgba(203,213,225,0.62)', fontSize: 11, fontWeight: 700, marginTop: 4 }}>
            {formatResetDate(questDate)} mission board
          </div>
        </div>

        <div style={{
          background: 'rgba(15,23,42,0.78)',
          border: '1px solid rgba(201,168,76,0.25)',
          borderRadius: 14,
          padding: '7px 9px',
          color: '#c9a84c',
          minWidth: 86,
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <Clock3 size={11} /> Reset
          </div>
          <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 950, fontVariantNumeric: 'tabular-nums' }}>
            {countdown}
          </div>
        </div>
      </header>

      <section style={{
        background: 'linear-gradient(135deg, rgba(139,0,0,0.36), rgba(15,23,42,0.92) 45%, rgba(201,168,76,0.18))',
        border: '1px solid rgba(201,168,76,0.22)',
        borderRadius: 22,
        padding: 14,
        marginBottom: 14,
        boxShadow: '0 18px 45px rgba(0,0,0,0.22)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#f8fafc', fontSize: 15, fontWeight: 950 }}>
              <Sparkles size={16} color="#c9a84c" />
              Build today's streak
            </div>
            <div style={{ color: 'rgba(203,213,225,0.68)', fontSize: 11.5, marginTop: 3 }}>
              Finish quests, claim rewards, keep your balance moving.
            </div>
          </div>
          <div style={{
            color: summary.claimable ? '#111827' : '#c9a84c',
            background: summary.claimable ? 'linear-gradient(135deg, #facc15, #c9a84c)' : 'rgba(201,168,76,0.12)',
            border: '1px solid rgba(201,168,76,0.28)',
            borderRadius: 999,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 950,
            whiteSpace: 'nowrap',
          }}>
            {summary.claimable} claimable
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <StatPill label="Complete" value={`${summary.completed}/${summary.total || 0}`} />
          <StatPill label="Claimed" value={summary.claimed} accent="#94a3b8" />
          <StatPill label="Balance" value={(user?.token_balance || 0).toLocaleString()} accent="#facc15" />
        </div>

        <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.14)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${summary.pct}%`,
            borderRadius: 999,
            background: 'linear-gradient(90deg, #8b0000, #c9a84c, #22c55e)',
            transition: 'width 0.45s ease',
          }} />
        </div>
      </section>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : error ? (
        <div style={{
          background: 'rgba(127,29,29,0.18)',
          border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 18,
          padding: 18,
          textAlign: 'center',
          color: '#fecaca',
        }}>
          <AlertTriangle size={24} style={{ margin: '0 auto 8px', color: '#f87171' }} />
          <div style={{ fontWeight: 900, marginBottom: 5 }}>Could not load quests</div>
          <div style={{ color: 'rgba(254,202,202,0.72)', fontSize: 12, marginBottom: 12 }}>{error}</div>
          <button
            type="button"
            onClick={() => fetchQuests()}
            style={{
              border: '1px solid rgba(248,113,113,0.32)',
              background: 'rgba(15,23,42,0.72)',
              color: '#fee2e2',
              borderRadius: 999,
              padding: '8px 14px',
              fontWeight: 850,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      ) : quests.length === 0 ? (
        <div style={{
          background: 'rgba(15,23,42,0.84)',
          border: '1px solid rgba(148,163,184,0.14)',
          borderRadius: 18,
          padding: 22,
          textAlign: 'center',
          color: 'rgba(226,232,240,0.82)',
        }}>
          <Gift size={26} style={{ margin: '0 auto 9px', color: '#c9a84c' }} />
          <div style={{ fontWeight: 950, color: '#f8fafc', marginBottom: 4 }}>No quests available</div>
          <div style={{ fontSize: 12, color: 'rgba(203,213,225,0.64)' }}>Check back after the next reset.</div>
        </div>
      ) : (
        quests.map((quest) => (
          <QuestCard
            key={quest.key}
            quest={quest}
            onClaim={handleClaim}
            claiming={claiming}
          />
        ))
      )}
    </div>
  );
}
