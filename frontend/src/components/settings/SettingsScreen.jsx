import { useEffect, useState } from 'react';
import { Bell, ChevronRight, Copy, Gamepad2, Lock, Scale, Settings, Shield, TriangleAlert, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../api/client';

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: value ? 'linear-gradient(135deg,#8b0000,#c0392b)' : 'rgba(255,255,255,0.1)',
        position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
        boxShadow: value ? '0 0 8px rgba(139,0,0,0.4)' : 'none',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: 'white',
        position: 'absolute', top: 3, left: value ? 23 : 3,
        transition: 'left 0.2s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div style={{ margin: '12px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon style={{ width: 13, height: 13, color: '#c9a84c' }} />
        <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#c9a84c', textTransform: 'uppercase', margin: 0 }}>
          {title}
        </p>
      </div>
      <div style={{ borderRadius: 16, background: 'rgba(26,26,46,0.85)', border: '1px solid rgba(201,168,76,0.1)', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, sub, right, borderTop }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 16px',
      borderTop: borderTop ? '1px solid rgba(255,255,255,0.05)' : 'none',
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ color: '#e8e0d0', fontWeight: 600, fontSize: 14, margin: 0 }}>{label}</p>
        {sub && <p style={{ color: '#475569', fontSize: 11, margin: '2px 0 0' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function LinkRow({ label, sub, onPress, borderTop, danger, rightIcon }) {
  const Icon = rightIcon || ChevronRight;
  return (
    <button
      onClick={onPress}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
        borderTop: borderTop ? '1px solid rgba(255,255,255,0.05)' : 'none',
        textAlign: 'left',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ color: danger ? '#f87171' : '#e8e0d0', fontWeight: 600, fontSize: 14, margin: 0 }}>{label}</p>
        {sub && <p style={{ color: '#475569', fontSize: 11, margin: '2px 0 0' }}>{sub}</p>}
      </div>
      <Icon style={{ width: 16, height: 16, color: '#475569', flexShrink: 0 }} />
    </button>
  );
}

const SESSION_OPTIONS = ['off', '30m', '1h', '2h'];

export default function SettingsScreen({ user, onNavigate }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get('/me/settings').then((r) => setSettings(r.data)).catch(() => {});
  }, []);

  const patch = async (section, key, value) => {
    if (!settings) return;
    const prev = settings;
    const next = { ...settings, [section]: { ...settings[section], [key]: value } };
    setSettings(next);
    setSaving(true);
    try {
      await apiClient.post('/me/settings', { [section]: { [key]: value } });
    } catch {
      setSettings(prev);
      toast.error('Failed to save setting');
    } finally {
      setSaving(false);
    }
  };

  const copyWallet = () => {
    const addr = user?.wallet_address || user?.derived_solana_address;
    if (!addr) { toast.error('No wallet address found'); return; }
    navigator.clipboard.writeText(addr).then(() => toast.success('Address copied!')).catch(() => toast.error('Copy failed'));
  };

  const cycleSessionReminder = () => {
    const cur = settings?.responsible?.session_reminder || 'off';
    const next = SESSION_OPTIONS[(SESSION_OPTIONS.indexOf(cur) + 1) % SESSION_OPTIONS.length];
    patch('responsible', 'session_reminder', next);
  };

  if (!settings) {
    return (
      <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#475569', fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  const s = settings;

  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, color: '#e8e0d0' }}>

      {/* Header */}
      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Settings style={{ width: 20, height: 20, color: '#c9a84c' }} />
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'white', margin: 0 }}>Settings</h1>
        {saving && <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 11 }}>Saving…</span>}
      </div>

      {/* Notifications */}
      <Section title="Notifications" icon={Bell}>
        <Row label="Battle results" sub="Win/loss notification after each duel"
          right={<Toggle value={s.notifications.battle} onChange={(v) => patch('notifications', 'battle', v)} />} />
        <Row label="Daily chest" sub="Reminder when your chest is ready" borderTop
          right={<Toggle value={s.notifications.daily_chest} onChange={(v) => patch('notifications', 'daily_chest', v)} />} />
        <Row label="Quest completed" sub="Alert when a quest is finished" borderTop
          right={<Toggle value={s.notifications.quests} onChange={(v) => patch('notifications', 'quests', v)} />} />
      </Section>

      {/* Gameplay */}
      <Section title="Gameplay" icon={Gamepad2}>
        <Row label="Remember last bet" sub="Pre-select your previous wager amount"
          right={<Toggle value={s.gameplay.remember_bet} onChange={(v) => patch('gameplay', 'remember_bet', v)} />} />
      </Section>

      {/* Privacy */}
      <Section title="Privacy" icon={Lock}>
        <Row label="Show on leaderboard" sub="Your name and rank are visible to others"
          right={<Toggle value={s.privacy.show_leaderboard} onChange={(v) => patch('privacy', 'show_leaderboard', v)} />} />
        <Row label="Show W/L stats" sub="Other players can see your win rate" borderTop
          right={<Toggle value={s.privacy.show_stats} onChange={(v) => patch('privacy', 'show_stats', v)} />} />
      </Section>

      {/* Responsible Gaming */}
      <Section title="Responsible Gaming" icon={Shield}>
        <div style={{ padding: '13px 16px' }}>
          <p style={{ color: '#e8e0d0', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>Daily spend limit</p>
          <p style={{ color: '#475569', fontSize: 11, margin: '0 0 10px' }}>Set a max coins you can wager per day (0 = no limit)</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number"
              min="0"
              value={s.responsible.daily_limit || ''}
              placeholder="0"
              onChange={(e) => {
                const v = Math.max(0, parseInt(e.target.value) || 0);
                setSettings((prev) => ({ ...prev, responsible: { ...prev.responsible, daily_limit: v } }));
              }}
              onBlur={(e) => patch('responsible', 'daily_limit', Math.max(0, parseInt(e.target.value) || 0))}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '8px 12px', color: '#e8e0d0', fontSize: 15, fontWeight: 700,
                outline: 'none',
              }}
            />
            <span style={{ color: '#64748b', fontSize: 13 }}>coins</span>
          </div>
        </div>
        <Row label="Session reminder" sub="Get a reminder after playing for a while" borderTop
          right={
            <button
              onClick={cycleSessionReminder}
              style={{
                background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)',
                borderRadius: 8, padding: '4px 10px', color: '#c9a84c', fontWeight: 700, fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {s.responsible.session_reminder === 'off' ? 'Off' : `Every ${s.responsible.session_reminder}`}
            </button>
          }
        />
        <div style={{ padding: '10px 16px 13px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <TriangleAlert style={{ width: 15, height: 15, color: '#fb923c', flexShrink: 0, marginTop: 1 }} />
            <p style={{ color: '#94a3b8', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
              Gambling can be addictive. Play responsibly and only wager what you can afford to lose. If you need help, contact support.
            </p>
          </div>
        </div>
      </Section>

      {/* Account */}
      <Section title="Account" icon={Wallet}>
        <LinkRow
          label="Solana wallet address"
          sub={user?.derived_solana_address ? `${(user.derived_solana_address).slice(0, 8)}…${(user.derived_solana_address).slice(-6)}` : 'Not set'}
          onPress={copyWallet}
          rightIcon={Copy}
        />
      </Section>

      {/* Legal */}
      <Section title="Legal" icon={Scale}>
        <LinkRow label="Terms of Service" onPress={() => onNavigate?.('tos')} />
        <LinkRow label="Privacy Policy" onPress={() => onNavigate?.('privacy')} borderTop />
      </Section>

      {/* Version */}
      <p style={{ textAlign: 'center', color: '#1e293b', fontSize: 11, marginTop: 28 }}>
        RiskArena v1.0 · Powered by Solana
      </p>
    </div>
  );
}
