import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import apiClient from '../../api/client';

function getTimeUntilMidnight() {
  const now = new Date();
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const diff = midnight - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function SkeletonCard() {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.85)',
      border: '1px solid rgba(148,163,184,0.12)',
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 10,
    }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(148,163,184,0.1)', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 13, width: '55%', background: 'rgba(148,163,184,0.1)', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 10, width: '75%', background: 'rgba(148,163,184,0.07)', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 4, width: '100%', background: 'rgba(148,163,184,0.08)', borderRadius: 2 }} />
      </div>
      <div style={{ width: 56, height: 28, borderRadius: 20, background: 'rgba(148,163,184,0.08)', flexShrink: 0 }} />
    </div>
  );
}

function QuestCard({ quest, onClaim, claiming }) {
  const { key, label, description, icon, goal, reward_coins, reward_xp, progress, completed, claimed } = quest;
  const isClaiming = claiming === key;
  const pct = goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : 0;

  let barColor = '#c9a84c'; // gold — in progress
  if (claimed) barColor = 'rgba(148,163,184,0.3)';
  else if (completed) barColor = '#22c55e'; // green — completed unclaimed

  let rewardChipColor = (completed || claimed) ? (claimed ? 'rgba(148,163,184,0.35)' : '#c9a84c') : 'rgba(148,163,184,0.25)';
  let rewardChipText = reward_coins > 0
    ? `+${reward_coins} 🪙`
    : reward_xp > 0
    ? `+${reward_xp} ⭐`
    : '';

  return (
    <div style={{
      background: 'rgba(15,23,42,0.85)',
      border: `1px solid ${completed && !claimed ? 'rgba(34,197,94,0.3)' : 'rgba(148,163,184,0.12)'}`,
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 10,
      transition: 'border-color 0.2s',
    }}>
      {/* Icon */}
      <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0, width: 40, textAlign: 'center' }}>
        {icon}
      </div>

      {/* Center content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{label}</div>
        <div style={{ color: 'rgba(148,163,184,0.75)', fontSize: 11, marginBottom: 8 }}>{description}</div>
        {/* Progress bar */}
        <div style={{ height: 4, width: '100%', background: 'rgba(148,163,184,0.12)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: barColor,
            borderRadius: 2,
            transition: 'width 0.3s',
          }} />
        </div>
        <div style={{ color: 'rgba(148,163,184,0.55)', fontSize: 10, marginTop: 4 }}>
          {progress} / {goal}
        </div>
      </div>

      {/* Right side: reward chip + claim button */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        {rewardChipText && (
          <div style={{
            background: rewardChipColor,
            color: claimed ? 'rgba(148,163,184,0.5)' : (completed ? '#f8fafc' : 'rgba(148,163,184,0.6)'),
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 20,
            whiteSpace: 'nowrap',
          }}>
            {rewardChipText}
          </div>
        )}
        {completed && !claimed && (
          <button
            onClick={() => onClaim(key)}
            disabled={isClaiming}
            style={{
              background: isClaiming ? 'rgba(201,168,76,0.5)' : '#c9a84c',
              color: '#0f172a',
              border: 'none',
              borderRadius: 20,
              padding: '5px 14px',
              fontSize: 12,
              fontWeight: 800,
              cursor: isClaiming ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            {isClaiming ? '...' : 'Claim'}
          </button>
        )}
        {claimed && (
          <div style={{ color: 'rgba(148,163,184,0.45)', fontSize: 11, fontWeight: 700 }}>
            Claimed ✓
          </div>
        )}
      </div>
    </div>
  );
}

export default function DailyQuestsScreen({ user, onBack }) {
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const [countdown, setCountdown] = useState(getTimeUntilMidnight());

  const fetchQuests = useCallback(async () => {
    try {
      const res = await apiClient.get('/daily-quests');
      setQuests(res.data.quests || []);
    } catch (err) {
      toast.error('Failed to load quests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(getTimeUntilMidnight());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleClaim = async (questKey) => {
    setClaiming(questKey);
    try {
      const res = await apiClient.post(`/daily-quests/${questKey}/claim`);
      const { reward_coins, reward_xp } = res.data;
      // Update local quest state
      setQuests((prev) =>
        prev.map((q) => q.key === questKey ? { ...q, claimed: true } : q)
      );
      const msg = reward_coins > 0
        ? `Claimed! +${reward_coins} 🪙`
        : reward_xp > 0
        ? `Claimed! +${reward_xp} ⭐ XP`
        : 'Claimed!';
      toast.success(msg);
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Failed to claim reward';
      toast.error(detail);
    } finally {
      setClaiming(null);
    }
  };

  const completedCount = quests.filter((q) => q.completed).length;

  return (
    <div style={{
      maxWidth: 520,
      margin: '0 auto',
      padding: '0 16px 88px',
      minHeight: '100%',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 0 12px',
        gap: 8,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'rgba(15,23,42,0.7)',
            border: '1px solid rgba(148,163,184,0.18)',
            borderRadius: 10,
            color: '#f8fafc',
            padding: '7px 12px',
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em', flex: 1, textAlign: 'center' }}>
          Daily Quests
        </div>
        <div style={{
          background: 'rgba(15,23,42,0.7)',
          border: '1px solid rgba(148,163,184,0.12)',
          borderRadius: 10,
          color: 'rgba(148,163,184,0.7)',
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 600,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          Resets in {countdown}
        </div>
      </div>

      {/* Progress summary */}
      {!loading && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}>
            <span style={{ color: 'rgba(148,163,184,0.75)', fontSize: 12, fontWeight: 600 }}>
              {completedCount} / {quests.length} complete
            </span>
            <span style={{ color: '#c9a84c', fontSize: 12, fontWeight: 700 }}>
              {Math.round((completedCount / (quests.length || 1)) * 100)}%
            </span>
          </div>
          <div style={{ height: 5, width: '100%', background: 'rgba(148,163,184,0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.round((completedCount / (quests.length || 1)) * 100)}%`,
              background: 'linear-gradient(90deg, #c9a84c, #f0c040)',
              borderRadius: 3,
              transition: 'width 0.4s',
            }} />
          </div>
        </div>
      )}

      {/* Quest cards or skeletons */}
      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
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
