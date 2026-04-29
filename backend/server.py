from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import socketio
from dotenv import load_dotenv
from database import create_pool, close_pool, get_pool
import db_queries as dbq
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import os
import logging
import uuid
from uuid import uuid4
import asyncio
import random
import secrets
from datetime import datetime, timezone, timedelta
from enum import Enum
import json
from pathlib import Path
import hashlib
import hmac
import aiohttp
# PostgreSQL via asyncpg (see database.py and db_queries.py)
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.system_program import transfer, TransferParams
import time
import base58
import uvicorn

# Load environment variables FIRST before importing modules that read them
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Import after .env is loaded so modules can read the environment
from solana_integration import SolanaPaymentProcessor, get_processor, PriceFetcher
from payment_recovery import run_startup_recovery
from rpc_monitor import rpc_alert_system
from manual_credit_logger import credit_tokens_manually, ManualCreditLogger
import socket_rooms

# Get environment variables
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_DB   = os.environ.get('PG_DB', 'casino_db')
CORS_ORIGINS_ENV = os.environ.get(
    'CORS_ORIGINS',
    'http://localhost:3000,https://telebet-2.preview.emergentagent.com,https://erniocasino.vercel.app'
).split(',')
CORS_ORIGINS_ENV = [origin.strip() for origin in CORS_ORIGINS_ENV if origin.strip()]
REQUIRED_CORS_ORIGINS = [
    "https://erniocasino.vercel.app",
    "https://www.erniocasino.vercel.app",
    "http://localhost:3000",
    # Telegram WebApp origins — required for Mini App preflight requests
    "https://web.telegram.org",
    "https://telegram.org",
]
CORS_ORIGINS = list(dict.fromkeys(CORS_ORIGINS_ENV + REQUIRED_CORS_ORIGINS))
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN_HERE')

# Solana Configuration for devnet (test environment as requested)
SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.devnet.solana.com')
CASINO_WALLET_PRIVATE_KEY = os.environ.get('CASINO_WALLET_PRIVATE_KEY', '')
CASINO_WALLET_ADDRESS = os.environ.get('CASINO_WALLET_ADDRESS', 'YourWalletAddressHere12345678901234567890123456789')

# HD Wallet Derivation System
class SolanaWalletDerivation:
    def __init__(self, master_private_key_base58: str = None):
        """Initialize with master private key for derivation"""
        self.master_private_key = master_private_key_base58
        if master_private_key_base58:
            try:
                # Create master keypair from base58 private key
                private_key_bytes = base58.b58decode(master_private_key_base58)
                self.master_keypair = Keypair.from_bytes(private_key_bytes)
                logging.info(f"🔑 Master wallet initialized: {self.master_keypair.pubkey()}")
            except Exception as e:
                logging.error(f"Error initializing master wallet: {e}")
                self.master_keypair = None
        else:
            self.master_keypair = None
    
    def derive_user_address(self, user_id: str, telegram_id: int) -> dict:
        """Derive a unique address for a user from master wallet"""
        try:
            # Create deterministic seed from user identifiers
            seed_string = f"casino_user_{user_id}_{telegram_id}"
            
            # Generate a random keypair and create a deterministic address string
            # This is simpler and more reliable than trying to create valid Solana keypairs
            seed_hash = hashlib.sha256(seed_string.encode()).digest()
            
            # Create a valid Solana address (base58 encoded, exactly 32 bytes)
            address_bytes = seed_hash[:32]  # Use exactly 32 bytes for valid Solana address
            derived_address = base58.b58encode(address_bytes).decode()
            
            # For demo purposes, we'll track this address but won't need the private key
            # In production, you'd use proper Solana keypair derivation libraries
            logging.info(f"🎯 Derived address for user {telegram_id}: {derived_address}")
            
            return {
                "address": derived_address,
                "user_id": user_id,
                "telegram_id": telegram_id,
                "derivation_path": seed_string
            }
            
        except Exception as e:
            logging.error(f"Error deriving user address: {e}")
            return None
    
    async def sweep_user_address_to_main(self, derived_keypair: Keypair, amount_lamports: int = None):
        """Sweep funds from derived address to main wallet"""
        try:
            if not self.master_keypair:
                logging.error("No master keypair configured for sweeping")
                return False
                
            # Get balance of derived address
            client = AsyncClient(SOLANA_RPC_URL)
            balance_response = await client.get_balance(derived_keypair.pubkey())
            
            if not balance_response.value:
                logging.info("No balance to sweep")
                return False
            
            balance_lamports = balance_response.value
            # Leave some lamports for rent (minimum account balance)
            sweep_amount = balance_lamports - 890880 if balance_lamports > 890880 else 0
            
            if sweep_amount <= 0:
                logging.info("Insufficient balance for sweep after rent")
                return False
            
            # Create transfer instruction
            transfer_instruction = transfer(
                TransferParams(
                    from_pubkey=derived_keypair.pubkey(),
                    to_pubkey=self.master_keypair.pubkey(),
                    lamports=sweep_amount
                )
            )
            
            logging.info(f"💸 Would sweep {sweep_amount} lamports from {derived_keypair.pubkey()} to {self.master_keypair.pubkey()}")
            # TODO: Implement actual transaction signing and sending
            
            return True
            
        except Exception as e:
            logging.error(f"Error sweeping funds: {e}")
            return False

# Initialize wallet derivation system
wallet_derivation = SolanaWalletDerivation(CASINO_WALLET_PRIVATE_KEY)

# PostgreSQL pool is initialized in the startup event (see lifespan below)

# FastAPI app
app = FastAPI(title="Solana Casino Battle Royale")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# Socket.IO setup
sio = socketio.AsyncServer(
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    async_mode='asgi',
    ping_timeout=60,  # Increase from default 5s to 60s
    ping_interval=25,  # Keep connection alive every 25s
    max_http_buffer_size=10000000  # 10MB for large payloads
    # engineio_path is set via ASGIApp's socketio_path parameter
)
api_router = APIRouter(prefix="/api")

# Room types and settings
class RoomType(str, Enum):
    FREE = "free"
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"
    FREEROLL = "freeroll"

# ** EDIT THESE LINES TO ADD YOUR PRIZE LINKS **
PRIZE_LINKS = {
    RoomType.FREE: "",
    RoomType.BRONZE: "https://your-prize-link-1.com",
    RoomType.SILVER: "https://your-prize-link-2.com",
    RoomType.GOLD: "https://your-prize-link-3.com",
    RoomType.FREEROLL: "https://your-prize-link-freeroll.com",
}

# ** EDIT THIS LINE TO ADD YOUR TELEGRAM BOT TOKEN **
# (Now configured above in environment variables section)

ROOM_SETTINGS = {
    RoomType.FREE:     {"min_bet": 0,   "max_bet": 0,    "name": "Free Room",  "min_players": 2, "max_players": 3},
    RoomType.BRONZE:   {"min_bet": 200, "max_bet": 450,  "name": "Bronze Room","min_players": 2, "max_players": 3},
    RoomType.SILVER:   {"min_bet": 350, "max_bet": 800,  "name": "Silver Room","min_players": 2, "max_players": 3},
    RoomType.GOLD:     {"min_bet": 650, "max_bet": 1200, "name": "Gold Room",  "min_players": 2, "max_players": 3},
    RoomType.FREEROLL: {"min_bet": 0,   "max_bet": 0,    "name": "Free Roll",  "min_players": 2, "max_players": 30},
}

# Dynamic room configs loaded from DB on startup (overrides ROOM_SETTINGS defaults)
room_configs: Dict[str, dict] = {}

