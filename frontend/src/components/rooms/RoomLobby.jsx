import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, MessageCircle, Shield, Sparkles, Sword, User, Users } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ROOM_CONFIGS } from '../../utils/constants';
import apiClient from '../../api/client';
import ArenaBattleLobby from '../game/ArenaBattleLobby';

function getStoredSessionToken() {
  try {
    return JSON.parse(localStorage.getItem('casino_user') || '{}')?.session_token || '';
  } catch {
    return '';
  }
}

// ── Main lobby dispatcher ───────────────────────────────────────────────────
export default function RoomLobby({
  socket,
  lobbyData,
  roomParticipants,
  user,
  lobbyIsAnonymous,
  lobbyMessages,
  lobbyChatInput,
  setLobbyChatInput,
  setLobbyMessages,
  setShowRevealModal,
  setInLobby,
  setLobbyIsAnonymous,
  setConfirmLeave,
  toast,
}) {
  const players = roomParticipants[lobbyData.room_type] || [];
  const isDuel = ROOM_CONFIGS[lobbyData.room_type]?.game_mode === 'duel';

  // Bronze 1v1 duel lobby — Greek mythology theme
  if (isDuel) {
    return (
      <ArenaBattleLobby
        lobbyData={lobbyData}
        players={players}
        user={user}
        setConfirmLeave={setConfirmLeave}
        toast={toast}
      />
    );
  }

  // ── Roulette lobby (free, silver, gold, freeroll) ─────────────────────────
  const minPlayers = lobbyData.min_players || ROOM_CONFIGS[lobbyData.room_type]?.maxPlayers || 3;
  const maxPlayers = lobbyData.max_players || ROOM_CONFIGS[lobbyData.room_type]?.maxPlayers || 3;
  const playersNeeded = Math.max(0, minPlayers - players.length);
  const isReady = players.length >= minPlayers;
  const prizePool = players.reduce((sum, p) => sum + (p.bet_amount || lobbyData.bet_amount || 0), 0);

  // Real countdown timer: starts from 10 s when room is full
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isReady) {
      setCountdown(10);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev == null || prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setCountdown(null);
    }
    return () => clearInterval(timerRef.current);
  }, [isReady]);

  // Emit join_game_room on mount and listen for room_update via the
  // shared socket passed from App.jsx. roomParticipants prop remains
  // the authoritative source (App.jsx handles player_joined centrally).
  useEffect(() => {
    if (!socket || !lobbyData?.room_id) return;

    if (socket.connected) {
      socket.emit('join_game_room', { room_id: lobbyData.room_id, user_id: user?.id, token: getStoredSessionToken() });
    } else {
      const onConnect = () => {
        socket.emit('join_game_room', { room_id: lobbyData.room_id, user_id: user?.id, token: getStoredSessionToken() });
      };
      socket.on('connect', onConnect);
      return () => socket.off('connect', onConnect);
    }
  }, [socket, lobbyData?.room_id]); // eslint-disable-line

  const countdownDisplay = isReady
    ? countdown != null
      ? `00:${String(countdown).padStart(2, '0')}`
      : '...'
    : `Need ${playersNeeded}`;

  return (
    <Card className="bg-white border-blue-100 shadow-[0_12px_30px_rgba(37,99,235,0.08)] text-slate-900 rounded-[24px] overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-blue-600 via-cyan-400 to-indigo-500" />
      <CardContent className="p-4 space-y-4">

        {/* Header */}
        <section className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-extrabold text-slate-950">
                {ROOM_CONFIGS[lobbyData.room_type]?.name || 'Arena'} Lobby
              </h2>
              <Badge className="bg-blue-600 text-white">Arena</Badge>
            </div>
            <p className="text-sm font-medium text-slate-500">
              {lobbyData.bet_amount > 0 ? `${lobbyData.bet_amount} coins entry` : 'Free entry'}
            </p>
          </div>
          <div className="rounded-2xl bg-blue-50 border border-blue-100 px-3 py-2 text-right">
            <div className="text-sm font-extrabold text-blue-700">{players.length}/{maxPlayers}</div>
            <p className="text-[11px] text-slate-500">players</p>
          </div>
        </section>

        {/* Prize pool + countdown */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Shield className="w-4 h-4" />
              Prize pool
            </div>
            <p className="text-2xl font-extrabold text-slate-950">{prizePool.toLocaleString()}</p>
          </div>
          <div className={`rounded-2xl p-3 text-white shadow-lg ${isReady ? 'bg-emerald-600 shadow-emerald-600/20' : 'bg-blue-600 shadow-blue-600/20'}`}>
            <div className="flex items-center gap-2 text-xs mb-1">
              <Clock3 className={`w-4 h-4 ${isReady ? 'text-emerald-100' : 'text-blue-100'}`} />
              <span className={isReady ? 'text-emerald-100' : 'text-blue-100'}>
                {isReady ? 'Starting in' : 'Waiting'}
              </span>
            </div>
            <p className="text-2xl font-extrabold">{countdownDisplay}</p>
          </div>
        </section>

        {/* Ready status banner */}
        <section className={`rounded-2xl border p-3 shadow-sm ${isReady ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${isReady ? 'bg-emerald-100' : 'bg-amber-100'}`}>
              <CheckCircle2 className={`w-5 h-5 ${isReady ? 'text-emerald-600' : 'text-amber-600'}`} />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-slate-950">Ready status</h3>
              <p className="text-xs font-medium text-slate-600">
                {isReady
                  ? 'All players ready. Match starting shortly.'
                  : `${playersNeeded} more player${playersNeeded === 1 ? '' : 's'} needed.`}
              </p>
            </div>
          </div>
        </section>

        {/* Player slots grid */}
        <section className="rounded-[22px] bg-blue-50 border border-blue-100 p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700" />
              <h3 className="font-extrabold text-sm">Players</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">{minPlayers} needed</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: maxPlayers }).map((_, index) => {
              const player = players[index];
              return (
                <div
                  key={player?.user_id || `empty-${index}`}
                  className="rounded-2xl bg-white border border-blue-100 p-3 min-h-[120px] flex flex-col items-center justify-center text-center shadow-sm"
                >
                  {player ? (
                    <>
                      <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center overflow-hidden mb-2 ring-4 ring-blue-50">
                        {player.is_anonymous ? (
                          <User className="w-5 h-5" />
                        ) : player.photo_url ? (
                          <img src={player.photo_url} alt={player.first_name || 'Player'} className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-extrabold">{(player.first_name || 'P').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <p className="text-xs font-extrabold text-slate-800 truncate w-full">
                        {player.is_anonymous ? 'Anonymous' : player.first_name || 'Player'}
                      </p>
                      {/* Loadout: weapon + ability from player data */}
                      <div className="flex flex-col gap-0.5 mt-1 w-full">
                        <span className="flex items-center justify-center gap-1 text-[10px] text-slate-500">
                          <Sword className="w-3 h-3 text-blue-500 shrink-0" />
                          <span className="truncate">{player.weapon?.name || '—'}</span>
                        </span>
                        <span className="flex items-center justify-center gap-1 text-[10px] text-slate-500">
                          <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
                          <span className="truncate">{player.ability?.name || '—'}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 mt-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Ready
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-2xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-slate-300 mb-2">
                        <User className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-bold text-slate-400">Open</p>
                      <p className="text-[11px] text-slate-400 mt-1">Waiting</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Loadout preview — per player */}
        <section className="rounded-[22px] bg-white border border-slate-100 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-extrabold text-sm">Loadout preview</h3>
              <p className="text-xs font-medium text-slate-500">Weapon &amp; ability per player</p>
            </div>
          </div>
          {players.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">No players yet.</p>
          ) : (
            <div className="space-y-2">
              {players.map((player, i) => (
                <div key={player.user_id || i} className="flex items-center gap-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {player.is_anonymous ? '?' : (player.first_name || 'P').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {player.is_anonymous ? 'Anonymous' : player.first_name || 'Player'}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Sword className="w-3 h-3 text-blue-500" />
                        {player.weapon?.name || '—'}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Sparkles className="w-3 h-3 text-violet-500" />
                        {player.ability?.name || '—'}
                      </span>
                    </div>
                  </div>
                  {player.bet_amount != null && player.bet_amount > 0 && (
                    <span className="text-xs font-extrabold text-blue-700 shrink-0">
                      {player.bet_amount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* CTA */}
        <Button
          className={`w-full h-14 rounded-2xl font-extrabold shadow-lg text-white ${
            isReady
              ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
              : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
          }`}
          onClick={() =>
            toast.info(
              isReady
                ? 'Game is starting automatically.'
                : "You're ready. Waiting for more players."
            )
          }
        >
          {isReady ? `Starting in ${countdownDisplay}` : 'Ready — Waiting for Players'}
        </Button>

        {/* Lobby chat */}
        <section className="rounded-[22px] bg-slate-50 border border-slate-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="w-4 h-4 text-blue-600" />
            <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">Lobby chat</p>
          </div>
          <div
            className="h-24 overflow-y-auto flex flex-col gap-1 mb-2"
            ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
          >
            {lobbyMessages.length === 0 ? (
              <p className="text-slate-400 text-sm text-center mt-8">No messages yet.</p>
            ) : (
              lobbyMessages.map((msg, index) => (
                <div key={index} className="text-sm">
                  <span className="font-bold text-blue-700">{msg.name}: </span>
                  <span className="text-slate-700">{msg.text}</span>
                </div>
              ))
            )}
          </div>
          {lobbyIsAnonymous ? (
            <button
              onClick={() => setShowRevealModal(true)}
              className="w-full rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-extrabold text-blue-700"
            >
              Anonymous mode active. Tap to reveal.
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const text = lobbyChatInput.trim();
                if (!text || !lobbyData?.room_id) return;
                const msg = {
                  user_id: String(user?.id),
                  name: user?.first_name || 'Player',
                  text,
                  ts: new Date().toISOString(),
                };
                setLobbyMessages((prev) => [...prev, msg].slice(-50));
                setLobbyChatInput('');
                apiClient
                  .post(
                    `/room-chat/${lobbyData.room_id}?user_id=${encodeURIComponent(
                      String(user?.id)
                    )}&name=${encodeURIComponent(user?.first_name || 'Player')}&text=${encodeURIComponent(text)}`
                  )
                  .catch(() => {
                    toast.error('Failed to send message');
                  });
              }}
              className="flex gap-2"
            >
              <input
                value={lobbyChatInput}
                onChange={(event) => setLobbyChatInput(event.target.value)}
                maxLength={120}
                placeholder="Message"
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
              />
              <button type="submit" className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-extrabold text-white">
                Send
              </button>
            </form>
          )}
        </section>

        {/* Browse / Leave */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => {
              setInLobby(false);
              setLobbyIsAnonymous(false);
              toast.info('Your spot is saved! Hit "Return to Room" to come back.');
            }}
            variant="outline"
            className="h-12 rounded-2xl border-slate-200 text-slate-700 hover:bg-slate-50 font-extrabold"
          >
            Browse
          </Button>
          <Button
            onClick={() => setConfirmLeave(true)}
            variant="outline"
            className="h-12 rounded-2xl border-red-200 text-red-600 hover:bg-red-50 font-extrabold"
          >
            Leave
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
