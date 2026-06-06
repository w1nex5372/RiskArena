import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import GameMasterPanel from './GameMasterPanel';

function AdminPanel({ API, rooms, isMobile, onRoomsRefresh, socket, user }) {
  const [tgId, setTgId] = React.useState('');
  const [tokenAmount, setTokenAmount] = React.useState('');
  const [userInfo, setUserInfo] = React.useState(null);
  const [lookupLoading, setLookupLoading] = React.useState(false);
  const [fakeRoom, setFakeRoom] = React.useState('bronze');
  const [fakeBet, setFakeBet] = React.useState('');
  const [userList, setUserList] = React.useState([]);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [stats, setStats] = React.useState(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [recentGames, setRecentGames] = React.useState([]);
  const [gamesLoading, setGamesLoading] = React.useState(false);
  const [broadcastMsg, setBroadcastMsg] = React.useState('');
  const [broadcasting, setBroadcasting] = React.useState(false);
  const [maintenance, setMaintenance] = React.useState(false);
  const [dailyStats, setDailyStats] = React.useState([]);
  const [chartLoading, setChartLoading] = React.useState(false);
  const [promoCode, setPromoCode] = React.useState('');
  const [promoAmount, setPromoAmount] = React.useState('');
  const [promoMaxUses, setPromoMaxUses] = React.useState('1');
  const [promoUnlimited, setPromoUnlimited] = React.useState(false);
  const [promoCodes, setPromoCodes] = React.useState([]);
  const [solWallet, setSolWallet] = React.useState('');
  const [solSig, setSolSig] = React.useState('');
  const [freerollConfig, setFreerollConfig] = React.useState({ prize: 500, max_players: 30, is_locked: false });
  const [freerollPrize, setFreerollPrize] = React.useState('500');
  const [freerollMaxPlayers, setFreerollMaxPlayers] = React.useState('30');
  const [freerollSaving, setFreerollSaving] = React.useState(false);

  const ROOM_DEFAULTS = {
    free:     { name: 'Training Grounds', min_bet: 0,   max_bet: 0,    max_players: 3, min_players: 2 },
    bronze:   { name: 'Dueling Pit',      min_bet: 200, max_bet: 450,  max_players: 3, min_players: 2 },
    silver:   { name: 'Silver Arena',     min_bet: 350, max_bet: 800,  max_players: 3, min_players: 2 },
    gold:     { name: 'Golden Arena',     min_bet: 650, max_bet: 1200, max_players: 3, min_players: 2 },
    freeroll: { name: 'Grand Arena',      min_bet: 0,   max_bet: 0,    max_players: 30, min_players: 2 },
  };
  const [roomConfigs, setRoomConfigs] = React.useState(
    Object.entries(ROOM_DEFAULTS).map(([rt, d]) => ({ room_type: rt, ...d }))
  );
  const [roomConfigEdits, setRoomConfigEdits] = React.useState({});
  const [roomConfigSaving, setRoomConfigSaving] = React.useState({});
  const [selectedRoomType, setSelectedRoomType] = React.useState('bronze');

  const loadRoomConfigs = async () => {
    try {
      const r = await apiClient.get('/admin/room-configs');
      setRoomConfigs(r.data);
      const edits = {};
      r.data.forEach(rc => { edits[rc.room_type] = { ...rc }; });
      setRoomConfigEdits(edits);
    } catch (e) { /* silently ignore */ }
  };

  const saveRoomConfig = async (roomType) => {
    const edit = roomConfigEdits[roomType];
    if (!edit) return;
    setRoomConfigSaving(s => ({ ...s, [roomType]: true }));
    try {
      const r = await apiClient.post(`/admin/room-config/${roomType}`, null, {
        params: {
          min_bet: Number(edit.min_bet),
          max_bet: Number(edit.max_bet),
          max_players: Number(edit.max_players),
          min_players: Number(edit.min_players),
        },
      });
      setRoomConfigs(prev => prev.map(rc => rc.room_type === roomType ? { ...rc, ...r.data } : rc));
      setRoomConfigEdits(prev => ({ ...prev, [roomType]: { ...prev[roomType], ...r.data } }));
      toast.success(`✅ ${roomType} room config saved`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setRoomConfigSaving(s => ({ ...s, [roomType]: false }));
    }
  };

  const loadFreerollConfig = async () => {
    try {
      const r = await apiClient.get('/admin/freeroll-config');
      setFreerollConfig(r.data);
      setFreerollPrize(String(r.data.prize));
      setFreerollMaxPlayers(String(r.data.max_players));
    } catch (e) {
      // silently ignore
    }
  };

  const saveFreerollConfig = async () => {
    setFreerollSaving(true);
    try {
      const r = await apiClient.post('/admin/freeroll-config', null, {
        params: {
          prize: freerollPrize,
          max_players: freerollMaxPlayers,
          is_locked: freerollConfig.is_locked,
        },
      });
      setFreerollConfig(r.data);
      toast.success('✅ Grand Arena config saved');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setFreerollSaving(false);
    }
  };

  const toggleFreerollLock = async () => {
    const newLocked = !freerollConfig.is_locked;
    try {
      const r = await apiClient.post('/admin/freeroll-config', null, {
        params: { is_locked: newLocked },
      });
      setFreerollConfig(r.data);
      toast.success(newLocked ? '🔒 Grand Arena locked' : '🔓 Grand Arena unlocked');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const lookupUser = async () => {
    if (!tgId) return;
    setLookupLoading(true);
    setUserInfo(null);
    try {
      const r = await apiClient.get(`/users/telegram/${tgId}`);
      setUserInfo(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'User not found');
    } finally {
      setLookupLoading(false);
    }
  };

  const adjustTokens = async (delta) => {
    const amt = parseInt(tokenAmount);
    if (!tgId || !amt) return toast.error('Enter Telegram ID and token amount');
    try {
      const r = await apiClient.post(`/admin/adjust-tokens/${tgId}`, null, {
        params: { tokens: delta * amt },
      });
      toast.success(`✅ ${delta > 0 ? 'Added' : 'Removed'} ${amt} tokens. New balance: ${r.data.new_balance}`);
      setUserInfo(prev => prev ? { ...prev, token_balance: r.data.new_balance } : null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const banUser = async (ban) => {
    if (!tgId) return toast.error('Enter Telegram ID first');
    try {
      const action = ban ? 'ban' : 'unban';
      await apiClient.post(`/admin/${action}/${tgId}`);
      toast.success(`✅ User ${tgId} ${ban ? 'banned' : 'unbanned'}`);
      setUserInfo(prev => prev ? { ...prev, is_banned: ban } : null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const setRole = async (isAdmin, isOwner) => {
    if (!tgId) return toast.error('Enter Telegram ID first');
    try {
      const r = await apiClient.post(`/admin/set-role/${tgId}`, null, {
        params: { is_admin: isAdmin, is_owner: isOwner },
      });
      toast.success(`✅ Role set to: ${r.data.role}`);
      setUserInfo(prev => prev ? { ...prev, is_admin: isAdmin, is_owner: isOwner } : null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const [givingItems, setGivingItems] = React.useState(false);
  const giveAllItems = async () => {
    if (!tgId) return toast.error('Enter Telegram ID first');
    setGivingItems(true);
    try {
      const r = await apiClient.post('/admin/give-all-items', null, {
        params: { telegram_id: tgId },
      });
      toast.success(`✅ Gave ${r.data.added} items to user ${tgId}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to give items');
    } finally {
      setGivingItems(false);
    }
  };

  // ── Grant specific item ────────────────────────────────────────────────────
  const [itemCatalog, setItemCatalog] = React.useState([]);
  const [selectedItemId, setSelectedItemId] = React.useState('');
  const [grantingItem, setGrantingItem] = React.useState(false);

  const loadItemCatalog = async () => {
    try {
      const r = await apiClient.get('/admin/items-catalog');
      setItemCatalog(r.data || []);
    } catch (e) {
      toast.error('Failed to load item catalog');
    }
  };

  const grantItem = async () => {
    if (!tgId) return toast.error('Enter Telegram ID first');
    if (!selectedItemId) return toast.error('Select an item first');
    setGrantingItem(true);
    try {
      const r = await apiClient.post('/admin/grant-item', null, {
        params: { telegram_id: tgId, item_id: selectedItemId },
      });
      toast.success(`✅ Granted "${r.data.item_name}" (${r.data.item_tier}) to user ${tgId}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to grant item');
    } finally {
      setGrantingItem(false);
    }
  };

  React.useEffect(() => { loadItemCatalog(); }, []);

  const addFakePlayer = async () => {
    if (!fakeBet) return toast.error('Enter bet amount');
    try {
      const r = await apiClient.post('/admin/add-fake-player', null, {
        params: { room_type: fakeRoom, player_name: 'Anonymous', bet_amount: fakeBet },
      });
      toast.success(`✅ ${r.data.message}. Players: ${r.data.players_count}/3`);
      setFakeBet('');
      onRoomsRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to add fake player');
    }
  };

  const removeFakePlayer = async () => {
    try {
      const r = await apiClient.post('/admin/remove-fake-player', null, {
        params: { room_type: fakeRoom },
      });
      toast.success(`✅ ${r.data.message}. Players: ${r.data.players_count}/3`);
      onRoomsRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'No bot to remove');
    }
  };

  const forceStart = async () => {
    try {
      const r = await apiClient.post(`/admin/force-start/${fakeRoom}`);
      toast.success(`🚀 ${r.data.message}`);
      onRoomsRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const forceCloseRoom = async (roomType) => {
    try {
      await apiClient.post(`/admin/force-close-room/${roomType}`);
      toast.success(`✅ ${roomType} room cleared`);
      onRoomsRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const loadUsers = async () => {
    try {
      const r = await apiClient.get('/admin/list-users', {
        params: { limit: 20, search: searchTerm },
      });
      setUserList(r.data.users);
    } catch (e) {
      toast.error('Failed to load users');
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const [sR, mR] = await Promise.all([
        apiClient.get('/admin/stats'),
        apiClient.get('/admin/maintenance-status'),
      ]);
      setStats(sR.data);
      setMaintenance(mR.data.maintenance_mode);
    } catch (e) {
      toast.error('Failed to load stats');
    } finally {
      setStatsLoading(false);
    }
  };

  const loadRecentGames = async () => {
    setGamesLoading(true);
    try {
      const r = await apiClient.get('/admin/recent-games', { params: { limit: 10 } });
      setRecentGames(r.data.games);
    } catch (e) {
      toast.error('Failed to load games');
    } finally {
      setGamesLoading(false);
    }
  };

  const loadChart = async () => {
    setChartLoading(true);
    try {
      const r = await apiClient.get('/admin/daily-stats', { params: { days: 7 } });
      setDailyStats(r.data.days);
    } catch (e) {
      toast.error('Failed to load chart');
    } finally {
      setChartLoading(false);
    }
  };

  const toggleMaintenance = async () => {
    try {
      const r = await apiClient.post('/admin/toggle-maintenance');
      setMaintenance(r.data.maintenance_mode);
      toast.success(`🔧 Maintenance ${r.data.maintenance_mode ? 'ON' : 'OFF'}`);
    } catch (e) {
      toast.error('Failed');
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return toast.error('Enter a message');
    if (!window.confirm(`Send to ALL users?\n\n"${broadcastMsg}"`)) return;
    setBroadcasting(true);
    try {
      const r = await apiClient.post('/admin/broadcast', null, {
        params: { message: broadcastMsg },
      });
      const d = r.data;
      if (d.failed > 0 && d.errors?.length) {
        toast.error(`Sent: ${d.sent}, Failed: ${d.failed} — ${d.errors[0]}`);
      } else {
        const skippedStr = d.skipped > 0 ? `, Skipped: ${d.skipped}` : '';
        toast.success(`📢 Sent: ${d.sent}/${d.total}${skippedStr}`);
      }
      setBroadcastMsg('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Broadcast failed');
    } finally {
      setBroadcasting(false);
    }
  };

  const createPromo = async () => {
    if (!promoCode || !promoAmount) return toast.error('Enter code and amount');
    try {
      await apiClient.post('/admin/promo-codes', null, {
        params: {
          code: promoCode,
          token_amount: promoAmount,
          max_uses: promoUnlimited ? 1 : (promoMaxUses || 1),
          unlimited: promoUnlimited,
        },
      });
      toast.success(`✅ Code "${promoCode.toUpperCase()}" created`);
      setPromoCode(''); setPromoAmount(''); setPromoMaxUses('1'); setPromoUnlimited(false);
      loadPromoCodes();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const loadPromoCodes = async () => {
    try {
      const r = await apiClient.get('/admin/promo-codes');
      setPromoCodes(r.data.codes);
    } catch (e) {}
  };

  const deletePromo = async (code) => {
    try {
      await apiClient.delete(`/admin/promo-codes/${code}`);
      toast.success(`🗑️ Deleted ${code}`);
      setPromoCodes(prev => prev.filter(c => c.code !== code));
    } catch (e) {
      toast.error('Failed');
    }
  };

  const confirmSolPayment = async () => {
    if (!solWallet || !solSig) return toast.error('Enter wallet and signature');
    try {
      await apiClient.post('/admin/process-payment', null, {
        params: { wallet_address: solWallet, signature: solSig },
      });
      toast.success('✅ Payment processed');
      setSolWallet(''); setSolSig('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const exportCSV = () => {
    apiClient.get('/admin/export-users', { responseType: 'blob' })
      .then((res) => {
        const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      })
      .catch(() => toast.error('Export failed'));
  };

  React.useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      setRoomConfigs(prev => prev.map(rc =>
        rc.room_type === data.room_type ? { ...rc, ...data } : rc
      ));
      setRoomConfigEdits(prev => ({
        ...prev,
        [data.room_type]: { ...(prev[data.room_type] || {}), ...data }
      }));
    };
    socket.on('room_config_updated', handler);
    return () => socket.off('room_config_updated', handler);
  }, [socket]);

  React.useEffect(() => { loadStats(); loadChart(); loadPromoCodes(); loadRecentGames(); loadFreerollConfig(); loadRoomConfigs(); }, []);

  const ROOM_MIN_BETS = { bronze: 200, silver: 350, gold: 650, freeroll: 0 };
  const card = "bg-slate-800/90 border border-red-700/40 rounded-xl p-4 space-y-3";
  const inp = "bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2";
  const maxGames = dailyStats.length ? Math.max(...dailyStats.map(d => d.games), 1) : 1;

  return (
    <div className="space-y-4 pb-6">
      <div className="text-center py-2">
        <h2 className="text-xl font-bold text-red-400">🛡️ Admin Panel</h2>
        <p className="text-xs text-slate-500">Only visible to admins</p>
      </div>
      {(user?.is_owner || user?.role === 'owner') && <GameMasterPanel />}

      {/* Live Stats + Maintenance */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>📊</span> Live Stats</h3>
          <div className="flex gap-2 items-center">
            <button onClick={toggleMaintenance}
              className={`text-xs px-2 py-1 rounded font-semibold ${maintenance ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              {maintenance ? '🔧 Maint. ON' : '🟢 Maint. OFF'}
            </button>
            <button onClick={loadStats} className="text-xs text-slate-400 hover:text-white">{statsLoading ? '...' : '↻'}</button>
          </div>
        </div>
        {stats ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              ['👥 Users', stats.total_users],
              ['🎮 Games today', stats.games_today],
              ['🎲 Total games', stats.total_games],
              ['🟡 Tokens in circ.', (stats.tokens_in_circulation || 0).toLocaleString()],
              ['💸 Tokens sold', (stats.tokens_sold || 0).toLocaleString()],
              ['🎰 Total wagered', (stats.total_wagered || 0).toLocaleString()],
              ['🌐 Active rooms', stats.active_rooms],
              ['👤 Players online', stats.players_online],
              ['🚫 Banned', stats.banned_users],
              ['👑 Admins', stats.admin_count],
            ].map(([label, val]) => (
              <div key={label} className="bg-slate-700/40 rounded-lg px-3 py-2">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-white font-bold text-sm">{val}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 text-center py-2">{statsLoading ? 'Loading...' : 'Failed to load — click ↻'}</div>
        )}
        <button onClick={exportCSV} className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs py-2 rounded-lg">
          📋 Export Users CSV
        </button>
      </div>

      {/* Daily Chart */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>📈</span> Last 7 Days</h3>
          <button onClick={loadChart} className="text-xs text-slate-400 hover:text-white">{chartLoading ? '...' : '↻'}</button>
        </div>
        {dailyStats.length > 0 ? (
          <div className="space-y-1">
            {dailyStats.map(d => (
              <div key={d.date} className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 w-12 shrink-0">{d.date.slice(5)}</span>
                <div className="flex-1 bg-slate-700/40 rounded overflow-hidden h-5 relative">
                  <div className="h-full rounded" style={{ width: `${Math.max(4, (d.games / maxGames) * 100)}%`, background: 'linear-gradient(90deg, #dc2626, #7c3aed)' }} />
                  <span className="absolute inset-0 flex items-center px-2 text-white font-semibold">{d.games} games</span>
                </div>
                <span className="text-yellow-400 w-20 text-right shrink-0">{(d.total_wagered||0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 text-center py-2">{chartLoading ? 'Loading...' : 'No data yet'}</div>
        )}
      </div>

      {/* Broadcast */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>📢</span> Broadcast to All Users</h3>
        <textarea value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)}
          placeholder="Message to all users via Telegram bot..." rows={3}
          className={`w-full ${inp} resize-none`} style={{ fontFamily: 'inherit' }} />
        <button onClick={sendBroadcast} disabled={broadcasting || !broadcastMsg.trim()}
          className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg font-semibold">
          {broadcasting ? '📤 Sending...' : '📢 Send Broadcast'}
        </button>
      </div>

      {/* User Management */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>👤</span> User Management</h3>
        <div className="flex gap-2">
          <input type="number" value={tgId} onChange={e => setTgId(e.target.value)}
            placeholder="Telegram ID" className={`flex-1 ${inp} min-w-0`} />
          <button onClick={lookupUser} disabled={lookupLoading}
            className="bg-slate-600 hover:bg-slate-500 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap">
            {lookupLoading ? '...' : 'Lookup'}
          </button>
        </div>
        {userInfo && (
          <div className="bg-slate-700/50 rounded-lg p-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-semibold">{userInfo.first_name}</span>
              {userInfo.telegram_username && <span className="text-slate-400">@{userInfo.telegram_username}</span>}
              <span className="text-yellow-400 font-bold">{(userInfo.token_balance||0).toLocaleString()} tkn</span>
              {userInfo.is_banned && <span className="text-red-400 font-bold">🚫 BANNED</span>}
              {userInfo.is_owner && <span className="text-yellow-400 font-bold">👑 OWNER</span>}
              {userInfo.is_admin && !userInfo.is_owner && <span className="text-blue-400 font-bold">🛡️ ADMIN</span>}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <input type="number" value={tokenAmount} onChange={e => setTokenAmount(e.target.value)}
            placeholder="Token amount" className={`flex-1 ${inp} min-w-0`} />
          <button onClick={() => adjustTokens(1)} className="bg-green-700 hover:bg-green-600 text-white text-sm px-3 py-2 rounded-lg">+ Add</button>
          <button onClick={() => adjustTokens(-1)} className="bg-red-700 hover:bg-red-600 text-white text-sm px-3 py-2 rounded-lg">− Remove</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => banUser(true)} className="bg-red-900/60 hover:bg-red-800 border border-red-600/40 text-red-300 text-xs py-2 rounded-lg font-semibold">🚫 Ban</button>
          <button onClick={() => banUser(false)} className="bg-green-900/60 hover:bg-green-800 border border-green-600/40 text-green-300 text-xs py-2 rounded-lg font-semibold">✅ Unban</button>
          <button onClick={() => setRole(true, false)} className="bg-blue-900/60 hover:bg-blue-800 border border-blue-600/40 text-blue-300 text-xs py-2 rounded-lg font-semibold">🛡️ Make Admin</button>
          <button onClick={() => setRole(false, false)} className="bg-slate-700 hover:bg-slate-600 border border-slate-500/40 text-slate-300 text-xs py-2 rounded-lg font-semibold">👤 Remove Role</button>
          <button
            onClick={giveAllItems}
            disabled={givingItems}
            className="col-span-2 bg-yellow-900/60 hover:bg-yellow-800 border border-yellow-500/40 text-yellow-300 text-xs py-2 rounded-lg font-semibold disabled:opacity-50"
          >
            {givingItems ? '⏳ Giving items...' : '🎁 Give All Items (all tiers)'}
          </button>
        </div>
      </div>

      {/* Grant Specific Item */}
      <div className={card}>
        <h3 className="text-yellow-400 font-bold text-sm flex items-center gap-2">
          <span>🎁</span> Grant Specific Item
        </h3>
        <p className="text-slate-400 text-xs">Select an item and grant it to the user above (by Telegram ID).</p>
        <div className="flex gap-2 items-center">
          <select
            value={selectedItemId}
            onChange={e => setSelectedItemId(e.target.value)}
            className={`flex-1 ${inp}`}
          >
            <option value="">— select item —</option>
            {['legendary','epic','rare','uncommon','common'].map(tier => {
              const tierItems = itemCatalog.filter(i => i.tier === tier);
              if (!tierItems.length) return null;
              return (
                <optgroup key={tier} label={`${tier.toUpperCase()} (${tierItems.length})`}>
                  {tierItems.map(item => (
                    <option key={item.id} value={item.id}>
                      [{item.class_name === 'any' ? 'all' : item.class_name}] {item.name} ({item.slot})
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <button
            onClick={grantItem}
            disabled={grantingItem || !selectedItemId || !tgId}
            className="bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 text-white text-xs font-bold py-2 px-3 rounded-lg whitespace-nowrap"
          >
            {grantingItem ? '⏳' : 'Grant →'}
          </button>
        </div>
      </div>

      {/* Room Control */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>🎮</span> Room Control</h3>
        <select value={fakeRoom} onChange={e => { setFakeRoom(e.target.value); setFakeBet(String(ROOM_MIN_BETS[e.target.value])); }} className={`w-full ${inp}`}>
          {['freeroll', 'bronze', 'silver', 'gold'].map(r => (
            <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)} (min {ROOM_MIN_BETS[r]})</option>
          ))}
        </select>
        <input type="number" value={fakeBet} onChange={e => setFakeBet(e.target.value)} placeholder="Bet amount" className={`w-full ${inp}`} />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={addFakePlayer} className="bg-purple-700 hover:bg-purple-600 text-white text-sm py-2 rounded-lg font-semibold">+ Anon Bot</button>
          <button onClick={removeFakePlayer} className="bg-yellow-900/60 hover:bg-yellow-800 border border-yellow-600/40 text-yellow-300 text-sm py-2 rounded-lg font-semibold">− Remove Bot</button>
          <button onClick={forceStart} className="bg-green-800 hover:bg-green-700 text-white text-sm py-2 rounded-lg font-semibold">🚀 Force Start</button>
          <button onClick={() => forceCloseRoom(fakeRoom)} className="bg-orange-900/60 hover:bg-orange-800 border border-orange-600/40 text-orange-300 text-sm py-2 rounded-lg font-semibold">🔄 Clear Room</button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {rooms.filter(r => r.status === 'waiting').map(r => (
            <div key={r.room_type} className="bg-slate-700/50 rounded p-1 text-center text-xs">
              <div className="text-white capitalize">{r.room_type}</div>
              <div className="text-yellow-400">{r.players_count || 0}/{r.max_players || 3}</div>
            </div>
          ))}
        </div>
      </div>

{/* Room Settings */}
      <div className={card}>
        <h3 className="text-yellow-400 font-bold text-sm flex items-center gap-2"><span>⚙️</span> Room Settings</h3>
        <div className="flex gap-1">
          {roomConfigs.filter(rc => rc.room_type !== 'freeroll').map(rc => {
            const btnColors = { free: 'bg-slate-500', bronze: 'bg-amber-700', silver: 'bg-slate-400', gold: 'bg-yellow-600' };
            const isSelected = selectedRoomType === rc.room_type;
            return (
              <button
                key={rc.room_type}
                onClick={() => setSelectedRoomType(rc.room_type)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${isSelected ? (btnColors[rc.room_type] || 'bg-slate-600') + ' text-white' : 'bg-slate-700/40 text-slate-500 hover:text-slate-300'}`}
              >
                {rc.name || rc.room_type}
              </button>
            );
          })}
        </div>
        {roomConfigs.filter(rc => rc.room_type === selectedRoomType).map(rc => {
          const edit = roomConfigEdits[rc.room_type] || rc;
          const saving = roomConfigSaving[rc.room_type];
          const setEdit = (field, val) => setRoomConfigEdits(prev => ({
            ...prev,
            [rc.room_type]: { ...(prev[rc.room_type] || rc), [field]: val }
          }));
          const roomColors = { free: 'text-slate-300', bronze: 'text-amber-500', silver: 'text-slate-300', gold: 'text-yellow-400' };
          return (
            <div key={rc.room_type} className="bg-slate-700/40 rounded-lg p-3 space-y-2">
              <div className={`font-semibold text-xs uppercase tracking-wide ${roomColors[rc.room_type] || 'text-white'}`}>
                {rc.name || rc.room_type}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Min Bet (tokens)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={edit.min_bet} onChange={e => setEdit('min_bet', e.target.value.replace(/^0+(?=\d)/, ''))} className={`w-full ${inp}`} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Max Bet (tokens)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={edit.max_bet} onChange={e => setEdit('max_bet', e.target.value.replace(/^0+(?=\d)/, ''))} className={`w-full ${inp}`} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Min Players to Start</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={edit.min_players} onChange={e => setEdit('min_players', e.target.value.replace(/^0+(?=\d)/, ''))} className={`w-full ${inp}`} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Max Players (cap)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={edit.max_players} onChange={e => setEdit('max_players', e.target.value.replace(/^0+(?=\d)/, ''))} className={`w-full ${inp}`} />
                </div>
              </div>
              <button
                onClick={() => saveRoomConfig(rc.room_type)}
                disabled={saving}
                className="w-full bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white text-xs py-1.5 rounded-lg font-semibold transition-all"
              >
                {saving ? 'Saving...' : `💾 Save ${rc.name || rc.room_type}`}
              </button>
            </div>
          );
        })}
      </div>

{/* Free Roll Settings */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>🏟️</span> Grand Arena Settings</h3>
        <div className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2">
          <div>
            <div className="text-white text-xs font-semibold">Room Status</div>
            <div className={`text-xs mt-0.5 ${freerollConfig.is_locked ? 'text-red-400' : 'text-emerald-400'}`}>
              {freerollConfig.is_locked ? '🔒 Locked — players cannot join' : '🔓 Open — players can join freely'}
            </div>
          </div>
          <button
            onClick={toggleFreerollLock}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${freerollConfig.is_locked ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-red-800 hover:bg-red-700 text-white'}`}
          >
            {freerollConfig.is_locked ? '🔓 Unlock' : '🔒 Lock'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Prize Tokens</label>
            <input
              type="number"
              value={freerollPrize}
              onChange={e => setFreerollPrize(e.target.value)}
              placeholder="500"
              className={`w-full ${inp}`}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Max Players</label>
            <input
              type="number"
              value={freerollMaxPlayers}
              onChange={e => setFreerollMaxPlayers(e.target.value)}
              placeholder="30"
              className={`w-full ${inp}`}
            />
          </div>
        </div>
        <button
          onClick={saveFreerollConfig}
          disabled={freerollSaving}
          className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg font-semibold transition-all"
        >
          {freerollSaving ? 'Saving...' : '💾 Save Grand Arena Config'}
        </button>
      </div>

      {/* User Search */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>👥</span> User Search</h3>
        <div className="flex gap-2">
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Name or username" className={`flex-1 ${inp} min-w-0`} />
          <button onClick={loadUsers} className="bg-blue-700 hover:bg-blue-600 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap">Search</button>
        </div>
        {userList.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {userList.map(u => (
              <div key={u.telegram_id} className="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2 text-xs cursor-pointer hover:bg-slate-600/50"
                onClick={() => { setTgId(String(u.telegram_id)); setUserInfo(u); }}>
                <div>
                  <span className="text-white font-semibold">{u.first_name}</span>
                  {u.username && <span className="text-slate-400 ml-1">@{u.username}</span>}
                  <span className="text-slate-500 ml-1">#{u.telegram_id}</span>
                </div>
                <span className="text-yellow-400 font-bold ml-2 whitespace-nowrap">{(u.token_balance||0).toLocaleString()} tkn</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promo Codes */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>🎟️</span> Promo Codes</h3>
        <div className="grid grid-cols-2 gap-2">
          <input type="text" value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())} placeholder="CODE" className={inp} />
          <input type="number" value={promoAmount} onChange={e => setPromoAmount(e.target.value)} placeholder="Tokens" className={inp} />
        </div>
        <div className="flex items-center gap-3">
          <input type="number" value={promoMaxUses} onChange={e => setPromoMaxUses(e.target.value)} placeholder="Max uses" className={inp} disabled={promoUnlimited} style={{ flex: 1, opacity: promoUnlimited ? 0.4 : 1 }} />
          <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={promoUnlimited} onChange={e => setPromoUnlimited(e.target.checked)} />
            Unlimited uses
          </label>
        </div>
        <button onClick={createPromo} className="w-full bg-purple-700 hover:bg-purple-600 text-white text-sm py-2 rounded-lg font-semibold">
          + Create Promo Code
        </button>
        {promoCodes.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {promoCodes.map(c => (
              <div key={c.code} className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2 text-xs">
                <div>
                  <span className="text-white font-bold font-mono">{c.code}</span>
                  <span className="text-yellow-400 ml-2">+{c.token_amount} tkn</span>
                  <span className="text-slate-500 ml-2">{c.unlimited ? `∞ (${c.uses_count} used)` : `${c.uses_count}/${c.max_uses} uses`}</span>
                </div>
                <button onClick={() => deletePromo(c.code)} className="text-red-400 hover:text-red-300 ml-2">🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual SOL Payment */}
      <div className={card}>
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>💳</span> Manual SOL Payment</h3>
        <input type="text" value={solWallet} onChange={e => setSolWallet(e.target.value)} placeholder="Wallet address" className={`w-full ${inp}`} />
        <input type="text" value={solSig} onChange={e => setSolSig(e.target.value)} placeholder="Transaction signature" className={`w-full ${inp}`} />
        <button onClick={confirmSolPayment} className="w-full bg-teal-700 hover:bg-teal-600 text-white text-sm py-2 rounded-lg font-semibold">
          ✅ Confirm Payment
        </button>
      </div>

      {/* Recent Games */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <h3 className="text-red-400 font-bold text-sm flex items-center gap-2"><span>📜</span> Recent Games</h3>
          <button onClick={loadRecentGames} className="text-xs text-slate-400 hover:text-white">{gamesLoading ? '...' : '↻ Load'}</button>
        </div>
        {recentGames.length > 0 ? (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {recentGames.map((g, i) => {
              const winner = typeof g.winner === 'string' ? JSON.parse(g.winner || 'null') : g.winner;
              return (
                <div key={g.id || i} className="bg-slate-700/40 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="capitalize font-semibold text-white">{g.room_type}</span>
                    <span className="text-yellow-400 font-bold">{(g.prize_pool||0).toLocaleString()} tkn</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-green-400">🏆 {winner?.name || winner?.first_name || 'Unknown'}</span>
                    <span className="text-slate-500">{g.finished_at ? new Date(g.finished_at).toLocaleTimeString() : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-slate-500 text-center py-2">{gamesLoading ? 'Loading...' : 'Click Load'}</div>
        )}
      </div>
    </div>
  );
}

export default AdminPanel;
