import React, { useState, useEffect, Suspense, lazy } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Progress } from './components/ui/progress';
import { Separator } from './components/ui/separator';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';
import { Crown, Coins, Users, Trophy, Zap, Wallet, Play, Timer, TrendingUp, TrendingDown, Gift } from 'lucide-react';
import PaymentModal from './components/PaymentModal';
import LevelUpModal from './components/profile/LevelUpModal';
import RouletteWheel from './components/game/RouletteWheel';
import StaticRouletteResult from './components/game/StaticRouletteResult';
import CountdownTimer from './components/game/CountdownTimer';
import PromoCodeBox from './components/shop/PromoCodeBox';
import TopBar from './components/layout/TopBar';
import BottomNav from './components/layout/BottomNav';
import HomeScreen from './components/home/HomeScreen';
import RoomLobby from './components/rooms/RoomLobby';

// Code-split heavy / non-initial screens so they download on demand instead of
// bloating the first-load bundle. Each becomes its own JS chunk loaded on navigation.
const ProfileScreen = lazy(() => import('./components/profile/ProfileScreen'));
const AdminPanel = lazy(() => import('./components/admin/AdminPanel'));
const ArenaScreen = lazy(() => import('./components/game/ArenaScreen'));
const ArenaEntryScreen = lazy(() => import('./components/game/ArenaEntryScreen'));
const RealTimeArenaScreen = lazy(() => import('./components/arena/RealTimeArenaScreen'));
const WeaponDebugScreen = lazy(() => import('./components/arena/WeaponDebugScreen'));
const BossRaidScreen = lazy(() => import('./components/game/BossRaidScreen'));
const TournamentScreen = lazy(() => import('./components/game/TournamentScreen'));
const LeaderboardScreen = lazy(() => import('./components/leaderboard/LeaderboardScreen'));
const InventoryScreen = lazy(() => import('./components/inventory/InventoryScreen'));
const CharacterCreationScreen = lazy(() => import('./components/onboarding/CharacterCreationScreen'));
const DailyQuestsScreen = lazy(() => import('./components/game/DailyQuestsScreen'));
const DailyChestScreen = lazy(() => import('./components/game/DailyChestScreen'));
const SettingsScreen = lazy(() => import('./components/settings/SettingsScreen'));
const TosScreen = lazy(() => import('./components/settings/TosScreen'));
const PrivacyScreen = lazy(() => import('./components/settings/PrivacyScreen'));
import { createSocketClient } from './socket/socketClient';
import { API, BACKEND_URL, PRIZE_LINKS, ROOM_CONFIGS, normalizeRoomType } from './utils/constants';
import { clearStoredUser, getStoredSessionToken, getStoredUser, saveStoredUser } from './utils/storage';
import './App.css';

