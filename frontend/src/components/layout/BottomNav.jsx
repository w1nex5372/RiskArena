import { Backpack, Crown, Swords, Trophy, UserCircle, Users, Zap } from 'lucide-react';

function NavBtn({ tab, activeTab, onClick, icon: Icon, label }) {
  const isActive = activeTab === tab;
  return (
    <button
      onClick={onClick}
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
      <Icon style={{ width: 24, height: 24, color: isActive ? '#c9a84c' : '#475569' }} />
      <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: isActive ? '#c9a84c' : '#475569' }}>
        {label}
      </span>
    </button>
  );
}

export default function BottomNav({ activeTab, setActiveTab, user }) {
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
      <NavBtn tab="boss"       activeTab={activeTab} onClick={() => setActiveTab('boss')}       icon={Zap}        label="Raid"    />
      <NavBtn tab="tournament" activeTab={activeTab} onClick={() => setActiveTab('tournament')} icon={Trophy}     label="Cup"     />
      <NavBtn tab="inventory"  activeTab={activeTab} onClick={() => setActiveTab('inventory')}  icon={Backpack}   label="Items"   />
      <NavBtn tab="profile"    activeTab={activeTab} onClick={() => setActiveTab('profile')}    icon={UserCircle} label="Profile" />
      {(user?.is_admin === true || user?.is_owner === true) && (
        <NavBtn tab="admin" activeTab={activeTab} onClick={() => setActiveTab('admin')} icon={Crown} label="Admin" />
      )}
    </nav>
  );
}
