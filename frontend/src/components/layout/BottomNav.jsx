import { memo } from 'react';
import { Backpack, Crown, Medal, Swords, Users, Zap } from 'lucide-react';
import { useUser } from '../../context/UserContext';
import { isRaidUnlocked, RAID_UNLOCK_LEVEL } from '../../utils/progression';

function NavBtn({ tab, activeTab, onClick, icon: Icon, label, disabled = false, badge = null }) {
  const effectiveActiveTab = activeTab === 'dailyChest' ? 'rooms' : activeTab;
  const isActive = effectiveActiveTab === tab;
  return (
    <button
      onClick={onClick}
      aria-disabled={disabled}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 0',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 10,
        background: isActive ? 'rgba(201,168,76,0.12)' : 'transparent',
        boxShadow: isActive ? '0 0 10px rgba(201,168,76,0.25)' : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      <Icon style={{ width: 24, height: 24, color: disabled ? '#334155' : isActive ? '#c9a84c' : '#475569' }} />
      <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: isActive ? '#c9a84c' : '#475569' }}>
        {label}{badge ? ` ${badge}` : ''}
      </span>
    </button>
  );
}

function BottomNav({ activeTab, setActiveTab }) {
  const { user } = useUser();
  const raidUnlocked = isRaidUnlocked(user);
  return (
    <nav
      className="mobile-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        width: '100%',
        height: 64,
        background: 'rgba(26,26,46,0.95)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(201,168,76,0.2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        boxSizing: 'border-box',
        zIndex: 50,
      }}
    >
      <NavBtn tab="rooms"      activeTab={activeTab} onClick={() => setActiveTab('rooms')}      icon={Users}      label="Home"    />
      <NavBtn tab="arena"      activeTab={activeTab} onClick={() => setActiveTab('arena')}      icon={Swords}     label="Arena"   />
      <NavBtn tab="boss"       activeTab={activeTab} onClick={() => setActiveTab('boss')}       icon={Zap}        label="Raid" badge={raidUnlocked ? null : `Lv${RAID_UNLOCK_LEVEL}`} disabled={!raidUnlocked} />
      <NavBtn tab="leaderboard" activeTab={activeTab} onClick={() => setActiveTab('leaderboard')} icon={Medal}  label="Ranks"   />
      <NavBtn tab="inventory"  activeTab={activeTab} onClick={() => setActiveTab('inventory')}  icon={Backpack}   label="Items"   />
      {(user?.is_admin === true || user?.is_owner === true) && (
        <NavBtn tab="admin" activeTab={activeTab} onClick={() => setActiveTab('admin')} icon={Crown} label="Admin" />
      )}
    </nav>
  );
}

// Memoized: `user` (admin flag) now comes from context, so BottomNav only
// re-renders when activeTab or the user's admin status changes.
export default memo(BottomNav);