function authConfig() {
  const token = getStoredSessionToken();
  return {
    withCredentials: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

axios.defaults.withCredentials = true;
axios.interceptors.request.use((config) => {
  const token = getStoredSessionToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Prize links configuration


// Room configurations


// Countdown Timer Component
// Roulette Wheel Component
// Lightweight fallback shown while a lazily-loaded screen chunk downloads.
function ScreenLoader() {
  return (
    <div className="flex items-center justify-center w-full" style={{ minHeight: '40vh' }}>
      <div
        className="animate-spin rounded-full"
        style={{ width: 36, height: 36, border: '3px solid rgba(220,38,38,0.25)', borderTopColor: '#dc2626' }}
      />
    </div>
  );
}

// Static wheel showing final position for missed games (no animation)
function App() {
  if (new URLSearchParams(window.location.search).get('weaponDebug') === '1') {
    return <Suspense fallback={<ScreenLoader />}><WeaponDebugScreen /></Suspense>;
  }

  // Core state
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const userRef = React.useRef(null);
  const isLoadingRef = React.useRef(true);
  const authTimeoutRef = React.useRef(null);
  const fallbackTimeoutRef = React.useRef(null);

  const cancelAuthTimeout = () => {
    if (authTimeoutRef.current) {
      clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;
    }
  };

  const cancelFallbackTimeout = () => {
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
  };

  // Wrap setUser to always log telegram_id
  const setUserWithLog = (newUser) => {
    console.log('🔧 SET_USER CALLED:', {
      hasTelegramId: !!newUser?.telegram_id,
      telegram_id: newUser?.telegram_id,
      isAdmin: newUser?.telegram_id === 7983427898,
      caller: new Error().stack.split('\n')[2] // Show where it was called from
    });
    userRef.current = newUser;
    setUser(newUser);
  };
  
  // Use setUserWithLog everywhere instead of setUser
  const originalSetUser = setUser;
  React.useEffect(() => {
    // Override setUser globally
    window.__setUserDebug = setUserWithLog;
  }, []);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [telegramError, setTelegramError] = useState(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Data state
  const [rooms, setRooms] = useState([]);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomParticipants, setRoomParticipants] = useState({}); // Track participants per room
  const [gameHistory, setGameHistory] = useState([]);
  const [recentWinners, setRecentWinners] = useState([]);
  const [userPrizes, setUserPrizes] = useState([]);
  const [inLobby, setInLobby] = useState(false); // Track if user is in lobby waiting
  const [lobbyIsAnonymous, setLobbyIsAnonymous] = useState(false); // Track if joined lobby anonymously
  const [showRevealModal, setShowRevealModal] = useState(false); // Show identity reveal modal
  const [lobbyData, setLobbyData] = useState(null); // Store lobby room data
  const [showWinnerScreen, setShowWinnerScreen] = useState(false); // Show winner announcement
  const [winnerData, setWinnerData] = useState(null); // Store winner information
  const [winnerDisplayedForGame, setWinnerDisplayedForGame] = useState(() => {
    // Initialize from sessionStorage to persist across re-renders but not page reloads
    return sessionStorage.getItem('last_winner_game_id') || null;
  }); // Track which game ID we've shown winner for
  const [gameInProgress, setGameInProgress] = useState(false); // Track if game is running
  const [currentGameData, setCurrentGameData] = useState(null); // Store current game info
  const [inRealTimeArena, setInRealTimeArena] = useState(false);
  const [activeArenaMatchId, setActiveArenaMatchId] = useState(() => sessionStorage.getItem('active_arena_match') || null);
  const [activeArenaRoomContext, setActiveArenaRoomContext] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('active_arena_context') || 'null');
    } catch {
      return null;
    }
  });
  
  // New synchronization states
  // Single atomic roulette state - null=hidden, {players,winner}=show wheel
  const [rouletteConfig, setRouletteConfig] = useState(null);
  const [floatingReactions, setFloatingReactions] = useState([]); // [{id, emoji, name, x}]
  const [lobbyMessages, setLobbyMessages] = useState([]); // [{user_id, name, text, ts}]
  const [adminBanner, setAdminBanner] = useState(null); // {message, ts}
  const [lobbyChatInput, setLobbyChatInput] = useState('');
  const [shownMatchIds, setShownMatchIds] = useState(new Set()); // Track shown match IDs to prevent duplicates
  const [missedResults, setMissedResults] = useState([]); // Queue of missed games to show on return
  const showGetReadyRef = React.useRef(false); // Ref to track roulette state for socket listeners
  const blockWinnerScreenRef = React.useRef(false); // Block winner screen after redirect_home
  const [forceHideLobby, setForceHideLobby] = useState(false); // Force hide lobby after redirect
  const currentGameRoomRef = React.useRef(null); // Track current game room for socket reconnects
  const lobbyDataRef = React.useRef(null); // Ref so socket listeners read current lobbyData without stale closure

  useEffect(() => {
    lobbyDataRef.current = lobbyData;
  }, [lobbyData]);

  const [activeGameRoomId, setActiveGameRoomId] = useState(() => sessionStorage.getItem('active_game_room') || null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('rooms');
  const [isMobile, setIsMobile] = useState(false);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [anonModal, setAnonModal] = useState(null); // { roomType, betAmount } when open
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Form state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmounts, setBetAmounts] = useState({
    bronze: '',
    silver: '',
    gold: '',
    freeroll: '0'
  }); // Separate bet amount for each room
  const [userActiveRooms, setUserActiveRooms] = useState({}); // Track which rooms user is in: {roomType: {roomId}}
  const [roomLimits, setRoomLimits] = useState({
    free:     { min: 0,   max: 0,    maxPlayers: 3  },
    bronze:   { min: 0,   max: 0,    maxPlayers: 2  },
    silver:   { min: 350, max: 800,  maxPlayers: 3  },
    gold:     { min: 650, max: 1200, maxPlayers: 3  },
    freeroll: { min: 0,   max: 0,    maxPlayers: 30 },
  });

  // Level-up modal state
  const [levelUpData, setLevelUpData] = useState(null);
  const [topBarVersion, setTopBarVersion] = useState(0);

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTokenAmount, setPaymentTokenAmount] = useState(1000);
  const [paymentEurAmount, setPaymentEurAmount] = useState(null); // EUR amount for payment modal

  // Debug roomParticipants changes
  useEffect(() => {
    console.log('🔄 roomParticipants changed:', roomParticipants);
    if (lobbyData) {
      console.log(`Players in ${lobbyData.room_type} room:`, roomParticipants[lobbyData.room_type]);
    }
  }, [roomParticipants, lobbyData]);


  // Debug winner screen state
  useEffect(() => {
    console.log('🏆 showWinnerScreen changed:', showWinnerScreen);
    console.log('🏆 winnerData:', winnerData);
  }, [showWinnerScreen, winnerData]);


  // Debug user state changes - especially telegram_id
  useEffect(() => {
    console.log('👤 USER STATE CHANGED:', {
      hasTelegram_id: !!user?.telegram_id,
      telegram_id: user?.telegram_id,
      isAdmin: user?.telegram_id === 7983427898,
      allKeys: user ? Object.keys(user) : []
    });
  }, [user]);

  // Debug game in progress state
  useEffect(() => {
    console.log('🎮 gameInProgress changed:', gameInProgress);
    console.log('🎮 currentGameData:', currentGameData);
  }, [gameInProgress, currentGameData]);

  // Debug lobby state
  useEffect(() => {
    console.log('🚪 inLobby changed:', inLobby);
    console.log('🚪 lobbyData:', lobbyData);
  }, [inLobby, lobbyData]);

  // Polling for lobby participants (only if in lobby)
  useEffect(() => {
    console.log(`🚪 inLobby changed: ${inLobby}`);
    console.log(`🚪 lobbyData:`, lobbyData);
    
    if (!inLobby || !lobbyData || !lobbyData.room_type) {
      console.log('⚠️ Polling NOT started - inLobby:', inLobby, 'lobbyData:', lobbyData);
      return;
    }

    let pollCount = 0;

    const fetchParticipants = async () => {
      if (document.hidden) return; // don't poll while backgrounded
      pollCount++;

      try {
        const response = await axios.get(`${API}/room-participants/${lobbyData.room_type}`);
        const players = response.data.players || [];

        setRoomParticipants(prev => ({ ...prev, [lobbyData.room_type]: players }));

        // Update min/max players in lobbyData if server returned them
        if (response.data.min_players || response.data.max_players) {
          setLobbyData(prev => prev ? { ...prev, min_players: response.data.min_players, max_players: response.data.max_players } : prev);
        }

        const minNeeded = response.data.min_players || lobbyData.min_players || 3;
        // React will automatically re-render when state changes.
        // game_finished socket event handles winner display from here.
        if (players.length >= minNeeded) {
          toast.success(`🎰 Room Full! Game starting...`, { id: `room-full-${lobbyData.room_type}`, duration: 3000 });
        }

      } catch (error) {
        console.error('Error fetching participants:', error);
        // Don't show error toast for every poll failure, just log it
        if (pollCount === 1) {
          // Only show error on first failure
          toast.error('Failed to load players. Retrying...');
        }
      }
    };

    // Fetch immediately
    fetchParticipants();
    
    // Then poll every 2000ms (reasonable for lobby updates)
    const pollInterval = setInterval(fetchParticipants, 2000);

    return () => {
      console.log('🧹 Cleaning up lobby polling');
      clearInterval(pollInterval);
    };
    // Depend on room_type only (stable per lobby session). Depending on the whole
    // lobbyData object would restart this interval on every poll, since the poll
    // itself calls setLobbyData (new object reference each time).
  }, [inLobby, lobbyData?.room_type]); // eslint-disable-line

  // GAME STATE POLLING — primary mechanism for showing roulette (socket events are unreliable)
  // Polls /api/room/{room_id} every 1s while user is in a game room
  useEffect(() => {
    const roomId = activeGameRoomId;
    if (!roomId) return;

    let lastStatus = '';
    let lastMatchId = '';

    const pollGameState = async () => {
      // Skip polling while app is backgrounded (saves battery + server load).
      // Interval resumes automatically when the tab/app becomes visible again.
      if (document.hidden) return;
      try {
        const response = await axios.get(`${API}/room/${roomId}`);
        const data = response.data;
        const status = data.status;
        const matchId = data.match_id || '';
        const playerCount = (data.players || []).length;
        const arenaMatchId = extractArenaMatchId(data);

        if (arenaMatchId) {
          openArenaCombat(arenaMatchId, {
            room_id: roomId,
            room_type: data.room_type,
            players: data.players || [],
            stake_amount: data.bet_amount || data.stake_amount,
          });
          return;
        }

        // Status: ready → show roulette wheel (never for arena duel rooms)
        const isDuelRoom = data.settings?.game_mode === 'duel';
        if (!isDuelRoom &&
            (status === 'ready' || status === 'playing' || status === 'finished') &&
            lastStatus !== 'ready' && lastStatus !== 'playing' && lastStatus !== 'finished' &&
            !showGetReadyRef.current) {
          blockWinnerScreenRef.current = false;
          showGetReadyRef.current = true;
          setInLobby(false);
          setLobbyData(null);
          setLobbyMessages([]);
          setGameInProgress(false);
          setShowWinnerScreen(false);
          setWinnerData(null);
          setForceHideLobby(true);
          setRouletteConfig({ players: data.players || [], winner: null });
        }

        // Status: finished + winner → inject winner into roulette (never for duel rooms)
        if (!isDuelRoom && status === 'finished' && data.winner && matchId && matchId !== lastMatchId) {
          if (showGetReadyRef.current) {
            lastMatchId = matchId;
            setShownMatchIds(prev => new Set([...prev, matchId]));
            setRouletteConfig(prev => prev ? { ...prev, winner: data.winner } : prev);
          }
        }

        lastStatus = status;
      } catch (e) {
        // Room gone (game ended, room reset) — stop polling
        if (e.response && e.response.status === 404) {
          clearInterval(interval);
        }
      }
    };

    const interval = setInterval(pollGameState, 1000);
    pollGameState(); // immediate first check
    // Poll immediately when app returns to foreground (don't wait for next tick)
    const onVisible = () => { if (!document.hidden) pollGameState(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeGameRoomId]);

  // Mobile detection - force mobile for Telegram WebApp
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Force mobile in Telegram WebApp environment or narrow screens
      const isTelegram = !!(window.Telegram && window.Telegram.WebApp);
      const shouldBeMobile = width <= 768 || isTelegram || (height > width && width <= 1024);
      setIsMobile(shouldBeMobile);
      console.log(`Mobile detection: width=${width}, height=${height}, isTelegram=${!!isTelegram}, isMobile=${shouldBeMobile}`);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);
  // Service Worker completely disabled - no SW listener needed
  // Cache clearing handled in index.html

  // Monitor room participants changes for debugging
  useEffect(() => {
    if (inLobby && lobbyData) {
      const currentRoomPlayers = roomParticipants[lobbyData.room_type] || [];
      const minNeeded = lobbyData.min_players || 3;
      if (currentRoomPlayers.length >= minNeeded && !showGetReadyRef.current) {
        console.log(`✅ [Room Monitor] ${minNeeded} PLAYERS REACHED - room_ready socket event will handle roulette`);
        // The room_ready socket event handles showing the roulette with proper player data
        // This polling fallback only hides the lobby - no roulette logic here
        setInLobby(false);
        setLobbyData(null);
        setLobbyMessages([]);
        setForceHideLobby(true);
      }
    }
  }, [roomParticipants, inLobby, lobbyData])

  // Poll lobby chat history when in lobby (fallback for missed socket events)
  useEffect(() => {
    if (!inLobby || !lobbyData?.room_id) return;
    const fetchChat = async () => {
      try {
        const res = await axios.get(`${API}/room-chat/${lobbyData.room_id}`);
        const msgs = res.data.messages || [];
        // Always sync with server state (source of truth)
        setLobbyMessages(msgs.slice(-50));
      } catch (_) {}
    };
    fetchChat();
    const interval = setInterval(fetchChat, 1500);
    return () => clearInterval(interval);
  }, [inLobby, lobbyData?.room_id]); // eslint-disable-line

  // Detect platform
  const detectPlatform = () => {
    const ua = navigator.userAgent.toLowerCase();
    if (window.Telegram && window.Telegram.WebApp) {
      if (ua.includes('android')) return 'Telegram Android';
      if (ua.includes('iphone') || ua.includes('ipad')) return 'Telegram iOS';
      return 'Telegram WebView';
    }
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'Mobile Browser';
    }
    return 'Desktop Browser';
  };
  
  const platform = detectPlatform();

  function openTelegramShop() {
    const currentUser = userRef.current || user;
    const botUsername = process.env.REACT_APP_TELEGRAM_BOT_USERNAME || 'RiskArenaBot';
    const startParam = currentUser?.telegram_id ? `riskarena_${currentUser.telegram_id}` : 'riskarena';
    const url = `https://t.me/${botUsername}?start=${encodeURIComponent(startParam)}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  }

  const extractArenaMatchId = (data) => (
    data?.arena_match_id ||
    data?.arena?.match_id ||
    data?.arena?.id ||
    data?.match?.arena_match_id ||
    (data?.mode === 'duel' || data?.match_mode === 'duel' || data?.type === 'arena_duel' ? data?.match_id : null)
  );

  const openArenaCombat = (matchId, context = {}) => {
    if (!matchId) return;
    sessionStorage.setItem('active_arena_match', matchId);
    try {
      sessionStorage.setItem('active_arena_context', JSON.stringify(context || null));
    } catch {}
    setActiveArenaMatchId(matchId);
    setActiveArenaRoomContext(context);
    setActiveTab('arena');
    setInLobby(false);
    setLobbyData(null);
    setLobbyMessages([]);
    setGameInProgress(false);
    setCurrentGameData(null);
    setShowWinnerScreen(false);
    setWinnerData(null);
    setRouletteConfig(null);
    showGetReadyRef.current = false;
    setForceHideLobby(false);
  };

  const closeArenaCombat = () => {
    sessionStorage.removeItem('active_arena_match');
    sessionStorage.removeItem('active_arena_context');
    setActiveArenaMatchId(null);
    setActiveArenaRoomContext(null);
    setGameInProgress(false);
    setShowWinnerScreen(false);
    setWinnerData(null);
    setInLobby(false);
    setActiveTab('rooms');
    loadRooms();
    loadGameHistory();
    if (userRef.current?.id) {
      axios.get(`${API}/user/${userRef.current.id}`)
        .then(response => setUser(response.data))
        .catch(() => {});
    }
  };
  
  // Socket connection with robust reconnection
  useEffect(() => {
    console.log('🔌🔌🔌 CONNECTING TO WEBSOCKET 🔌🔌🔌');
    console.log('Backend URL:', BACKEND_URL);
    console.log('Platform:', platform);
    console.log('User Agent:', navigator.userAgent);
    
    // Socket.IO connection
    console.log('🔌 Socket URL:', BACKEND_URL);
    const newSocket = createSocketClient({
      path: '/api/socket.io',  // Match engineio_path in backend
      transports: ['websocket', 'polling'],
      timeout: 60000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      forceNew: false,
      auth: { token: getStoredSessionToken() },
      autoConnect: true
    });
    
    newSocket.on('connect', () => {
      console.log('✅✅✅ WebSocket CONNECTED! ✅✅✅');
      console.log('Socket ID:', newSocket.id);
      console.log('Platform:', platform);
      console.log('Connected:', newSocket.connected);
      console.log('Transport:', newSocket.io.engine.transport.name);
      
      setIsConnected(true);
      // Don't show "Connected" toast - it confuses users before authentication
      // Only authentication success/failure will show toasts
      
      // Register user to socket mapping if user is logged in
      const storedUser = getStoredUser();
      if (storedUser && storedUser.id) {
        console.log('📝 Registering user to socket:', storedUser.id, platform);
        newSocket.emit('register_user', {
          user_id: storedUser.id,
          platform: platform,
          token: getStoredSessionToken()
        });

        // Re-join game room if user was in one (survives reconnect AND full remount)
        const activeGameRoom = sessionStorage.getItem('active_game_room');
        if (activeGameRoom) {
          console.log('🔄 Re-joining game room on connect:', activeGameRoom);
          currentGameRoomRef.current = activeGameRoom;
          newSocket.emit('join_game_room', {
            room_id: activeGameRoom,
            user_id: storedUser.id,
            platform: platform,
            token: getStoredSessionToken()
          });
        }
      } else {
        console.warn('⚠️ No user in localStorage to register');
      }
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('❌❌❌ WebSocket connection error:', error);
      setIsConnected(false);
      // Only show error toast if we've been trying for more than 3 attempts
      // This prevents spam during initial connection or temporary network blips
    });
    
    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}...`);
      setIsConnected(false);
      // Only show reconnection toast after 5 attempts to reduce spam
      if (attemptNumber === 5) {
        toast.info(`Reconnecting...`, { duration: 1000 });
      }
    });
    
    newSocket.on('reconnect_failed', () => {
      console.error('❌ All reconnection attempts failed');
      setIsConnected(false);
      toast.error('Unable to connect to server. Please refresh the page.', { 
        duration: 5000 
      });
    });
    
    newSocket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts!`);
      setIsConnected(true);
      
      // Only show success toast if it took more than 2 attempts
      if (attemptNumber > 2) {
        toast.success('Reconnected!', { duration: 1000 });
      }
      
      // Re-register user after reconnection
      const storedUser = getStoredUser();
      if (storedUser && storedUser.id) {
        console.log('📝 Re-registering user after reconnection:', storedUser.id);
        newSocket.emit('register_user', {
          user_id: storedUser.id,
          platform: platform,
          token: getStoredSessionToken()
        });

        // Re-join game room if we were in one (socket loses room membership on reconnect)
        const reconnectRoom = currentGameRoomRef.current || sessionStorage.getItem('active_game_room');
        if (reconnectRoom) {
          console.log('🔄 Re-joining game room after reconnect:', reconnectRoom);
          newSocket.emit('join_game_room', {
            room_id: reconnectRoom,
            user_id: storedUser.id,
            platform: platform,
            token: getStoredSessionToken()
          });
        }
      }

      // Reload rooms after reconnection
      loadRooms();
    });
    
    newSocket.on('disconnect', (reason) => {
      console.warn('⚠️⚠️⚠️ WebSocket disconnected:', reason);
      setIsConnected(false);
      
      if (reason === 'io server disconnect') {
        // Server disconnected us, manually reconnect
        console.log('🔄 Server disconnected, attempting to reconnect...');
        newSocket.connect();
      }
      
      // Don't show disconnect toast for normal disconnects or quick reconnects
      // Only show if it's a server issue and not a normal close
      if (reason !== 'io client disconnect' && reason !== 'transport close') {
        // Delay showing the toast to avoid spam on quick reconnects
        setTimeout(() => {
          if (!newSocket.connected) {
            toast.warning('Connection lost. Reconnecting...', { duration: 1500 });
          }
        }, 2000);
      }
    });

    setSocket(newSocket);

    // Sync room bet limits when admin changes config
    newSocket.on('room_config_updated', (data) => {
      setRoomLimits(prev => ({
        ...prev,
        [data.room_type]: { min: data.min_bet, max: data.max_bet, maxPlayers: data.max_players }
      }));
    });

    // Room management events
    newSocket.on('user_registered', (data) => {
      console.log('✅✅✅ USER REGISTERED TO SOCKET ✅✅✅');
      console.log('User ID:', data.user_id);
      console.log('Platform:', data.platform);
      console.log('Status:', data.status);
    });

    newSocket.on('room_joined_confirmed', (data) => {
      console.log('✅✅✅ ROOM JOINED CONFIRMED VIA SOCKET.IO ✅✅✅');
      console.log('Room ID:', data.room_id);
      console.log('Socket count in room:', data.socket_count);
    });

    newSocket.on('room_full', (data) => {
      console.log('🚀 ROOM FULL event received:', data);
      // Removed toast - silent transition to GET READY
    });

    // Game events - CRITICAL: These must maintain strict order
    newSocket.on('player_joined', (data) => {
      console.log('📥 EVENT: player_joined', {
        room: data.room_type,
        player: data.player.first_name,
        count: data.players_count,
        status: data.room_status
      });
      
      // REPLACE (not append) room participants with full list from server
      setRoomParticipants(prev => ({
        ...prev,
        [data.room_type]: data.all_players || []
      }));
      
      console.log(`✅ Participant list REPLACED for ${data.room_type}`);
      // Removed toast - silent player join
      
      // Reload rooms to update lobby counts (skip if GET READY is active)
      if (!showGetReadyRef.current) {
        loadRooms();
      }
    });

    // NEW EVENT: room_ready - Show "GET READY!" full-screen animation
    newSocket.on('room_ready', (data) => {
      console.log('🚀🚀🚀 EVENT: room_ready RECEIVED 🚀🚀🚀');
      console.log('📥 room_ready data:', data);

      // Filter: only process if current user is a participant in this game
      const currentUser = userRef.current;
      const isParticipant = currentUser && data.players && data.players.some(p =>
        String(p.user_id) === String(currentUser.id) ||
        String(p.telegram_id) === String(currentUser.telegram_id)
      );
      if (!isParticipant) {
        return;
      }

      const arenaMatchId = extractArenaMatchId(data);
      if (arenaMatchId) {
        openArenaCombat(arenaMatchId, {
          room_id: data.room_id,
          room_type: data.room_type,
          players: data.players || [],
          stake_amount: data.bet_amount || data.stake_amount,
        });
        return;
      }

      // Reset all block flags for new game
      blockWinnerScreenRef.current = false;
      showGetReadyRef.current = false; // force-clear any stuck state from previous game
      
      // AGGRESSIVELY CLOSE EVERYTHING IMMEDIATELY
      console.log('🚪🚪🚪 FORCE CLOSING ALL SCREENS 🚪🚪🚪');
      console.log('BEFORE:', { inLobby, rouletteActive: showGetReadyRef.current, showWinnerScreen, gameInProgress, forceHideLobby });

      setInLobby(false);
      setLobbyData(null);
      setGameInProgress(false);
      setShowWinnerScreen(false);
      setWinnerData(null);
      setForceHideLobby(true);

      // Atomic: set players + show wheel in ONE state update — no timing issues
      showGetReadyRef.current = true;
      const roomPlayers = data.players || [];
      setRouletteConfig({ players: roomPlayers, winner: null });

    });

    newSocket.on('game_starting', (data) => {
      console.log('📥 EVENT: game_starting', {
        room: data.room_type,
        match_id: data.match_id,
        players: data.players?.length
      });

      const arenaMatchId = extractArenaMatchId(data);
      if (arenaMatchId) {
        openArenaCombat(arenaMatchId, {
          room_id: data.room_id,
          room_type: data.room_type,
          players: data.players || [],
          stake_amount: data.bet_amount || data.stake_amount,
        });
        return;
      }
      
      // Removed toast - silent game start
      
      // If user is in this room, show game screen
      if (inLobby && lobbyData?.room_type === data.room_type) {
        setInLobby(false);
        setGameInProgress(true);
        setCurrentGameData({
          room_type: data.room_type,
          players: roomParticipants[data.room_type] || data.players || [],
          message: 'Game in progress...'
        });
        setActiveRoom(data);
      }
      
      // Reload rooms for all players to see updated status
      loadRooms();
    });

    newSocket.on('game_finished', (data) => {
      const matchId = data.match_id;

      // Always refresh history for all users when any game finishes
      loadGameHistory();

      // Filter: only process if current user was a participant (check via showGetReadyRef or player list)
      // If roulette is active (showGetReadyRef=true), we're definitely a participant
      // Otherwise check active_game_room sessionStorage to confirm participation
      const activeRoom = sessionStorage.getItem('active_game_room');
      const isParticipatingRoom = showGetReadyRef.current || (activeRoom && activeRoom === data.room_id);
      if (!isParticipatingRoom) {
        console.log('⏭️ game_finished: not a participant in this game, ignoring');
        return;
      }

      // FIRST CHECK - Before any logging or processing
      if (blockWinnerScreenRef.current) {
        console.log('🚫 BLOCKED by ref');
        return;
      }

      if (!matchId || shownMatchIds.has(matchId)) {
        console.log('🚫 BLOCKED by matchId');
        return;
      }

      if (showWinnerScreen) {
        console.log('🚫 BLOCKED - already showing');
        return;
      }
      
      console.log('✅ game_finished PASSED all checks - Match:', matchId);
      
      // Mark IMMEDIATELY before any processing
      setShownMatchIds(prev => new Set([...prev, matchId]));
      
      // Determine winner
      const winnerName = data.winner_name || `${data.winner?.first_name || ''} ${data.winner?.last_name || ''}`.trim();
      const gameTime = data.finished_at ? new Date(data.finished_at).toLocaleTimeString() : new Date().toLocaleTimeString();
      const isWinner = user &&
        String(user.id) === String(data.winner?.user_id);
      
      // Close game/lobby screens
      setGameInProgress(false);
      setCurrentGameData(null);
      setInLobby(false);
      setLobbyData(null);
      setActiveRoom(null);

      // Prepare winner data
      const winnerInfo = {
        winner: data.winner,
        winner_name: winnerName,
        winner_id: data.winner_id,
        winner_user_id: data.winner?.user_id,
        winner_telegram_id: data.winner?.telegram_id,
        winner_photo: data.winner?.photo_url || '',
        winner_username: data.winner?.username || '',
        room_type: data.room_type,
        prize_pool: data.prize_pool,
        prize_link: data.prize_link,
        is_winner: isWinner,
        game_time: gameTime,
        match_id: matchId
      };

      if (showGetReadyRef.current) {
        // Roulette is spinning - inject winner into existing config atomically
        console.log('🎡 Roulette active - injecting winner into wheel');
        setRouletteConfig(prev => prev ? { ...prev, winner: data.winner } : prev);
        setWinnerDisplayedForGame(matchId);
        if (user) loadUserPrizes();
      } else {
        // No roulette - show winner screen directly
        setRouletteConfig(null);
        showGetReadyRef.current = false;
        setWinnerData(winnerInfo);
        setShowWinnerScreen(true);
        setWinnerDisplayedForGame(matchId);
        console.log('✅ Winner screen displayed');

        setTimeout(() => {
          console.log('⏰ 5 seconds elapsed - auto-redirecting to home');
          setShowWinnerScreen(false);
          setWinnerData(null);
          setActiveTab('rooms');
          if (user && user.id) {
            axios.get(`${API}/user/${user.id}`)
              .then(response => setUser(response.data))
              .catch(error => console.error('Failed to reload user:', error));
          }
          loadRooms();
          loadGameHistory();
        }, 5000);

        if (user) loadUserPrizes();
      }
    });

    newSocket.on('prize_won', (data) => {
      console.log('🎉 Prize won:', data);
      // Removed toast - silent prize notification
      if (user) loadUserPrizes();
    });

    // NEW EVENT: player_left - Handle player disconnection
    newSocket.on('player_left', (data) => {
      console.log('📥 EVENT: player_left', {
        room: data.room_type,
        player: data.player?.first_name,
        remaining: data.players_count
      });
      
      // REPLACE participant list with updated full list
      setRoomParticipants(prev => ({
        ...prev,
        [data.room_type]: data.all_players || []  // FULL list replacement
      }));
      
      console.log(`✅ Participant list updated after ${data.player?.first_name} left`);
      
      toast.warning(
        `👋 ${data.player?.first_name || 'Player'} left the room (${data.players_count}/${lobbyData?.max_players || 3})`,
        { duration: 2000 }
      );
      
      loadRooms();
    });

    newSocket.on('rooms_updated', (data) => {
      console.log('📥 EVENT: rooms_updated');
      // DON'T reload if GET READY is showing - prevents state reset
      if (!showGetReadyRef.current) {
        console.log('✅ Updating room list from socket data');
        if (data && data.rooms) {
          setRooms(data.rooms);
          if (data.maintenance_mode !== undefined) setMaintenanceMode(data.maintenance_mode);
        }
      } else {
        console.log('⏭️ Skipping rooms reload - GET READY animation in progress');
      }
    });

    // NEW EVENT: redirect_home - Backend signals all players to return to home
    newSocket.on('redirect_home', (data) => {
      console.log('🟢🟢🟢 EVENT: redirect_home RECEIVED 🟢🟢🟢');
      console.log('Match ID:', data.match_id);

      // Filter: only process if we're an active participant
      const activeRoomForRedirect = sessionStorage.getItem('active_game_room');
      const isParticipatingRedirect = showGetReadyRef.current || (activeRoomForRedirect && activeRoomForRedirect === data.room_id);
      if (!isParticipatingRedirect) {
        console.log('⏭️ redirect_home: not a participant, ignoring');
        return;
      }

      // User was online and saw the result — clear pending result from DB
      if (userRef.current?.id) {
        axios.get(`${API}/pending-result/${userRef.current.id}`, authConfig()).catch(() => {});
      }

      // CRITICAL: Block any future winner screens from this game
      blockWinnerScreenRef.current = true;
      console.log('🚫 Winner screen BLOCKED for future events');
      
      // FORCE RESET ALL GAME STATE IMMEDIATELY
      console.log('🏠🏠🏠 FORCING HOME SCREEN RETURN 🏠🏠🏠');
      
      // Mark this match as fully processed
      if (data.match_id) {
        setShownMatchIds(prev => new Set([...prev, data.match_id]));
      }
      
      // Batch all state updates together
      setShowWinnerScreen(false);
      setWinnerData(null);
      setInLobby(false);
      setLobbyIsAnonymous(false);
      setLobbyData(null);
      setGameInProgress(false);
      setActiveRoom(null);
      setRoomParticipants({});
      setForceHideLobby(false);
      // Always reset roulette ref + config on redirect_home (game is fully over)
      showGetReadyRef.current = false;
      currentGameRoomRef.current = null;
      sessionStorage.removeItem('active_game_room');
      sessionStorage.removeItem('active_arena_match');
      setActiveGameRoomId(null);
      setActiveArenaMatchId(null);
      setActiveArenaRoomContext(null);
      setRouletteConfig(null);
      setActiveTab('rooms');
      
      console.log('AFTER - inLobby:', false, 'showWinner:', false, 'gameInProgress:', false);
      console.log('AFTER - activeTab:', 'rooms');
      
      // Force re-render by updating a dummy state
      console.log('Forcing component re-render...');
      
      // Reload user data to get updated balance
      console.log('Reloading user data...');
      if (user && user.id) {
        axios.get(`${API}/user/${user.id}`)
          .then(response => {
            console.log('✅ User data reloaded:', response.data);
            setUser(response.data);
          })
          .catch(error => {
            console.error('❌ Failed to reload user:', error);
          });
      }
      
      // Reload all data with delays
      console.log('Reloading rooms, history, and bonus...');
      loadRooms();
      loadGameHistory();
      
      // Double-check lobby is hidden after 1 second
      setTimeout(() => {
        console.log('🔍 Double-checking state after 1s...');
        console.log('inLobby should be false:', inLobby);
        if (inLobby) {
          console.error('⚠️⚠️⚠️ LOBBY STILL VISIBLE - FORCING AGAIN');
          setInLobby(false);
          setLobbyData(null);
        }
      }, 1000);
      
      console.log('✅ redirect_home complete');
      // Removed "Game finished! Returning home..." toast - clean silent redirect
    });

    newSocket.on('new_room_available', (data) => {
      console.log('🆕 New room available:', data);
      loadRooms();
    });

    newSocket.on('reaction_received', (data) => {
      // Only show if we're in the same room
      const activeRoom = sessionStorage.getItem('active_game_room');
      if (data.room_id && activeRoom && data.room_id !== activeRoom) return;
      const id = Date.now() + Math.random();
      const x = 15 + Math.random() * 70;
      setFloatingReactions(prev => [...prev, { id, emoji: data.emoji, name: data.name, x }]);
      setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
    });

    newSocket.on('lobby_message', (data) => {
      // Skip echo of own messages — already added optimistically on send
      const currentUserId = userRef.current?.id;
      if (currentUserId && String(data.user_id) === String(currentUserId)) return;
      // Only show messages for the current room
      const currentRoomId = lobbyDataRef.current?.room_id;
      if (currentRoomId && data.room_id && String(data.room_id) !== String(currentRoomId)) return;
      setLobbyMessages(prev => [...prev, data].slice(-50));
    });

    newSocket.on('admin_broadcast', (data) => {
      if (data?.message) {
        setAdminBanner({ message: data.message, ts: data.ts });
        // Auto-dismiss after 12s
        setTimeout(() => setAdminBanner(null), 12000);
      }
    });

    newSocket.on('token_balance_updated', (data) => {
      if (user && data.user_id === user.id) {
        setUser({...user, token_balance: data.new_balance});
        toast.success(`🎉 Payment confirmed! +${data.tokens_added} tokens (${data.sol_received} SOL)`);
      }
    });

    newSocket.on('balance_updated', (data) => {
      setUser(prev => prev && data.user_id === prev.id ? {...prev, token_balance: data.new_balance} : prev);
    });

    newSocket.on('players_updated', (data) => {
      console.log('📥 EVENT: players_updated', data);
      // Update lobby room participants when a player reveals identity
      if (data.room_id && data.players) {
        // Find which room type this room belongs to by checking lobbyData
        // We update by room_id matching in roomParticipants via the room_type in lobbyData
        setRoomParticipants(prev => {
          const newPrev = { ...prev };
          // Update any room type whose players contain a match for this room_id
          // Since we track by room_type, we rebuild via players list
          Object.keys(newPrev).forEach(rt => {
            // We identify room by checking if any of the updated players match current list
            if (newPrev[rt] && newPrev[rt].length > 0) {
              const currentIds = new Set(newPrev[rt].map(p => p.user_id));
              const updatedIds = new Set(data.players.map(p => p.user_id));
              // If the sets overlap significantly, this is our room
              let overlap = 0;
              currentIds.forEach(id => { if (updatedIds.has(id)) overlap++; });
              if (overlap > 0 && overlap >= Math.min(currentIds.size, updatedIds.size) / 2) {
                newPrev[rt] = data.players;
              }
            }
          });
          return newPrev;
        });
      }
    });

    return () => {
      console.log('🧹 Cleaning up WebSocket connection');
      newSocket.close();
    };
  }, []); // Empty dependency array - only run once on mount

  // Authentication and data loading
  useEffect(() => {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    // Initialize Telegram Web App early
    if (window.Telegram && window.Telegram.WebApp) {
      console.log('🔄 Initializing Telegram Web App...');
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }

    // Local dev auth bypass. Use localhost:3000?dev=2 in a second browser
    // to create a separate user for real-time battle testing.
    if (isLocalhost) {
      const loginDevUser = async () => {
        try {
          const params = new URLSearchParams(window.location.search);
          const devUid = params.get('dev') || '1';
          const response = await axios.get(`${API}/auth/dev`, {
            params: { username: `DevUser${devUid}`, uid: devUid },
          });

          if (response.data) {
            setUser(response.data);
            saveUserSession(response.data);
            loadRooms();
            loadGameHistory();
            loadUserPrizes();
            fetchRoomLimits();
            await fetchMissedResults(response.data.id);
            setIsLoading(false);
          }
        } catch (err) {
          console.error('Dev auth failed, falling back to Telegram auth:', err);
          clearStoredUser();
        }
      };

      loginDevUser();
      return;
    }
    
    // Check for saved user session first
    const userData = getStoredUser();
    if (userData?.id || userData?.session_token) {
      try {
        console.log('✅ Found saved user session:', userData);
        
        // CRITICAL FIX: If user ID is null/undefined, force re-auth
        if (!userData.id || userData.id === 'null' || userData.id === 'undefined') {
          console.warn('⚠️ Invalid user ID in cache - forcing re-authentication');
          clearStoredUser();
          authenticateFromTelegram();
          return;
        }
        
        // CRITICAL: Validate telegram_id exists in cached data
        if (!userData.telegram_id) {
          console.warn('⚠️ Cached user missing telegram_id - forcing re-authentication');
          clearStoredUser();
          authenticateFromTelegram();
          return;
        }
        
        // CRITICAL: For admin, always force fresh authentication to prevent stale data
        // DISABLED: This prevents admin from staying logged in
        // if (userData.telegram_id === 7983427898) {
        //   console.warn('👑 Admin detected in cache - forcing fresh authentication for data integrity');
        //   clearStoredUser();
        //   authenticateFromTelegram();
        //   return;
        // }
        
        // Set cached user first for instant UI
        setUser(userData);
        
        // Load fresh data
        loadRooms();
        loadGameHistory();
        loadUserPrizes();
        
        // IMMEDIATELY refresh from server to get latest balance and verify session (async)
        (async () => {
          try {
            const response = await axios.get(`${API}/user/${userData.id}`);
            if (response.data) {
              console.log('✅ Session verified. Refreshed user data:', response.data);
              setUser(response.data);
              saveUserSession(response.data);
              toast.success(`Welcome back, ${response.data.first_name}!`);

              await fetchMissedResults(response.data.id);
            }
          } catch (refreshError) {
            console.error('❌ Session validation failed:', refreshError);
            // If session is invalid, clear it and try Telegram auth
            clearStoredUser();
            toast.warning('Session expired. Please log in again.');
            authenticateFromTelegram();
          }
        })();
        
        setIsLoading(false);
        return;
      } catch (e) {
        console.error('Failed to parse saved user:', e);
        clearStoredUser();
      }
    }
    
    loadRooms();
    loadGameHistory();
    fetchRoomLimits();

    // Telegram authentication - REAL USERS ONLY
    const authenticateFromTelegram = async () => {
      // Background Telegram auth - updates user if in Telegram environment
      try {
        console.log('🔍 Initializing Telegram Web App authentication...');
        
        // Quick check for Telegram environment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // If not in Telegram environment, throw error to trigger fallback
        if (!window.Telegram || !window.Telegram.WebApp) {
          throw new Error('Not in Telegram environment');
        }
        
        const webApp = window.Telegram.WebApp;
        console.log('=' * 50);
        console.log('🔍 TELEGRAM WEB APP DEBUG INFO:');
        console.log('WebApp object:', webApp);
        console.log('WebApp.initData:', webApp.initData);
        console.log('WebApp.initDataUnsafe:', webApp.initDataUnsafe);
        console.log('WebApp.initDataUnsafe.user:', webApp.initDataUnsafe?.user);
        console.log('=' * 50);
        
        // Initialize WebApp
        webApp.ready();
        webApp.expand();
        
        // Get Telegram user data
        let telegramUser = webApp.initDataUnsafe?.user;
        console.log('Initial telegramUser:', telegramUser);
        
        // If no user data in initDataUnsafe, try other methods
        if (!telegramUser || !telegramUser.id) {
          console.log('No user in initDataUnsafe, checking other sources...');
          
          // Try to get user from initData if available
          if (webApp.initData) {
            try {
              const initDataParams = new URLSearchParams(webApp.initData);
              const userParam = initDataParams.get('user');
              if (userParam) {
                telegramUser = JSON.parse(decodeURIComponent(userParam));
                console.log('Found user in initData:', telegramUser);
              }
            } catch (e) {
              console.log('Failed to parse user from initData:', e);
            }
          }
          
          // If still no user, throw error to trigger fallback
          if (!telegramUser || !telegramUser.id) {
            console.warn('⚠️ NO TELEGRAM USER DATA AVAILABLE - Will use fallback');
            console.log('WebApp.initData:', webApp.initData);
            console.log('WebApp.initDataUnsafe:', webApp.initDataUnsafe);
            throw new Error('No Telegram user data - using fallback authentication');
          }
        }
        
        console.log('Final telegramUser:', telegramUser);
        
        // Prepare authentication data with proper validation
        const authData = {
          id: parseInt(telegramUser.id),
          first_name: telegramUser.first_name || 'Telegram User',
          last_name: telegramUser.last_name || '',
          username: telegramUser.username || '',
          photo_url: telegramUser.photo_url || '',
          auth_date: Math.floor(Date.now() / 1000),
          hash: webApp.initData || 'telegram_webapp',
          init_data: webApp.initData || '',
          telegram_id: parseInt(telegramUser.id)
        };

        console.log('📤 Sending authentication data to backend:', authData);
        
        // Call API with user data
        const response = await axios.post(`${API}/auth/telegram`, {
          telegram_auth_data: authData
        }, {
          timeout: 10000, // 10 second timeout
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.data) {
          console.log('✅ Telegram authentication successful:', response.data);

          cancelFallbackTimeout();
          setUser(response.data);
          saveUserSession(response.data);
          setIsLoading(false);

          // Show welcome message for returning users
          if (response.data.token_balance >= 1000) {
            toast.success(`🎉 Welcome back, ${response.data.first_name}! Balance: ${response.data.token_balance} tokens`);
          } else if (response.data.token_balance > 0) {
            toast.success(`Welcome, ${response.data.first_name}! Balance: ${response.data.token_balance} tokens`);
          } else {
            toast.success(`👋 Welcome, ${response.data.first_name}!`);
          }

          // Load additional data for returning users
          setTimeout(() => {
            loadUserPrizes();
            loadDerivedWallet();
          }, 500);

          await fetchMissedResults(response.data.id);

          // Configure WebApp
          webApp.enableClosingConfirmation();
          if (webApp.setHeaderColor) webApp.setHeaderColor('#1e293b');
          if (webApp.setBackgroundColor) webApp.setBackgroundColor('#0f172a');

          cancelAuthTimeout();
          return; // Exit successfully
        }
        
      } catch (error) {
        console.error('❌ Telegram authentication failed:', error);
        console.error('Error details:', {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data
        });
        
        console.log('⚠️ Auth failed - secure fallback will retry verified Telegram initData only.');
        // Note: isLoading stays true so fallback can retry once and then surface the error.
      }
    };

    // Start authentication immediately
    authTimeoutRef.current = setTimeout(authenticateFromTelegram, 100);

    // Fallback timeout - ALWAYS ensures loading completes (reduced to 3s for better UX)
    fallbackTimeoutRef.current = setTimeout(async () => {
      const currentUser = userRef.current;
      const currentLoading = isLoadingRef.current;
      console.log(`⏰ Fallback timeout triggered! user=${currentUser ? 'exists' : 'null'}, isLoading=${currentLoading}`);

      // Ensure we don't run fallback twice
      cancelFallbackTimeout();

      // If user already exists, just stop loading
      if (currentUser) {
        console.log('✅ User already exists - just stopping loading state');
        setIsLoading(false);
        cancelAuthTimeout();
        return;
      }
      
      console.log('No authenticated user found - retrying verified Telegram authentication once.');

      const webApp = window.Telegram?.WebApp;
      const telegramUser = webApp?.initDataUnsafe?.user;
      if (webApp?.initData && telegramUser?.id) {
        try {
          const initDataParams = new URLSearchParams(webApp.initData);
          const authDate = parseInt(initDataParams.get('auth_date') || `${Math.floor(Date.now() / 1000)}`, 10);
          const response = await axios.post(`${API}/auth/telegram`, {
            telegram_auth_data: {
              id: parseInt(telegramUser.id),
              first_name: telegramUser.first_name || 'Telegram User',
              last_name: telegramUser.last_name || '',
              username: telegramUser.username || '',
              photo_url: telegramUser.photo_url || '',
              auth_date: authDate,
              hash: webApp.initData,
              init_data: webApp.initData,
              telegram_id: parseInt(telegramUser.id)
            }
          });

          if (response.data) {
            setUser(response.data);
            saveUserSession(response.data);
            cancelAuthTimeout();
            toast.success(`Welcome back, ${response.data.first_name}!`);
            return;
          }
        } catch (error) {
          console.error('Verified Telegram fallback failed:', error);
        }
      }

      cancelAuthTimeout();
      toast.error('Telegram authentication failed. Reopen the app from Telegram.');
      // Always ensure loading is stopped
      setIsLoading(false);
    }, 3000); // 3 seconds - gives real auth time to complete, but not too long

    return () => {
      cancelAuthTimeout();
      cancelFallbackTimeout();
    };
  }, []);


  // User session management
  const saveUserSession = (userData) => {
    try {
      console.log('💾 Saving user session:', {
        hasTelegramId: !!userData?.telegram_id,
        telegram_id: userData?.telegram_id,
        keys: userData ? Object.keys(userData) : []
      });

      saveStoredUser(userData);
      console.log('✅ User session saved to localStorage');
    } catch (e) {
      console.error('❌ Failed to save user session:', e);
    }
  };

  const handleCharacterCreated = (fields) => {
    setUser((prev) => {
      if (!prev) return prev;
      const nextUser = { ...prev, ...fields };
      saveUserSession(nextUser);
      return nextUser;
    });
    setActiveTab('arena');
    toast.success('Character created');
  };

  const refreshUserData = async (userId) => {
    try {
      // Refresh user balance and data from server
      const response = await axios.get(`${API}/user/${userId}`);
      if (response.data) {
        setUser(response.data);
        saveUserSession(response.data);
        console.log('User data refreshed:', response.data);
      }
    } catch (error) {
      console.log('Failed to refresh user data:', error);
    }
  };

  // Fetch dynamic room bet limits from server
  const fetchRoomLimits = async () => {
    try {
      const r = await axios.get(`${API}/room-configs`);
      const limits = {};
      r.data.forEach(rc => {
        limits[rc.room_type] = { min: rc.min_bet, max: rc.max_bet, maxPlayers: rc.max_players };
      });
      setRoomLimits(limits);
    } catch (e) { /* silently ignore — defaults stay */ }
  };

  // Data loading functions
  const loadRooms = async (showError = false) => {
    try {
      const response = await axios.get(`${API}/rooms`);
      setRooms(response.data.rooms);
      if (response.data.maintenance_mode !== undefined) setMaintenanceMode(response.data.maintenance_mode);

      // Load user's active rooms
      loadAllUserRooms();
    } catch (error) {
      console.error('Failed to load rooms:', error);
      // Only show error toast if explicitly requested (not on initial load)
      if (showError) {
        toast.error('Failed to load rooms. Please refresh.');
      }
    }
  };

  // Enhanced winner detection system for ALL players in room
  const startWinnerDetection = (roomType) => {
    let attempts = 0;
    const maxAttempts = 30; // Check for 30 seconds max
    
    console.log(`🔍 Starting synchronized winner detection for ${roomType} room`);
    
    const checkForWinner = async () => {
      attempts++;
      console.log(`🔍 Winner detection attempt ${attempts}/${maxAttempts} for ${roomType}`);
      
      try {
        // Check game history for recent completed games of this room type
        const response = await axios.get(`${API}/game-history?limit=15`);
        const games = response.data.games;
        
        // Look for ANY recent completed game of this room type (within last 60 seconds)
        const recentGame = games.find(game => 
          game.room_type === roomType && 
          game.status === 'finished' &&
          new Date(game.finished_at) > new Date(Date.now() - 60000) // Within last 60 seconds
        );
        
        if (recentGame && recentGame.winner) {
          console.log('🏆 WINNER FOUND FOR ALL PLAYERS!', recentGame.winner);
          
          // BROADCAST WINNER TO ALL PLAYERS IN THIS ROOM
          await broadcastWinnerToAllPlayers(recentGame, roomType);
          
          return true; // Winner found, stop checking
        }
        
        // Continue checking if no winner yet and under max attempts
        if (attempts < maxAttempts) {
          console.log(`⏳ No winner yet, checking again in 800ms... (${attempts}/${maxAttempts})`);
          setTimeout(checkForWinner, 800);
        } else {
          console.log('❌ Winner detection timeout - no winner found after 30 attempts');
          
          // Force manual check as fallback
          toast.error('Game taking longer than expected. Use "Force Check Winner" button.', { 
            duration: 10000 
          });
        }
        
      } catch (error) {
        console.error('❌ Error in winner detection:', error);
        
        // Retry on error if under max attempts
        if (attempts < maxAttempts) {
          setTimeout(checkForWinner, 1000);
        }
      }
      
      return false;
    };
    
    // Start checking after 2 second delay (give backend time to process)
    setTimeout(checkForWinner, 2000);
  };

  // Broadcast winner result to ALL players (works on mobile AND desktop)
  const broadcastWinnerToAllPlayers = async (gameResult, roomType) => {
    console.log('📢 BROADCASTING WINNER TO ALL PLAYERS (Mobile & Desktop):', gameResult.winner);
    console.log('🖥️ Device Info:', { isMobile, userAgent: navigator.userAgent });
    
    const winnerName = `${gameResult.winner.first_name} ${gameResult.winner.last_name || ''}`.trim();
    
    // PREVENT DUPLICATE: Check if we already showed winner for this game
    const gameId = gameResult.id;
    if (winnerDisplayedForGame === gameId) {
      console.log('⏭️ Winner already displayed for game:', gameId);
      return;
    }
    
    // Force exit ALL states for consistent experience across devices
    console.log('🔄 Setting winner screen state - Before:', { inLobby, gameInProgress, showWinnerScreen });
    
    setInLobby(false);
    setGameInProgress(false);
    setShowWinnerScreen(true);
    setWinnerDisplayedForGame(gameId); // Mark this game as displayed
    
    // Set comprehensive winner data with Telegram info
    const winnerDisplayData = {
      winner: gameResult.winner,
      winner_name: winnerName,
      winner_username: gameResult.winner.username || gameResult.winner.telegram_username,
      winner_photo: gameResult.winner.photo_url,
      room_type: roomType,
      prize_pool: gameResult.prize_pool,
      prize_link: gameResult.prize_link,
      game_id: gameResult.id,
      finished_at: gameResult.finished_at,
      all_players: gameResult.players || []
    };
    
    setWinnerData(winnerDisplayData);
    
    console.log('✅ Winner data set for game:', gameId, winnerDisplayData);
    console.log('🔄 Setting winner screen state - After:', { 
      inLobby: false, 
      gameInProgress: false, 
      showWinnerScreen: true 
    });
    
    // Show synchronized winner announcement to ALL players (mobile & desktop)
    toast.success(`🏆 GAME COMPLETE! Winner: ${winnerName}`, { 
      duration: 10000,
      style: {
        background: 'linear-gradient(45deg, #10b981, #059669)',
        color: 'white',
        fontSize: '16px',
        fontWeight: 'bold',
        border: '2px solid #fbbf24'
      }
    });
    
    console.log('🎉 Winner announcement displayed for ALL players (Mobile & Desktop)!');
    
    // Update user balance if current user is the winner
    if (user && gameResult.winner && 
        (user.telegram_id === gameResult.winner.telegram_id || user.id === gameResult.winner.id)) {
      console.log('🏆 Current user is the WINNER! Updating balance...');
      
      // Refresh user data to get updated balance
      setTimeout(async () => {
        try {
          const userResponse = await axios.get(`${API}/me`);
          if (userResponse.data) {
            setUser(userResponse.data);
            console.log('💰 Winner balance updated!');
          }
        } catch (error) {
          console.error('Failed to refresh winner balance:', error);
        }
      }, 1000);
    }
    
    // Force a re-render to ensure winner screen shows on all devices
    setTimeout(() => {
      console.log('🔄 Force checking winner screen state:', { showWinnerScreen: true });
    }, 100);
    
    // AUTO-REDIRECT to home after 2 seconds
    setTimeout(() => {
      console.log('🏠 AUTO-REDIRECTING to home after winner screen...');
      setShowWinnerScreen(false);
      setWinnerData(null);
      setInLobby(false);
      setLobbyData(null);
      setForceHideLobby(false);  // Allow joining new rooms
      setActiveTab('rooms');
      
      // Reload rooms
      loadRooms();
      
      toast.success('Redirected to home! Join another game.', { duration: 2000 });
    }, 2000);  // 2 seconds to view winner
  };

  const checkForGameCompletion = async (roomType) => {
    try {
      console.log(`🔍 ONE-TIME check for ${roomType} game completion...`);
      
      // Get game history to find the latest finished game  
      const response = await axios.get(`${API}/game-history?limit=5`);
      const games = response.data.games;
      
      if (games.length > 0) {
        // Look for the most recent game of this room type
        const recentGame = games.find(game => game.room_type === roomType);
        
        if (recentGame && recentGame.status === 'finished') {
          const gameId = recentGame.id;
          
          // PREVENT DUPLICATE: Check if we already showed winner for this game
          if (winnerDisplayedForGame === gameId) {
            console.log('⏭️ Winner already displayed for game:', gameId);
            return true; // Already shown
          }
          
          console.log('🏆 FOUND FINISHED GAME! Showing winner:', recentGame.winner);
          
          // FORCE exit from lobby state
          setInLobby(false);
          setGameInProgress(false);
          setShowWinnerScreen(true);
          setWinnerDisplayedForGame(gameId); // Mark this game as displayed
          
          const winnerName = `${recentGame.winner.first_name} ${recentGame.winner.last_name || ''}`.trim();
          
          setWinnerData({
            winner: recentGame.winner,
            winner_name: winnerName,
            room_type: roomType,
            prize_pool: recentGame.total_pool,
            prize_link: recentGame.prize_link,
            game_id: gameId
          });
          
          // Show winner notification
          toast.success(`🏆 WINNER: ${winnerName}!`, { duration: 5000 });
          
          console.log('✅ Winner screen activated for game:', gameId);
          return true; // Winner found
        }
      }
      
      console.log('⏳ No finished game found');
      return false; // No winner yet
      
    } catch (error) {
      console.error('❌ Failed to check for game completion:', error);
      return false;
    }
  };

  const loadDerivedWallet = async () => {
    try {
      if (!user || !user.id) return;
      
      await axios.get(`${API}/user/${user.id}/derived-wallet`, authConfig());
      toast.success('Your personal wallet loaded! 🎯');
    } catch (error) {
      console.error('Failed to load derived wallet:', error);
      toast.error('Failed to load wallet address');
    }
  };

  const loadGameHistory = async (showLoading = false) => {
    try {
      if (showLoading) setIsRefreshingHistory(true);
      const response = await axios.get(`${API}/game-history?limit=10${user?.id ? `&user_id=${user.id}` : ''}`);
      setGameHistory(response.data.games);
      if (showLoading) {
        toast.success('✅ History refreshed!', { duration: 2000 });
      }
    } catch (error) {
      console.error('Failed to load game history:', error);
      if (showLoading) {
        toast.error('Failed to refresh history');
      }
    } finally {
      if (showLoading) {
        setTimeout(() => setIsRefreshingHistory(false), 500);
      }
    }
  };

  const loadUserPrizes = async () => {
    try {
      if (!user || !user.id) return;
      const response = await axios.get(`${API}/user/${user.id}/prizes`);
      setUserPrizes(response.data.prizes || []);
    } catch (error) {
      console.error('Failed to load prizes:', error);
    }
  };


  const fetchMissedResults = async (userId) => {
    try {
      const res = await axios.get(`${API}/pending-result/${userId}`, authConfig());
      const list = res.data?.results || [];
      if (list.length > 0) {
        setMissedResults(list.map(pending => ({
          winner: pending.winner,
          winner_name: `${pending.winner.first_name} ${pending.winner.last_name || ''}`.trim(),
          winner_username: pending.winner.username,
          winner_photo: pending.winner.photo_url,
          room_type: pending.room_type,
          prize_pool: pending.prize_pool,
          prize_link: pending.prize_link,
          game_id: pending.match_id,
          finished_at: pending.finished_at,
          all_players: pending.all_players || [],
          is_winner: String(pending.winner.user_id) === String(userId),
        })));
      }
    } catch (e) {
      console.error('Failed to fetch pending results:', e);
    }
  };

  // Game functions
  const checkUserRoomStatus = async (specificRoomType = null) => {
    if (!user || !user.id) return null;
    
    try {
      const response = await axios.get(`${API}/user-room-status/${user.id}`, authConfig());
      
      // Update active rooms state with ALL rooms
      if (response.data.in_room && response.data.rooms) {
        const newActiveRooms = {};
        response.data.rooms.forEach(room => {
          const roomType = room.room_type.toLowerCase();
          newActiveRooms[roomType] = {
            roomId: room.room_id
          };
        });
        setUserActiveRooms(newActiveRooms);

        // If checking for specific room type, return that room's data
        if (specificRoomType) {
          const specificRoom = response.data.rooms.find(r => r.room_type.toLowerCase() === specificRoomType);
          return specificRoom || null;
        }
      }
      
      return response.data;
    } catch (error) {
      console.error('Failed to check room status:', error);
      return null;
    }
  };

  const loadAllUserRooms = async () => {
    if (!user || !user.id) return;
    
    try {
      // Get current room status
      const response = await axios.get(`${API}/user-room-status/${user.id}`, authConfig());
      
      console.log('🔍 API Response for user rooms:', response.data);
      
      const newActiveRooms = {};
      
      if (response.data.in_room && response.data.rooms) {
        // Loop through all rooms user is in
        response.data.rooms.forEach(room => {
          const roomType = normalizeRoomType(room.room_type);
          newActiveRooms[roomType] = {
            roomId: room.room_id
          };
        });

        console.log('✅ User active rooms loaded:', {
          totalRooms: response.data.total_rooms,
          fullState: newActiveRooms
        });
        setUserActiveRooms(newActiveRooms);
      } else {
        // Clear active rooms if user is not in any room
        console.log('❌ No active rooms');
        setUserActiveRooms({});
      }
    } catch (error) {
      console.error('Failed to load user rooms:', error);
    }
  };

  // Called by the "Enter Bet" / "Join" button — shows anonymous choice modal
  const promptJoinRoom = (roomType) => {
    const betAmount = betAmounts[roomType];
    if (!user) { toast.error('Please authenticate first'); return; }
    if (userActiveRooms[roomType]) { joinRoom(roomType, false); return; } // return-to-room, skip modal
    if (roomType === 'bronze' && !user?.class_name) {
      toast.error('Select a class in Items → Loadout first!');
      setActiveTab('inventory');
      return;
    }
    const parsedBetAmount = parseInt(betAmount);
    if (!parsedBetAmount || isNaN(parsedBetAmount)) { toast.error('Please enter a valid bet amount'); return; }
    const rLimits = roomLimits[roomType] || ROOM_CONFIGS[roomType];
    if (parsedBetAmount < rLimits.min || parsedBetAmount > rLimits.max) {
      toast.error(`Bet amount must be between ${rLimits.min} - ${rLimits.max} tokens`); return;
    }
    if (user.token_balance < parsedBetAmount) { toast.error('Insufficient tokens'); return; }
    setAnonModal({ roomType, betAmount });
  };

  const joinRoom = async (roomType, isAnonymous = false) => {
    const betAmount = betAmounts[roomType];

    console.log('🎯 JOIN ROOM CALLED!', {
      roomType,
      user: user ? 'EXISTS' : 'NULL',
      betAmount,
      selectedRoom
    });

    if (!user) {
      console.error('❌ No user');
      toast.error('Please authenticate first');
      return;
    }

    // Check if user is already in THIS specific room type
    if (userActiveRooms[roomType]) {
      // Show the lobby (Return to Room)
      console.log('✅ User already in this room, showing lobby');

      // Fetch current room state for this specific room type
      const specificRoomData = await checkUserRoomStatus(roomType);
      toast.info(`🔍 Return to Room: ${specificRoomData ? 'found room ' + specificRoomData.room_id?.substring(0,8) : 'NO ROOM'}`, { duration: 5000 });
      if (specificRoomData) {
        setInLobby(true);
        setLobbyData({
          room_type: roomType,
          room_id: specificRoomData.room_id,
          bet_amount: betAmount,
          min_players: specificRoomData.min_players,
          max_players: specificRoomData.max_players,
        });
        setRoomParticipants(specificRoomData.players);

        // Always set game room for polling — regardless of socket state
        currentGameRoomRef.current = specificRoomData.room_id;
        sessionStorage.setItem('active_game_room', specificRoomData.room_id);
        setActiveGameRoomId(specificRoomData.room_id);

        // Also join Socket.IO room if connected
        if (socket && socket.connected) {
          socket.emit('join_game_room', {
            room_id: specificRoomData.room_id,
            user_id: user.id,
            platform: platform,
            token: getStoredSessionToken()
          });
        }
      }

      // Silently return to room, no toast needed
      return;
    }

    // User can join this room (not participating yet in this room type)

    // Freeroll / Free room: skip validation, use bet 0
    const isFreeroll = roomType === 'freeroll' || roomType === 'free';
    const parsedBetAmount = isFreeroll ? 0 : parseInt(betAmount);
    console.log('💰 Parsed bet amount:', parsedBetAmount);

    if (!isFreeroll) {
      if (!parsedBetAmount || isNaN(parsedBetAmount)) {
        console.error('❌ Invalid bet amount (not a number)', betAmount);
        toast.error('Please enter a valid bet amount');
        return;
      }

      const rLimits2 = roomLimits[roomType] || ROOM_CONFIGS[roomType];
      if (parsedBetAmount < rLimits2.min || parsedBetAmount > rLimits2.max) {
        console.error('❌ Bet amount out of range', parsedBetAmount);
        toast.error(`Bet amount must be between ${rLimits2.min} - ${rLimits2.max} tokens`);
        return;
      }

      if (user.token_balance < parsedBetAmount) {
        console.error('❌ Insufficient tokens', { balance: user.token_balance, bet: parsedBetAmount });
        toast.error('Insufficient tokens');
        return;
      }
    }

    console.log('✅ Validation passed, calling API with:', {
      room_type: roomType,
      user_id: user.id,
      bet_amount: parsedBetAmount
    });
    
    try {
      const response = await axios.post(`${API}/join-room`, {
        room_type: roomType,
        user_id: user.id,
        bet_amount: parsedBetAmount,
        is_anonymous: isAnonymous
      }, authConfig());
      console.log('✅ API Response:', response.data);

      if (response.data.status === 'joined') {
        // Removed toast - silent room join
        setUser({...user, token_balance: response.data.new_balance});
        setBetAmounts(prev => ({ ...prev, [roomType]: '' })); // Clear only this room's bet
        setSelectedRoom(null);
        setForceHideLobby(false);
        
        // Track that user is now in this room
        setUserActiveRooms(prev => ({
          ...prev,
          [roomType]: {
            roomId: response.data.room_id
          }
        }));
        
        // DON'T manually set roomParticipants here - let the player_joined socket event handle it
        console.log('✅ Joined room, waiting for player_joined socket event...');
        
        // Always set game room for polling — regardless of socket state
        currentGameRoomRef.current = response.data.room_id;
        sessionStorage.setItem('active_game_room', response.data.room_id);
        setActiveGameRoomId(response.data.room_id);
        toast.info(`✅ JOINED: polling room ${response.data.room_id?.substring(0,8)}`, { duration: 5000 });

        // Join the Socket.IO room for room-specific events
        if (socket && socket.connected) {
          socket.emit('join_game_room', {
            room_id: response.data.room_id,
            user_id: user.id,
            platform: platform,
            token: getStoredSessionToken()
          });
        } else {
          console.error('❌❌❌ SOCKET NOT CONNECTED!');
          console.log('Socket exists:', !!socket);
          console.log('Socket connected:', socket?.connected);
          console.log('Socket ID:', socket?.id);
          console.log('Platform:', platform);
        }
        
        // Enter lobby mode and reset winner screen block
        blockWinnerScreenRef.current = false; // Allow winner screen for new game
        console.log('✅ Winner screen block RESET for new game');
        setInLobby(true);
        setLobbyIsAnonymous(isAnonymous); // Track if joined anonymously
        setLobbyData({
          room_type: roomType,
          room_id: response.data.room_id,
          bet_amount: parsedBetAmount,
          min_players: response.data.min_players,
          max_players: response.data.max_players,
        });
        
        loadRooms();
      }
    } catch (error) {
      console.error('Join room error:', error);
      const errorDetail = error.response?.data?.detail || 'Failed to join room';
      // If already in room → refresh state and show lobby instead of error
      if (errorDetail === 'You are already in this room') {
        await loadAllUserRooms();
        const roomData = await checkUserRoomStatus(roomType);
        if (roomData) {
          setInLobby(true);
          setLobbyData({ room_type: roomType, room_id: roomData.room_id, bet_amount: parseInt(betAmounts[roomType]) || 0, min_players: roomData.min_players, max_players: roomData.max_players });
          setRoomParticipants(prev => ({ ...prev, [roomType]: roomData.players || [] }));
          currentGameRoomRef.current = roomData.room_id;
          sessionStorage.setItem('active_game_room', roomData.room_id);
          if (socket?.connected) socket.emit('join_game_room', { room_id: roomData.room_id, user_id: user.id, token: getStoredSessionToken() });
        }
        return;
      }
      toast.error(errorDetail);
    }
  };

  const enterArenaBattle = async () => {
    if (!user) return;
    if (!user.class_name) {
      toast.error('Choose a character class first');
      return;
    }
    try {
      const response = await axios.post(`${API}/join-room`, {
        room_type: 'bronze',
        user_id: user.id,
        bet_amount: 0,
        is_anonymous: false,
      }, authConfig());
      setUserActiveRooms((prev) => ({ ...prev, bronze: { roomId: response.data.room_id } }));
      currentGameRoomRef.current = response.data.room_id;
      sessionStorage.setItem('active_game_room', response.data.room_id);
      setActiveGameRoomId(response.data.room_id);
      blockWinnerScreenRef.current = false;
      setInLobby(true);
      setLobbyIsAnonymous(false);
      setLobbyData({
        room_type: 'bronze',
        room_id: response.data.room_id,
        bet_amount: 0,
        min_players: response.data.min_players,
        max_players: response.data.max_players,
      });
      loadRooms();
    } catch (error) {
      const errorDetail = error.response?.data?.detail || 'Failed to join arena';
      if (errorDetail === 'You are already in this room') {
        await loadAllUserRooms();
        const roomData = await checkUserRoomStatus('bronze');
        if (roomData) {
          setInLobby(true);
          setLobbyData({ room_type: 'bronze', room_id: roomData.room_id, bet_amount: 0, min_players: roomData.min_players, max_players: roomData.max_players });
          setRoomParticipants((prev) => ({ ...prev, bronze: roomData.players || [] }));
          currentGameRoomRef.current = roomData.room_id;
          sessionStorage.setItem('active_game_room', roomData.room_id);
          if (socket?.connected) socket.emit('join_game_room', { room_id: roomData.room_id, user_id: user.id, token: getStoredSessionToken() });
        }
        return;
      }
      toast.error(errorDetail);
    }
  };

  // Listen for payment completion events to refresh user balance
  useEffect(() => {
    const handlePaymentCompleted = async () => {
      console.log('💰 Payment completed event received - refreshing user data...');
      if (user && user.id) {
        try {
          const response = await axios.get(`${API}/user/${user.id}`);
          if (response.data) {
            console.log('✅ User balance refreshed:', response.data.token_balance);
            setUser(response.data);
            saveUserSession(response.data);
            toast.success(`Balance updated: ${response.data.token_balance} tokens`);
          }
        } catch (error) {
          console.error('Failed to refresh user data:', error);
        }
      }
    };

    window.addEventListener('payment-completed', handlePaymentCompleted);
    
    return () => {
      window.removeEventListener('payment-completed', handlePaymentCompleted);
    };
  }, [user]);

  // Auto-fetch recent winners every 10 seconds
  useEffect(() => {
    if (!user) return;
    const fetchWinners = async () => {
      if (document.hidden) return; // don't poll while backgrounded
      try {
        const res = await axios.get(`${API}/game-history?limit=5`);
        setRecentWinners(res.data.games || []);
      } catch (e) {}
    };
    fetchWinners();
    const interval = setInterval(fetchWinners, 10000);
    return () => clearInterval(interval);
  }, [user]); // eslint-disable-line

  // Error screen for non-Telegram access
  if (telegramError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background: 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)'}}>
        <Card className="w-full max-w-md bg-[#0d0d1a]/95 border-red-900/40">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Telegram Web App Required</h3>
            <p className="text-slate-400 mb-4">RiskArena must be opened as a Telegram Web App, not in a regular browser.</p>
            
            <div className="space-y-3 text-left mb-4">
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">📱</span>
                <p className="text-sm text-slate-300">Open Telegram on your mobile device</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">🔍</span>
                <p className="text-sm text-slate-300">Find your RiskArena bot or Web App</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">🚀</span>
                <p className="text-sm text-slate-300">Tap "Launch" or "Open App" in Telegram</p>
              </div>
            </div>
            
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-4">
              <p className="text-sm text-blue-300 font-medium mb-1">
                🔒 Why Telegram Only?
              </p>
              <p className="text-xs text-blue-200">
                Authentication and payments work securely only within Telegram's environment.
              </p>
            </div>
            
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-300 font-medium">
                ⚠️ Not working? Contact support with error details.
              </p>
            </div>
            <Button
              onClick={() => window.location.reload()}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700"
            >
              🔄 Retry Connection
            </Button>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // Loading screen
  if (isLoading || !user) {
    const loadingMsg = isLoading ? 'Authenticating...' : 'Entering the Arena...';
    return (
      <div style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 30%, rgba(139,0,0,0.18) 0%, transparent 60%), linear-gradient(180deg, #08080f 0%, #130818 50%, #08080f 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glow orbs */}
        <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,0,0,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

        {/* Logo area */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          {/* Crossed swords icon */}
          <div style={{ fontSize: 56, marginBottom: 16, filter: 'drop-shadow(0 0 18px rgba(201,168,76,0.5))' }}>⚔️</div>
          <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 4, color: '#fff', textTransform: 'uppercase', textShadow: '0 0 30px rgba(201,168,76,0.4)' }}>
            Risk<span style={{ color: '#c9a84c' }}>Arena</span>
          </div>
          <div style={{ fontSize: 12, letterSpacing: 6, color: 'rgba(201,168,76,0.6)', textTransform: 'uppercase', marginTop: 6 }}>
            Season 1 · Rise to Risk
          </div>
        </div>

        {/* Spinner */}
        <div style={{ position: 'relative', width: 56, height: 56, marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.05)',
            borderTopColor: '#c9a84c',
            borderRightColor: 'rgba(201,168,76,0.4)',
            animation: 'spin 1s linear infinite',
          }} />
          <div style={{
            position: 'absolute', inset: 8, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.03)',
            borderTopColor: 'rgba(139,0,0,0.8)',
            animation: 'spin 1.5s linear infinite reverse',
          }} />
        </div>

        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>
          {loadingMsg}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 6 }}>
          Compete. Climb. Dominate.
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  if (!user.class_name) {
    return (
      <>
        <Suspense fallback={<ScreenLoader />}>
          <CharacterCreationScreen user={user} onComplete={handleCharacterCreated} />
        </Suspense>
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // Main app
  console.log('🔄 Rendering: MAIN APP', {
    hasUser: !!user,
    telegram_id: user?.telegram_id
  });
  const lightTabs = ['rooms', 'boss', 'inventory'];
  const useLightChrome = lightTabs.includes(activeTab) || inLobby;
  const appBackground = useLightChrome
    ? 'radial-gradient(circle at top left, rgba(96,165,250,0.18), transparent 34%), linear-gradient(180deg, #f8fbff 0%, #eef6ff 48%, #f8fafc 100%)'
    : 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)';
  return (
    <div className={`min-h-screen mobile-app-shell ${useLightChrome ? 'text-slate-900' : 'text-white'} overflow-y-auto ${
      isMobile ? 'overflow-x-hidden max-w-full w-full' : ''
    }`} style={isMobile ? {maxWidth: '100vw', width: '100vw', background: appBackground} : {background: appBackground}}>
      
      {/* Roulette Wheel Animation */}
      {rouletteConfig && (
        <RouletteWheel
          players={rouletteConfig.players}
          winner={rouletteConfig.winner}
          currentUser={user}
          onComplete={() => {
            setRouletteConfig(null);
            showGetReadyRef.current = false;
            currentGameRoomRef.current = null;
            sessionStorage.removeItem('active_game_room');
            setActiveGameRoomId(null);
            setActiveTab('rooms');
            setInLobby(false);
            setLobbyIsAnonymous(false);
            setGameInProgress(false);
            if (user && user.id) {
              axios.get(`${API}/user/${user.id}`)
                .then(response => setUser(response.data))
                .catch(() => {});
            }
            loadRooms();
            loadGameHistory();
          }}
        />
      )}
      
      <TopBar
        key={topBarVersion}
        isMobile={isMobile}
        user={user}
        isConnected={isConnected}
        userPrizes={userPrizes}
        onBuyTokens={() => setActiveTab('tokens')}
        onOpenItems={() => setActiveTab('inventory')}
        onOpenSettings={() => setActiveTab('settings')}
      />

      <div className="flex">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <nav className="desktop-sidebar w-64 backdrop-blur-sm border-r min-h-screen p-4" style={{background: 'rgba(8,8,15,0.85)', borderColor: 'rgba(220,38,38,0.2)'}}>
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab('rooms')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'rooms'
                    ? 'bg-gradient-to-r from-red-700 to-red-800 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Users className="w-5 h-5" />
                <span>Spin Rooms</span>
              </button>

              <button
                onClick={() => setActiveTab('arena')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'arena'
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Play className="w-5 h-5" />
                <span>Arena Game</span>
              </button>

              <button
                onClick={() => setActiveTab('boss')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'boss'
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Zap className="w-5 h-5" />
                <span>Boss Raid</span>
              </button>

              <button
                onClick={() => setActiveTab('tournament')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'tournament'
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Trophy className="w-5 h-5" />
                <span>Tournament</span>
              </button>

              <button
                onClick={() => setActiveTab('inventory')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'inventory'
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Wallet className="w-5 h-5" />
                <span>Items</span>
              </button>

              <button
                onClick={() => setActiveTab('dailyChest')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'dailyChest'
                    ? 'bg-gradient-to-r from-yellow-500 to-yellow-700 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Gift className="w-5 h-5" />
                <span>Daily Chest</span>
              </button>
              
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'history'
                    ? 'bg-gradient-to-r from-purple-700 to-purple-800 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Timer className="w-5 h-5" />
                <span>History</span>
              </button>
              
              <button
                onClick={() => setActiveTab('tokens')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'tokens'
                    ? 'bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Coins className="w-5 h-5" />
                <span>Buy Tokens</span>
              </button>

              {(user?.is_admin || user?.is_owner) && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    activeTab === 'admin'
                      ? 'bg-gradient-to-r from-red-600 to-red-700 text-white font-semibold'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Crown className="w-5 h-5" />
                  <span>Admin Panel</span>
                </button>
              )}

            </div>

            {/* Stats Sidebar */}
            <div className="mt-8 space-y-4">
              <div className="rounded-lg p-4" style={{background: 'rgba(13,13,26,0.8)', border: '1px solid rgba(220,38,38,0.2)'}}>
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Your Balance</div>
                <div className="text-2xl font-bold" style={{color: 'var(--sw-gold)'}}>{user.token_balance}</div>
                <div className="text-xs text-slate-500">RiskArena Tokens</div>
              </div>
            </div>
          </nav>
        )}

        {/* Main Content */}
        <main
          className={`flex-1 overflow-x-hidden ${isMobile ? 'pt-0 pb-24' : 'p-6'}`}
          style={{ background: '#0f172a', minHeight: '100vh', width: '100%' }}
        >
          <div style={{ width: '100%' }}>
            <Suspense fallback={<ScreenLoader />}>

            {/* 🏆 WINNER ANNOUNCEMENT SCREEN - Responsive & Scrollable */}
            {showWinnerScreen && winnerData && (
              <div className="winner-screen-overlay fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-y-auto overflow-x-hidden animate-fadeIn">
                {/* Animated Confetti Background */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(15)].map((_, i) => (
                    <div
                      key={i}
                      className={`absolute w-2 h-2 md:w-3 md:h-3 bg-gradient-to-r ${
                        i % 3 === 0 ? 'from-yellow-400 to-gold-500' : 
                        i % 3 === 1 ? 'from-purple-400 to-purple-600' : 
                        'from-green-400 to-emerald-500'
                      } rounded-full animate-confetti opacity-80`}
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `-${Math.random() * 20}%`,
                        animationDelay: `${Math.random() * 3}s`,
                        animationDuration: `${2 + Math.random() * 2}s`
                      }}
                    />
                  ))}
                </div>

                {/* Scrollable Container */}
                <div className="min-h-full flex items-center justify-center p-3 md:p-6 py-8">
                  <Card className="w-full max-w-[95vw] md:max-w-lg mx-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 border-2 border-gold-500 shadow-2xl shadow-gold-500/50 relative animate-slideUp my-4">
                    <CardContent className="p-4 md:p-8 text-center space-y-4 md:space-y-6">
                      {/* Close Button */}
                      <button
                        onClick={() => {
                          console.log('❌ Closing winner screen');
                          setShowWinnerScreen(false);
                          setWinnerData(null);
                          // Keep the game ID in sessionStorage to prevent re-display on reconnect
                          // It will be cleared on page reload
                          setActiveTab('rooms');
                          setInLobby(false);
                          setGameInProgress(false);
                        }}
                        className="absolute top-2 right-2 md:top-4 md:right-4 w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-slate-700/80 hover:bg-slate-600 text-white transition-colors z-10"
                        aria-label="Close"
                      >
                        ✕
                      </button>
                      
                      {/* Missed game badge */}
                      {winnerData.missed && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700/80 border border-slate-500 text-slate-300 text-xs font-medium mb-1">
                          📵 You were offline — here's what happened
                        </div>
                      )}

                      {/* 🏆 Winner Announcement Title - PERSONALIZED */}
                      <div className="space-y-3 md:space-y-4">
                        {(() => {
                          // FIXED: Use winner.user_id which exists in RoomPlayer model
                          const isCurrentUserWinner = winnerData.is_winner || (user && winnerData.winner && (
                            String(winnerData.winner.user_id) === String(user.id) ||
                            String(winnerData.winner_id) === String(user.id) ||
                            String(winnerData.winner_user_id) === String(user.id)
                          ));
                          
                          console.log('Winner screen check:', {
                            user_id: user?.id,
                            winner_user_id: winnerData.winner?.user_id,
                            winner_id: winnerData.winner_id,
                            is_winner_flag: winnerData.is_winner,
                            isCurrentUserWinner
                          });
                          
                          return isCurrentUserWinner;
                        })() ? (
                          <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-gradient-to-r from-yellow-400 via-gold-500 to-yellow-600 bg-clip-text animate-pulse">
                            🎉 Congratulations, You Won!
                          </h1>
                        ) : (
                          <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-gradient-to-r from-slate-400 via-slate-500 to-slate-600 bg-clip-text">
                            Better Luck Next Time!
                          </h1>
                        )}
                        
                        {/* Animated Trophy - Conditional */}
                        <div className="flex justify-center">
                          <div className="relative">
                            {(() => {
                              const isCurrentUserWinner = winnerData.is_winner || (user && winnerData.winner && (
                                String(winnerData.winner.user_id) === String(user.id) ||
                                String(winnerData.winner_id) === String(user.id) ||
                                String(winnerData.winner_user_id) === String(user.id)
                              ));
                              return isCurrentUserWinner;
                            })() ? (
                              <>
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-r from-yellow-400 to-gold-600 rounded-full flex items-center justify-center animate-bounce shadow-lg shadow-gold-500/50">
                                  <Trophy className="w-8 h-8 md:w-10 md:h-10 text-slate-900" />
                                </div>
                                <div className="absolute -inset-2 bg-gradient-to-r from-yellow-400/20 to-gold-600/20 rounded-full animate-ping"></div>
                              </>
                            ) : (
                              <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-r from-slate-600 to-slate-700 rounded-full flex items-center justify-center shadow-lg">
                                <Trophy className="w-8 h-8 md:w-10 md:h-10 text-slate-400" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Winner Display - PERSONALIZED */}
                      <div className="space-y-3 md:space-y-4">
                        {(() => {
                          const isCurrentUserWinner = winnerData.is_winner || (user && winnerData.winner && (
                            String(winnerData.winner.user_id) === String(user.id) ||
                            String(winnerData.winner_id) === String(user.id) ||
                            String(winnerData.winner_user_id) === String(user.id)
                          ));
                          return isCurrentUserWinner;
                        })() ? (
                          <h2 className="text-xl md:text-2xl font-bold text-green-400 animate-pulse px-2">
                            🎉 Congratulations, @{user.telegram_username || user.first_name}!
                          </h2>
                        ) : (
                          <h2 className="text-xl md:text-2xl font-bold text-slate-300 px-2">
                            🏆 The winner was @{winnerData.winner_username || winnerData.winner?.username || winnerData.winner_name}
                          </h2>
                        )}
                        
                        {/* Winner Photo with Enhanced Display */}
                        <div className="flex justify-center">
                          <div className="relative">
                            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border-4 border-gold-500 shadow-xl shadow-gold-500/50">
                              {winnerData.winner_photo || winnerData.winner?.photo_url ? (
                                <img 
                                  src={winnerData.winner_photo || winnerData.winner.photo_url} 
                                  alt={winnerData.winner_name} 
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    console.log('Photo failed to load, using fallback');
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'flex';
                                  }}
                                />
                              ) : null}
                              <div className="w-full h-full bg-gradient-to-r from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg md:text-xl" 
                                   style={{display: (winnerData.winner_photo || winnerData.winner?.photo_url) ? 'none' : 'flex'}}>
                                {(winnerData.winner_name || 'W').charAt(0).toUpperCase()}
                              </div>
                            </div>
                            <div className="absolute -inset-2 bg-gradient-to-r from-gold-400/30 to-yellow-500/30 rounded-full animate-pulse -z-10"></div>
                          </div>
                        </div>

                        {/* Winner Name Display */}
                        <div className="text-center px-2">
                          <p className="text-base md:text-lg font-semibold text-white">
                            {winnerData.winner_name}
                          </p>
                          {winnerData.winner_username && (
                            <p className="text-sm text-slate-300">
                              @{winnerData.winner_username}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Room Type Display */}
                      <div className="bg-gradient-to-r from-slate-800/80 to-slate-700/80 border border-slate-600/30 rounded-lg p-3 md:p-4 mx-2">
                        <p className="text-xs md:text-sm text-slate-400 text-center">
                          {ROOM_CONFIGS[winnerData.room_type]?.icon} {ROOM_CONFIGS[winnerData.room_type]?.name} Room
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 md:space-y-3 pt-2 md:pt-4 px-2">
                        {/* Play Again Button */}
                        <Button
                          onClick={() => {
                            console.log('🔄 Play Again clicked');
                            setShowWinnerScreen(false);
                            setWinnerData(null);
                            // Keep game ID to prevent re-display
                            setActiveTab('rooms');
                            setInLobby(false);
                            setGameInProgress(false);
                            loadRooms();
                            toast.success('🎮 Ready for another game!');
                          }}
                          className="w-full bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-700 hover:from-purple-700 hover:via-purple-800 hover:to-indigo-800 text-white font-bold text-base md:text-lg py-3 md:py-4 rounded-lg border border-purple-500/50 shadow-lg shadow-purple-500/25 transition-all duration-300 active:scale-95"
                        >
                          🎮 Play Again
                        </Button>
                        
                        {/* View Game History Button */}
                        <Button
                          onClick={() => {
                            console.log('📜 View History clicked');
                            setShowWinnerScreen(false);
                            setWinnerData(null);
                            // Keep game ID to prevent re-display
                            setActiveTab('history');
                            setInLobby(false);
                            setGameInProgress(false);
                            loadGameHistory();
                            toast.info('📊 Viewing game history');
                          }}
                          variant="outline"
                          className="w-full border-2 border-gold-500/50 bg-slate-800/50 hover:bg-gold-500/20 text-gold-400 hover:text-gold-300 font-semibold py-2 md:py-3 rounded-lg transition-all duration-300 active:scale-95"
                        >
                          📊 View Game History
                        </Button>
                      </div>

                      {/* Decorative Elements */}
                      <div className="flex justify-center space-x-1 md:space-x-2 pt-2">
                        {['🎉', '✨', '🏆', '✨', '🎉'].map((emoji, i) => (
                          <span 
                            key={i} 
                            className="text-xl md:text-2xl animate-bounce" 
                            style={{ animationDelay: `${i * 0.1}s` }}
                          >
                            {emoji}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* 📵 MISSED GAME - full screen with static wheel */}
            {missedResults.length > 0 && !showWinnerScreen && (
              <StaticRouletteResult
                players={missedResults[0].all_players}
                winner={missedResults[0].winner}
                currentUser={user}
                missedCount={missedResults.length}
                onClose={() => setMissedResults(prev => prev.slice(1))}
              />
            )}

            {/* GAME IN PROGRESS SCREEN - Show countdown */}
            {gameInProgress && currentGameData && (
              <Card className="bg-slate-800/90 border-2 border-green-500/50">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl text-green-400 flex items-center justify-center gap-2">
                    <Zap className="w-6 h-6 animate-pulse" />
                    {ROOM_CONFIGS[currentGameData.room_type]?.icon} Room is Full!
                  </CardTitle>
                  <CardDescription className="text-lg text-white">
                    This game at {new Date().toLocaleTimeString()} has taken place and is now FULL.
                  </CardDescription>
                  
                  {/* COUNTDOWN TIMER */}
                  <div className="mt-4">
                    <CountdownTimer 
                      onComplete={() => {
                        console.log('⏰ Countdown complete, waiting for winner...');
                      }}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Show both players competing */}
                    <div>
                      <h3 className="text-white font-semibold mb-3 text-center">Players in This Game:</h3>
                      <div className="space-y-3">
                        {currentGameData.players?.map((player, index) => (
                          <div key={`game-player-${player.user_id}`} className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-600/20 to-blue-600/20 rounded-lg border border-green-500/30">
                            {/* Profile Picture */}
                            <div className="w-12 h-12 rounded-full bg-gradient-to-r from-green-400 to-blue-400 flex items-center justify-center text-slate-900 font-bold text-xl flex-shrink-0">
                              {player.photo_url ? (
                                <img src={player.photo_url} alt={player.first_name} className="w-12 h-12 rounded-full" />
                              ) : (
                                player.first_name?.charAt(0).toUpperCase()
                              )}
                            </div>
                            
                            {/* Player Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-white font-semibold truncate">
                                  {player.first_name} {player.last_name || ''}
                                </p>
                                {player.user_id === user?.id && (
                                  <Badge className="bg-blue-500 text-white text-xs">You</Badge>
                                )}
                              </div>
                              {player.username && (
                                <p className="text-slate-400 text-sm">@{player.username}</p>
                              )}
                              <p className="text-blue-400 text-sm font-medium">In Spin</p>
                            </div>
                            
                            {/* Battle indicator for 3-player games */}
                            {index === 1 && currentGameData.players.length === 3 && (
                              <div className="absolute left-1/2 transform -translate-x-1/2 bg-red-500 text-white font-bold px-2 py-1 rounded-full text-xs">
                                ⚔️ BATTLE
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                  </div>
                </CardContent>
              </Card>
            )}

            {/* LOBBY SCREEN - Show when player is waiting in room - HIDDEN when GET READY animation is showing */}
            {!activeArenaMatchId && !showWinnerScreen && !gameInProgress && inLobby && !rouletteConfig && !forceHideLobby && lobbyData && (
              <RoomLobby
                socket={socket}
                lobbyData={lobbyData}
                roomParticipants={roomParticipants}
                user={user}
                lobbyIsAnonymous={lobbyIsAnonymous}
                lobbyMessages={lobbyMessages}
                lobbyChatInput={lobbyChatInput}
                setLobbyChatInput={setLobbyChatInput}
                setLobbyMessages={setLobbyMessages}
                setShowRevealModal={setShowRevealModal}
                setInLobby={setInLobby}
                setLobbyIsAnonymous={setLobbyIsAnonymous}
                setConfirmLeave={setConfirmLeave}
                toast={toast}
              />
            )}

            {/* Battle Rooms Tab */}
            {activeTab === 'rooms' && !activeArenaMatchId && !inLobby && !showWinnerScreen && !gameInProgress && (
              <HomeScreen
                isMobile={isMobile}
                user={user}
                recentWinners={recentWinners}
                rooms={rooms}
                roomLimits={roomLimits}
                maintenanceMode={maintenanceMode}
                userActiveRooms={userActiveRooms}
                betAmounts={betAmounts}
                setBetAmounts={setBetAmounts}
                setSelectedRoom={setSelectedRoom}
                setActiveTab={setActiveTab}
                promptJoinRoom={promptJoinRoom}
                joinRoom={joinRoom}
                setAnonModal={setAnonModal}
              />
            )}

            {activeTab === 'arena' && inRealTimeArena && (
              <RealTimeArenaScreen
                user={user}
                onLeave={() => {
                  setInRealTimeArena(false);
                  setGameInProgress(false);
                  setShowWinnerScreen(false);
                  setWinnerData(null);
                }}
              />
            )}

            {activeTab === 'arena' && !inRealTimeArena && !activeArenaMatchId && !inLobby && !showWinnerScreen && !gameInProgress && (
              <ArenaEntryScreen
                user={user}
                rooms={rooms}
                onEnterBattle={enterArenaBattle}
                onEnterRealTime={() => setInRealTimeArena(true)}
                onClassChange={(cls) => setUser((prev) => prev ? {
                  ...prev,
                  class_name: cls,
                  battle_spritesheet_path: '',
                  battle_spritesheet_hash: '',
                } : prev)}
                onNavigateInventory={() => setActiveTab('inventory')}
                onEnergySpent={(energyData) => setUser((prev) => prev ? { ...prev, ...energyData } : prev)}
              />
            )}

            {/* Safety fallback: arena tab stuck with stale blocking flags but no content to show */}
            {activeTab === 'arena' && !inRealTimeArena && !activeArenaMatchId && !inLobby && (showWinnerScreen ? !winnerData : gameInProgress ? !currentGameData : false) && (
              <ArenaEntryScreen
                user={user}
                rooms={rooms}
                onEnterBattle={enterArenaBattle}
                onEnterRealTime={() => {
                  setGameInProgress(false);
                  setShowWinnerScreen(false);
                  setWinnerData(null);
                  setInRealTimeArena(true);
                }}
                onClassChange={(cls) => setUser((prev) => prev ? {
                  ...prev,
                  class_name: cls,
                  battle_spritesheet_path: '',
                  battle_spritesheet_hash: '',
                } : prev)}
                onNavigateInventory={() => setActiveTab('inventory')}
                onEnergySpent={(energyData) => setUser((prev) => prev ? { ...prev, ...energyData } : prev)}
              />
            )}

            {activeTab === 'arena' && activeArenaMatchId && !inLobby && !showWinnerScreen && !gameInProgress && (
              <ArenaScreen
                user={user}
                matchId={activeArenaMatchId}
                roomContext={activeArenaRoomContext}
                socket={socket}
                onExit={closeArenaCombat}
                onMatchUpdate={(match) => {
                  if (match?.status === 'finished' || match?.status === 'draw') {
                    loadGameHistory();
                    const myXp = match?.metadata?.xp_results?.[String(user?.id)];
                    if (myXp?.leveled_up) {
                      setLevelUpData({ new_level: myXp.new_level });
                    }
                  }
                }}
              />
            )}

            {activeTab === 'boss' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <BossRaidScreen user={user} socket={socket} onLevelUp={(data) => setLevelUpData(data)} />
            )}

            {activeTab === 'tournament' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <TournamentScreen user={user} />
            )}

            {activeTab === 'leaderboard' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <LeaderboardScreen user={user} />
            )}

            {activeTab === 'inventory' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <InventoryScreen
                user={user}
                onClassChange={(cls) => setUser((prev) => prev ? {
                  ...prev,
                  class_name: cls,
                  battle_spritesheet_path: '',
                  battle_spritesheet_hash: '',
                } : prev)}
                onUserUpdate={(fields) => {
                  setUser((prev) => {
                    if (!prev) return prev;
                    const next = { ...prev, ...fields };
                    saveUserSession(next);
                    return next;
                  });
                  setTopBarVersion((v) => v + 1);
                }}
              />
            )}

            {activeTab === 'quests' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <DailyQuestsScreen
                user={user}
                onBack={() => setActiveTab('rooms')}
                onUserUpdate={(fields) => {
                  setUser((prev) => {
                    if (!prev) return prev;
                    const nextUser = { ...prev, ...fields };
                    saveUserSession(nextUser);
                    return nextUser;
                  });
                  setTopBarVersion((version) => version + 1);
                }}
              />
            )}

            {activeTab === 'dailyChest' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <DailyChestScreen
                user={user}
                onBack={() => setActiveTab('rooms')}
                onUserUpdate={(fields) => {
                  setUser((prev) => {
                    if (!prev) return prev;
                    const nextUser = { ...prev, ...fields };
                    saveUserSession(nextUser);
                    if (
                      fields.level !== undefined &&
                      Number(fields.level || 0) > Number(prev.level || 0)
                    ) {
                      setLevelUpData({ new_level: fields.level });
                    }
                    return nextUser;
                  });
                  setTopBarVersion((version) => version + 1);
                }}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsScreen
                user={user}
                onNavigate={(page) => setActiveTab(page)}
              />
            )}

            {activeTab === 'tos' && (
              <TosScreen onBack={() => setActiveTab('settings')} />
            )}

            {activeTab === 'privacy' && (
              <PrivacyScreen onBack={() => setActiveTab('settings')} />
            )}

            {/* Token Purchase Tab */}
            {activeTab === 'tokens' && (
              isMobile ? (
                <div className="space-y-3 max-w-full px-1">
                  {/* Balance Card */}
                  <div style={{ background: 'linear-gradient(135deg, #1a0320 0%, #0d0d1a 100%)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Wallet className="w-4 h-4" style={{ color: '#a855f7' }} />
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Your Balance</span>
                    </div>
                    <div className="text-2xl font-black text-yellow-400" style={{ fontFamily: 'Orbitron, monospace' }}>{(user.token_balance || 0).toLocaleString()}</div>
                    <div className="text-xs text-slate-500">SW Tokens</div>
                  </div>

                  {/* Add Tokens Button */}
                  <button
                    onClick={() => setShowPaymentModal(true)}
                    style={{ width: '100%', background: 'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)', border: 'none', borderRadius: 10, padding: '10px 16px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 0 16px rgba(220,38,38,0.4)' }}
                  >
                    <Zap className="w-4 h-4" />
                    + Add Tokens
                  </button>
                  <p className="text-xs text-slate-500 text-center">⚡ Solana Mainnet · Real SOL payments</p>

                  {/* Package grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {[500, 1000, 2000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => {
                          if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
                          setShowPaymentModal(true);
                          setPaymentEurAmount(amount / 100);
                        }}
                        style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a20 100%)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 10, padding: '10px 6px', color: 'white', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(220,38,38,0.8)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(220,38,38,0.35)'}
                      >
                        <div className="text-yellow-400 font-black text-base" style={{ fontFamily: 'Orbitron, monospace' }}>{amount}</div>
                        <div className="text-slate-400 text-xs">tokens</div>
                        <div style={{ marginTop: 4, background: 'rgba(220,38,38,0.2)', borderRadius: 6, padding: '2px 6px', display: 'inline-block', fontSize: 11, color: '#f87171' }}>€{(amount / 100).toFixed(0)}</div>
                      </button>
                    ))}
                  </div>

                  {/* Info box */}
                  <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: '10px 12px' }}>
                    <p className="text-xs text-slate-400 text-center">
                      <span style={{ color: '#a855f7', fontWeight: 600 }}>1 EUR = 100 tokens</span> · Auto-credited in 1–2 min
                    </p>
                  </div>

                  {/* Buy Items with Tokens */}
                  <div style={{ borderTop: '1px solid rgba(220,38,38,0.15)', paddingTop: 12 }}>
                    <p className="text-xs text-slate-500 text-center mb-2">Spend your tokens in the shop</p>
                    <button
                      onClick={openTelegramShop}
                      style={{ width: '100%', background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 10, padding: '10px 16px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                    >
                      🛍️ Buy Items with Tokens
                    </button>
                    <p className="text-xs text-slate-600 text-center mt-1">Balance: {user.token_balance || 0} tokens available</p>
                  </div>

                  {/* Promo Code */}
                  <PromoCodeBox API={API} user={user} onTokensAdded={(amt) => setUser(prev => prev ? {...prev, token_balance: (prev.token_balance||0)+amt} : prev)} />
                </div>
              ) : (
                <div className="space-y-4 max-w-2xl mx-auto">
                  {/* Balance Card */}
                  <div style={{ background: 'linear-gradient(135deg, #1a0320 0%, #0d0d1a 100%)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Wallet className="w-4 h-4" style={{ color: '#a855f7' }} />
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Balance</span>
                      </div>
                      <div className="text-4xl font-black text-yellow-400" style={{ fontFamily: 'Orbitron, monospace' }}>{(user.token_balance || 0).toLocaleString()}</div>
                      <div className="text-xs text-slate-500 mt-1">RiskArena Tokens</div>
                    </div>
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      style={{ marginLeft: 'auto', background: 'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)', border: 'none', borderRadius: 10, padding: '10px 20px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 0 16px rgba(220,38,38,0.4)', whiteSpace: 'nowrap' }}
                    >
                      <Zap className="w-4 h-4" /> + Add Tokens
                    </button>
                  </div>

                  {/* Package grid */}
                  <div style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 14, padding: '20px' }}>
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-3">Quick Buy</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {[500, 1000, 2000, 5000].map(amount => (
                        <button
                          key={amount}
                          onClick={() => { setShowPaymentModal(true); setPaymentEurAmount(amount / 100); }}
                          style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a20 100%)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 10, padding: '12px 8px', color: 'white', cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                          <div className="text-yellow-400 font-black text-lg" style={{ fontFamily: 'Orbitron, monospace' }}>{amount}</div>
                          <div className="text-slate-400 text-xs mb-1">tokens</div>
                          <div style={{ background: 'rgba(220,38,38,0.2)', borderRadius: 6, padding: '2px 8px', display: 'inline-block', fontSize: 12, color: '#f87171' }}>€{(amount / 100).toFixed(0)}</div>
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-3">
                      <Input
                        type="number"
                        placeholder="Custom amount (min 100)"
                        min="100"
                        style={{ background: '#0a0a12', border: '1px solid rgba(124,58,237,0.3)', color: 'white', borderRadius: 8, fontSize: 13 }}
                        onChange={(e) => setPaymentTokenAmount(parseInt(e.target.value) || 100)}
                      />
                      <button
                        onClick={() => setShowPaymentModal(true)}
                        style={{ background: 'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)', border: 'none', borderRadius: 8, padding: '8px 18px', color: 'white', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        <Zap className="w-3.5 h-3.5" /> Buy
                      </button>
                    </div>

                    <div style={{ marginTop: 16, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                      <p className="text-xs text-slate-400 mb-2 font-semibold" style={{ color: '#a855f7' }}>How it works</p>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• Pick a package or enter a custom amount</li>
                        <li>• Send SOL to the generated address (20 min timer)</li>
                        <li>• Tokens credited automatically in 1–2 min</li>
                        <li>• <span style={{ color: '#a855f7', fontWeight: 600 }}>1 EUR = 100 tokens</span> (live SOL/EUR rate)</li>
                      </ul>
                    </div>
                  </div>

                  {/* Buy Items with Tokens - Desktop */}
                  <div style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 14, padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <p className="text-sm font-bold text-white mb-1">🛍️ Shop — Buy Items with Tokens</p>
                      <p className="text-xs text-slate-400">Use your RiskArena tokens to purchase items in the shop</p>
                      <p className="text-xs mt-1" style={{ color: '#a855f7' }}>Available: <span className="font-bold text-yellow-400">{(user.token_balance || 0).toLocaleString()} tokens</span></p>
                    </div>
                    <button
                      onClick={openTelegramShop}
                      style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 10, padding: '10px 20px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}
                    >
                      🛍️ Open Shop
                    </button>
                  </div>

                  {/* Promo Code - Desktop */}
                  <div style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 14, padding: '20px' }}>
                    <PromoCodeBox API={API} user={user} onTokensAdded={(amt) => setUser(prev => prev ? {...prev, token_balance: (prev.token_balance||0)+amt} : prev)} />
                  </div>
                </div>
              )
            )}

            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <ProfileScreen
                API={API}
                user={user}
                onUserUpdate={(fields) => setUser((prev) => prev ? { ...prev, ...fields } : prev)}
              />
            )}

            {/* Admin Panel Tab */}
            {activeTab === 'admin' && (user?.is_admin || user?.is_owner) && (
              <AdminPanel API={API} rooms={rooms} isMobile={isMobile} onRoomsRefresh={loadRooms} socket={socket} />
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <div>
                    <CardTitle className="flex items-center gap-2 text-blue-400">
                      <Timer className="w-5 h-5" />
                      Game History
                    </CardTitle>
                    <CardDescription>Recent completed games</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {gameHistory.length === 0 ? (
                    <p className="text-center text-slate-400 py-8">No games completed yet. Start playing!</p>
                  ) : (
                    <div className="space-y-3">
                      {gameHistory.map((game, index) => {
                        // FIXED: Correct winner detection using user_id from RoomPlayer
                        const isUserWinner = user && game.winner && (
                          String(game.winner.user_id) === String(user.id) ||
                          String(game.winner_id) === String(user.id) ||
                          String(game.winner_user_id) === String(user.id)
                        );
                        
                        console.log('History winner check:', {
                          user_id: user?.id,
                          winner_user_id: game.winner?.user_id,
                          winner_id: game.winner_id,
                          winner_user_id_field: game.winner_user_id,
                          isUserWinner
                        });
                        
                        const userPlayer = game.players && Array.isArray(game.players)
                          ? game.players.find(p => String(p.user_id) === String(user?.id))
                          : null;
                        const userBet = userPlayer?.bet_amount || 0;
                        const prizePool = game.prize_pool || 0;

                        return (
                          <div key={index} className={`p-4 rounded-lg ${
                            isUserWinner
                              ? 'bg-gradient-to-r from-gold-900/30 to-yellow-900/30 border border-gold-500/30'
                              : 'bg-slate-700/50 border border-slate-600/30'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{ROOM_CONFIGS[normalizeRoomType(game.room_type)]?.icon}</span>
                                <div>
                                  <span className="font-medium text-white capitalize">{normalizeRoomType(game.room_type)} Room</span>
                                  {isUserWinner
                                    ? <span className="ml-2 text-green-400 font-bold text-sm">+{prizePool} tkn</span>
                                    : userBet > 0 && <span className="ml-2 text-red-400 font-bold text-sm">-{userBet} tkn</span>
                                  }
                                </div>
                              </div>
                              <Badge className={isUserWinner ? 'bg-gradient-to-r from-yellow-400 to-gold-500 text-slate-900 font-bold border border-gold-600' : 'bg-slate-600 text-white border border-slate-500'}>
                                {isUserWinner ? '🏆 Won' : 'Lost'}
                              </Badge>
                            </div>
                            <div className="text-sm text-slate-300 space-y-1">
                              {isUserWinner ? (
                                <div className="text-green-400 font-semibold">🎉 You won this game!</div>
                              ) : (
                                <>
                                  <div>Winner: <span className="text-yellow-400 font-medium">
                                    {game.winner?.first_name || 'Unknown'}
                                  </span></div>
                                  <div className="text-slate-500">You did not win this round</div>
                                </>
                              )}
                              <div>Date: {new Date(game.finished_at).toLocaleDateString()}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            </Suspense>
          </div>
        </main>
      </div>

      {isMobile && (
        <BottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          user={user}
          onOpenShop={openTelegramShop}
        />
      )}

      <Toaster richColors position={isMobile ? "top-center" : "top-right"} />

      {/* Admin Broadcast Banner */}
      {adminBanner && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999999,
          background: 'linear-gradient(90deg, #7c3aed, #dc2626)',
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'slideDown 0.3s ease-out',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📢</span>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>{adminBanner.message}</span>
          </div>
          <button onClick={() => setAdminBanner(null)} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 14, fontWeight: 700, padding: '2px 8px', cursor: 'pointer', flexShrink: 0
          }}>✕</button>
        </div>
      )}

      {/* Floating Reactions Overlay */}
      {floatingReactions.map(r => (
        <div key={r.id} style={{ position: 'fixed', bottom: 120, left: `${r.x}%`, transform: 'translateX(-50%)', zIndex: 99999, pointerEvents: 'none', animation: 'reactionFloat 2.5s ease-out forwards', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' }}>{r.emoji}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600, background: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: '1px 5px', whiteSpace: 'nowrap' }}>{r.name}</span>
        </div>
      ))}

      {/* Leave & Refund Confirmation Modal */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">💸</div>
              <h2 className="text-white text-xl font-bold mb-1">Leave the room?</h2>
              <p className="text-slate-400 text-sm">
                Your bet of <span className="text-yellow-400 font-semibold">{lobbyData?.bet_amount} tokens</span> will be refunded to your balance.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmLeave(false)}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-all active:scale-95"
              >
                No, stay
              </button>
              <button
                onClick={async () => {
                  setConfirmLeave(false);
                  if (!lobbyData?.room_id || !user?.id) return;
                  try {
                    const res = await axios.post(`${API}/leave-room`, {
                      room_id: lobbyData.room_id,
                      user_id: user.id,
                    });
                    setUser(prev => ({ ...prev, token_balance: res.data.new_balance }));
                    setInLobby(false);
                    setLobbyData(null);
                    setUserActiveRooms(prev => { const next = { ...prev }; delete next[lobbyData.room_type]; return next; });
                    setActiveGameRoomId(null);
                    currentGameRoomRef.current = null;
                    sessionStorage.removeItem('active_game_room');
                    toast.success(`💸 Left room — ${res.data.refund} tokens refunded`);
                    loadRooms();
                  } catch (err) {
                    toast.error(err.response?.data?.detail || 'Could not leave room');
                  }
                }}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold transition-all active:scale-95"
              >
                Yes, leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anonymous Choice Modal */}
      {anonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white text-xl font-bold text-center mb-1">How do you want to play?</h2>
            <p className="text-slate-400 text-sm text-center mb-6">Choose your identity for this game</p>
            <div className="space-y-3">
              <button
                onClick={() => { setAnonModal(null); joinRoom(anonModal.roomType, false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all active:scale-95"
              >
                {user?.photo_url ? (
                  <img src={user.photo_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-400 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {user?.first_name?.[0] || '?'}
                  </div>
                )}
                <div className="text-left">
                  <div className="text-white font-semibold">{user?.first_name} {user?.last_name || ''}</div>
                  {user?.telegram_username && <div className="text-blue-200 text-xs">@{user.telegram_username}</div>}
                </div>
              </button>
              <button
                onClick={() => { setAnonModal(null); joinRoom(anonModal.roomType, true); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-all active:scale-95 border border-slate-500"
              >
                <div className="w-8 h-8 rounded-full bg-slate-500 flex items-center justify-center text-2xl flex-shrink-0">🥷</div>
                <div className="text-left">
                  <div className="text-white font-semibold">Play Anonymously</div>
                  <div className="text-slate-400 text-xs">Others will see you as "Anonymous"</div>
                </div>
              </button>
            </div>
            <button
              onClick={() => setAnonModal(null)}
              className="w-full mt-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >Cancel</button>
          </div>
        </div>
      )}

      {/* Reveal Identity Modal */}
      {showRevealModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white text-xl font-bold text-center mb-1">Reveal your identity?</h2>
            <p className="text-slate-400 text-sm text-center mb-6">Other players will see your real Telegram profile</p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setShowRevealModal(false);
                  setLobbyIsAnonymous(false);
                  if (socket && lobbyData?.room_id && user?.id) {
                    socket.emit('reveal_identity', {
                      room_id: lobbyData.room_id,
                      user_id: user.id,
                      token: getStoredSessionToken(),
                      first_name: user.first_name,
                      last_name: user.last_name,
                      photo_url: user.photo_url,
                      username: user.telegram_username,
                    });
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-all active:scale-95"
              >
                {user?.photo_url ? (
                  <img src={user.photo_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-violet-400 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {user?.first_name?.[0] || '?'}
                  </div>
                )}
                <div className="text-left">
                  <div className="text-white font-semibold">Reveal as {user?.first_name} {user?.last_name || ''}</div>
                  {user?.telegram_username && <div className="text-violet-200 text-xs">@{user.telegram_username}</div>}
                </div>
              </button>
            </div>
            <button
              onClick={() => setShowRevealModal(false)}
              className="w-full mt-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >Cancel</button>
          </div>
        </div>
      )}

      {/* Level Up Modal */}
      {levelUpData && (
        <LevelUpModal
          newLevel={levelUpData.new_level}
          onContinue={() => {
            setLevelUpData(null);
            try { localStorage.removeItem('user_progress'); } catch {}
          }}
        />
      )}

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setPaymentEurAmount(null);
        }}
        userId={user?.id}
        tokenAmount={paymentTokenAmount}
        initialEurAmount={paymentEurAmount}
      />

    </div>
  );
}



// Normalize room_type from any format: 'RoomType.BRONZE' | 'BRONZE' | 'bronze' → 'bronze'
export default App;