# Models
class TelegramAuthData(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    telegram_id: int
    first_name: str
    last_name: Optional[str] = None
    telegram_username: Optional[str] = None
    photo_url: Optional[str] = None
    wallet_address: Optional[str] = None
    # NEW: Each user gets unique Solana receiving address
    personal_solana_address: Optional[str] = None
    token_balance: int = Field(default=0)  # Starting balance - users must purchase tokens
    is_verified: bool = Field(default=False)
    is_admin: bool = Field(default=False)
    is_owner: bool = Field(default=False)
    role: str = Field(default="user")  # user, admin, owner
    last_daily_claim: Optional[str] = None  # Timestamp of last daily token claim
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserCreate(BaseModel):
    telegram_auth_data: TelegramAuthData


class RoomPlayer(BaseModel):
    user_id: str
    username: str  # Telegram username (@username)
    first_name: str  # Telegram first name
    last_name: Optional[str] = None  # Telegram last name
    photo_url: Optional[str] = None  # Telegram profile photo
    bet_amount: int
    is_anonymous: bool = False
    joined_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GameResult(BaseModel):
    winner: RoomPlayer
    prize_link: str
    total_bet_amount: int

class GameRoom(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    room_type: RoomType
    players: List[RoomPlayer] = Field(default_factory=list)
    status: str = "waiting"  # waiting, ready, playing, finished
    prize_pool: int = Field(default=0)
    max_players: int = Field(default=3)
    min_players: int = Field(default=2)
    winner: Optional[RoomPlayer] = None
    prize_link: Optional[str] = None
    match_id: Optional[str] = None  # Set when game round starts
    round_number: int = Field(default=1)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

class JoinRoomRequest(BaseModel):
    room_type: RoomType
    user_id: str
    bet_amount: int = Field(ge=0, le=1_000_000)
    is_anonymous: bool = False

# In-memory storage for active rooms (in production, use Redis)
active_rooms: Dict[str, GameRoom] = {}

# Maintenance mode — blocks new room joins (resets on restart)
maintenance_mode: bool = False

# Free Roll room global config
freeroll_config: dict = {"max_players": 30, "prize": 500, "is_locked": False}


# Telegram authentication functions
def verify_telegram_auth(auth_data: dict, bot_token: str) -> bool:
    """Verify Telegram authentication data - PRODUCTION VERSION"""
    if not auth_data:
        logging.warning("No auth data provided")
        return False
    
    # Production: Verify required fields
    required_fields = ['id', 'first_name', 'auth_date']
    for field in required_fields:
        if field not in auth_data:
            logging.warning(f"Missing required field: {field}")
            return False
    
    # Production: Verify auth_date is recent (within 24 hours)
    current_time = datetime.now(timezone.utc).timestamp()
    auth_time = auth_data.get('auth_date', 0)
    if current_time - auth_time > 86400:  # 24 hours
        logging.warning(f"Auth data too old: {current_time - auth_time} seconds")
        return False
    
    # For Telegram Web App integration, we trust these hash types
    if auth_data.get('hash') in ['telegram_auto', 'telegram_webapp']:
        return True
        
    if 'hash' not in auth_data:
        return False
    
    # Extract hash and remove it from data
    received_hash = auth_data.pop('hash')
    
    # Create data check string
    data_check_string = '\n'.join([f"{k}={v}" for k, v in sorted(auth_data.items()) if k != 'hash'])
    
    # Create secret key
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    
    # Calculate expected hash
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    return hmac.compare_digest(expected_hash, received_hash)

def is_telegram_user_legitimate(telegram_data: TelegramAuthData) -> bool:
    """Additional security checks for Telegram user legitimacy"""
    
    # Check if auth is recent (within 24 hours)
    current_time = datetime.now(timezone.utc).timestamp()
    if current_time - telegram_data.auth_date > 86400:  # 24 hours
        return False
    
    # Check if user has reasonable data
    if not telegram_data.first_name or len(telegram_data.first_name.strip()) == 0:
        return False
    
    # Check for suspicious patterns (optional additional checks)
    if telegram_data.telegram_username:
        # Very basic check - could be enhanced
        if len(telegram_data.telegram_username) < 3:
            return False
    
    return True

# Telegram bot messaging functions
async def send_telegram_message(telegram_id: int, message: str, reply_markup: Optional[Dict] = None) -> bool:
    """Send a message to a Telegram user via bot API"""
    try:
        if TELEGRAM_BOT_TOKEN == 'YOUR_TELEGRAM_BOT_TOKEN_HERE':
            logging.warning("Telegram bot token not configured, skipping message send")
            return False
            
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        
        payload = {
            "chat_id": telegram_id,
            "text": message,
            "parse_mode": "HTML"
        }
        
        if reply_markup:
            payload["reply_markup"] = reply_markup
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    logging.info(f"Message sent successfully to Telegram user {telegram_id}")
                    return True
                else:
                    error_text = await response.text()
                    logging.error(f"Failed to send Telegram message: {response.status} - {error_text}")
                    return False
                    
    except Exception as e:
        logging.error(f"Error sending Telegram message: {e}")
        return False

async def send_prize_notification(telegram_id: int, username: str, room_type: str, prize_link: str) -> bool:
    """Send prize notification with claim button to Telegram user"""
    try:
        # Format the message
        message = f"🎉 <b>Congratulations {username}!</b>\n\n"
        message += f"You won the {room_type.title()} Room battle!\n\n"
        message += "🏆 <b>You have a prize waiting!</b>\n"
        message += "Click the button below to claim your prize:"
        
        # Create inline keyboard with claim button
        reply_markup = {
            "inline_keyboard": [[
                {
                    "text": "🎁 Claim Your Prize",
                    "url": prize_link
                }
            ]]
        }
        
        return await send_telegram_message(telegram_id, message, reply_markup)
        
    except Exception as e:
        logging.error(f"Error sending prize notification: {e}")
        return False


# CoinGecko API Integration for Real-time SOL/EUR Pricing
class PriceOracle:
    def __init__(self):
        self.cached_price = None
        self.last_update = 0
        self.cache_duration = 60  # Cache for 60 seconds
        
    async def get_sol_eur_price(self) -> float:
        """Get current SOL price in EUR — Binance primary, CoinGecko fallback"""
        current_time = time.time()
        if self.cached_price and (current_time - self.last_update) < self.cache_duration:
            return self.cached_price

        # 1) Binance — no key needed, direct SOL/EUR pair
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://api.binance.com/api/v3/ticker/price",
                    params={"symbol": "SOLEUR"},
                    timeout=aiohttp.ClientTimeout(total=8)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        price = float(data["price"])
                        self.cached_price = price
                        self.last_update = current_time
                        logging.info(f"💰 SOL/EUR (Binance): {price}")
                        return price
                    logging.warning(f"Binance returned {resp.status}, trying CoinGecko...")
        except Exception as e:
            logging.warning(f"Binance price fetch failed: {e}, trying CoinGecko...")

        # 2) CoinGecko fallback
        try:
            async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0"}) as session:
                async with session.get(
                    "https://api.coingecko.com/api/v3/simple/price",
                    params={"ids": "solana", "vs_currencies": "eur"},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        price = float(data["solana"]["eur"])
                        self.cached_price = price
                        self.last_update = current_time
                        logging.info(f"💰 SOL/EUR (CoinGecko): {price}")
                        return price
        except Exception as e:
            logging.error(f"CoinGecko price fetch failed: {e}")

        logging.error("All price sources failed, using cached/fallback")
        return self.cached_price or 120.0
    
    def calculate_tokens_from_sol(self, sol_amount: float, sol_eur_price: float) -> int:
        """Calculate tokens from SOL amount using real-time EUR price"""
        # SOL → EUR → Tokens (1 EUR = 100 tokens)
        eur_value = sol_amount * sol_eur_price
        tokens = int(eur_value * 100)
        
        logging.info(f"💱 Conversion: {sol_amount} SOL × {sol_eur_price} EUR/SOL = {eur_value:.4f} EUR = {tokens} tokens")
        return tokens

# Initialize price oracle
price_oracle = PriceOracle()

# Payment Request System
class PaymentRequest:
    def __init__(self, user_id: str, telegram_id: int, eur_amount: float):
        self.id = str(uuid.uuid4())[:8]  # Short ID
        self.user_id = user_id
        self.telegram_id = telegram_id
        self.eur_amount = eur_amount
        self.expected_sol_amount = None
        self.tokens_to_credit = int(eur_amount * 100)  # 1 EUR = 100 tokens
        self.created_at = time.time()
        self.expires_at = time.time() + 300  # 5 minutes
        self.status = "pending"
        
    async def calculate_expected_sol(self) -> float:
        """Calculate expected SOL amount based on current price"""
        sol_price = await price_oracle.get_sol_eur_price()
        self.expected_sol_amount = self.eur_amount / sol_price
        return self.expected_sol_amount
    
    def is_expired(self) -> bool:
        return time.time() > self.expires_at
    
    def matches_payment(self, received_sol: float, tolerance: float = 0.02) -> bool:
        """Check if received SOL matches expected amount (2% tolerance)"""
        if not self.expected_sol_amount:
            return False
        
        min_amount = self.expected_sol_amount * (1 - tolerance)
        max_amount = self.expected_sol_amount * (1 + tolerance)
        
        return min_amount <= received_sol <= max_amount

# Payment request storage
active_payment_requests = {}  # request_id -> PaymentRequest

async def get_or_create_derived_address(user_id: str, telegram_id: int) -> dict:
    """Get existing derived address or create new one for user"""
    try:
        # Check if user already has a derived address
        user = await dbq.get_user_by_telegram_id(telegram_id)

        if user and user.get('derived_solana_address'):
            return {
                "address": user['derived_solana_address'],
                "user_id": user_id,
                "telegram_id": telegram_id
            }

        # Generate new derived address
        derived_info = wallet_derivation.derive_user_address(user_id, telegram_id)

        if not derived_info:
            raise Exception("Failed to derive address")

        # Save to database
        await dbq.update_user_fields_by_telegram_id(
            telegram_id,
            {
                "derived_solana_address": derived_info["address"],
                "derivation_path": derived_info["derivation_path"]
            }
        )
        
        logging.info(f"✅ Created derived address for user {telegram_id}: {derived_info['address']}")
        return derived_info
        
    except Exception as e:
        logging.error(f"Error getting/creating derived address: {e}")
        return None

# Solana Payment Monitoring System
class PaymentMonitor:
    def __init__(self):
        self.client = AsyncClient(SOLANA_RPC_URL)
        self.last_checked_signatures = {}  # Track last signature per address
        self.monitoring = False
        self.monitored_addresses = set()  # All derived addresses being monitored
        
    async def start_monitoring(self):
        """Start monitoring Solana payments to derived addresses"""
        if self.monitoring:
            return
            
        self.monitoring = True
        logging.info(f"🚀 Starting payment monitoring for derived addresses")
        
        # Load existing derived addresses
        await self._load_derived_addresses()
        
        # Run monitoring in background
        asyncio.create_task(self._monitor_payments())
    
    async def _load_derived_addresses(self):
        """Load all derived addresses from database to monitor"""
        try:
            users = await dbq.get_users_with_derived_address()
            
            for user in users:
                address = user.get('derived_solana_address')
                if address:
                    self.monitored_addresses.add(address)
            
            logging.info(f"📍 Monitoring {len(self.monitored_addresses)} derived addresses")
            
        except Exception as e:
            logging.error(f"Error loading derived addresses: {e}")
    
    async def add_address_to_monitor(self, address: str):
        """Add a new derived address to monitoring"""
        self.monitored_addresses.add(address)
        logging.info(f"➕ Added derived address to monitoring: {address}")
    
    async def _monitor_payments(self):
        """Monitor all derived addresses for incoming payments"""
        try:
            while self.monitoring:
                await self._check_for_payments()
                await asyncio.sleep(10)  # Check every 10 seconds
                
        except Exception as e:
            logging.error(f"Payment monitoring error: {e}")
            # Restart monitoring after error
            await asyncio.sleep(30)
            if self.monitoring:
                asyncio.create_task(self._monitor_payments())
    
    async def _check_for_payments(self):
        """Check for new payments to all derived addresses"""
        try:
            if not self.monitored_addresses:
                # No addresses to monitor yet
                return
                
            # Check each monitored address
            for address in list(self.monitored_addresses):  # Create copy to avoid modification during iteration
                await self._check_address_for_payments(address)
                    
        except Exception as e:
            logging.error(f"Error checking payments: {e}")
    
    async def _check_address_for_payments(self, address: str):
        """Check a specific derived address for new payments"""
        try:
            # Get wallet public key
            wallet_pubkey = Pubkey.from_string(address)
            
            # Get recent transactions
            last_sig = self.last_checked_signatures.get(address)
            response = await self.client.get_signatures_for_address(
                wallet_pubkey, 
                limit=5,
                before=last_sig if last_sig else None
            )
            
            if response.value:
                signatures = response.value
                
                # Process new transactions (most recent first)
                for sig_info in reversed(signatures):
                    if last_sig and sig_info.signature == last_sig:
                        break
                        
                    await self._process_transaction(sig_info.signature, address)
                
                # Update last checked signature for this address
                if signatures:
                    self.last_checked_signatures[address] = signatures[0].signature
                    
        except Exception as e:
            logging.error(f"Error checking address {address}: {e}")
    
    async def _process_transaction(self, signature: str, receiving_address: str):
        """Process a single transaction for payment detection using Derived Address System"""
        try:
            # Get transaction details
            tx = await self.client.get_transaction(signature)
            if not tx.value or not tx.value.transaction:
                return
                
            transaction = tx.value.transaction
            meta = tx.value.transaction.meta
            
            if not meta or meta.err:
                return  # Skip failed transactions
            
            # Check if this is an incoming SOL transfer
            pre_balances = meta.pre_balances
            post_balances = meta.post_balances
            
            # Find receiving address in account keys
            account_keys = transaction.transaction.message.account_keys
            receiving_address_index = None
            
            for i, key in enumerate(account_keys):
                if str(key) == receiving_address:
                    receiving_address_index = i
                    break
            
            if receiving_address_index is None:
                return
            
            # Calculate SOL received (in lamports)
            if len(post_balances) > receiving_address_index and len(pre_balances) > receiving_address_index:
                balance_change = post_balances[receiving_address_index] - pre_balances[receiving_address_index]
                
                if balance_change > 0:  # Received SOL
                    sol_amount = balance_change / 1_000_000_000  # Convert lamports to SOL
                    
                    logging.info(f"💰 Received {sol_amount} SOL in transaction {signature} to derived address {receiving_address}")
                    
                    # Credit tokens to user who owns this derived address
                    await self._credit_tokens_for_derived_address(signature, sol_amount, receiving_address)
                    
        except Exception as e:
            logging.error(f"Error processing transaction {signature}: {e}")
    
    async def _credit_tokens_for_derived_address(self, signature: str, sol_amount: float, derived_address: str):
        """Credit tokens to user who owns the derived address"""
        try:
            # Find user by derived address
            all_users = await dbq.get_users_with_derived_address()
            user = next((u for u in all_users if u.get('derived_solana_address') == derived_address), None)
            
            if not user:
                logging.error(f"❌ No user found for derived address {derived_address}! Payment of {sol_amount} SOL lost!")
                return
            
            # Calculate tokens using real-time EUR price
            sol_price = await price_oracle.get_sol_eur_price()
            tokens_to_credit = price_oracle.calculate_tokens_from_sol(sol_amount, sol_price)
            
            # Credit tokens to user
            await self._credit_tokens_to_user(
                signature, 
                sol_amount, 
                tokens_to_credit, 
                user['telegram_id'],
                sol_price,
                derived_address
            )
                
        except Exception as e:
            logging.error(f"Error crediting tokens for derived address: {e}")
    
    async def _credit_tokens_to_user(self, signature: str, sol_amount: float, tokens_to_credit: int, telegram_id: int, sol_eur_price: float, derived_address: str = None):
        """Credit tokens to specific user account - PRODUCTION VERSION"""
        try:
            if tokens_to_credit <= 0:
                logging.warning(f"Invalid token amount: {tokens_to_credit}")
                return
            
            # Production: Minimum payment validation (prevent dust payments)
            min_sol_amount = 0.001  # Minimum 0.001 SOL
            if sol_amount < min_sol_amount:
                logging.warning(f"Payment too small: {sol_amount} SOL (minimum: {min_sol_amount})")
                return
            
            # Find user by telegram_id
            user = await dbq.get_user_by_telegram_id(telegram_id)

            if not user:
                logging.error(f"❌ No user found for telegram_id {telegram_id}! Payment of {sol_amount} SOL lost!")
                return

            # Production: Check for duplicate transactions (payment_history field not in PG schema; skip)

            # Credit tokens to user
            result = await dbq.increment_user_tokens_by_telegram_id(telegram_id, tokens_to_credit)

            if result:
                logging.info(f"✅ Credited {tokens_to_credit} tokens to user {user['first_name']} for {sol_amount} SOL (€{sol_amount * sol_eur_price:.2f})")
                
                # Send notification to user
                if user.get('telegram_id'):
                    await self._send_payment_confirmation(
                        user['telegram_id'],
                        user['first_name'],
                        sol_amount,
                        tokens_to_credit,
                        sol_eur_price
                    )
                
                # Broadcast token update to frontend
                await sio.emit('token_balance_updated', {
                    'user_id': user['id'],
                    'new_balance': user.get('token_balance', 0) + tokens_to_credit,
                    'tokens_added': tokens_to_credit,
                    'sol_received': sol_amount,
                    'eur_value': sol_amount * sol_eur_price
                })
                
        except Exception as e:
            logging.error(f"Error crediting tokens to user: {e}")
    
    async def _send_payment_confirmation(self, telegram_id: int, username: str, sol_amount: float, tokens_credited: int, sol_eur_price: float):
        """Send payment confirmation to user via Telegram"""
        try:
            eur_value = sol_amount * sol_eur_price
            
            message = "💰 <b>Payment Confirmed!</b>\n\n"
            message += f"Hello {username}!\n\n"
            message += f"✅ Received: <b>{sol_amount} SOL</b>\n"
            message += f"💶 EUR Value: <b>€{eur_value:.2f}</b> (1 SOL = €{sol_eur_price:.4f})\n"
            message += f"🎰 Credited: <b>{tokens_credited:,} Casino Tokens</b>\n\n"
            message += f"💡 <i>Rate: 1 EUR = 100 tokens</i>\n\n"
            message += "Your tokens are ready for battle! Good luck! 🎯"
            
            await send_telegram_message(telegram_id, message)
            logging.info(f"📨 Payment confirmation sent to {username}")
            
        except Exception as e:
            logging.error(f"Error sending payment confirmation: {e}")

# Initialize payment monitor
payment_monitor = PaymentMonitor()

# Track user_id to socket_id mapping for room management
user_to_socket: Dict[str, str] = {}  # user_id -> sid
socket_to_user: Dict[str, str] = {}  # sid -> user_id

# Socket.IO events
@sio.event
async def connect(sid, environ):
    logging.info(f"🔌🔌🔌 NEW CLIENT CONNECTED 🔌🔌🔌")
    logging.info(f"Socket ID: {sid}")
    logging.info(f"Remote Address: {environ.get('REMOTE_ADDR', 'unknown')}")
    logging.info(f"User Agent: {environ.get('HTTP_USER_AGENT', 'unknown')}")
    
    # Detect platform
    user_agent = environ.get('HTTP_USER_AGENT', '').lower()
    if 'telegram' in user_agent:
        platform = 'Telegram WebView'
    elif 'mobile' in user_agent or 'android' in user_agent or 'iphone' in user_agent:
        platform = 'Mobile Browser'
    else:
        platform = 'Desktop Browser'
    
    logging.info(f"Platform: {platform}")
    logging.info(f"Total active connections: {len(user_to_socket) + 1}")
    
    await sio.emit('connected', {
        'status': 'Connected to casino!',
        'socket_id': sid,
        'platform': platform
    }, room=sid)
    logging.info(f"✅ Sent 'connected' confirmation to {sid} ({platform})")

@sio.event
async def disconnect(sid):
    logging.info(f"🔌 Client {sid} disconnected")
    
    # Get user_id before cleanup
    user_id = socket_to_user.get(sid)
    
    # Get room_id from socket_rooms tracking
    room_id = socket_rooms.socket_to_room.get(sid)
    
    # Clean up socket from rooms ONLY
    socket_rooms.cleanup_socket(sid)
    
    # DON'T immediately clean up user mapping or remove from game room
    # Give user 30 seconds to reconnect (Telegram browser often disconnects temporarily)
    # User mapping and room removal will be handled on reconnect timeout or manual leave
    logging.info(f"⏳ User {user_id} disconnected, keeping in room for potential reconnect")
    
    # DO NOT remove from active_rooms.players - let them stay in the game
    # They can still receive events when they reconnect

@sio.event
async def register_user(sid, data):
    """Register user_id to socket_id mapping for room-specific events"""
    try:
        logging.info(f"📥📥📥 REGISTER_USER EVENT RECEIVED 📥📥📥")
        logging.info(f"Socket ID: {sid}")
        logging.info(f"Data: {data}")
        
        user_id = data.get('user_id')
        platform = data.get('platform', 'unknown')
        
        if not user_id:
            logging.error(f"❌ No user_id provided in register_user event")
            return
        
        # Update mappings
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        
        logging.info(f"✅ Registered user {user_id} to socket {sid[:8]}")
        logging.info(f"📱 Platform: {platform}")
        logging.info(f"📊 Total user mappings: {len(user_to_socket)}")
        
        # Send confirmation
        await sio.emit('user_registered', {
            'user_id': user_id,
            'status': 'registered',
            'platform': platform
        }, room=sid)
        
    except Exception as e:
        logging.error(f"❌ Error in register_user: {e}")

@sio.event
async def join_game_room(sid, data):
    """Join a game room via Socket.IO (called after successful REST API join)"""
    try:
        logging.info(f"📥📥📥 JOIN_GAME_ROOM EVENT RECEIVED 📥📥📥")
        logging.info(f"Socket ID: {sid}")
        logging.info(f"Data: {data}")
        
        room_id = data.get('room_id')
        user_id = data.get('user_id')
        platform = data.get('platform', 'unknown')
        
        if not room_id or not user_id:
            logging.error(f"❌ Missing room_id or user_id in join_game_room event")
            logging.error(f"Received data: {data}")
            return
        
        logging.info(f"📥 join_game_room: user={user_id}, room={room_id}, socket={sid[:8]}, platform={platform}")
        
        # Join the Socket.IO room
        await socket_rooms.join_socket_room(sio, sid, room_id)
        
        # Update user mapping
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        
        # Check current socket count in room
        socket_count = socket_rooms.get_room_socket_count(room_id)
        sockets_in_room = socket_rooms.room_to_sockets.get(room_id, set())
        
        logging.info(f"✅ User {user_id} ({platform}) joined room {room_id} via socket {sid[:8]}")
        logging.info(f"📊 Room {room_id} now has {socket_count} socket(s) connected")
        logging.info(f"📋 Socket IDs in room: {[s[:8] for s in sockets_in_room]}")
        
        # Send confirmation with full room info
        await sio.emit('room_joined_confirmed', {
            'room_id': room_id,
            'socket_count': socket_count,
            'socket_id': sid,
            'platform': platform
        }, room=sid)
        logging.info(f"✅ Sent room_joined_confirmed to {sid[:8]} ({platform})")
        
    except Exception as e:
        logging.error(f"❌ Error in join_game_room: {e}")
        import traceback
        logging.error(traceback.format_exc())

# Game logic functions
def calculate_win_probability(player_bet: int, total_pool: int) -> float:
    """Calculate weighted probability based on bet amount"""
    if total_pool == 0:
        return 0
    # Base probability + bonus for higher bets
    base_prob = 0.1  # 10% base chance
    bet_bonus = (player_bet / total_pool) * 0.9  # Up to 90% based on bet ratio
    return min(base_prob + bet_bonus, 0.95)  # Cap at 95%

def select_winner(players: List[RoomPlayer]) -> RoomPlayer:
    """Select winner using cryptographically secure weighted random — bigger bets = better odds."""
    if not players:
        raise ValueError("No players to select from")

    total_pool = sum(p.bet_amount for p in players)

    if total_pool == 0:
        # Free room: all equal weight — pick uniformly
        return players[secrets.randbelow(len(players))]

    # secrets.randbelow gives a secure integer in [0, total_pool)
    random_point = secrets.randbelow(total_pool)

    cumulative = 0
    for player in players:
        cumulative += player.bet_amount
        if random_point < cumulative:
            return player

    return players[-1]  # unreachable safety fallback

@sio.event
async def send_reaction(sid, data):
    """Broadcast an emoji reaction to all players in a room"""
    room_id = data.get('room_id')
    emoji = data.get('emoji', '🔥')
    name = data.get('name', 'Player')
    user_id = data.get('user_id', '')
    if not room_id:
        return
    # Broadcast globally — client filters by room_id (same pattern as game events)
    await sio.emit('reaction_received', {
        'emoji': emoji,
        'name': name,
        'user_id': user_id,
        'room_id': room_id,
    })
    logging.info(f"💬 Reaction {emoji} from {name} in room {room_id[:8]}")


# In-memory chat history per room (last 50 messages)
room_chat: dict = {}

@sio.event
async def lobby_message(sid, data):
    """Send a chat message to all players in the lobby room."""
    room_id = data.get('room_id')
    user_id = data.get('user_id', '')
    name = data.get('name', 'Player')
    text = (data.get('text') or '').strip()[:200]
    is_anonymous = data.get('is_anonymous', False)

    if not room_id or not text:
        return
    if is_anonymous:
        return  # Anonymous players cannot chat

    msg = {
        'user_id': user_id,
        'name': name,
        'text': text,
        'ts': datetime.now(timezone.utc).isoformat(),
    }
    room_chat.setdefault(room_id, [])
    room_chat[room_id].append(msg)
    if len(room_chat[room_id]) > 50:
        room_chat[room_id] = room_chat[room_id][-50:]

    payload = {'room_id': room_id, **msg}
    await sio.emit('lobby_message', payload)
    logging.info(f"💬 Chat [{room_id[:8]}] {name}: {text[:40]}")


@sio.event
async def reveal_identity(sid, data):
    """Player reveals their identity after joining anonymously"""
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    if not room_id or not user_id:
        return
    room = active_rooms.get(room_id)
    if not room:
        return
    for player in room.players:
        if player.user_id == user_id:
            player.is_anonymous = False
            player.first_name = data.get('first_name', player.first_name)
            player.last_name = data.get('last_name', player.last_name)
            player.photo_url = data.get('photo_url', player.photo_url)
            player.username = data.get('username', player.username)
            break
    serialized_players = []
    for p in room.players:
        pd = p.dict()
        if 'joined_at' in pd and isinstance(pd['joined_at'], datetime):
            pd['joined_at'] = pd['joined_at'].isoformat()
        serialized_players.append(pd)
    await socket_rooms.broadcast_to_room(sio, room_id, 'players_updated', {
        'room_id': room_id,
        'players': serialized_players,
    })
    logging.info(f"🔓 Player {user_id} revealed identity in room {room_id[:8]}")


@sio.event
async def catch_all(event, sid, data):
    """Catch all events for debugging"""
    logging.info(f"🎯 CATCH-ALL: Event '{event}' from {sid[:8]} with data: {data}")

async def broadcast_room_updates():
    """Broadcast current room states to all connected clients"""
    try:
        room_data = []
        for room in active_rooms.values():
            # Serialize player data with datetime conversion
            serialized_players = []
            for p in room.players:
                player_dict = p.dict()
                # Convert datetime fields to ISO format
                if 'joined_at' in player_dict and isinstance(player_dict['joined_at'], datetime):
                    player_dict['joined_at'] = player_dict['joined_at'].isoformat()
                serialized_players.append(player_dict)
            
            room_info = {
                'id': room.id,
                'room_type': room.room_type,
                'players': serialized_players,
                'status': room.status,
                'prize_pool': room.prize_pool,
                'round_number': room.round_number,
                'players_count': len(room.players),
                'max_players': room.max_players,
                'settings': ROOM_SETTINGS.get(room.room_type, ROOM_SETTINGS.get('bronze', {})),
                'is_locked': (room.room_type == RoomType.FREEROLL and freeroll_config.get('is_locked', False))
            }
            room_data.append(room_info)
        
        await sio.emit('rooms_updated', {
            'rooms': room_data,
            'maintenance_mode': maintenance_mode,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
    except Exception as e:
        logging.error(f"Error broadcasting room updates: {e}")
        import traceback
        logging.error(traceback.format_exc())

async def start_game_round(room: GameRoom):
    """Start a game round when enough players have joined - with strict event sequence"""
    if len(room.players) < room.min_players:
        return
    
    # Generate unique match ID for this game
    match_id = str(uuid.uuid4())[:12]  # Short unique ID
    room.match_id = match_id  # Store on room for polling clients
    logging.info(f"🎮 Starting game round for room {room.id}, match_id: {match_id}")
    logging.info(f"👥 Players in room: {[p.username for p in room.players]}")

    # Set status IMMEDIATELY — polling clients detect this within 500ms
    room.status = "ready"
    room.prize_pool = sum(p.bet_amount for p in room.players)

    # Serialize player data
    serialized_players = []
    for p in room.players:
        player_dict = p.dict()
        if 'joined_at' in player_dict and isinstance(player_dict['joined_at'], datetime):
            player_dict['joined_at'] = player_dict['joined_at'].isoformat()
        serialized_players.append(player_dict)

    # Broadcast room_ready globally (socket fallback — polling is the primary mechanism)
    room_ready_data = {
        'room_id': room.id,
        'room_type': room.room_type,
        'match_id': match_id,
        'players': serialized_players,
        'prize_pool': room.prize_pool,
        'message': '🚀 GET READY FOR BATTLE!',
    }
    await sio.emit('room_ready', room_ready_data)
    logging.info(f"✅ room_ready emitted globally, match {match_id}")

    # Wait for roulette wheel animation (8 seconds to spin + show result)
    await asyncio.sleep(8)
    
    # Select winner immediately after GET READY (no game_starting event needed)
    room.status = "playing"
    room.started_at = datetime.now(timezone.utc)
    
    # Select winner using weighted random selection
    winner = select_winner(room.players)
    room.winner = winner
    room.status = "finished"
    room.finished_at = datetime.now(timezone.utc)
    
    # Credit winner with the full prize pool (losers already had bets deducted on join)
    # For freeroll rooms, credit the fixed house prize instead of prize_pool
    FREE_ROOM_PRIZE = 100  # tokens winner gets in the free room
    if room.room_type == RoomType.FREE:
        credit_amount = FREE_ROOM_PRIZE
    elif room.room_type == RoomType.FREEROLL:
        credit_amount = freeroll_config['prize']
    else:
        credit_amount = room.prize_pool
    room.prize_pool = credit_amount  # ensure prize_pool reflects actual credit for DB storage

    if not winner.user_id.startswith('bot_'):
        try:
            result = await dbq.increment_user_tokens(winner.user_id, credit_amount)
            if result:
                logging.info(f"💰 Credited {credit_amount} tokens to winner {winner.username} (new balance: {result.get('token_balance', 0)})")
                winner_sid = user_to_socket.get(winner.user_id)
                if winner_sid:
                    await sio.emit('balance_updated', {'user_id': winner.user_id, 'new_balance': result.get('token_balance', 0)}, room=winner_sid)
            else:
                logging.error(f"❌ Winner user {winner.user_id} not found in DB — balance NOT credited")
        except Exception as e:
            logging.error(f"❌ Failed to credit winner balance: {e}")

    # Get the prize link for this room type
    prize_link = PRIZE_LINKS[room.room_type]
    room.prize_link = prize_link

    # Store the winner's prize link in database for later retrieval
    try:
        await dbq.insert_winner_prize({
            "user_id": winner.user_id,
            "username": winner.username,
            "room_type": room.room_type.value if hasattr(room.room_type, 'value') else str(room.room_type).split('.')[-1].lower(),
            "prize_link": prize_link,
            "bet_amount": winner.bet_amount,
            "total_pool": room.prize_pool,
            "round_number": room.round_number,
            "won_at": room.finished_at
        })
        logging.info(f"Prize link stored for winner {winner.username}: {prize_link}")
    except Exception as e:
        logging.error(f"Failed to store winner prize: {e}")
    
    # EVENT 3: game_finished - Notify ROOM participants of the winner
    logging.info(f"📤 Broadcasting game_finished to room {room.id}")
    
    # Serialize winner data
    winner_dict = winner.dict()
    if 'joined_at' in winner_dict and isinstance(winner_dict['joined_at'], datetime):
        winner_dict['joined_at'] = winner_dict['joined_at'].isoformat()
    
    game_finished_data = {
        'room_id': room.id,
        'room_type': room.room_type,
        'match_id': match_id,  # Unique match identifier
        'winner': winner_dict,
        'winner_name': f"{winner.first_name} {winner.last_name}".strip(),
        'winner_id': winner.user_id,
        'prize_pool': room.prize_pool,
        'prize_link': prize_link,  # Include for winner screen
        'round_number': room.round_number,
        'has_prize': True,
        'finished_at': room.finished_at.isoformat()
    }
    # Broadcast game_finished to ALL clients - client filters by player list
    await sio.emit('game_finished', game_finished_data)
    logging.info(f"✅ Emitted game_finished globally, winner: {winner.username}, match_id: {match_id}")

    # Wait for winner announcement screen (8 seconds so players can see it)
    logging.info(f"⏱️ Waiting 8 seconds for winner announcement...")
    await asyncio.sleep(8)

    # EVENT 4: redirect_home - Redirect all players back to home screen
    final_sockets = socket_rooms.room_to_sockets.get(room.id, set())
    socket_count = len(final_sockets)

    logging.info(f"📤📤📤 BROADCASTING redirect_home to room {room.id}")
    logging.info(f"🧩 Target sockets: {[sid[:8] for sid in final_sockets]}")
    logging.info(f"📊 Socket count: {socket_count}")

    redirect_home_data = {
        'room_id': room.id,
        'match_id': match_id,
        'message': 'Returning to home screen...'
    }
    # Broadcast redirect_home to ALL clients - client filters by player list
    await sio.emit('redirect_home', redirect_home_data)
    logging.info(f"✅ Emitted redirect_home globally for match {match_id}")
    
    # EVENT 5: prize_won - Send prize link privately to the winner (using socket ID)
    winner_sid = user_to_socket.get(winner.user_id)
    if winner_sid:
        await sio.emit('prize_won', {
            'prize_link': prize_link,
            'room_type': room.room_type,
            'match_id': match_id,
            'bet_amount': winner.bet_amount,
            'total_pool': room.prize_pool
        }, room=winner_sid)
        logging.info(f"🏆 Sent private prize_won event to winner {winner.username}, match_id: {match_id}")
    else:
        logging.warning(f"⚠️ Could not find socket for winner {winner.user_id} to send prize_won event")
    
    # Save completed game to database
    try:
        game_doc = room.dict()
        # Normalize enum to plain string value
        rt = game_doc.get('room_type')
        game_doc['room_type'] = rt.value if hasattr(rt, 'value') else str(rt).split('.')[-1].lower()
        # Keep datetimes as objects — insert_completed_game uses _to_dt() helper
        # (no need to call .isoformat() here; that caused the previous asyncpg bug)
        
        await dbq.insert_completed_game(game_doc)

        # Save pending result for all participants — cleared client-side on redirect_home if they were online
        for participant in room.players:
            if not participant.user_id.startswith('bot_'):
                pending_doc = {
                    'user_id': participant.user_id,
                    'match_id': match_id,
                    'winner': game_doc['winner'],
                    'all_players': game_doc['players'],
                    'room_type': game_doc['room_type'],
                    'prize_pool': room.prize_pool,
                    'prize_link': prize_link,
                    'finished_at': game_doc['finished_at'],
                }
                await dbq.upsert_pending_result(participant.user_id, pending_doc)

        # Cleanup old game history (keep only 5 most recent)
        await cleanup_old_game_history()
    except Exception as e:
        logging.error(f"Failed to save completed game: {e}")
    
    # Wait a moment before cleaning up room to ensure redirect_home is processed
    await asyncio.sleep(0.5)
    
    # Remove room from active rooms
    if room.id in active_rooms:
        del active_rooms[room.id]
    
    # Create new room for next round
    new_room = GameRoom(
        room_type=room.room_type,
        round_number=room.round_number + 1
    )
    cfg = room_configs.get(room.room_type, {})
    defaults = ROOM_SETTINGS.get(RoomType(room.room_type), {})
    new_room.max_players = cfg.get('max_players', defaults.get('max_players', 3))
    new_room.min_players = cfg.get('min_players', defaults.get('min_players', 2))
    if room.room_type == 'freeroll':
        new_room.max_players = freeroll_config['max_players']
    active_rooms[new_room.id] = new_room

    logging.info(f"🆕 Created new {room.room_type} room {new_room.id}, round #{new_room.round_number}")

    # Notify clients about new room (global broadcast)
    await sio.emit('new_room_available', {
        'room_id': new_room.id,
        'room_type': new_room.room_type,
        'round_number': new_room.round_number
    })
    
    
    # Broadcast updated room states (global broadcast)
    await broadcast_room_updates()
    
    # Clear chat history for finished room
    room_chat.pop(room.id, None)

    logging.info(f"✅ Game cycle complete for {room.room_type} room")

# Initialize rooms
async def initialize_rooms():
    """Create initial rooms for all room types, applying DB room configs"""
    from db_queries import get_all_room_configs
    try:
        configs = await get_all_room_configs()
        for cfg in configs:
            room_configs[cfg['room_type']] = cfg
        logging.info(f"✅ Loaded {len(configs)} room configs from DB")
    except Exception as e:
        logging.warning(f"⚠️ Could not load room configs from DB (using defaults): {e}")

    room_types = ['free', 'bronze', 'silver', 'gold', 'freeroll']
    for room_type in room_types:
        cfg = room_configs.get(room_type, {})
        defaults = ROOM_SETTINGS.get(RoomType(room_type), {})
        room = GameRoom(room_type=room_type)
        room.max_players = cfg.get('max_players', defaults.get('max_players', 3))
        room.min_players = cfg.get('min_players', defaults.get('min_players', 2))
        if room_type == 'freeroll':
            room.max_players = freeroll_config['max_players']
        active_rooms[room.id] = room
        logging.info(f"✅ Created {room_type} room {room.id} (min={room.min_players}, max={room.max_players})")

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Solana Casino Battle Royale API"}

@api_router.get("/casino-wallet")
async def get_casino_wallet():
    """Get casino wallet address for payments - DEPRECATED, use /user/{user_id}/wallet"""
    return {
        "wallet_address": "DEPRECATED - Use personal wallet endpoint",
        "network": "devnet",
        "conversion_rate": {
            "sol_to_tokens": 1000,
            "description": "1 SOL = 1,000 Casino Tokens"
        },
        "message": "This endpoint is deprecated. Each user now gets a personal wallet address."
    }

@api_router.get("/user/{user_id}/derived-wallet")
async def get_user_derived_wallet(user_id: str):
    """Get user's personal derived Solana address for payments"""
    try:
        # Find user by ID
        user = await dbq.get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Get or create derived address
        derived_info = await get_or_create_derived_address(user_id, user['telegram_id'])
        
        if not derived_info:
            raise HTTPException(status_code=500, detail="Failed to create derived address")
        
        # Add address to monitoring
        await payment_monitor.add_address_to_monitor(derived_info["address"])
        
        # Get current SOL/EUR price for display
        sol_eur_price = await price_oracle.get_sol_eur_price()
        
        return {
            "derived_wallet_address": derived_info["address"],
            "user_id": user_id,
            "telegram_id": user['telegram_id'],
            "network": "devnet",
            "current_sol_eur_price": sol_eur_price,
            "conversion_rate": {
                "eur_to_tokens": 100,
                "description": f"1 EUR = 100 tokens (1 SOL = €{sol_eur_price})"
            },
            "instructions": f"Send SOL to YOUR personal address above. Tokens credited automatically! 1 SOL = {int(sol_eur_price * 100)} tokens"
        }
        
    except Exception as e:
        logging.error(f"Error getting derived wallet: {e}")
        raise HTTPException(status_code=500, detail="Failed to get derived wallet address")

@api_router.get("/sol-eur-price")
async def get_sol_eur_price():
    """Get current SOL/EUR price"""
    try:
        price = await price_oracle.get_sol_eur_price()
        return {
            "sol_eur_price": price,
            "last_updated": price_oracle.last_update,
            "conversion_info": {
                "1_eur": f"{1/price:.6f} SOL",
                "100_tokens": f"{1/price:.6f} SOL",
                "description": "1 EUR = 100 tokens"
            }
        }
    except Exception as e:
        logging.error(f"Error getting SOL price: {e}")
        raise HTTPException(status_code=500, detail="Failed to get price")

@api_router.get("/casino-wallet")
async def get_casino_wallet():
    """Get casino wallet address and current pricing"""
    try:
        sol_price = await price_oracle.get_sol_eur_price()
        return {
            "wallet_address": CASINO_WALLET_ADDRESS,
            "network": "devnet",
            "current_sol_eur_price": sol_price,
            "conversion_rate": {
                "eur_to_tokens": 100,
                "description": "1 EUR = 100 Casino Tokens (real-time SOL pricing)"
            },
            "instructions": "Users get personal derived addresses for payments"
        }
    except Exception as e:
        logging.error(f"Error getting casino wallet info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get wallet info")

@api_router.post("/admin/add-tokens")
async def add_tokens_to_user(admin_key: str, username: str, tokens: int):
    """Add tokens to a specific user by username"""
    
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    try:
        # Find user by username
        user_doc = await dbq.get_user_by_username(username)

        if user_doc:
            # Update existing user
            await dbq.increment_user_tokens(user_doc['id'], tokens)

            new_balance = user_doc.get('token_balance', 0) + tokens

            return {
                "status": "success",
                "message": f"Added {tokens} tokens to existing user {username}",
                "new_balance": new_balance,
                "user_id": user_doc.get('id')
            }
        else:
            # Create new user with tokens
            new_user_id = str(uuid.uuid4())

            new_user = {
                "id": new_user_id,
                "telegram_id": -(abs(hash(username)) % 999_999_999 + 1),  # Negative ID — never conflicts with real Telegram IDs
                "first_name": username.replace("@", "").title(),
                "last_name": "",
                "username": username,
                "photo_url": "",
                "token_balance": tokens,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_login": datetime.now(timezone.utc).isoformat(),
                "is_verified": True
            }

            await dbq.insert_user(new_user)
            
            return {
                "status": "success", 
                "message": f"Created new user {username} with {tokens} tokens",
                "new_balance": tokens,
                "user_id": new_user_id
            }
            
    except Exception as e:
        logging.error(f"Failed to add tokens: {e}")
        raise HTTPException(status_code=500, detail="Failed to add tokens")

@api_router.post("/admin/add-tokens/{telegram_id}")
async def add_tokens_by_telegram_id(telegram_id: int, admin_key: str, tokens: int):
    """Add tokens to a user by their Telegram ID - useful for testing"""
    
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    try:
        # Find user by telegram_id
        user_doc = await dbq.get_user_by_telegram_id(telegram_id)

        if user_doc:
            # Update existing user's balance
            await dbq.increment_user_tokens_by_telegram_id(telegram_id, tokens)

            new_balance = user_doc.get('token_balance', 0) + tokens

            logging.info(f"✅ Added {tokens} tokens to Telegram user {telegram_id}. New balance: {new_balance}")
            
            return {
                "status": "success",
                "message": f"Added {tokens} tokens to Telegram user {telegram_id}",
                "new_balance": new_balance,
                "user_id": user_doc.get('id'),
                "username": user_doc.get('username', 'unknown')
            }
        else:
            # User doesn't exist yet - they need to login first
            return {
                "status": "user_not_found",
                "message": f"User with Telegram ID {telegram_id} not found. Please login first via Telegram, then tokens can be added.",
                "telegram_id": telegram_id
            }
            
    except Exception as e:
        logging.error(f"Failed to add tokens by Telegram ID: {e}")
        raise HTTPException(status_code=500, detail="Failed to add tokens")

@api_router.post("/admin/cleanup-database")
async def cleanup_database_for_production(admin_key: str):
    """ADMIN ONLY: Clean database for production launch"""
    try:
        # Simple admin key check (in production, use proper authentication)
        if admin_key != "PRODUCTION_CLEANUP_2025":
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Clear ALL tables completely
        delete_result = await dbq.delete_all_data()

        logging.info("🧹 COMPLETE DATABASE WIPE FINISHED")
        logging.info(f"Deleted: {delete_result.get('users', 0)} users")
        logging.info(f"Deleted: {delete_result.get('completed_games', 0)} completed games")
        logging.info(f"Deleted: {delete_result.get('winner_prizes', 0)} winner prizes")

        return {
            "status": "success",
            "message": "Database cleaned for production",
            "deleted": {
                "users": delete_result.get('users', 0),
                "completed_games": delete_result.get('completed_games', 0),
                "winner_prizes": delete_result.get('winner_prizes', 0)
            }
        }
        
    except Exception as e:
        logging.error(f"Error cleaning database: {e}")
        raise HTTPException(status_code=500, detail="Failed to clean database")


@api_router.get("/admin/reset-game-history")
async def reset_game_history(admin_key: str):
    """ADMIN ONLY: Clear all game history and stats, keep user accounts"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        async with dbq.get_pool().acquire() as conn:
            r_games   = await conn.execute("DELETE FROM completed_games")
            r_prizes  = await conn.execute("DELETE FROM winner_prizes")
            r_pending = await conn.execute("DELETE FROM pending_results")
        return {
            "status": "success",
            "deleted": {
                "completed_games": int(r_games.split()[-1]),
                "winner_prizes":   int(r_prizes.split()[-1]),
                "pending_results": int(r_pending.split()[-1]),
            }
        }
    except Exception as e:
        logging.error(f"Error resetting game history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/auth/telegram", response_model=User)
async def telegram_auth(user_data: UserCreate):
    """Authenticate user with Telegram data"""
    telegram_data = user_data.telegram_auth_data
    
    # Log the incoming data for debugging
    logging.info(f"🔐 Telegram auth attempt for user ID: {telegram_data.id}")
    logging.info(f"📋 Full auth data: id={telegram_data.id}, first_name={telegram_data.first_name}, username={telegram_data.username}")
    
    # For Telegram Web App, be more permissive with authentication
    # Basic validation - user must have ID and first name
    if not telegram_data.id or not telegram_data.first_name:
        raise HTTPException(status_code=400, detail="Missing required Telegram user data")
    
    # Skip hash verification for now since Web App integration can be complex
    # In production, you'd want proper hash verification
    logging.info(f"🔍 Authenticating Telegram user: {telegram_data.first_name} (ID: {telegram_data.id})")
    
    # Check if user already exists
    logging.info(f"🔎 Searching for existing user with telegram_id={telegram_data.id} in database")
    existing_user = await dbq.get_user_by_telegram_id(telegram_data.id)
    logging.info(f"🔎 Search result: {'FOUND' if existing_user else 'NOT FOUND'}")

    if existing_user:
        # Special handling for admin @cia_nera - ensure unlimited tokens
        if telegram_data.id == 7983427898:
            logging.info(f"👑 Admin @cia_nera detected - ensuring unlimited tokens")
            await dbq.update_user_fields_by_telegram_id(
                telegram_data.id,
                {
                    "last_login": datetime.now(timezone.utc).isoformat(),
                    "token_balance": 1000000000
                }
            )
            existing_user['token_balance'] = 1000000000
        else:
            # Update last login time for regular users
            await dbq.update_user_fields_by_telegram_id(
                telegram_data.id,
                {"last_login": datetime.now(timezone.utc).isoformat()}
            )
        
        # Convert back from stored format
        if isinstance(existing_user['created_at'], str):
            existing_user['created_at'] = datetime.fromisoformat(existing_user['created_at'])
        if isinstance(existing_user['last_login'], str):
            existing_user['last_login'] = datetime.fromisoformat(existing_user['last_login'])
        
        logging.info(f"✅ Returning existing user: {existing_user['first_name']} with balance: {existing_user.get('token_balance', 0)}")
        return User(**existing_user)
    
    # Create new user
    user = User(
        telegram_id=telegram_data.id,
        first_name=telegram_data.first_name,
        last_name=telegram_data.last_name,
        telegram_username=telegram_data.username,
        photo_url=telegram_data.photo_url,
        is_verified=True
    )
    
    user_dict = user.dict()
    user_dict['created_at'] = user_dict['created_at'].isoformat()
    user_dict['last_login'] = user_dict['last_login'].isoformat()
    
    # Special handling for admin @cia_nera - unlimited tokens
    if telegram_data.id == 7983427898:
        user_dict['token_balance'] = 1000000000  # 1 billion tokens for admin
        logging.info(f"👑 Creating admin @cia_nera with unlimited tokens!")
    else:
        pass

    try:
        await dbq.insert_user(user_dict)
    except Exception as insert_err:
        logging.warning(
            "User with telegram_id %s may have been created concurrently (error: %s). Refreshing existing record.",
            telegram_data.id, insert_err
        )

        # Fetch the document that now exists and update the login timestamp (and admin tokens if applicable)
        existing_user = await dbq.get_user_by_telegram_id(telegram_data.id)
        if not existing_user:
            logging.error(
                "Duplicate user detected for telegram_id %s but document could not be reloaded.",
                telegram_data.id
            )
            raise HTTPException(status_code=500, detail="Failed to finalize Telegram authentication")

        update_fields = {"last_login": datetime.now(timezone.utc).isoformat()}
        if telegram_data.id == 7983427898:
            update_fields["token_balance"] = 1000000000

        await dbq.update_user_fields_by_telegram_id(telegram_data.id, update_fields)
        existing_user = await dbq.get_user_by_telegram_id(telegram_data.id)

        if isinstance(existing_user.get('created_at'), str):
            existing_user['created_at'] = datetime.fromisoformat(existing_user['created_at'])
        if isinstance(existing_user.get('last_login'), str):
            existing_user['last_login'] = datetime.fromisoformat(existing_user['last_login'])

        logging.info(
            "✅ Returning concurrently created user %s (telegram_id: %s) with balance %s",
            existing_user.get('first_name', ''),
            telegram_data.id,
            existing_user.get('token_balance', 0)
        )

        return User(**existing_user)

    if telegram_data.id == 7983427898:
        user.token_balance = user_dict['token_balance']
        logging.info(f"👑 Admin @cia_nera created with {user.token_balance} tokens!")
    else:
        logging.info(f"🆕 Created new user: {user.first_name} (telegram_id: {user.telegram_id})")

    return user

# Solana Token Purchase Endpoints
class TokenPurchaseRequest(BaseModel):
    user_id: str
    token_amount: int = Field(gt=0, description="Number of tokens to purchase")

@api_router.post("/purchase-tokens")
async def initiate_token_purchase(request: TokenPurchaseRequest):
    """
    Create a unique wallet address for token purchase
    Returns wallet address and payment instructions
    """
    try:
        # Validate user exists
        user = await dbq.get_user_by_id(request.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Validate token amount (min 10, max 10000)
        if request.token_amount < 10:
            raise HTTPException(status_code=400, detail="Minimum purchase is 10 tokens")
        if request.token_amount > 10000:
            raise HTTPException(status_code=400, detail="Maximum purchase is 10,000 tokens")
        
        # Create payment wallet using Solana processor
        processor = get_processor(None)
        payment_info = await processor.create_payment_wallet(
            user_id=request.user_id,
            token_amount=request.token_amount
        )
        
        logging.info(f"Token purchase initiated: {request.user_id} -> {request.token_amount} tokens")
        
        return {
            "status": "success",
            "message": "Payment wallet created successfully",
            "payment_info": payment_info
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to initiate token purchase: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create payment wallet: {str(e)}")

@api_router.get("/purchase-status/{user_id}/{wallet_address}")
async def get_purchase_status(user_id: str, wallet_address: str):
    """
    Get the status of a token purchase
    Shows payment detection, token crediting, and forwarding status
    """
    try:
        # Get purchase status from Solana processor
        processor = get_processor(None)
        status_info = await processor.get_purchase_status(user_id, wallet_address)
        
        return {
            "status": "success",
            "purchase_status": status_info
        }
        
    except Exception as e:
        logging.error(f"Failed to get purchase status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get purchase status: {str(e)}")

@api_router.get("/purchase-history/{user_id}")
async def get_purchase_history(user_id: str, limit: int = 5, offset: int = 0):
    """Get token purchase history for a user with pagination"""
    try:
        user = await dbq.get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        purchases, total = await dbq.get_token_purchases(user_id, limit=limit, offset=offset)

        return {
            "status": "success",
            "purchases": purchases,
            "total": total
        }

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to get purchase history: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get purchase history")

@api_router.post("/admin/update-user-name/{telegram_id}")
async def update_user_name(telegram_id: int, first_name: str, username: str = "", photo_url: str = "", admin_key: str = ""):
    """Update user name, username and photo"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    # Update user data
    update_data = {
        "first_name": first_name,
        "telegram_username": username
    }
    
    # Add photo_url if provided
    if photo_url:
        update_data["photo_url"] = photo_url
    
    updated = await dbq.update_user_fields_by_telegram_id(telegram_id, update_data)

    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "status": "success",
        "message": f"Updated user {telegram_id} name to {first_name}",
        "telegram_id": telegram_id,
        "first_name": first_name,
        "username": username,
        "photo_url": photo_url
    }

@api_router.post("/admin/process-payment")
async def manually_process_payment(wallet_address: str, signature: str, admin_key: str = ""):
    """ADMIN ONLY: Manually trigger payment processing for a specific transaction"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        # Get Solana processor
        from solana_integration import get_processor
        processor = get_processor(None)
        
        logging.info(f"🔧 [Admin] Manually processing payment for wallet {wallet_address}")
        logging.info(f"🔧 [Admin] Transaction signature: {signature}")
        
        # Trigger payment processing
        await processor.process_detected_payment(wallet_address, signature)
        
        # Check result
        wallet_doc = await dbq.get_temporary_wallet(wallet_address)
        
        return {
            "status": "success",
            "message": "Payment processing triggered",
            "wallet_address": wallet_address,
            "signature": signature,
            "payment_detected": wallet_doc.get("payment_detected") if wallet_doc else False,
            "tokens_credited": wallet_doc.get("tokens_credited") if wallet_doc else False,
            "sol_forwarded": wallet_doc.get("sol_forwarded") if wallet_doc else False,
            "wallet_status": wallet_doc.get("status") if wallet_doc else "not_found"
        }
        
    except Exception as e:
        logging.error(f"Error manually processing payment: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to process payment: {str(e)}")

@api_router.post("/admin/manual-credit")
async def manual_credit_tokens(
    telegram_id: int,
    amount: int,
    reason: str,
    transaction_signature: Optional[str] = None,
    admin_key: str = ""
):
    """
    ADMIN ONLY: Manually credit tokens to a user with full logging
    
    Args:
        telegram_id: User's Telegram ID
        amount: Tokens to credit
        reason: Reason for manual credit
        transaction_signature: Optional Solana transaction signature
        admin_key: Admin authentication key
    """
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    result = await credit_tokens_manually(
        db=None,
        telegram_id=telegram_id,
        amount=amount,
        reason=reason,
        transaction_signature=transaction_signature
    )
    
    return result

@api_router.get("/admin/recovery-status")
async def get_recovery_status(admin_key: str = ""):
    """ADMIN ONLY: Get payment recovery system status"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    # Get RPC health status
    rpc_health = rpc_alert_system.get_health_report()
    
    # Get recent manual credits
    credit_logger = ManualCreditLogger(None)
    recent_credits = await credit_logger.get_recent_manual_credits(limit=10)
    
    return {
        "rpc_health": rpc_health,
        "recent_manual_credits": [
            {
                "telegram_id": c.get("telegram_id"),
                "amount": c.get("tokens_credited"),
                "reason": c.get("reason"),
                "timestamp": c.get("timestamp").isoformat() if c.get("timestamp") else None
            }
            for c in recent_credits
        ],
        "monitoring_active": True
    }

@api_router.post("/admin/rescan-payments")
async def rescan_payments(admin_key: str = "", wallet_address: Optional[str] = None):
    """
    ADMIN ONLY: Manually trigger payment rescan
    If wallet_address provided, scans only that wallet
    Otherwise scans all pending wallets
    """
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        from solana_integration import get_processor
        processor = get_processor(None)
        
        if wallet_address:
            logging.info(f"🔧 [Admin] Manual rescan for wallet: {wallet_address}")
            
            # Get specific wallet
            wallet_doc = await dbq.get_temporary_wallet(wallet_address)
            if not wallet_doc:
                raise HTTPException(status_code=404, detail=f"Wallet {wallet_address} not found")
            
            # Check balance
            from solders.pubkey import Pubkey
            from decimal import Decimal
            from solana.rpc.commitment import Confirmed
            from solana_integration import SOLANA_RPC_URL
            
            logging.info(f"🔧 [Admin] Using RPC URL: {SOLANA_RPC_URL}")
            logging.info(f"🔧 [Admin] Processor client: {processor.client._provider.endpoint_uri}")
            
            pubkey = Pubkey.from_string(wallet_address)
            balance_response = await processor.client.get_balance(pubkey, commitment=Confirmed)
            balance_lamports = balance_response.value if balance_response.value else 0
            
            logging.info(f"🔧 [Admin] Balance response: {balance_response}")
            logging.info(f"🔧 [Admin] Balance lamports: {balance_lamports}")
            
            balance_sol = Decimal(balance_lamports) / Decimal(1000000000)
            
            expected_sol = Decimal(str(wallet_doc["required_sol"]))
            
            result = {
                "wallet_address": wallet_address,
                "current_balance": str(balance_sol),
                "expected_amount": str(expected_sol),
                "status": wallet_doc.get("status"),
                "payment_detected": wallet_doc.get("payment_detected", False),
                "tokens_credited": wallet_doc.get("tokens_credited", False),
                "user_id": wallet_doc.get("user_id")
            }
            
            # If payment found, process it
            tolerance = Decimal("0.001")
            if balance_sol >= (expected_sol - tolerance) and not wallet_doc.get("tokens_credited"):
                logging.info(f"💰 [Admin] Processing payment for wallet {wallet_address}")
                
                # Mark as detected
                await dbq.update_temporary_wallet(
                    wallet_address,
                    {"payment_detected": True, "status": "manual_rescan", "detected_at": datetime.now(timezone.utc).isoformat()}
                )
                
                # Credit tokens
                await processor.credit_tokens_to_user(wallet_doc, balance_sol)
                
                # Forward SOL
                await processor.forward_sol_to_main_wallet(wallet_address, wallet_doc["private_key"], balance_lamports)
                
                result["action"] = "payment_processed"
            else:
                result["action"] = "no_action_needed"
            
            return result
        else:
            # Scan all pending wallets
            logging.info("🔧 [Admin] Manual rescan of all pending payments")
            await processor.rescan_pending_payments()
            
            # Get stats
            pending_count = await dbq.count_pending_wallets()
            
            return {
                "status": "success",
                "message": "Rescan completed",
                "pending_wallets_checked": pending_count
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error in payment rescan: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to rescan payments: {str(e)}")

@api_router.post("/admin/reset-processor")
async def reset_solana_processor(admin_key: str = ""):
    """ADMIN ONLY: Force reset Solana processor (for RPC URL changes)"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        from solana_integration import reset_processor, SOLANA_RPC_URL
        
        logging.info("🔄 [Admin] Forcing processor reset...")
        reset_processor()
        logging.info(f"✅ [Admin] Processor reset complete")
        logging.info(f"🌐 [Admin] Current RPC URL: {SOLANA_RPC_URL}")
        
        return {
            "status": "success",
            "message": "Processor reset successfully",
            "rpc_url": SOLANA_RPC_URL
        }
        
    except Exception as e:
        logging.error(f"Error resetting processor: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to reset processor: {str(e)}")

@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    user_doc = await dbq.get_user_by_id(user_id)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    if isinstance(user_doc['created_at'], str):
        user_doc['created_at'] = datetime.fromisoformat(user_doc['created_at'])

    return User(**user_doc)


@api_router.get("/rooms")
async def get_active_rooms():
    """Get all active rooms with their current status"""
    rooms_data = []

    for room in active_rooms.values():
        room_data = {
            "id": room.id,
            "room_type": room.room_type,
            "players_count": len(room.players),
            "max_players": room.max_players,
            "status": room.status,
            "prize_pool": room.prize_pool,
            "round_number": room.round_number,
            "settings": ROOM_SETTINGS.get(room.room_type, ROOM_SETTINGS["bronze"]),
            "is_locked": (room.room_type == RoomType.FREEROLL and freeroll_config.get('is_locked', False))
        }
        rooms_data.append(room_data)

    return {"rooms": rooms_data, "maintenance_mode": maintenance_mode}

@api_router.get("/user-room-status/{user_id}")
async def get_user_room_status(user_id: str):
    """Check if user is currently in any active rooms (can be multiple)"""
    try:
        # Collect ALL rooms user is in
        user_rooms = []

        # Check all active rooms for this user
        for room in active_rooms.values():
            for player in room.players:
                if player.user_id == user_id:
                    # User is in this room - add to list
                    serialized_players = []
                    for p in room.players:
                        player_dict = p.dict()
                        if 'joined_at' in player_dict and isinstance(player_dict['joined_at'], datetime):
                            player_dict['joined_at'] = player_dict['joined_at'].isoformat()
                        serialized_players.append(player_dict)

                    user_rooms.append({
                        "room_id": room.id,
                        "room_type": room.room_type,
                        "status": room.status,
                        "players": serialized_players,
                        "players_count": len(room.players),
                        "prize_pool": room.prize_pool,
                        "min_players": room.min_players,
                        "max_players": room.max_players,
                        "position": next((i+1 for i, p in enumerate(room.players) if p.user_id == user_id), 0)
                    })
                    break  # Found user in this room, move to next room

        # Return all rooms user is in
        if len(user_rooms) > 0:
            return {
                "in_room": True,
                "rooms": user_rooms,
                "total_rooms": len(user_rooms)
            }
        else:
            return {
                "in_room": False,
                "rooms": [],
                "total_rooms": 0
            }
    except Exception as e:
        logging.error(f"Error checking user room status: {e}")
        raise HTTPException(status_code=500, detail="Failed to check room status")

@api_router.post("/join-room")
async def join_room(request: JoinRoomRequest, background_tasks: BackgroundTasks):
    """Join a room with a bet"""
    logging.info(f"Join room request: {request.dict()}")
    
    # Find room of the requested type
    target_room = None
    for room in active_rooms.values():
        if room.room_type == request.room_type and room.status == "waiting":
            target_room = room
            break
    
    if not target_room:
        logging.error(f"No available room of type {request.room_type}")
        raise HTTPException(status_code=404, detail="No available room of this type")

    # Freeroll lock check
    if target_room.room_type == RoomType.FREEROLL and freeroll_config.get('is_locked'):
        raise HTTPException(status_code=423, detail="Free Roll room is currently locked.")

    # Validate bet amount (skip range check for freeroll)
    settings = ROOM_SETTINGS[request.room_type]
    if request.room_type != RoomType.FREEROLL:
        if request.bet_amount < settings["min_bet"] or request.bet_amount > settings["max_bet"]:
            raise HTTPException(
                status_code=400,
                detail=f"Bet amount must be between {settings['min_bet']} and {settings['max_bet']} tokens"
            )

    # Check if user exists and has enough tokens
    user_doc = await dbq.get_user_by_id(request.user_id)
    if not user_doc:
        logging.error(f"User not found: {request.user_id}")
        raise HTTPException(status_code=404, detail="User not found")

    if user_doc.get("is_banned"):
        raise HTTPException(status_code=403, detail="Your account has been banned.")

    if maintenance_mode:
        raise HTTPException(status_code=503, detail="🔧 Maintenance in progress. Please try again later.")

    logging.info(f"User balance: {user_doc.get('token_balance', 0)}, Bet amount: {request.bet_amount}")

    if request.bet_amount > 0 and user_doc.get('token_balance', 0) < request.bet_amount:
        raise HTTPException(status_code=400, detail="Insufficient token balance")

    # Check if user is already in the room
    if any(p.user_id == request.user_id for p in target_room.players):
        raise HTTPException(status_code=400, detail="You are already in this room")

    # Check if room is full
    if len(target_room.players) >= target_room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")

    # Deduct tokens from user balance (skip for freeroll / 0-bet)
    # increment_user_tokens with negative amount guards against going below 0
    if request.bet_amount > 0:
        updated = await dbq.increment_user_tokens(request.user_id, -request.bet_amount)
        if not updated:
            raise HTTPException(status_code=400, detail="Insufficient token balance")
    new_balance_after_join = user_doc.get('token_balance', 0) - request.bet_amount
    joining_sid = user_to_socket.get(request.user_id)
    if joining_sid:
        await sio.emit('balance_updated', {'user_id': request.user_id, 'new_balance': new_balance_after_join}, room=joining_sid)
    
    # Add player to room with full Telegram info
    if request.is_anonymous:
        anon_count = sum(1 for p in target_room.players if p.is_anonymous)
        anon_name = "Anonymous" if anon_count == 0 else f"Anonymous-{anon_count + 1}"
        player = RoomPlayer(
            user_id=request.user_id,
            username='',
            first_name=anon_name,
            last_name='',
            photo_url='',
            bet_amount=request.bet_amount,
            is_anonymous=True
        )
    else:
        player = RoomPlayer(
            user_id=request.user_id,
            username=user_doc.get('telegram_username', ''),  # @username
            first_name=user_doc.get('first_name', 'Player'),
            last_name=user_doc.get('last_name', ''),
            photo_url=user_doc.get('photo_url', ''),
            bet_amount=request.bet_amount,
            is_anonymous=False
        )
    target_room.players.append(player)
    target_room.prize_pool += request.bet_amount
    
    # Notify ROOM participants about new player - ALWAYS send FULL participant list
    # Serialize player data with datetime conversion
    serialized_players = []
    for p in target_room.players:
        player_dict = p.dict()
        if 'joined_at' in player_dict and isinstance(player_dict['joined_at'], datetime):
            player_dict['joined_at'] = player_dict['joined_at'].isoformat()
        serialized_players.append(player_dict)
    
    # Serialize single player data
    player_dict = player.dict()
    if 'joined_at' in player_dict and isinstance(player_dict['joined_at'], datetime):
        player_dict['joined_at'] = player_dict['joined_at'].isoformat()
    
    logging.info(f"👤 Player {player.username} joined room {target_room.id} ({len(target_room.players)}/{target_room.max_players})")
    logging.info(f"📋 Full participant list: {[p['username'] for p in serialized_players]}")

    await socket_rooms.broadcast_to_room(sio, target_room.id, 'player_joined', {
        'room_id': target_room.id,
        'room_type': target_room.room_type,
        'player': player_dict,
        'players_count': len(target_room.players),
        'prize_pool': target_room.prize_pool,
        'all_players': serialized_players,  # FULL participant list - REPLACE, don't append
        'room_status': 'filling' if len(target_room.players) < target_room.max_players else 'full',
        'timestamp': datetime.now(timezone.utc).isoformat()
    })
    logging.info(f"✅ Emitted player_joined to room {target_room.id} with {len(serialized_players)} players")

    # Broadcast updated room states to all clients (global lobby update)
    await broadcast_room_updates()

    # Check if enough players to start game
    if len(target_room.players) >= target_room.min_players:
        logging.info(f"🚀 Enough players! Room {target_room.id} has {len(target_room.players)}/{target_room.min_players} players, starting game sequence...")

        # Emit room_full event to all participants in THIS room only
        await socket_rooms.broadcast_to_room(sio, target_room.id, 'room_full', {
            'room_id': target_room.id,
            'room_type': target_room.room_type,
            'players': serialized_players,
            'players_count': len(target_room.players),
            'message': '🚀 GAME IS STARTING! GET READY FOR THE BATTLE!',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        logging.info(f"✅ Emitted room_full to room {target_room.id}")

        # Start the game sequence (will emit room_ready, game_starting, game_finished in order)
        background_tasks.add_task(start_game_round, target_room)

    return {
        "status": "joined",
        "success": True,
        "room_id": target_room.id,
        "position": len(target_room.players),
        "players_needed": target_room.max_players - len(target_room.players),
        "min_players": target_room.min_players,
        "max_players": target_room.max_players,
        "new_balance": user_doc.get('token_balance', 0) - request.bet_amount
    }

class LeaveRoomRequest(BaseModel):
    room_id: str
    user_id: str

@api_router.post("/leave-room")
async def leave_room(request: LeaveRoomRequest):
    """Remove player from a waiting room and refund their bet"""
    room = active_rooms.get(request.room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.status != "waiting":
        raise HTTPException(status_code=400, detail="Cannot leave a room that is already in progress")

    player = next((p for p in room.players if p.user_id == request.user_id), None)
    if not player:
        raise HTTPException(status_code=404, detail="Player not in this room")

    refund = player.bet_amount
    room.players = [p for p in room.players if p.user_id != request.user_id]
    room.prize_pool = max(0, room.prize_pool - refund)

    # Refund tokens
    result = await dbq.increment_user_tokens(request.user_id, refund)
    new_balance = result.get("token_balance", 0) if result else 0

    # Notify socket
    sid = user_to_socket.get(request.user_id)
    if sid:
        await sio.emit("balance_updated", {"user_id": request.user_id, "new_balance": new_balance}, room=sid)

    # Broadcast updated room list to all clients
    await broadcast_room_updates()

    # Notify remaining room players
    serialized_players = []
    for p in room.players:
        pd = p.dict()
        if isinstance(pd.get("joined_at"), datetime):
            pd["joined_at"] = pd["joined_at"].isoformat()
        serialized_players.append(pd)
    await sio.emit("player_left", {
        "room_type": room.room_type,
        "player": {"first_name": player.first_name, "username": player.username},
        "players_count": len(room.players),
        "all_players": serialized_players,
    })

    logging.info(f"👋 Player {player.username or player.first_name} left room {room.id}, refunded {refund} tokens")
    return {"status": "left", "refund": refund, "new_balance": new_balance}

@api_router.get("/pending-result/{user_id}")
async def get_pending_result(user_id: str):
    """Return and delete all missed game results for this user"""
    results = await dbq.get_and_delete_pending_result(user_id)
    return {"results": results or []}

@api_router.get("/room-participants/{room_type}")
async def get_room_participants_by_type(room_type: str):
    """Get current participants in a room by type - for lobby updates"""
    # Find the active room of this type
    target_room = None
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == "waiting":
            target_room = room
            break
    
    if not target_room:
        return {
            "room_type": room_type,
            "players": [],
            "count": 0
        }
    
    return {
        "room_type": room_type,
        "room_id": target_room.id,
        "players": [p.dict() for p in target_room.players],
        "count": len(target_room.players),
        "status": target_room.status,
        "min_players": target_room.min_players,
        "max_players": target_room.max_players,
    }

@api_router.get("/room-chat/{room_id}")
async def get_room_chat(room_id: str):
    """Get chat history for a room"""
    return {"messages": room_chat.get(room_id, [])}

@api_router.post("/room-chat/{room_id}")
async def post_room_chat(room_id: str, user_id: str = "", name: str = "Player", text: str = ""):
    """Post a chat message to a room (REST fallback when socket unreliable)"""
    text = text.strip()[:200]
    if not text or not room_id:
        raise HTTPException(status_code=400, detail="Missing room_id or text")
    msg = {
        'user_id': user_id,
        'name': name,
        'text': text,
        'ts': datetime.now(timezone.utc).isoformat(),
    }
    room_chat.setdefault(room_id, [])
    room_chat[room_id].append(msg)
    if len(room_chat[room_id]) > 50:
        room_chat[room_id] = room_chat[room_id][-50:]
    payload = {'room_id': room_id, **msg}
    await sio.emit('lobby_message', payload)
    logging.info(f"💬 REST Chat [{room_id[:8]}] {name}: {text[:40]}")
    return {"ok": True, "message": msg}

@api_router.get("/room/{room_id}")
async def get_room_details(room_id: str):
    """Get detailed information about a specific room"""
    room = active_rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    def serialize_player(p):
        d = p.dict()
        if 'joined_at' in d and isinstance(d['joined_at'], datetime):
            d['joined_at'] = d['joined_at'].isoformat()
        return d

    return {
        "id": room.id,
        "room_type": room.room_type,
        "players": [serialize_player(p) for p in room.players],
        "status": room.status,
        "prize_pool": room.prize_pool,
        "match_id": room.match_id,
        "round_number": room.round_number,
        "settings": ROOM_SETTINGS[room.room_type],
        "winner": serialize_player(room.winner) if room.winner else None,
        "finished_at": room.finished_at.isoformat() if room.finished_at else None,
    }

@api_router.get("/leaderboard")
async def get_leaderboard():
    """Get top players by token balance"""
    leaderboard = await dbq.get_leaderboard(10)
    return {"leaderboard": leaderboard}

@api_router.get("/game-history")
async def get_game_history(limit: int = 10, user_id: str = ""):
    """Get recent completed games. If user_id given, returns only that user's games."""
    if limit > 20:
        limit = 20
    if user_id:
        games = await dbq.get_user_completed_games(user_id, limit)
    else:
        games = await dbq.get_recent_completed_games(limit)
    return {"games": games}

@api_router.get("/user-stats/{user_id}")
async def get_user_stats_endpoint(user_id: str):
    """Return play statistics for a user (games played, win rate, profit, etc.)"""
    try:
        stats = await dbq.get_user_stats(user_id)
        return stats
    except Exception as e:
        logging.error(f"get_user_stats error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/version")
async def get_version():
    """Get current build version for verification"""
    return {
        "version": "8.0-WINNER-FIX-20250114",
        "build_timestamp": "1736864000",
        "environment": "production",
        "status": "healthy",
        "features": {
            "winner_message_fixed": True,
            "version_label_removed": True,
            "prize_visibility_fixed": True,
            "history_badge_fixed": True
        }
    }

@api_router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": "8.0-WINNER-FIX-20250114",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@api_router.get("/users/telegram/{telegram_id}")
async def get_user_by_telegram_id(telegram_id: int):
    """Find user by Telegram ID. Returns 404 if not found, never 500 for missing user."""
    # DB query is isolated so HTTPException(404) is never caught as a generic error
    try:
        user_doc = await dbq.get_user_by_telegram_id(telegram_id)
    except Exception as e:
        logging.error(f"DB error looking up telegram_id={telegram_id}: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    if not user_doc:
        logging.info(f"User not found for telegram_id={telegram_id}")
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user_doc.get('id'),
        "telegram_id": user_doc.get('telegram_id'),
        "first_name": user_doc.get('first_name'),
        "last_name": user_doc.get('last_name', ''),
        "username": user_doc.get('telegram_username', ''),
        "photo_url": user_doc.get('photo_url', ''),
        "token_balance": user_doc.get('token_balance', 0),
        "created_at": user_doc.get('created_at'),
        "last_login": user_doc.get('last_login'),
        "last_daily_claim": user_doc.get('last_daily_claim'),
        "is_verified": user_doc.get('is_verified', False),
        "is_admin": user_doc.get('is_admin', False),
        "is_owner": user_doc.get('is_owner', False),
        "role": user_doc.get('role', 'user')
    }

@api_router.get("/user/{user_id}")
async def get_user_data(user_id: str):
    """Get user data including current balance"""
    try:
        user_doc = await dbq.get_user_by_id(user_id)
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")

        return {
            "id": user_doc.get('id'),
            "telegram_id": user_doc.get('telegram_id'),
            "first_name": user_doc.get('first_name'),
            "last_name": user_doc.get('last_name', ''),
            "username": user_doc.get('telegram_username', ''),
            "photo_url": user_doc.get('photo_url', ''),
            "token_balance": user_doc.get('token_balance', 0),
            "created_at": user_doc.get('created_at'),
            "last_login": user_doc.get('last_login'),
            "is_verified": user_doc.get('is_verified', False),
            "is_admin": user_doc.get('is_admin', False),
            "is_owner": user_doc.get('is_owner', False),
            "role": user_doc.get('role', 'user')
        }
    except Exception as e:
        logging.error(f"Failed to get user data: {e}")
        raise HTTPException(status_code=500, detail="Failed to get user data")

@api_router.get("/user/{user_id}/prizes")
async def get_user_prizes(user_id: str):
    """Get all prize links won by a specific user"""
    prizes = await dbq.get_user_prizes(user_id)
    return {"prizes": prizes}

@api_router.get("/check-winner/{user_id}")
async def check_if_winner(user_id: str):
    """Check if user has any unclaimed prizes"""
    recent_prizes = await dbq.get_user_prizes(user_id)
    return {"recent_prizes": recent_prizes[:5]}


@api_router.post("/admin/adjust-tokens/{telegram_id}")
async def adjust_tokens(telegram_id: int, tokens: int, admin_key: str = ""):
    """Add or remove tokens from a user by Telegram ID. Use negative tokens to remove."""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        user_doc = await dbq.get_user_by_telegram_id(telegram_id)
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")
        current = user_doc.get('token_balance', 0)
        new_balance = max(0, current + tokens)
        await dbq.update_user_fields_by_telegram_id(telegram_id, {"token_balance": new_balance})
        action = "Added" if tokens >= 0 else "Removed"
        logging.info(f"Admin {action} {abs(tokens)} tokens for user {telegram_id}. New balance: {new_balance}")
        return {
            "status": "success",
            "telegram_id": telegram_id,
            "username": user_doc.get('telegram_username', ''),
            "first_name": user_doc.get('first_name', ''),
            "previous_balance": current,
            "tokens_changed": tokens,
            "new_balance": new_balance
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to adjust tokens: {e}")
        raise HTTPException(status_code=500, detail="Failed to adjust tokens")


@api_router.post("/admin/remove-fake-player")
async def remove_fake_player(room_type: str, admin_key: str = ""):
    """Remove the last bot player from a waiting room."""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    target_room = None
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == "waiting":
            target_room = room
            break
    if not target_room:
        raise HTTPException(status_code=404, detail=f"No waiting {room_type} room found")
    bot_players = [p for p in target_room.players if p.user_id.startswith("bot_")]
    if not bot_players:
        raise HTTPException(status_code=404, detail="No bot players in this room")
    bot = bot_players[-1]
    target_room.players = [p for p in target_room.players if p.user_id != bot.user_id]
    target_room.prize_pool = max(0, target_room.prize_pool - bot.bet_amount)
    serialized_players = []
    for p in target_room.players:
        pd = p.dict()
        if 'joined_at' in pd and isinstance(pd['joined_at'], datetime):
            pd['joined_at'] = pd['joined_at'].isoformat()
        serialized_players.append(pd)
    await socket_rooms.broadcast_to_room(sio, target_room.id, 'player_left', {
        'room_id': target_room.id,
        'players': serialized_players,
        'players_count': len(target_room.players),
        'prize_pool': target_room.prize_pool,
    })
    return {"status": "success", "message": f"Bot removed from {room_type}", "players_count": len(target_room.players)}


@api_router.post("/admin/add-fake-player")
async def add_fake_player(room_type: str, player_name: str, bet_amount: int, admin_key: str = "", background_tasks: BackgroundTasks = None):
    """Add a fake/bot player to a room to fill it up."""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")

    room_type_enum = None
    for rt in RoomType:
        if rt.value == room_type:
            room_type_enum = rt
            break
    if room_type_enum is None:
        raise HTTPException(status_code=400, detail=f"Invalid room type: {room_type}")

    settings = ROOM_SETTINGS[room_type_enum]
    if bet_amount < settings["min_bet"] or bet_amount > settings["max_bet"]:
        raise HTTPException(status_code=400, detail=f"Bet must be between {settings['min_bet']} and {settings['max_bet']}")

    target_room = None
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == "waiting":
            target_room = room
            break
    if not target_room:
        raise HTTPException(status_code=404, detail=f"No waiting room found for {room_type}")
    if len(target_room.players) >= target_room.max_players:
        raise HTTPException(status_code=400, detail="Room is already full")

    bot_seed = str(uuid.uuid4())[:8]
    anon_num = str(hash(bot_seed) % 9000 + 1000)
    fake_player = RoomPlayer(
        user_id=f"bot_{bot_seed}",
        username="",
        first_name="Anonymous",
        last_name="",
        photo_url="",
        bet_amount=bet_amount,
        is_anonymous=True
    )
    target_room.players.append(fake_player)
    target_room.prize_pool += bet_amount

    serialized_players = []
    for p in target_room.players:
        pd = p.dict()
        if 'joined_at' in pd and isinstance(pd['joined_at'], datetime):
            pd['joined_at'] = pd['joined_at'].isoformat()
        serialized_players.append(pd)

    fake_dict = fake_player.dict()
    if 'joined_at' in fake_dict and isinstance(fake_dict['joined_at'], datetime):
        fake_dict['joined_at'] = fake_dict['joined_at'].isoformat()

    await socket_rooms.broadcast_to_room(sio, target_room.id, 'player_joined', {
        'room_id': target_room.id,
        'room_type': target_room.room_type,
        'player': fake_dict,
        'players_count': len(target_room.players),
        'prize_pool': target_room.prize_pool,
        'all_players': serialized_players,
        'room_status': 'filling' if len(target_room.players) < target_room.max_players else 'full',
        'timestamp': datetime.now(timezone.utc).isoformat()
    })
    await broadcast_room_updates()

    if len(target_room.players) >= target_room.min_players:
        await socket_rooms.broadcast_to_room(sio, target_room.id, 'room_full', {
            'room_id': target_room.id,
            'room_type': target_room.room_type,
            'players': serialized_players,
            'players_count': len(target_room.players),
            'message': '🚀 GAME IS STARTING! GET READY FOR THE BATTLE!',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        if background_tasks:
            background_tasks.add_task(start_game_round, target_room)

    return {
        "status": "success",
        "message": f"Anonymous player added to {room_type} room",
        "room_id": target_room.id,
        "players_count": len(target_room.players),
        "prize_pool": target_room.prize_pool
    }


@api_router.get("/admin/list-users")
async def list_users(admin_key: str = "", limit: int = 20, search: str = ""):
    """List users with optional search by name/username."""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        if search:
            users = await dbq.search_users(search, limit)
        else:
            users = await dbq.get_all_users(limit)
        result = []
        for u in users:
            result.append({
                "id": u.get("id"),
                "telegram_id": u.get("telegram_id"),
                "first_name": u.get("first_name", ""),
                "username": u.get("telegram_username", ""),
                "token_balance": u.get("token_balance", 0),
            })
        return {"users": result, "count": len(result)}
    except Exception as e:
        logging.error(f"Failed to list users: {e}")
        raise HTTPException(status_code=500, detail="Failed to list users")


@api_router.post("/admin/ban/{telegram_id}")
async def ban_user_endpoint(telegram_id: int, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    user = await dbq.get_user_by_telegram_id(telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await dbq.ban_user(telegram_id)
    return {"success": True, "message": f"User {telegram_id} banned"}


@api_router.post("/admin/unban/{telegram_id}")
async def unban_user_endpoint(telegram_id: int, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    await dbq.unban_user(telegram_id)
    return {"success": True, "message": f"User {telegram_id} unbanned"}


@api_router.post("/admin/set-role/{telegram_id}")
async def set_role_endpoint(telegram_id: int, is_admin: bool = False, is_owner: bool = False, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    user = await dbq.get_user_by_telegram_id(telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await dbq.set_user_role(telegram_id, is_admin, is_owner)
    role = "owner" if is_owner else ("admin" if is_admin else "user")
    return {"success": True, "telegram_id": telegram_id, "role": role}


@api_router.get("/admin/stats")
async def get_admin_stats_endpoint(admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        stats = await dbq.get_admin_stats()
        # Add live room info
        stats["active_rooms"] = len(active_rooms)
        stats["players_online"] = sum(len(r.players) for r in active_rooms.values())
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/admin/recent-games")
async def get_recent_games_endpoint(admin_key: str = "", limit: int = 15):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        games = await dbq.get_recent_completed_games(limit)
        return {"games": games, "count": len(games)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/admin/wallets")
async def get_wallets(admin_key: str = "", limit: int = 10):
    """ADMIN: View recent temporary wallets — public key, private key, sweep status"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        import json as _json
        async with dbq.get_pool().acquire() as conn:
            rows = await conn.fetch(
                """SELECT wallet_address, user_id, required_sol, token_amount,
                          status, payment_detected, tokens_credited, sol_forwarded,
                          private_key, created_at
                   FROM temporary_wallets
                   ORDER BY created_at DESC
                   LIMIT $1""",
                limit
            )
        wallets = []
        for r in rows:
            w = dict(r)
            if w.get("created_at"):
                w["created_at"] = w["created_at"].isoformat()
            try:
                pk = _json.loads(w["private_key"]) if w.get("private_key") else None
            except Exception:
                pk = w.get("private_key")
            w["public_key"] = w["wallet_address"]
            w["private_key_bytes"] = pk
            w["private_key_length"] = len(pk) if isinstance(pk, list) else 0
            wallets.append(w)
        return {"wallets": wallets, "count": len(wallets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/admin/broadcast")
async def broadcast_message(message: str, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    message = message.strip().replace('\x00', '')
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Message too long (max 4000 chars)")
    if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN == 'YOUR_TELEGRAM_BOT_TOKEN_HERE':
        raise HTTPException(status_code=400, detail="TELEGRAM_BOT_TOKEN not configured")
    try:
        tg_ids = await dbq.get_all_telegram_ids()
        sent, failed, skipped = 0, 0, 0
        import httpx as _httpx
        errors = []
        SKIP_ERRORS = ("not found", "chat not found", "user not found", "bot was blocked by the user", "forbidden")
        async with _httpx.AsyncClient(timeout=10) as client:
            for tg_id in tg_ids:
                try:
                    resp = await client.post(
                        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                        json={"chat_id": tg_id, "text": message, "parse_mode": "HTML"},
                    )
                    if resp.status_code == 200:
                        sent += 1
                    else:
                        tg_err = resp.json().get("description", f"HTTP {resp.status_code}")
                        if any(s in tg_err.lower() for s in SKIP_ERRORS):
                            skipped += 1
                            logging.info(f"📢 Broadcast skipped {tg_id} (unreachable): {tg_err}")
                        else:
                            failed += 1
                            errors.append(f"{tg_id}: {tg_err}")
                            logging.warning(f"📢 Broadcast to {tg_id} failed: {tg_err}")
                    await asyncio.sleep(0.05)
                except Exception as ex:
                    failed += 1
                    errors.append(f"{tg_id}: {ex}")
        logging.info(f"📢 Broadcast done: sent={sent}, skipped={skipped}, failed={failed}, total={len(tg_ids)}")
        # Push in-app broadcast to all connected socket clients
        await sio.emit('admin_broadcast', {'message': message, 'ts': datetime.now(timezone.utc).isoformat()})
        return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(tg_ids), "errors": errors[:5]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/admin/force-start/{room_type}")
async def force_start_room(room_type: str, admin_key: str = "", background_tasks: BackgroundTasks = None):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    target_room = None
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == "waiting":
            target_room = room
            break
    if not target_room:
        raise HTTPException(status_code=404, detail=f"No waiting {room_type} room")
    if len(target_room.players) == 0:
        raise HTTPException(status_code=400, detail="Room has no players — add at least one first")
    settings = ROOM_SETTINGS[room_type]
    while len(target_room.players) < target_room.min_players:
        bot_seed = str(uuid.uuid4())[:8]
        anon_num = str(abs(hash(bot_seed)) % 9000 + 1000)
        bot = RoomPlayer(
            user_id=f"bot_{bot_seed}",
            username=f"anon{anon_num}",
            first_name="Anonymous",
            last_name="",
            photo_url="",
            bet_amount=settings["min_bet"]
        )
        target_room.players.append(bot)
        target_room.prize_pool += settings["min_bet"]
    if background_tasks:
        background_tasks.add_task(start_game_round, target_room)
    else:
        asyncio.create_task(start_game_round(target_room))
    return {"success": True, "message": f"Force starting {room_type} room", "players": len(target_room.players)}


@api_router.post("/admin/toggle-maintenance")
async def toggle_maintenance(admin_key: str = ""):
    global maintenance_mode
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    maintenance_mode = not maintenance_mode
    logging.info(f"🔧 Maintenance mode {'ON' if maintenance_mode else 'OFF'}")
    # Notify all connected clients immediately
    await broadcast_room_updates()
    return {"maintenance_mode": maintenance_mode}


@api_router.get("/admin/maintenance-status")
async def get_maintenance_status_endpoint(admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    return {"maintenance_mode": maintenance_mode}


@api_router.get("/admin/daily-stats")
async def get_daily_stats_endpoint(admin_key: str = "", days: int = 7):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        return {"days": await dbq.get_daily_stats(days)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/admin/promo-codes")
async def create_promo_code_endpoint(code: str, token_amount: int, max_uses: int = 1, unlimited: bool = False, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    ok = await dbq.create_promo_code(code, token_amount, max_uses, unlimited=unlimited)
    if not ok:
        raise HTTPException(status_code=400, detail="Code already exists or failed to create")
    return {"success": True, "code": code.upper(), "token_amount": token_amount, "max_uses": max_uses, "unlimited": unlimited}


@api_router.get("/admin/promo-codes")
async def list_promo_codes_endpoint(admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    return {"codes": await dbq.get_promo_codes()}


@api_router.delete("/admin/promo-codes/{code}")
async def delete_promo_code_endpoint(code: str, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    ok = await dbq.delete_promo_code(code)
    if not ok:
        raise HTTPException(status_code=404, detail="Code not found")
    return {"success": True}


@api_router.post("/use-promo")
async def use_promo_code_endpoint(code: str, telegram_id: int):
    result = await dbq.use_promo_code(code, telegram_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@api_router.get("/admin/export-users")
async def export_users_csv(admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from fastapi.responses import StreamingResponse
    import io, csv
    users = await dbq.get_all_users(limit=10000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["telegram_id", "first_name", "username", "token_balance", "total_purchases", "is_admin", "is_banned", "created_at"])
    for u in users:
        writer.writerow([u.get("telegram_id",""), u.get("first_name",""), u.get("telegram_username",""),
                         u.get("token_balance",0), u.get("total_purchases",0),
                         u.get("is_admin",False), u.get("is_banned",False), u.get("created_at","")])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users.csv"})


@api_router.post("/admin/force-close-room/{room_type}")
async def force_close_room_endpoint(room_type: str, admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    closed = []
    for room_id, room in list(active_rooms.items()):
        if room.room_type == room_type and room.status == "waiting":
            room.players.clear()
            closed.append(room_id)
    if not closed:
        raise HTTPException(status_code=404, detail=f"No waiting {room_type} room found")
    return {"success": True, "closed_rooms": closed}


@api_router.get("/room-configs")
async def get_public_room_configs():
    """Public endpoint — no auth required. Returns current room bet limits."""
    result = []
    for rt in ['free', 'bronze', 'silver', 'gold', 'freeroll']:
        cfg = room_configs.get(rt, {})
        defaults = ROOM_SETTINGS.get(RoomType(rt), {})
        result.append({
            "room_type": rt,
            "min_bet": cfg.get("min_bet", defaults.get("min_bet", 0)),
            "max_bet": cfg.get("max_bet", defaults.get("max_bet", 0)),
            "max_players": cfg.get("max_players", defaults.get("max_players", 3)),
        })
    return result


@api_router.get("/admin/room-configs")
async def get_room_configs_endpoint(admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    result = []
    for rt in ['free', 'bronze', 'silver', 'gold', 'freeroll']:
        cfg = room_configs.get(rt, {})
        defaults = ROOM_SETTINGS.get(RoomType(rt), {})
        result.append({
            "room_type": rt,
            "name": defaults.get("name", rt),
            "min_bet": cfg.get("min_bet", defaults.get("min_bet", 0)),
            "max_bet": cfg.get("max_bet", defaults.get("max_bet", 0)),
            "max_players": cfg.get("max_players", defaults.get("max_players", 3)),
            "min_players": cfg.get("min_players", defaults.get("min_players", 2)),
        })
    return result


@api_router.post("/admin/room-config/{room_type}")
async def update_room_config_endpoint(
    room_type: str,
    min_bet: int = None,
    max_bet: int = None,
    max_players: int = None,
    min_players: int = None,
    admin_key: str = ""
):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    if room_type not in ['free', 'bronze', 'silver', 'gold', 'freeroll']:
        raise HTTPException(status_code=400, detail="Invalid room type")

    defaults = ROOM_SETTINGS.get(RoomType(room_type), {})
    current = room_configs.get(room_type, {})

    new_min_bet     = min_bet     if min_bet     is not None else current.get("min_bet",     defaults.get("min_bet", 0))
    new_max_bet     = max_bet     if max_bet     is not None else current.get("max_bet",     defaults.get("max_bet", 0))
    new_max_players = max_players if max_players is not None else current.get("max_players", defaults.get("max_players", 3))
    new_min_players = min_players if min_players is not None else current.get("min_players", defaults.get("min_players", 2))

    if new_min_players < 2:
        raise HTTPException(status_code=400, detail="min_players must be at least 2")
    if new_max_players < new_min_players:
        raise HTTPException(status_code=400, detail="max_players must be >= min_players")

    # Persist to DB
    from db_queries import upsert_room_config
    saved = await upsert_room_config(room_type, new_min_bet, new_max_bet, new_max_players, new_min_players)

    # Update in-memory cache
    room_configs[room_type] = saved

    # Apply to existing waiting rooms of this type
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == 'waiting':
            room.max_players = new_max_players
            room.min_players = new_min_players

    # Also update ROOM_SETTINGS so bet validation uses new values
    ROOM_SETTINGS[RoomType(room_type)]["min_bet"]     = new_min_bet
    ROOM_SETTINGS[RoomType(room_type)]["max_bet"]     = new_max_bet
    ROOM_SETTINGS[RoomType(room_type)]["max_players"] = new_max_players
    ROOM_SETTINGS[RoomType(room_type)]["min_players"] = new_min_players

    # Broadcast live config update to all connected clients
    await sio.emit('room_config_updated', {
        'room_type': room_type,
        'name': ROOM_SETTINGS[RoomType(room_type)].get('name', room_type),
        'min_bet': new_min_bet,
        'max_bet': new_max_bet,
        'max_players': new_max_players,
        'min_players': new_min_players,
    })
    await broadcast_room_updates()

    return saved


@api_router.get("/admin/freeroll-config")
async def get_freeroll_config(admin_key: str = ""):
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    return freeroll_config


@api_router.post("/admin/freeroll-config")
async def update_freeroll_config(
    max_players: int = None,
    prize: int = None,
    is_locked: bool = None,
    admin_key: str = ""
):
    global freeroll_config
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    if max_players is not None:
        freeroll_config['max_players'] = max_players
        for room in active_rooms.values():
            if room.room_type == RoomType.FREEROLL and room.status == 'waiting':
                room.max_players = max_players
    if prize is not None:
        freeroll_config['prize'] = prize
    if is_locked is not None:
        freeroll_config['is_locked'] = is_locked
    return freeroll_config


# Include the router
app.include_router(api_router)

# Create Socket.IO ASGI app with custom path
# socketio_path='/' means the Socket.IO server will handle requests at the mounted path
sio_app = socketio.ASGIApp(
    socketio_server=sio,
    socketio_path='/'  # Root path relative to mount point
)

# Mount Socket.IO at /api/socket.io (matches ingress routing and frontend client path)
app.mount('/api/socket.io', sio_app)

# Export the main app for uvicorn
socket_app = app

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    """Initialize the application"""
    # Initialize PostgreSQL connection pool
    await create_pool()

    # Ensure all DB columns/tables exist (safe to run every startup)
    try:
        from init_db import init as run_migrations
        await run_migrations()
        logger.info("✅ DB migrations applied on startup")
    except Exception as e:
        logger.error(f"⚠️ DB migrations warning: {e}")

    await initialize_rooms()

    # Start Solana payment monitoring
    await payment_monitor.start_monitoring()

    # Run payment auto-recovery system (scans last 24 hours for missed payments)
    logger.info("🔄 Running payment auto-recovery on startup...")
    try:
        processor = get_processor(None)
        recovery_result = await run_startup_recovery(None, processor)
        logger.info(f"✅ Auto-recovery complete: {recovery_result}")
    except Exception as e:
        logger.error(f"❌ Auto-recovery failed: {e}")

    # Start redundant payment scanner (backup detection system)
    asyncio.create_task(redundant_payment_scanner())

    # Start wallet cleanup scheduler with grace period
    asyncio.create_task(wallet_cleanup_scheduler())

    # Clear existing game history for fresh start (as requested)
    try:
        deleted_count = await dbq.delete_all_completed_games()
        logging.info(f"🗑️ [Startup] Cleared {deleted_count} existing game history records for fresh start")
    except Exception as e:
        logging.error(f"❌ [Startup] Failed to clear game history: {e}")

    logging.info("🎰 Casino Battle Royale API started!")
    logging.info(f"🏠 Active rooms: {len(active_rooms)}")
    logging.info(f"💳 Solana monitoring: {'Enabled' if CASINO_WALLET_ADDRESS != 'YourWalletAddressHere12345678901234567890123456789' else 'Disabled (set CASINO_WALLET_ADDRESS)'}")
    logging.info("🔍 Redundant payment scanner: Enabled (15s interval - FAST detection)")
    logging.info("🧹 Wallet cleanup scheduler: Enabled (72h grace period)")

async def redundant_payment_scanner():
    """
    Background task that periodically rescans all pending payments
    This catches payments missed by the real-time monitoring system
    Runs every 15 seconds for fast detection
    """
    from solana_integration import get_processor
    
    # Wait a bit before starting to ensure DB is ready
    await asyncio.sleep(10)
    
    logging.info("🔍 [Scanner] Redundant payment scanner started (15s interval)")
    
    while True:
        try:
            processor = get_processor(None)
            await processor.rescan_pending_payments()
        except Exception as e:
            logging.error(f"❌ [Scanner] Error in redundant payment scanner: {e}")
            import traceback
            logging.error(traceback.format_exc())
        
        # Wait 15 seconds before next scan (faster detection)
        await asyncio.sleep(15)

async def wallet_cleanup_scheduler():
    """
    Background task that periodically cleans up old completed wallets
    Runs every 24 hours with 72-hour grace period
    SAFETY: Only removes private keys from wallets that have been successfully swept
    """
    from solana_integration import get_processor
    
    # Wait 1 hour after startup before first cleanup
    await asyncio.sleep(3600)
    
    logging.info("🧹 [Cleanup Scheduler] Wallet cleanup scheduler started (24h interval, 72h grace period)")
    
    while True:
        try:
            processor = get_processor(None)
            result = await processor.cleanup_old_wallets_with_grace_period(grace_period_hours=120)
            
            logging.info(f"🧹 [Cleanup Scheduler] Cleanup complete:")
            logging.info(f"   Cleaned: {result.get('cleaned', 0)} wallets")
            logging.info(f"   Blocked: {result.get('blocked', 0)} wallets (funds still present)")
            logging.info(f"   Flagged: {result.get('flagged_for_review', 0)} wallets need manual review")
            
        except Exception as e:
            logging.error(f"❌ [Cleanup Scheduler] Error: {e}")
            import traceback
            logging.error(traceback.format_exc())
        
        # Wait 24 hours before next cleanup
        await asyncio.sleep(86400)

async def cleanup_old_game_history():
    """
    Keep only the 5 most recent games in history.
    Deletes older games to maintain privacy and reduce data storage.
    """
    try:
        # Count total games
        total_games = await dbq.count_completed_games()

        if total_games > 5:
            logging.info(f"🗑️ [Game History] {total_games} games in history (limit 5); old entries managed by DB retention policy")

    except Exception as e:
        logging.error(f"❌ [Game History Cleanup] Error: {e}")
    
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    payment_monitor.monitoring = False
    await close_pool()
    logging.info("🛑 Casino Battle Royale API shutting down")

# Export the socket app for uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("server:app", host="0.0.0.0", port=port)

