import { useEffect, useMemo, useState } from 'react';
import {
  Backpack, CalendarClock, Check, ChevronRight, Coins, Gem, PackagePlus,
  RefreshCw, Search, Shield, Sparkles, Trash2, UserCog, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../api/client';

const TABS = [
  { key: 'player', label: 'Player', Icon: UserCog },
  { key: 'catalog', label: 'Items', Icon: Backpack },
  { key: 'events', label: 'Events', Icon: CalendarClock },
];

const TIERS = ['', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
const CLASSES = ['', 'warrior', 'mage', 'rogue', 'any'];
const SLOTS = ['', 'weapon', 'armor', 'helmet', 'ability'];
const EVENT_TYPES = [
  { key: 'double_xp', label: 'Double XP', config: { xp_multiplier: 2 } },
  { key: 'double_coins', label: 'Double Coins', config: { coin_multiplier: 2 } },
  { key: 'legendary_drop_boost', label: 'Legendary Drop Boost', config: { legendary_drop_multiplier: 2 } },
];

const tierColor = {
  common: '#94a3b8', uncommon: '#22c55e', rare: '#3b82f6',
  epic: '#a855f7', legendary: '#eab308',
};

function Btn({ children, onClick, disabled, tone = 'slate', className = '', title }) {
  const tones = {
    slate: 'bg-slate-700 hover:bg-slate-600 border-slate-500/30 text-slate-100',
    green: 'bg-emerald-800 hover:bg-emerald-700 border-emerald-500/30 text-emerald-100',
    red: 'bg-red-950/70 hover:bg-red-900 border-red-500/30 text-red-300',
    gold: 'bg-yellow-900/60 hover:bg-yellow-800 border-yellow-500/30 text-yellow-200',
    blue: 'bg-blue-900/70 hover:bg-blue-800 border-blue-500/30 text-blue-200',
  };
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      className={`min-h-9 rounded-md border px-3 text-xs font-bold disabled:opacity-40 ${tones[tone]} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return <label className="block min-w-0"><span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">{label}</span>{children}</label>;
}

const inputClass = 'w-full min-h-9 rounded-md border border-slate-600 bg-slate-950 px-2 text-xs text-white';

function ItemThumb({ item }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-slate-950"
      style={{ borderColor: `${tierColor[item.tier] || '#64748b'}88` }}>
      {item.image_path && item.slot !== 'weapon'
        ? <img src={item.image_path} alt="" className="h-full w-full object-contain" />
        : <Sparkles className="h-5 w-5" style={{ color: tierColor[item.tier] || '#94a3b8' }} />}
    </div>
  );
}

export default function GameMasterPanel() {
  const [tab, setTab] = useState('player');
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('Admin adjustment');
  const [progressField, setProgressField] = useState('token_balance');
  const [progressValue, setProgressValue] = useState('');
  const [progressMode, setProgressMode] = useState('adjust');
  const [catalog, setCatalog] = useState([]);
  const [catalogFilters, setCatalogFilters] = useState({ search: '', tier: 'legendary', class_name: '', slot: '' });
  const [grantConfig, setGrantConfig] = useState({ quantity: 1, enchant_level: 0 });
  const [events, setEvents] = useState([]);
  const [eventType, setEventType] = useState('double_xp');
  const [eventHours, setEventHours] = useState(24);
  const [eventConfig, setEventConfig] = useState(JSON.stringify(EVENT_TYPES[0].config));

  const selectedEventTemplate = useMemo(
    () => EVENT_TYPES.find((entry) => entry.key === eventType) || EVENT_TYPES[0],
    [eventType],
  );

  const loadPlayers = async () => {
    setBusy('players');
    try {
      const res = await apiClient.get('/admin/players', { params: { search, limit: 40 } });
      setPlayers(res.data.players || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to search players');
    } finally {
      setBusy('');
    }
  };

  const loadProfile = async (userId = selectedId) => {
    if (!userId) return;
    setBusy('profile');
    try {
      const res = await apiClient.get(`/admin/players/${userId}`);
      setSelectedId(userId);
      setProfile(res.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load player');
    } finally {
      setBusy('');
    }
  };

  const loadCatalog = async () => {
    setBusy('catalog');
    try {
      const res = await apiClient.get('/admin/item-catalog', { params: catalogFilters });
      setCatalog(res.data.items || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load item catalog');
    } finally {
      setBusy('');
    }
  };

  const loadEvents = async () => {
    try {
      const res = await apiClient.get('/admin/events');
      setEvents(res.data.events || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load events');
    }
  };

  useEffect(() => { loadPlayers(); loadEvents(); }, []);
  useEffect(() => { if (tab === 'catalog') loadCatalog(); }, [tab]);

  const mutate = async (key, request, message, refresh = true) => {
    setBusy(key);
    try {
      await request();
      toast.success(message);
      if (refresh) await loadProfile();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Admin action failed');
    } finally {
      setBusy('');
    }
  };

  const patchProgress = () => {
    if (!selectedId || progressValue === '') return;
    const value = progressField === 'class_name' ? progressValue : Number(progressValue);
    mutate('progress', () => apiClient.patch(`/admin/players/${selectedId}`, {
      mode: progressMode, [progressField]: value, reason,
    }), `${progressField} updated`);
  };

  const grantItem = (item) => mutate(
    `grant-${item.id}`,
    () => apiClient.post(`/admin/players/${selectedId}/items`, {
      item_id: item.id,
      quantity: Number(grantConfig.quantity),
      enchant_level: Number(grantConfig.enchant_level),
      reason,
    }),
    `${item.name} granted`,
  );

  const bulkGrant = () => {
    if (!window.confirm(`Grant every item matching the current filters to the selected player?`)) return;
    mutate(
      'bulk',
      () => apiClient.post(`/admin/players/${selectedId}/items/bulk`, {
        search: catalogFilters.search || null,
        tier: catalogFilters.tier || null,
        class_name: catalogFilters.class_name || null,
        slot: catalogFilters.slot || null,
        enchant_level: Number(grantConfig.enchant_level),
        reason,
      }),
      'Filtered item set granted',
    );
  };

  const grantBossSet = () => {
    const { tier, class_name: className } = catalogFilters;
    if (!['epic', 'legendary'].includes(tier) || !['warrior', 'mage', 'rogue'].includes(className)) return;
    if (!window.confirm(`Grant the full ${tier} ${className} boss set: weapon, armor, ability, and helmet?`)) return;
    mutate(
      'boss-set',
      () => apiClient.post(`/admin/players/${selectedId}/items/boss-set`, {
        tier,
        class_name: className,
        enchant_level: Number(grantConfig.enchant_level),
        reason,
      }),
      `Full ${tier} ${className} boss set granted`,
    );
  };

  const patchInventory = (item, patch) => mutate(
    `inv-${item.inventory_id}`,
    () => apiClient.patch(`/admin/players/${selectedId}/inventory/${item.inventory_id}`, { ...patch, reason }),
    `${item.name} updated`,
  );

  const deleteInventory = (item) => {
    if (!window.confirm(`Remove ${item.name} from this player?`)) return;
    mutate(
      `inv-${item.inventory_id}`,
      () => apiClient.delete(`/admin/players/${selectedId}/inventory/${item.inventory_id}`, { params: { reason } }),
      `${item.name} removed`,
    );
  };

  const patchScroll = (scrollType, amount) => mutate(
    `scroll-${scrollType}`,
    () => apiClient.patch(`/admin/players/${selectedId}/scrolls`, {
      scroll_type: scrollType, quantity: amount, mode: 'adjust', reason,
    }),
    `${scrollType} updated`,
  );

  const createEvent = async () => {
    let config;
    try { config = JSON.parse(eventConfig); } catch { return toast.error('Event config must be valid JSON'); }
    const starts = new Date();
    const ends = new Date(starts.getTime() + Number(eventHours) * 3600000);
    await mutate('event-create', () => apiClient.post('/admin/events', {
      name: selectedEventTemplate.label,
      event_type: selectedEventTemplate.key,
      description: `${selectedEventTemplate.label} launched from admin panel`,
      config,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      is_active: true,
    }), 'Event launched', false);
    loadEvents();
  };

  const resetDaily = () => {
    if (!window.confirm('Reset daily claims and quest progress? This lets the player claim daily rewards again.')) return;
    mutate(
      'daily',
      () => apiClient.post(`/admin/players/${selectedId}/reset-daily`, null, { params: { confirm: true, reason } }),
      'Daily state reset',
    );
  };

  const eventStatus = (event) => {
    const now = Date.now();
    if (!event.is_active) return 'OFF';
    if (new Date(event.starts_at).getTime() > now) return 'SCHEDULED';
    if (event.ends_at && new Date(event.ends_at).getTime() <= now) return 'EXPIRED';
    return 'ACTIVE';
  };

  const toggleEvent = async (event) => {
    await mutate(`event-${event.id}`, () => apiClient.patch(`/admin/events/${event.id}`, {
      is_active: !event.is_active,
    }), event.is_active ? 'Event stopped' : 'Event activated', false);
    loadEvents();
  };

  const deleteEvent = async (event) => {
    if (!window.confirm(`Delete ${event.name}?`)) return;
    await mutate(`event-${event.id}`, () => apiClient.delete(`/admin/events/${event.id}`), 'Event deleted', false);
    loadEvents();
  };

  return (
    <section className="rounded-md border border-red-700/40 bg-slate-900/95 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-red-300">Game Master</div>
          <div className="text-[10px] text-slate-500">Player state, items, events, and audit history</div>
        </div>
        <Shield className="h-5 w-5 text-red-400" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`flex min-h-10 items-center justify-center gap-1 rounded-md border text-xs font-bold ${
              tab === key ? 'border-red-500/50 bg-red-950/70 text-red-200' : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'player' && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
              <input className={`${inputClass} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadPlayers()} placeholder="Username, Telegram ID, UUID, wallet" />
            </div>
            <Btn onClick={loadPlayers} disabled={busy === 'players'} tone="blue">Search</Btn>
          </div>

          <div className="max-h-44 overflow-y-auto rounded-md border border-slate-700">
            {players.map((player) => (
              <button key={player.id} type="button" onClick={() => loadProfile(player.id)}
                className={`flex w-full items-center justify-between border-b border-slate-800 px-3 py-2 text-left last:border-0 ${
                  selectedId === player.id ? 'bg-red-950/40' : 'bg-slate-950/50 hover:bg-slate-800'
                }`}>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-white">{player.first_name} {player.last_name || ''}</div>
                  <div className="truncate text-[10px] text-slate-500">@{player.telegram_username || '-'} · {player.telegram_id}</div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  Lv.{player.level} <ChevronRight className="h-3 w-3" />
                </div>
              </button>
            ))}
          </div>

          {profile && (
            <>
              <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-white">{profile.user.first_name} {profile.user.last_name || ''}</div>
                    <div className="text-[10px] text-slate-500">{profile.user.id}</div>
                  </div>
                  <Btn title="Refresh player" onClick={() => loadProfile()}><RefreshCw className="h-3 w-3" /></Btn>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ['Coins', profile.user.token_balance, Coins],
                    ['Diamonds', profile.user.diamonds, Gem],
                    ['Level', profile.user.level, Sparkles],
                    ['XP', profile.user.xp, Zap],
                    ['Energy', profile.user.energy, Zap],
                    ['W/L', `${profile.user.wins}/${profile.user.losses}`, Shield],
                  ].map(([label, value, Icon]) => (
                    <div key={label} className="rounded-md border border-slate-800 bg-slate-900 p-2">
                      <Icon className="mx-auto h-3 w-3 text-yellow-400" />
                      <div className="mt-1 text-xs font-black text-white">{Number.isFinite(value) ? value.toLocaleString() : value}</div>
                      <div className="text-[9px] uppercase text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                <div className="mb-2 text-xs font-black text-slate-200">Progress and resources</div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Operation">
                    <select className={inputClass} value={progressMode} onChange={(e) => setProgressMode(e.target.value)}>
                      <option value="adjust">Add / subtract</option><option value="set">Set exact</option>
                    </select>
                  </Field>
                  <Field label="Field">
                    <select className={inputClass} value={progressField} onChange={(e) => { setProgressField(e.target.value); setProgressValue(''); }}>
                      {['token_balance', 'diamonds', 'xp', 'level', 'energy', 'wins', 'losses', 'class_name'].map((field) => <option key={field}>{field}</option>)}
                    </select>
                  </Field>
                  <Field label="Value">
                    {progressField === 'class_name'
                      ? <select className={inputClass} value={progressValue} onChange={(e) => setProgressValue(e.target.value)}>
                          <option value="">Choose class</option><option>warrior</option><option>mage</option><option>rogue</option>
                        </select>
                      : <input className={inputClass} type="number" value={progressValue} onChange={(e) => setProgressValue(e.target.value)} />}
                  </Field>
                  <Field label="Audit reason">
                    <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Btn tone="green" onClick={patchProgress} disabled={busy === 'progress'}>Apply change</Btn>
                  <Btn tone="gold" onClick={resetDaily}>
                    Reset daily
                  </Btn>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {['normal_scroll', 'blessed_scroll'].map((scroll) => (
                    <div key={scroll} className="rounded-md border border-slate-800 bg-slate-900 p-2">
                      <div className="text-[10px] font-bold text-slate-300">{scroll.replace('_', ' ')}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <Btn onClick={() => patchScroll(scroll, -10)} tone="red">-10</Btn>
                        <span className="text-sm font-black text-white">{profile.scrolls?.[scroll] || 0}</span>
                        <Btn onClick={() => patchScroll(scroll, 10)} tone="green">+10</Btn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-black text-slate-200">Inventory · {profile.inventory.length}</div>
                  <Btn tone="gold" onClick={() => setTab('catalog')}><PackagePlus className="mr-1 inline h-3 w-3" /> Add items</Btn>
                </div>
                <div className="max-h-96 space-y-1 overflow-y-auto">
                  {profile.inventory.map((item) => (
                    <div key={item.inventory_id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-2">
                      <ItemThumb item={item} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-white">{item.name}</div>
                        <div className="text-[9px] uppercase" style={{ color: tierColor[item.tier] }}>{item.tier} · {item.class_name} · {item.slot}</div>
                      </div>
                      <input type="number" min="0" max="10" value={item.enchant_level}
                        onChange={(e) => setProfile((prev) => ({ ...prev, inventory: prev.inventory.map((candidate) => candidate.inventory_id === item.inventory_id ? { ...candidate, enchant_level: e.target.value } : candidate) }))}
                        className="h-8 w-11 rounded border border-slate-600 bg-slate-950 text-center text-xs text-yellow-300" />
                      <Btn title="Save enchant" onClick={() => patchInventory(item, { enchant_level: Number(item.enchant_level) })}><Check className="h-3 w-3" /></Btn>
                      <Btn title={item.equipped ? 'Unequip' : 'Equip'} tone={item.equipped ? 'gold' : 'blue'} onClick={() => patchInventory(item, { equipped: !item.equipped })}>
                        {item.equipped ? 'E' : '+'}
                      </Btn>
                      <Btn title="Remove item" tone="red" onClick={() => deleteInventory(item)}><Trash2 className="h-3 w-3" /></Btn>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                <div className="mb-2 text-xs font-black text-slate-200">Recent admin audit</div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {(profile.audit || []).map((entry) => (
                    <div key={entry.id} className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5">
                      <div className="text-[10px] font-bold text-red-300">{entry.action}</div>
                      <div className="text-[9px] text-slate-500">{entry.reason || 'No reason'} · {new Date(entry.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="mt-3 space-y-3">
          {!selectedId && <div className="rounded-md border border-yellow-600/30 bg-yellow-950/30 p-3 text-xs text-yellow-200">Select a player before granting items.</div>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Search"><input className={inputClass} value={catalogFilters.search} onChange={(e) => setCatalogFilters({ ...catalogFilters, search: e.target.value })} /></Field>
            <Field label="Tier"><select className={inputClass} value={catalogFilters.tier} onChange={(e) => setCatalogFilters({ ...catalogFilters, tier: e.target.value })}>{TIERS.map((v) => <option key={v} value={v}>{v || 'all'}</option>)}</select></Field>
            <Field label="Class"><select className={inputClass} value={catalogFilters.class_name} onChange={(e) => setCatalogFilters({ ...catalogFilters, class_name: e.target.value })}>{CLASSES.map((v) => <option key={v} value={v}>{v || 'all'}</option>)}</select></Field>
            <Field label="Slot"><select className={inputClass} value={catalogFilters.slot} onChange={(e) => setCatalogFilters({ ...catalogFilters, slot: e.target.value })}>{SLOTS.map((v) => <option key={v} value={v}>{v || 'all'}</option>)}</select></Field>
            <Field label="Quantity"><input className={inputClass} type="number" min="1" max="100" value={grantConfig.quantity} onChange={(e) => setGrantConfig({ ...grantConfig, quantity: e.target.value })} /></Field>
            <Field label="Enchant"><input className={inputClass} type="number" min="0" max="10" value={grantConfig.enchant_level} onChange={(e) => setGrantConfig({ ...grantConfig, enchant_level: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn tone="blue" onClick={loadCatalog} disabled={busy === 'catalog'}>Apply filters</Btn>
            <Btn tone="gold" onClick={bulkGrant} disabled={!selectedId || busy === 'bulk'}>Grant filtered set</Btn>
          </div>
          <Btn
            className="w-full"
            tone="green"
            onClick={grantBossSet}
            disabled={
              !selectedId
              || busy === 'boss-set'
              || !['epic', 'legendary'].includes(catalogFilters.tier)
              || !['warrior', 'mage', 'rogue'].includes(catalogFilters.class_name)
            }
          >
            Grant full boss set (weapon + armor + ability + helmet)
          </Btn>
          <div className="max-h-[32rem] space-y-1 overflow-y-auto">
            {catalog.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 p-2">
                <ItemThumb item={item} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-white">{item.name}</div>
                  <div className="text-[9px] uppercase" style={{ color: tierColor[item.tier] }}>{item.tier} · {item.class_name} · {item.slot}</div>
                </div>
                <Btn tone="green" disabled={!selectedId || busy === `grant-${item.id}`} onClick={() => grantItem(item)}>
                  <PackagePlus className="h-3 w-3" />
                </Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'events' && (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
            <div className="mb-2 text-xs font-black text-slate-200">Launch event</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Type"><select className={inputClass} value={eventType} onChange={(e) => {
                const template = EVENT_TYPES.find((entry) => entry.key === e.target.value);
                setEventType(e.target.value); setEventConfig(JSON.stringify(template.config));
              }}>{EVENT_TYPES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></Field>
              <Field label="Duration hours"><input className={inputClass} type="number" min="1" value={eventHours} onChange={(e) => setEventHours(e.target.value)} /></Field>
            </div>
            <Field label="Config"><textarea readOnly className={`${inputClass} mt-2 min-h-20 py-2 font-mono text-slate-400`} value={eventConfig} /></Field>
            <Btn className="mt-2 w-full" tone="green" onClick={createEvent} disabled={busy === 'event-create'}>Launch {selectedEventTemplate.label}</Btn>
          </div>
          <div className="space-y-1">
            {events.map((event) => (
              <div key={event.id} className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-black text-white">{event.name}</div>
                    <div className="text-[9px] text-slate-500">{event.event_type} · ends {event.ends_at ? new Date(event.ends_at).toLocaleString() : 'never'}</div>
                  </div>
                  <span className={`rounded px-2 py-1 text-[9px] font-black ${eventStatus(event) === 'ACTIVE' ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>{eventStatus(event)}</span>
                </div>
                <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-[9px] text-slate-400">{JSON.stringify(event.config, null, 2)}</pre>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Btn tone={event.is_active ? 'red' : 'green'} onClick={() => toggleEvent(event)}>{event.is_active ? 'Stop' : 'Activate'}</Btn>
                  <Btn tone="red" onClick={() => deleteEvent(event)}><Trash2 className="mr-1 inline h-3 w-3" /> Delete</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
