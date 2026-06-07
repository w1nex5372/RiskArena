from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks, Request, Response
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import socketio
from dotenv import load_dotenv
from database import create_pool, close_pool, get_pool
import db_queries as dbq
from pydantic import BaseModel, Field, ConfigDict, field_validator
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
from collections import defaultdict, deque
from urllib.parse import parse_qsl, urlencode
from http.cookies import SimpleCookie
# PostgreSQL via asyncpg (see database.py and db_queries.py)
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.system_program import transfer, TransferParams
import time
import base58
import uvicorn
import copy
import re
import sys
import math

# Load environment variables FIRST before importing modules that read them
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Import after .env is loaded so modules can read the environment
from solana_integration import SolanaPaymentProcessor, get_processor, PriceFetcher
from payment_recovery import run_startup_recovery
from rpc_monitor import rpc_alert_system
from manual_credit_logger import credit_tokens_manually, ManualCreditLogger
import socket_rooms
import arena_repo
import admin_gm
import event_effects
import progression as _progression
import daily_quests as _daily_quests
import daily_chest as _daily_chest
from auth import SESSION_COOKIE, create_session_token, get_authenticated_user_id, verify_session_token
from itemization import (
    SCROLL_SHOP,
    SCROLL_TYPES,
    aggregate_item_modifiers,
    battle_ability_allowed_for_class,
    battle_ability_cooldown_ms,
    battle_ability_stats,
    can_user_equip_item,
    choose_inventory_copy_for_equip,
    enchant_success_chance,
    item_stat_payload,
    is_enchantable_slot,
    is_shop_tier,
    max_enchant_for_tier,
    modifiers_to_dict,
    next_enchant_preview,
    resolve_effective_equipped_inventory_ids,
    resolve_enchant_attempt,
    stat_preview,
    tier_to_rarity,
)

# Get environment variables
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_DB   = os.environ.get('PG_DB', 'riskarena_db')
CORS_ORIGINS = [
    "https://riskarena.vercel.app",
    "https://www.riskarena.vercel.app",
    "http://localhost:3000",
    # Telegram WebApp origins  required for Mini App preflight requests
    "https://web.telegram.org",
    "https://telegram.org",
]
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN_HERE')
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get('RATE_LIMIT_WINDOW_SECONDS', '60'))
RATE_LIMIT_DEFAULT_MAX = int(os.environ.get('RATE_LIMIT_DEFAULT_MAX', '120'))
RATE_LIMIT_SENSITIVE_MAX = int(os.environ.get('RATE_LIMIT_SENSITIVE_MAX', '30'))
RATE_LIMIT_AUTH_MAX = int(os.environ.get('RATE_LIMIT_AUTH_MAX', '12'))
RATE_LIMIT_ADMIN_MAX = int(os.environ.get('RATE_LIMIT_ADMIN_MAX', '60'))

# Solana Configuration for devnet (test environment as requested)
SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.devnet.solana.com')
RISKARENA_WALLET_PRIVATE_KEY = os.environ.get('RISKARENA_WALLET_PRIVATE_KEY', '')
RISKARENA_WALLET_ADDRESS = os.environ.get('RISKARENA_WALLET_ADDRESS', 'YourWalletAddressHere12345678901234567890123456789')
ADMIN_KEY = os.environ.get('ADMIN_KEY', '')

def verify_admin_key(admin_key: str) -> bool:
    return bool(ADMIN_KEY) and secrets.compare_digest(admin_key or '', ADMIN_KEY)

_rate_limit_hits: Dict[str, deque] = defaultdict(deque)

def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get('x-forwarded-for')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.client.host if request.client else 'unknown'

def _rate_limit_for_path(path: str) -> int:
    if path.startswith('/api/auth/telegram'):
        return RATE_LIMIT_AUTH_MAX
    if path.startswith('/api/admin'):
        return RATE_LIMIT_ADMIN_MAX
    if (
        path.startswith('/api/join-room')
        or path.endswith('/payment-wallet')
        or path.startswith('/api/promo-codes/use')
    ):
        return RATE_LIMIT_SENSITIVE_MAX
    return RATE_LIMIT_DEFAULT_MAX

def _check_rate_limit(request: Request) -> bool:
    now = time.time()
    path = request.url.path
    limit = _rate_limit_for_path(path)
    key = f"{_client_ip(request)}:{request.method}:{path}"
    bucket = _rate_limit_hits[key]
    while bucket and now - bucket[0] > RATE_LIMIT_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True

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
                logging.info(f" Master wallet initialized: {self.master_keypair.pubkey()}")
            except Exception as e:
                logging.error(f"Error initializing master wallet: {e}")
                self.master_keypair = None
        else:
            self.master_keypair = None
    
    def derive_user_address(self, user_id: str, telegram_id: int) -> dict:
        """Derive a unique address for a user from master wallet"""
        try:
            # Create deterministic seed from user identifiers
            seed_string = f"riskarena_user_{user_id}_{telegram_id}"
            
            # Generate a random keypair and create a deterministic address string
            # This is simpler and more reliable than trying to create valid Solana keypairs
            seed_hash = hashlib.sha256(seed_string.encode()).digest()
            
            # Create a valid Solana address (base58 encoded, exactly 32 bytes)
            address_bytes = seed_hash[:32]  # Use exactly 32 bytes for valid Solana address
            derived_address = base58.b58encode(address_bytes).decode()
            
            # For demo purposes, we'll track this address but won't need the private key
            # In production, you'd use proper Solana keypair derivation libraries
            logging.info(f" Derived address for user {telegram_id}: {derived_address}")
            
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
            
            logging.info(f" Would sweep {sweep_amount} lamports from {derived_keypair.pubkey()} to {self.master_keypair.pubkey()}")
            # TODO: Implement actual transaction signing and sending
            
            return True
            
        except Exception as e:
            logging.error(f"Error sweeping funds: {e}")
            return False

# Initialize wallet derivation system
wallet_derivation = SolanaWalletDerivation(RISKARENA_WALLET_PRIVATE_KEY)

# PostgreSQL pool is initialized in the startup event (see lifespan below)

# FastAPI app
app = FastAPI(title="RiskArena API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if not _check_rate_limit(request):
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please try again later."},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )
    return await call_next(request)

@app.middleware("http")
async def admin_auth_middleware(request: Request, call_next):
    if not request.url.path.startswith("/api/admin"):
        return await call_next(request)

    query_pairs = parse_qsl(request.scope.get("query_string", b"").decode(), keep_blank_values=True)
    if any(key == "admin_key" for key, _ in query_pairs):
        return JSONResponse(
            status_code=400,
            content={"detail": "Admin key query authentication is disabled"},
        )

    header_admin_key = request.headers.get("x-admin-key", "")
    authorized = verify_admin_key(header_admin_key)

    if not authorized:
        try:
            user_id = get_authenticated_user_id(request)
            user_doc = await dbq.get_user_by_id(user_id)
            authorized = bool(
                user_doc
                and (
                    user_doc.get("is_admin")
                    or user_doc.get("is_owner")
                    or user_doc.get("role") in ("admin", "owner")
                )
            )
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    if not authorized:
        return JSONResponse(status_code=403, content={"detail": "Admin authentication required"})

    if not ADMIN_KEY:
        return JSONResponse(status_code=500, content={"detail": "ADMIN_KEY is not configured"})

    # Existing admin handlers still declare admin_key as a query parameter.
    # Inject it only after server-side auth so clients never send or see it.
    query_pairs.append(("admin_key", ADMIN_KEY))
    request.scope["query_string"] = urlencode(query_pairs).encode()
    return await call_next(request)

# Socket.IO setup
sio = socketio.AsyncServer(
    cors_allowed_origins=CORS_ORIGINS,
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
    RoomType.FREE:     {"min_bet": 0,   "max_bet": 0,    "name": "Free Room",  "min_players": 2, "max_players": 3,  "game_mode": "roulette"},
    RoomType.BRONZE:   {"min_bet": 0,   "max_bet": 0,    "name": "Bronze Room","min_players": 2, "max_players": 2,  "game_mode": "duel"},
    RoomType.SILVER:   {"min_bet": 350, "max_bet": 800,  "name": "Silver Room","min_players": 2, "max_players": 3,  "game_mode": "roulette"},
    RoomType.GOLD:     {"min_bet": 650, "max_bet": 1200, "name": "Gold Room",  "min_players": 2, "max_players": 3,  "game_mode": "roulette"},
    RoomType.FREEROLL: {"min_bet": 0,   "max_bet": 0,    "name": "Free Roll",  "min_players": 2, "max_players": 30, "game_mode": "roulette"},
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
    init_data: Optional[str] = None

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
    diamonds: int = Field(default=0)        # Premium currency (cases/energy reset later)
    is_verified: bool = Field(default=False)
    is_admin: bool = Field(default=False)
    is_owner: bool = Field(default=False)
    role: str = Field(default="user")  # user, admin, owner
    session_token: Optional[str] = None
    last_daily_claim: Optional[str] = None
    xp: int = Field(default=0)
    level: int = Field(default=1)
    class_name: Optional[str] = None
    character_build_json: Optional[Dict[str, Any]] = None
    character_spritesheet_path: Optional[str] = None
    character_spritesheet_hash: Optional[str] = None
    battle_spritesheet_path: Optional[str] = None
    battle_spritesheet_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    energy: Optional[int] = None
    max_energy: Optional[int] = None
    next_energy_at: Optional[str] = None

    @field_validator("character_build_json", mode="before")
    @classmethod
    def _parse_character_build_json(cls, value):
        if value is None or isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                return None
        return None

class UserCreate(BaseModel):
    telegram_auth_data: TelegramAuthData


VALID_CHARACTER_CLASSES = {"warrior", "mage", "rogue"}

DEFAULT_CHARACTER_BUILDS: Dict[str, Dict[str, Any]] = {
    "warrior": {
        "schemaVersion": "character_build.v1",
        "className": "warrior",
        "bodyType": "male",
        "layers": [
            {"slot": "body", "asset": "body.male", "variant": None},
            {"slot": "head", "asset": "head.human.male", "variant": None},
            {"slot": "face", "asset": "face.male.neutral", "variant": None},
            {"slot": "eyes", "asset": "eyes.human.neutral", "variant": "blue"},
            {"slot": "legs", "asset": "legs.pants2", "variant": "black"},
            {"slot": "feet", "asset": "feet.boots.rimmed", "variant": "black"},
            {"slot": "torso", "asset": "torso.jacket.collared", "variant": "brown"},
            {"slot": "hair", "asset": "hair.bedhead", "variant": "red"},
        ],
        "weapon": {"asset": "weapon.sword.katana", "enabled": False},
    },
    "rogue": {
        "schemaVersion": "character_build.v1",
        "className": "rogue",
        "bodyType": "male",
        "layers": [
            {"slot": "body", "asset": "body.male", "variant": None},
            {"slot": "head", "asset": "head.human.male", "variant": None},
            {"slot": "face", "asset": "face.male.neutral", "variant": None},
            {"slot": "eyes", "asset": "eyes.human.neutral", "variant": "gray"},
            {"slot": "legs", "asset": "legs.pants2", "variant": "brown"},
            {"slot": "feet", "asset": "feet.boots.rimmed", "variant": "leather"},
            {"slot": "torso", "asset": "torso.jacket.frock", "variant": "charcoal"},
            {"slot": "hair", "asset": "hair.bangslong", "variant": "brown"},
        ],
        "weapon": {"asset": "weapon.sword.scimitar", "enabled": False},
    },
    "mage": {
        "schemaVersion": "character_build.v1",
        "className": "mage",
        "bodyType": "male",
        "layers": [
            {"slot": "body", "asset": "body.male", "variant": None},
            {"slot": "head", "asset": "head.human.male", "variant": None},
            {"slot": "face", "asset": "face.male.neutral", "variant": None},
            {"slot": "eyes", "asset": "eyes.human.neutral", "variant": "blue"},
            {"slot": "legs", "asset": "legs.pants2", "variant": "navy"},
            {"slot": "feet", "asset": "feet.sandals", "variant": "leather"},
            {"slot": "torso", "asset": "torso.clothes.vest_open", "variant": "blue"},
            {"slot": "waist", "asset": "torso.waist.belt_robe", "variant": "teal"},
            {"slot": "hair", "asset": "hair.xlong", "variant": "blue"},
        ],
        "weapon": {"asset": "weapon.staff.mage_staff", "enabled": False},
    },
}

APP_DIR = Path(__file__).resolve().parent
RISKARENA_ROOT = Path(os.getenv("RISKARENA_ROOT") or APP_DIR.parent).resolve()
GENERATED_ASSET_ROOT = Path(os.getenv("GENERATED_ASSET_ROOT") or (RISKARENA_ROOT / "generated")).resolve()
GENERATED_CHARACTER_DIR = GENERATED_ASSET_ROOT / "characters"
SAFE_GENERATED_ID = re.compile(r"^[A-Za-z0-9_-]+$")

ALLOWED_CHARACTER_BUILD_ASSETS = {
    "body.male",
    "head.human.male",
    "face.male.neutral",
    "eyes.human.neutral",
    "legs.pants2",
    "feet.boots.rimmed",
    "feet.sandals",
    "torso.armour.plate",
    "torso.armour.leather",
    "torso.armour.legion",
    "torso.armour.chainmail",
    "torso.armour.bandage",
    "torso.clothes.vest_open",
    "torso.jacket.collared",
    "torso.jacket.frock",
    "torso.waist.belt_robe",
    "hair.bedhead",
    "hair.bangslong",
    "hair.xlong",
    "helmet.nasal",
    "helmet.flattop",
    "helmet.barbuta_simple",
    "helmet.sugarloaf_simple",
    "helmet.spangenhelm",
    "helmet.barbarian",
    "helmet.close",
    "helmet.barbuta",
    "helmet.sugarloaf",
    "helmet.barbarian_nasal",
    "helmet.spangenhelm_viking",
    "helmet.barbarian_viking",
    "helmet.greathelm",
}
ALLOWED_CHARACTER_WEAPONS = {
    "weapon.sword.katana",
    "weapon.sword.scimitar",
    "weapon.staff.mage_staff",
}
CLASS_CHARACTER_WEAPON = {
    "warrior": "weapon.sword.katana",
    "rogue": "weapon.sword.scimitar",
    "mage": "weapon.staff.mage_staff",
}
ALLOWED_CHARACTER_SLOTS = {"body", "head", "face", "eyes", "legs", "feet", "torso", "waist", "hair", "helmet"}
REQUIRED_CHARACTER_LAYER_SLOTS = {"body", "head", "face", "eyes"}


def _coerce_json_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _default_character_build(class_name: Optional[str]) -> Dict[str, Any]:
    cls = (class_name or "warrior").strip().lower()
    if cls not in DEFAULT_CHARACTER_BUILDS:
        cls = "warrior"
    return copy.deepcopy(DEFAULT_CHARACTER_BUILDS[cls])


def _with_required_character_layers(build: Dict[str, Any], class_name: Optional[str]) -> Dict[str, Any]:
    patched = copy.deepcopy(build)
    default_build = _default_character_build(patched.get("className") or class_name)
    layers = patched.get("layers")
    if not isinstance(layers, list):
        layers = []
    else:
        layers = copy.deepcopy(layers)
    seen_slots = {str(layer.get("slot") or "").strip().lower() for layer in layers if isinstance(layer, dict)}
    for default_layer in default_build.get("layers", []):
        slot = str(default_layer.get("slot") or "").strip().lower()
        if slot in REQUIRED_CHARACTER_LAYER_SLOTS and slot not in seen_slots:
            layers.append(copy.deepcopy(default_layer))
            seen_slots.add(slot)
    patched["layers"] = layers
    return patched


def _character_build_for_user_payload(user_payload: Dict[str, Any]) -> Dict[str, Any]:
    build = _coerce_json_dict(user_payload.get("character_build_json"))
    if build:
        try:
            return _validate_character_build(
                _with_required_character_layers(build, user_payload.get("class_name")),
                user_payload.get("class_name"),
            )
        except HTTPException:
            return _default_character_build(user_payload.get("class_name"))
    return _default_character_build(user_payload.get("class_name"))


def _stable_character_build_hash(build: Dict[str, Any]) -> str:
    raw = json.dumps(build, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _validate_character_build(build: Dict[str, Any], current_class_name: Optional[str]) -> Dict[str, Any]:
    if not isinstance(build, dict):
        raise HTTPException(status_code=400, detail="character_build must be an object")
    schema_version = build.get("schemaVersion")
    if schema_version != "character_build.v1":
        raise HTTPException(status_code=400, detail="Unsupported character_build schemaVersion")

    build_class = str(build.get("className") or current_class_name or "").strip().lower()
    if build_class not in VALID_CHARACTER_CLASSES:
        raise HTTPException(status_code=400, detail="className must be warrior, mage, or rogue")
    if current_class_name and str(current_class_name).lower() != build_class:
        raise HTTPException(status_code=400, detail="character_build className must match your active class")

    body_type = str(build.get("bodyType") or "male").strip().lower()
    if body_type != "male":
        raise HTTPException(status_code=400, detail="Only bodyType=male is supported in character_build.v1")

    build = _with_required_character_layers(build, build_class)
    layers = build.get("layers")
    if not isinstance(layers, list) or not layers:
        raise HTTPException(status_code=400, detail="character_build layers must be a non-empty list")
    normalized_layers: List[Dict[str, Any]] = []
    seen_slots = set()
    for layer in layers:
        if not isinstance(layer, dict):
            raise HTTPException(status_code=400, detail="Each character_build layer must be an object")
        slot = str(layer.get("slot") or "").strip().lower()
        asset = str(layer.get("asset") or "").strip()
        variant = layer.get("variant")
        if slot not in ALLOWED_CHARACTER_SLOTS:
            raise HTTPException(status_code=400, detail=f"Unsupported character_build slot: {slot}")
        if slot in seen_slots and slot != "torso":
            raise HTTPException(status_code=400, detail=f"Duplicate character_build slot: {slot}")
        if asset not in ALLOWED_CHARACTER_BUILD_ASSETS:
            raise HTTPException(status_code=400, detail=f"Unsupported character_build asset: {asset}")
        if variant is not None and not isinstance(variant, str):
            raise HTTPException(status_code=400, detail="character_build variant must be a string or null")
        seen_slots.add(slot)
        normalized_layers.append({"slot": slot, "asset": asset, "variant": variant})
    if "body" not in seen_slots:
        raise HTTPException(status_code=400, detail="character_build requires a body layer")

    weapon = build.get("weapon") or {"enabled": False}
    if not isinstance(weapon, dict):
        raise HTTPException(status_code=400, detail="character_build weapon must be an object")
    weapon_enabled = bool(weapon.get("enabled"))
    weapon_asset = weapon.get("asset")
    if weapon_enabled and weapon_asset not in ALLOWED_CHARACTER_WEAPONS:
        raise HTTPException(status_code=400, detail=f"Unsupported character_build weapon asset: {weapon_asset}")
    if weapon_enabled and weapon_asset != CLASS_CHARACTER_WEAPON.get(build_class):
        raise HTTPException(status_code=400, detail=f"Weapon asset does not match className={build_class}")

    return {
        "schemaVersion": "character_build.v1",
        "className": build_class,
        "bodyType": body_type,
        "layers": normalized_layers,
        "weapon": {"asset": weapon_asset, "enabled": weapon_enabled},
    }


def attach_session(response: Response, user_payload: dict) -> dict:
    token = create_session_token(user_payload["id"])
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        secure=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() not in ("0", "false", "no"),
        samesite=os.environ.get("SESSION_COOKIE_SAMESITE", "none"),
        max_age=int(os.environ.get("SESSION_TTL_SECONDS", "86400")),
    )
    enriched = dict(user_payload)
    enriched["session_token"] = token
    return enriched


class RoomPlayer(BaseModel):
    user_id: str
    username: str  # Telegram username (@username)
    first_name: str  # Telegram first name
    last_name: Optional[str] = None  # Telegram last name
    photo_url: Optional[str] = None  # Telegram profile photo
    bet_amount: int
    is_anonymous: bool = False
    level: int = Field(default=1)
    class_name: Optional[str] = None
    character_spritesheet_path: Optional[str] = None
    character_spritesheet_hash: Optional[str] = None
    battle_spritesheet_path: Optional[str] = None
    battle_spritesheet_hash: Optional[str] = None
    weapon: Optional[Dict[str, Any]] = None
    armor: Optional[Dict[str, Any]] = None
    ability: Optional[Dict[str, Any]] = None
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
    arena_match_id: Optional[str] = None  # Set for 1v1 Arena Duel rooms
    round_number: int = Field(default=1)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

class JoinRoomRequest(BaseModel):
    room_type: RoomType
    user_id: str
    bet_amount: int = Field(ge=0, le=1_000_000)
    is_anonymous: bool = False


async def _fetch_equipped_snapshot(user_id: str) -> Dict[str, Any]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ei.slot, ei.inventory_id, COALESCE(inv.enchant_level, 0) AS enchant_level, i.*
            FROM equipped_items ei
            JOIN users u ON u.id = ei.user_id
            JOIN items i ON i.id = ei.item_id
            LEFT JOIN LATERAL (
                SELECT id, enchant_level
                FROM inventory
                WHERE user_id = ei.user_id
                  AND item_id = ei.item_id
                  AND (ei.inventory_id IS NULL OR id = ei.inventory_id)
                ORDER BY
                    CASE WHEN id = ei.inventory_id THEN 0 ELSE 1 END,
                    acquired_at ASC,
                    id ASC
                LIMIT 1
            ) inv ON TRUE
            WHERE ei.user_id = $1
              AND ei.class_name = u.class_name
              AND (i.class_name = u.class_name OR i.class_name = 'any')
            """,
            user_id,
        )

    equipped: Dict[str, Any] = {"weapon": None, "armor": None, "ability": None, "helmet": None}
    for row in rows:
        slot = row["slot"]
        if slot in equipped:
            equipped[slot] = _serialize_equipped_row(row)
    return equipped


async def _get_and_regen_energy(user_id: str, conn) -> dict:
    """Returns current energy after applying hourly regen. Updates DB if regen occurred."""
    row = await conn.fetchrow(
        "SELECT energy, energy_last_regen FROM users WHERE id = $1", user_id
    )
    if not row:
        return {"energy": 0, "max_energy": 10, "next_energy_at": None}

    stored = int(row["energy"])
    last_regen = row["energy_last_regen"]
    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    if last_regen.tzinfo is None:
        last_regen = last_regen.replace(tzinfo=timezone.utc)

    max_energy = 10
    regen_multiplier = max(0.1, await event_effects.multiplier(conn, "energy_regen_multiplier"))
    regen_interval_seconds = 3600 / regen_multiplier
    if stored < max_energy:
        intervals_passed = int((now - last_regen).total_seconds() // regen_interval_seconds)
        regen = min(max_energy - stored, intervals_passed)
        if regen > 0:
            stored += regen
            last_regen = last_regen + timedelta(seconds=regen * regen_interval_seconds)
            await conn.execute(
                "UPDATE users SET energy = $1, energy_last_regen = $2 WHERE id = $3",
                stored, last_regen, user_id
            )

    next_energy_at = None
    if stored < max_energy:
        next_energy_at = (last_regen + timedelta(seconds=regen_interval_seconds)).isoformat()

    return {"energy": stored, "max_energy": max_energy, "next_energy_at": next_energy_at}


# In-memory storage for active rooms (in production, use Redis)
active_rooms: Dict[str, GameRoom] = {}
room_locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

# Maintenance mode  blocks new room joins (resets on restart)
maintenance_mode: bool = False

# Free Roll room global config
freeroll_config: dict = {"max_players": 30, "prize": 500, "is_locked": False}


def _session_token_from_socket(environ: Optional[Dict[str, Any]], auth: Optional[Dict[str, Any]] = None) -> str:
    if isinstance(auth, dict):
        token = str(auth.get("token") or auth.get("session_token") or "").strip()
        if token:
            return token

    environ = environ or {}
    auth_header = str(environ.get("HTTP_AUTHORIZATION") or environ.get("authorization") or "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()

    cookie_header = str(environ.get("HTTP_COOKIE") or "")
    if cookie_header:
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
            morsel = cookie.get(SESSION_COOKIE)
            if morsel:
                return morsel.value
        except Exception:
            return ""
    return ""


async def _authenticated_socket_user_id(sid: str, data: Optional[Dict[str, Any]] = None) -> Optional[str]:
    user_id = socket_to_user.get(sid)
    if user_id:
        return str(user_id)
    token = _session_token_from_socket(None, data)
    user_id = verify_session_token(token) if token else None
    if user_id:
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        return str(user_id)
    return None


def _user_is_in_room(room_id: str, user_id: str) -> bool:
    room = active_rooms.get(room_id)
    return bool(room and any(str(player.user_id) == str(user_id) for player in room.players))


# Telegram authentication functions
def verify_telegram_auth(auth_data: dict, bot_token: str) -> bool:
    """Verify Telegram WebApp initData using Telegram's HMAC check."""
    if not auth_data:
        logging.warning("No auth data provided")
        return False
    if not bot_token or bot_token == 'YOUR_TELEGRAM_BOT_TOKEN_HERE':
        logging.warning("Telegram bot token is not configured")
        return False

    required_fields = ['id', 'first_name', 'auth_date']
    for field in required_fields:
        if field not in auth_data:
            logging.warning(f"Missing required field: {field}")
            return False

    current_time = datetime.now(timezone.utc).timestamp()
    auth_time = auth_data.get('auth_date', 0)
    if current_time - int(auth_time) > 86400:
        logging.warning(f"Auth data too old: {current_time - int(auth_time)} seconds")
        return False

    raw_init_data = auth_data.get('init_data')
    if not raw_init_data and isinstance(auth_data.get('hash'), str) and '=' in auth_data['hash']:
        raw_init_data = auth_data['hash']

    if raw_init_data:
        pairs = dict(parse_qsl(raw_init_data, keep_blank_values=True))
        received_hash = pairs.pop('hash', None)
        if not received_hash:
            logging.warning("Telegram initData missing hash")
            return False
        data_check_string = '\n'.join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret_key = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
        expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected_hash, received_hash)

    received_hash = auth_data.get('hash')
    if not received_hash:
        return False
    check_data = {k: v for k, v in auth_data.items() if k not in ('hash', 'init_data') and v is not None}
    data_check_string = '\n'.join(f"{k}={v}" for k, v in sorted(check_data.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
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
        message = f" <b>Congratulations {username}!</b>\n\n"
        message += f"You won the {room_type.title()} Room battle!\n\n"
        message += " <b>You have a prize waiting!</b>\n"
        message += "Click the button below to claim your prize:"
        
        # Create inline keyboard with claim button
        reply_markup = {
            "inline_keyboard": [[
                {
                    "text": " Claim Your Prize",
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
        """Get current SOL price in EUR  Binance primary, CoinGecko fallback"""
        current_time = time.time()
        if self.cached_price and (current_time - self.last_update) < self.cache_duration:
            return self.cached_price

        # 1) Binance  no key needed, direct SOL/EUR pair
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
                        logging.info(f" SOL/EUR (Binance): {price}")
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
                        logging.info(f" SOL/EUR (CoinGecko): {price}")
                        return price
        except Exception as e:
            logging.error(f"CoinGecko price fetch failed: {e}")

        logging.error("All price sources failed, using cached/fallback")
        return self.cached_price or 120.0
    
    def calculate_tokens_from_sol(self, sol_amount: float, sol_eur_price: float) -> int:
        """Calculate tokens from SOL amount using real-time EUR price"""
        # SOL  EUR  Tokens (1 EUR = 100 tokens)
        eur_value = sol_amount * sol_eur_price
        tokens = int(eur_value * 100)
        
        logging.info(f" Conversion: {sol_amount} SOL  {sol_eur_price} EUR/SOL = {eur_value:.4f} EUR = {tokens} tokens")
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
        
        logging.info(f" Created derived address for user {telegram_id}: {derived_info['address']}")
        return {"address": derived_info["address"], "user_id": user_id, "telegram_id": telegram_id}
        
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
        logging.info(f" Starting payment monitoring for derived addresses")
        
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
            
            logging.info(f" Monitoring {len(self.monitored_addresses)} derived addresses")
            
        except Exception as e:
            logging.error(f"Error loading derived addresses: {e}")
    
    async def add_address_to_monitor(self, address: str):
        """Add a new derived address to monitoring"""
        self.monitored_addresses.add(address)
        logging.info(f" Added derived address to monitoring: {address}")
    
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
                    
                    logging.info(f" Received {sol_amount} SOL in transaction {signature} to derived address {receiving_address}")
                    
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
                logging.error(f" No user found for derived address {derived_address}! Payment of {sol_amount} SOL lost!")
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
                logging.error(f" No user found for telegram_id {telegram_id}! Payment of {sol_amount} SOL lost!")
                return

            # Production: Check for duplicate transactions (payment_history field not in PG schema; skip)

            # Credit tokens to user
            result = await dbq.increment_user_tokens_by_telegram_id(telegram_id, tokens_to_credit)

            if result:
                logging.info(f" Credited {tokens_to_credit} tokens to user {user['first_name']} for {sol_amount} SOL ({sol_amount * sol_eur_price:.2f})")
                
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
            
            message = " <b>Payment Confirmed!</b>\n\n"
            message += f"Hello {username}!\n\n"
            message += f" Received: <b>{sol_amount} SOL</b>\n"
            message += f" EUR Value: <b>{eur_value:.2f}</b> (1 SOL = {sol_eur_price:.4f})\n"
            message += f" Credited: <b>{tokens_credited:,} RiskArena Tokens</b>\n\n"
            message += f" <i>Rate: 1 EUR = 100 tokens</i>\n\n"
            message += "Your tokens are ready for battle! Good luck! "
            
            await send_telegram_message(telegram_id, message)
            logging.info(f" Payment confirmation sent to {username}")
            
        except Exception as e:
            logging.error(f"Error sending payment confirmation: {e}")

# Initialize payment monitor
payment_monitor = PaymentMonitor()

# Track user_id to socket_id mapping for room management
user_to_socket: Dict[str, str] = {}  # user_id -> sid
socket_to_user: Dict[str, str] = {}  # sid -> user_id

# Socket.IO events
@sio.event
async def connect(sid, environ, auth=None):
    logging.info(f" NEW CLIENT CONNECTED ")
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
    token = _session_token_from_socket(environ, auth)
    authenticated_user_id = verify_session_token(token) if token else None
    if authenticated_user_id:
        user_to_socket[authenticated_user_id] = sid
        socket_to_user[sid] = authenticated_user_id
        logging.info(f"Authenticated socket {sid[:8]} as user {authenticated_user_id}")
    
    await sio.emit('connected', {
        'status': 'Connected to RiskArena!',
        'socket_id': sid,
        'platform': platform,
        'authenticated': bool(authenticated_user_id),
    }, room=sid)
    logging.info(f" Sent 'connected' confirmation to {sid} ({platform})")

@sio.event
async def disconnect(sid):
    logging.info(f" Client {sid} disconnected")
    
    # Get user_id before cleanup
    user_id = socket_to_user.get(sid)
    
    # Get room_id from socket_rooms tracking
    room_id = socket_rooms.socket_to_room.get(sid)
    
    # Clean up socket from rooms ONLY
    socket_rooms.cleanup_socket(sid)
    if user_id and user_to_socket.get(user_id) == sid:
        user_to_socket.pop(user_id, None)
    socket_to_user.pop(sid, None)
    
    # DON'T immediately clean up user mapping or remove from game room
    # Give user 30 seconds to reconnect (Telegram browser often disconnects temporarily)
    # User mapping and room removal will be handled on reconnect timeout or manual leave
    logging.info(f" User {user_id} disconnected, keeping in room for potential reconnect")
    
    # DO NOT remove from active_rooms.players - let them stay in the game
    # They can still receive events when they reconnect

@sio.event
async def register_user(sid, data):
    """Register user_id to socket_id mapping for room-specific events"""
    try:
        logging.info(f" REGISTER_USER EVENT RECEIVED ")
        logging.info(f"Socket ID: {sid}")
        logging.info(f"Data: {data}")
        
        user_id = await _authenticated_socket_user_id(sid, data)
        platform = data.get('platform', 'unknown')
        
        if not user_id:
            logging.error(f" No user_id provided in register_user event")
            return
        
        # Update mappings
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        
        logging.info(f" Registered user {user_id} to socket {sid[:8]}")
        logging.info(f" Platform: {platform}")
        logging.info(f" Total user mappings: {len(user_to_socket)}")
        
        # Send confirmation
        await sio.emit('user_registered', {
            'user_id': user_id,
            'status': 'registered',
            'platform': platform
        }, room=sid)
        
    except Exception as e:
        logging.error(f" Error in register_user: {e}")

@sio.event
async def join_game_room(sid, data):
    """Join a game room via Socket.IO (called after successful REST API join)"""
    try:
        logging.info(f" JOIN_GAME_ROOM EVENT RECEIVED ")
        logging.info(f"Socket ID: {sid}")
        logging.info(f"Data: {data}")
        
        room_id = data.get('room_id')
        user_id = await _authenticated_socket_user_id(sid, data)
        platform = data.get('platform', 'unknown')
        
        if not room_id or not user_id:
            logging.error(f" Missing room_id or user_id in join_game_room event")
            logging.error(f"Received data: {data}")
            return
        if not _user_is_in_room(room_id, user_id):
            logging.warning(f"Rejected socket room join for user {user_id}: not a member of room {room_id}")
            await sio.emit('room_joined_confirmed', {'room_id': room_id, 'status': 'forbidden'}, room=sid)
            return
        
        logging.info(f" join_game_room: user={user_id}, room={room_id}, socket={sid[:8]}, platform={platform}")
        
        # Join the Socket.IO room
        await socket_rooms.join_socket_room(sio, sid, room_id)
        
        # Update user mapping
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        
        # Check current socket count in room
        socket_count = socket_rooms.get_room_socket_count(room_id)
        sockets_in_room = socket_rooms.room_to_sockets.get(room_id, set())
        
        logging.info(f" User {user_id} ({platform}) joined room {room_id} via socket {sid[:8]}")
        logging.info(f" Room {room_id} now has {socket_count} socket(s) connected")
        logging.info(f" Socket IDs in room: {[s[:8] for s in sockets_in_room]}")
        
        # Send confirmation with full room info
        await sio.emit('room_joined_confirmed', {
            'room_id': room_id,
            'socket_count': socket_count,
            'socket_id': sid,
            'platform': platform
        }, room=sid)
        logging.info(f" Sent room_joined_confirmed to {sid[:8]} ({platform})")
        
    except Exception as e:
        logging.error(f" Error in join_game_room: {e}")
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
    """Select winner using cryptographically secure weighted random  bigger bets = better odds."""
    if not players:
        raise ValueError("No players to select from")

    total_pool = sum(p.bet_amount for p in players)

    if total_pool == 0:
        # Free room: all equal weight  pick uniformly
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
    emoji = data.get('emoji', '')
    name = data.get('name', 'Player')
    user_id = await _authenticated_socket_user_id(sid, data)
    if not room_id:
        return
    if not user_id or not _user_is_in_room(room_id, user_id):
        return
    # Broadcast globally  client filters by room_id (same pattern as game events)
    await sio.emit('reaction_received', {
        'emoji': emoji,
        'name': name,
        'user_id': user_id,
        'room_id': room_id,
    })
    logging.info(f" Reaction {emoji} from {name} in room {room_id[:8]}")


# In-memory chat history per room (last 50 messages)
room_chat: dict = {}

@sio.event
async def lobby_message(sid, data):
    """Send a chat message to all players in the lobby room."""
    room_id = data.get('room_id')
    user_id = await _authenticated_socket_user_id(sid, data)
    name = data.get('name', 'Player')
    text = (data.get('text') or '').strip()[:200]
    is_anonymous = data.get('is_anonymous', False)

    if not room_id or not text:
        return
    if not user_id or not _user_is_in_room(room_id, user_id):
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
    logging.info(f" Chat [{room_id[:8]}] {name}: {text[:40]}")


@sio.event
async def reveal_identity(sid, data):
    """Player reveals their identity after joining anonymously"""
    room_id = data.get('room_id')
    user_id = await _authenticated_socket_user_id(sid, data)
    if not room_id or not user_id:
        return
    if not _user_is_in_room(room_id, user_id):
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
    logging.info(f" Player {user_id} revealed identity in room {room_id[:8]}")


@sio.event
async def catch_all(event, sid, data):
    """Catch all events for debugging"""
    logging.info(f" CATCH-ALL: Event '{event}' from {sid[:8]} with data: {data}")

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
                'match_id': room.match_id,
                'arena_match_id': room.arena_match_id,
                'mode': 'duel' if room.arena_match_id else None,
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


def is_arena_duel_room(room: GameRoom) -> bool:
    return (
        room.room_type == RoomType.BRONZE
        and len(room.players) == 2
        and all(not p.user_id.startswith("bot_") for p in room.players)
    )


async def start_game_round(room: GameRoom):
    """Start a game round when enough players have joined - with strict event sequence"""
    async with room_locks[room.id]:
        if room.status != "waiting" or len(room.players) < room.min_players:
            return
        room.status = "starting"

    if is_arena_duel_room(room):
        room.status = "ready"
        room.prize_pool = sum(p.bet_amount for p in room.players)
        room.started_at = datetime.now(timezone.utc)
        try:
            arena_match = await arena_repo.create_room_duel(
                room.players[0].user_id,
                room.players[1].user_id,
                room.players[0].bet_amount,
                room.id,
                room.room_type.value if hasattr(room.room_type, "value") else str(room.room_type),
                pot_amount=room.prize_pool,
            )
        except Exception as exc:
            logging.error(f"Failed to create arena duel for room {room.id}: {exc}")
            refund_players = [p for p in room.players if not p.user_id.startswith("bot_") and p.bet_amount > 0]
            room.players = []
            room.prize_pool = 0
            room.status = "waiting"
            room.started_at = None
            for player in refund_players:
                try:
                    result = await dbq.increment_user_tokens(player.user_id, player.bet_amount)
                    sid = user_to_socket.get(player.user_id)
                    if sid and result:
                        await sio.emit(
                            "balance_updated",
                            {"user_id": player.user_id, "new_balance": result.get("token_balance", 0)},
                            room=sid,
                        )
                except Exception as refund_exc:
                    logging.error(f"Failed to refund arena start failure for {player.user_id}: {refund_exc}")
            await broadcast_room_updates()
            return

        room.match_id = arena_match["id"]
        room.arena_match_id = arena_match["id"]

        serialized_players = []
        for p in room.players:
            player_dict = p.dict()
            if "joined_at" in player_dict and isinstance(player_dict["joined_at"], datetime):
                player_dict["joined_at"] = player_dict["joined_at"].isoformat()
            serialized_players.append(player_dict)

        payload = {
            "room_id": room.id,
            "room_type": room.room_type,
            "match_id": arena_match["id"],
            "arena_match_id": arena_match["id"],
            "mode": "duel",
            "players": serialized_players,
            "prize_pool": room.prize_pool,
            "stake_amount": room.players[0].bet_amount,
            "message": "Arena duel is ready",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await socket_rooms.broadcast_to_room(sio, room.id, "room_ready", payload)
        await socket_rooms.broadcast_to_room(sio, room.id, "game_starting", payload)
        asyncio.create_task(watch_arena_room_completion(room.id, arena_match["id"]))
        await broadcast_room_updates()
        logging.info(f"Arena duel bridge created match {arena_match['id']} for room {room.id}")
        return
    
    # Generate unique match ID for this game
    match_id = str(uuid.uuid4())[:12]  # Short unique ID
    room.match_id = match_id  # Store on room for polling clients
    logging.info(f" Starting game round for room {room.id}, match_id: {match_id}")
    logging.info(f" Players in room: {[p.username for p in room.players]}")

    # Set status IMMEDIATELY  polling clients detect this within 500ms
    room.status = "ready"
    room.prize_pool = sum(p.bet_amount for p in room.players)

    # Serialize player data
    serialized_players = []
    for p in room.players:
        player_dict = p.dict()
        if 'joined_at' in player_dict and isinstance(player_dict['joined_at'], datetime):
            player_dict['joined_at'] = player_dict['joined_at'].isoformat()
        serialized_players.append(player_dict)

    # Broadcast room_ready globally (socket fallback  polling is the primary mechanism)
    room_ready_data = {
        'room_id': room.id,
        'room_type': room.room_type,
        'match_id': match_id,
        'players': serialized_players,
        'prize_pool': room.prize_pool,
        'message': ' GET READY FOR BATTLE!',
    }
    await sio.emit('room_ready', room_ready_data)
    logging.info(f" room_ready emitted globally, match {match_id}")

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
                logging.info(f" Credited {credit_amount} tokens to winner {winner.username} (new balance: {result.get('token_balance', 0)})")
                winner_sid = user_to_socket.get(winner.user_id)
                if winner_sid:
                    await sio.emit('balance_updated', {'user_id': winner.user_id, 'new_balance': result.get('token_balance', 0)}, room=winner_sid)
            else:
                logging.error(f" Winner user {winner.user_id} not found in DB  balance NOT credited")
        except Exception as e:
            logging.error(f" Failed to credit winner balance: {e}")

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
    logging.info(f" Broadcasting game_finished to room {room.id}")
    
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
    logging.info(f" Emitted game_finished globally, winner: {winner.username}, match_id: {match_id}")

    # Wait for winner announcement screen (8 seconds so players can see it)
    logging.info(f" Waiting 8 seconds for winner announcement...")
    await asyncio.sleep(8)

    # EVENT 4: redirect_home - Redirect all players back to home screen
    final_sockets = socket_rooms.room_to_sockets.get(room.id, set())
    socket_count = len(final_sockets)

    logging.info(f" BROADCASTING redirect_home to room {room.id}")
    logging.info(f" Target sockets: {[sid[:8] for sid in final_sockets]}")
    logging.info(f" Socket count: {socket_count}")

    redirect_home_data = {
        'room_id': room.id,
        'match_id': match_id,
        'message': 'Returning to home screen...'
    }
    # Broadcast redirect_home to ALL clients - client filters by player list
    await sio.emit('redirect_home', redirect_home_data)
    logging.info(f" Emitted redirect_home globally for match {match_id}")
    
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
        logging.info(f" Sent private prize_won event to winner {winner.username}, match_id: {match_id}")
    else:
        logging.warning(f" Could not find socket for winner {winner.user_id} to send prize_won event")
    
    # Save completed game to database
    try:
        game_doc = room.dict()
        # Normalize enum to plain string value
        rt = game_doc.get('room_type')
        game_doc['room_type'] = rt.value if hasattr(rt, 'value') else str(rt).split('.')[-1].lower()
        # Keep datetimes as objects  insert_completed_game uses _to_dt() helper
        # (no need to call .isoformat() here; that caused the previous asyncpg bug)
        
        await dbq.insert_completed_game(game_doc)

        # Save pending result for all participants  cleared client-side on redirect_home if they were online
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

    logging.info(f" Created new {room.room_type} room {new_room.id}, round #{new_room.round_number}")

    # Notify clients about new room (global broadcast)
    await sio.emit('new_room_available', {
        'room_id': new_room.id,
        'room_type': new_room.room_type,
        'round_number': new_room.round_number
    })
    
    
    # Broadcast updated room states (global broadcast)
    await broadcast_room_updates()


async def watch_arena_room_completion(room_id: str, arena_match_id: str):
    last_round_seen = 1  # round 1 is open at match creation; only emit on advances
    max_iterations = 3600  # safety cap: 30 min at 2 s/poll
    iterations = 0
    while iterations < max_iterations:
        iterations += 1
        await asyncio.sleep(2)
        try:
            match = await arena_repo.get_match(arena_match_id)
        except Exception as exc:
            logging.error(f"[Arena] Failed to watch match {arena_match_id}: {exc}")
            continue

        if not match:
            logging.warning(f"[Arena] Match {arena_match_id} not found in DB, stopping watcher")
            break

        # Push round-advance notification so clients don't wait for the next poll
        current_round = match.get("round_number", 1)
        if current_round > last_round_seen and match.get("status") == "active":
            last_round_seen = current_round
            room = active_rooms.get(room_id)
            if room and room.arena_match_id == arena_match_id:
                await socket_rooms.broadcast_to_room(sio, room_id, "match_update", {
                    "arena_match_id": arena_match_id,
                    "room_id": room_id,
                    "round_number": current_round,
                    "player_one_hp": match.get("player_one_hp"),
                    "player_two_hp": match.get("player_two_hp"),
                    "status": "active",
                })

        if match.get("status") not in ("finished", "draw", "cancelled"):
            continue

        room = active_rooms.get(room_id)
        if not room or room.arena_match_id != arena_match_id:
            return

        room.status = "finished"
        room.finished_at = datetime.now(timezone.utc)
        winner_user_id = match.get("winner_user_id")
        if winner_user_id:
            room.winner = next((p for p in room.players if p.user_id == winner_user_id), None)

        _meta = match.get("metadata") or {}
        if isinstance(_meta, str):
            try: _meta = json.loads(_meta)
            except Exception: _meta = {}
        _streak_results = _meta.get("streak_results", {})
        _winner_streak = _streak_results.get(str(winner_user_id), {}) if winner_user_id else {}

        await socket_rooms.broadcast_to_room(sio, room_id, "arena_match_finished", {
            "room_id": room.id,
            "room_type": room.room_type,
            "match_id": arena_match_id,
            "arena_match_id": arena_match_id,
            "mode": "duel",
            "status": match.get("status"),
            "winner_user_id": winner_user_id,
            "payout_amount": match.get("payout_amount", 0),
            "finished_at": room.finished_at.isoformat(),
            "winner_streak": _winner_streak.get("streak", 0),
            "streak_bonus": _winner_streak.get("bonus", 0),
            "streak_is_record": _winner_streak.get("is_record", False),
        })

        # Persist arena result to completed_games so it shows in game history
        try:
            serialized_players = []
            for p in room.players:
                player_dict = p.dict()
                if "joined_at" in player_dict and isinstance(player_dict["joined_at"], datetime):
                    player_dict["joined_at"] = player_dict["joined_at"].isoformat()
                serialized_players.append(player_dict)
            room_type_str = (
                room.room_type.value
                if hasattr(room.room_type, "value")
                else str(room.room_type).split(".")[-1].lower()
            )
            game_doc = {
                "id": room.id,
                "room_type": room_type_str,
                "players": serialized_players,
                "status": match.get("status", "finished"),
                "prize_pool": room.prize_pool,
                "winner": room.winner.dict() if room.winner else None,
                "prize_link": None,
                "match_id": arena_match_id,
                "round_number": room.round_number,
                "created_at": room.created_at,
                "started_at": room.started_at,
                "finished_at": room.finished_at,
            }
            await dbq.insert_completed_game(game_doc)
        except Exception as exc:
            logging.error(f"[Arena] Failed to save completed game: {exc}")

        await asyncio.sleep(8)
        current_room = active_rooms.get(room_id)
        if current_room and current_room.arena_match_id == arena_match_id:
            del active_rooms[room_id]

            new_room = GameRoom(
                room_type=room.room_type,
                round_number=room.round_number + 1,
            )
            cfg = room_configs.get(room.room_type, {})
            defaults = ROOM_SETTINGS.get(RoomType(room.room_type), {})
            new_room.max_players = cfg.get("max_players", defaults.get("max_players", 3))
            new_room.min_players = cfg.get("min_players", defaults.get("min_players", 2))
            active_rooms[new_room.id] = new_room
            await broadcast_room_updates()
        return
    else:
        logging.warning(
            f"[Arena] Watcher for match {arena_match_id} reached max_iterations limit "
                    f"({max_iterations} polls), stopping without resolution"
                )


# Initialize rooms
async def initialize_rooms():
    """Create initial rooms for all room types, applying DB room configs"""
    from db_queries import get_all_room_configs
    try:
        configs = await get_all_room_configs()
        for cfg in configs:
            room_configs[cfg['room_type']] = cfg
        logging.info(f"Loaded {len(configs)} room configs from DB")
    except Exception as e:
        logging.warning(f"Could not load room configs from DB (using defaults): {e}")

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
        logging.info(f"Created {room_type} room {room.id} (min={room.min_players}, max={room.max_players})")

# API Routes
@api_router.get("/")
async def root():
    return {"message": "RiskArena API"}

@api_router.get("/user/{user_id}/derived-wallet")
async def get_user_derived_wallet(user_id: str, http_request: Request):
    """Get user's personal derived Solana address for payments"""
    try:
        authenticated_user_id = get_authenticated_user_id(http_request)
        if str(user_id) != str(authenticated_user_id):
            raise HTTPException(status_code=403, detail="Authenticated user mismatch")
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
                "description": f"1 EUR = 100 tokens (1 SOL = {sol_eur_price})"
            },
            "instructions": f"Send SOL to YOUR personal address above. Tokens credited automatically! 1 SOL = {int(sol_eur_price * 100)} tokens"
        }
        
    except HTTPException:
        raise
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

@api_router.get("/riskarena-wallet")
async def get_riskarena_wallet():
    """Get RiskArena wallet address and current pricing"""
    try:
        sol_price = await price_oracle.get_sol_eur_price()
        return {
            "wallet_address": RISKARENA_WALLET_ADDRESS,
            "network": "devnet",
            "current_sol_eur_price": sol_price,
            "conversion_rate": {
                "eur_to_tokens": 100,
                "description": "1 EUR = 100 RiskArena tokens (real-time SOL pricing)"
            },
            "instructions": "Users get personal derived addresses for payments"
        }
    except Exception as e:
        logging.error(f"Error getting RiskArena wallet info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get wallet info")

@api_router.post("/admin/add-tokens")
async def add_tokens_to_user(admin_key: str, username: str, tokens: int):
    """Add tokens to a specific user by username"""
    
    if not verify_admin_key(admin_key):
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
                "telegram_id": -(abs(hash(username)) % 999_999_999 + 1),  # Negative ID  never conflicts with real Telegram IDs
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
    
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    try:
        # Find user by telegram_id
        user_doc = await dbq.get_user_by_telegram_id(telegram_id)

        if user_doc:
            # Update existing user's balance
            await dbq.increment_user_tokens_by_telegram_id(telegram_id, tokens)

            new_balance = user_doc.get('token_balance', 0) + tokens

            logging.info(f" Added {tokens} tokens to Telegram user {telegram_id}. New balance: {new_balance}")
            
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


@api_router.post("/admin/add-diamonds/{telegram_id}")
async def add_diamonds_by_telegram_id(telegram_id: int, admin_key: str, diamonds: int):
    """Grant diamonds (premium currency) to a user by Telegram ID. Admin only."""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        updated = await dbq.increment_user_diamonds_by_telegram_id(telegram_id, diamonds)
        if not updated:
            return {
                "status": "user_not_found",
                "message": f"User with Telegram ID {telegram_id} not found (or balance would go negative).",
                "telegram_id": telegram_id,
            }
        new_balance = updated.get("diamonds", 0)
        logging.info(f" Added {diamonds} diamonds to Telegram user {telegram_id}. New balance: {new_balance}")
        return {
            "status": "success",
            "message": f"Added {diamonds} diamonds to Telegram user {telegram_id}",
            "new_diamonds": new_balance,
            "user_id": updated.get("id"),
        }
    except Exception as e:
        logging.error(f"Failed to add diamonds by Telegram ID: {e}")
        raise HTTPException(status_code=500, detail="Failed to add diamonds")

@api_router.post("/admin/cleanup-database")
async def cleanup_database_for_production(admin_key: str):
    """ADMIN ONLY: Clean database for production launch"""
    try:
        # Simple admin key check (in production, use proper authentication)
        if not verify_admin_key(admin_key):
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Clear ALL tables completely
        delete_result = await dbq.delete_all_data()

        logging.info(" COMPLETE DATABASE WIPE FINISHED")
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
    if not verify_admin_key(admin_key):
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
async def telegram_auth(user_data: UserCreate, response: Response):
    """Authenticate user with Telegram data"""
    telegram_data = user_data.telegram_auth_data
    
    # Log the incoming data for debugging
    logging.info(f" Telegram auth attempt for user ID: {telegram_data.id}")
    logging.info(f" Full auth data: id={telegram_data.id}, first_name={telegram_data.first_name}, username={telegram_data.username}")
    
    # For Telegram Web App, be more permissive with authentication
    # Basic validation - user must have ID and first name
    if not telegram_data.id or not telegram_data.first_name:
        raise HTTPException(status_code=400, detail="Missing required Telegram user data")
    
    if not verify_telegram_auth(telegram_data.dict(), TELEGRAM_BOT_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid Telegram authentication")

    logging.info(f" Authenticating Telegram user: {telegram_data.first_name} (ID: {telegram_data.id})")
    
    # Check if user already exists
    logging.info(f" Searching for existing user with telegram_id={telegram_data.id} in database")
    existing_user = await dbq.get_user_by_telegram_id(telegram_data.id)
    logging.info(f" Search result: {'FOUND' if existing_user else 'NOT FOUND'}")

    if existing_user:
        now_utc = datetime.now(timezone.utc)
        last_login_raw = existing_user.get('last_login')
        if isinstance(last_login_raw, str):
            last_login_raw = datetime.fromisoformat(last_login_raw)

        # Award daily login XP if last login was on a previous calendar day
        gave_daily_xp = False
        if last_login_raw is None or last_login_raw.date() < now_utc.date():
            cur_xp = int(existing_user.get('xp') or 0)
            async with get_pool().acquire() as _conn:
                daily_xp = round(_progression.XP_DAILY_LOGIN * await event_effects.multiplier(_conn, "xp_multiplier"))
                xp_res = _progression.award_xp_result(cur_xp, daily_xp)
                await _conn.execute(
                    "UPDATE users SET xp = $2, level = $3, last_login = $4 WHERE telegram_id = $1",
                    telegram_data.id, xp_res["new_xp"], xp_res["new_level"], now_utc,
                )
            gave_daily_xp = True
        else:
            await dbq.update_user_fields_by_telegram_id(
                telegram_data.id,
                {"last_login": now_utc.isoformat()},
            )

        existing_user = await dbq.get_user_by_telegram_id(telegram_data.id)

        if isinstance(existing_user['created_at'], str):
            existing_user['created_at'] = datetime.fromisoformat(existing_user['created_at'])
        if isinstance(existing_user['last_login'], str):
            existing_user['last_login'] = datetime.fromisoformat(existing_user['last_login'])

        logging.info(
            f" Returning existing user: {existing_user['first_name']} "
            f"balance={existing_user.get('token_balance', 0)} "
            f"xp={existing_user.get('xp', 0)} daily_xp={gave_daily_xp}"
        )
        async with get_pool().acquire() as _econn:
            energy_data = await _get_and_regen_energy(str(existing_user['id']), _econn)
        user_payload = attach_session(response, existing_user)
        user_payload.update(energy_data)
        user_payload.update(await _character_preview_fields_for_user(existing_user))
        user_payload.update(await _runtime_character_sprite_payload_for_user(str(existing_user["id"])))
        return User(**user_payload)
    
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

        await dbq.update_user_fields_by_telegram_id(telegram_data.id, update_fields)
        existing_user = await dbq.get_user_by_telegram_id(telegram_data.id)

        if isinstance(existing_user.get('created_at'), str):
            existing_user['created_at'] = datetime.fromisoformat(existing_user['created_at'])
        if isinstance(existing_user.get('last_login'), str):
            existing_user['last_login'] = datetime.fromisoformat(existing_user['last_login'])

        logging.info(
            " Returning concurrently created user %s (telegram_id: %s) with balance %s",
            existing_user.get('first_name', ''),
            telegram_data.id,
            existing_user.get('token_balance', 0)
        )
        async with get_pool().acquire() as _econn2:
            energy_data2 = await _get_and_regen_energy(str(existing_user['id']), _econn2)
        user_payload2 = attach_session(response, existing_user)
        user_payload2.update(energy_data2)
        user_payload2.update(await _character_preview_fields_for_user(existing_user))
        user_payload2.update(await _runtime_character_sprite_payload_for_user(str(existing_user["id"])))
        return User(**user_payload2)

    logging.info(f" Created new user: {user.first_name} (telegram_id: {user.telegram_id})")

    new_user_payload = attach_session(response, user.dict())
    new_user_payload.update({"energy": 10, "max_energy": 10, "next_energy_at": None})
    new_user_payload.update(await _character_preview_fields_for_user(new_user_payload))
    new_user_payload.update({"battle_spritesheet_path": "", "battle_spritesheet_hash": ""})
    return User(**new_user_payload)


@api_router.get("/auth/dev")
async def dev_auth(response: Response, username: str = "DevUser", uid: int = 1):
    """Local dev only  requires ALLOW_INSECURE_DEV_AUTH=true in .env"""
    if not os.getenv("ALLOW_INSECURE_DEV_AUTH"):
        raise HTTPException(status_code=403, detail="Dev auth disabled")
    fake_telegram_id = 9_900_000_000 + uid
    existing = await dbq.get_user_by_telegram_id(fake_telegram_id)
    if existing:
        payload = attach_session(response, existing)
        async with get_pool().acquire() as conn:
            energy_data = await _get_and_regen_energy(str(existing["id"]), conn)
        payload.update(energy_data)
        payload.update(await _character_preview_fields_for_user(existing))
        payload.update(await _runtime_character_sprite_payload_for_user(str(existing["id"])))
        return User(**payload)
    new_user = User(
        telegram_id=fake_telegram_id,
        first_name=username,
        telegram_username=username,
        token_balance=10_000,
        is_verified=True,
    )
    user_dict = new_user.dict()
    user_dict["created_at"] = user_dict["created_at"].isoformat()
    user_dict["last_login"] = user_dict["last_login"].isoformat()
    await dbq.insert_user(user_dict)
    created = await dbq.get_user_by_telegram_id(fake_telegram_id)
    payload = attach_session(response, created)
    payload.update({"energy": 10, "max_energy": 10, "next_energy_at": None})
    payload.update(await _character_preview_fields_for_user(created))
    payload.update({"battle_spritesheet_path": "", "battle_spritesheet_hash": ""})
    return User(**payload)


# Solana Token Purchase Endpoints
class TokenPurchaseRequest(BaseModel):
    token_amount: int = Field(gt=0, description="Number of tokens to purchase")

@api_router.post("/purchase-tokens")
async def initiate_token_purchase(request: TokenPurchaseRequest, http_request: Request):
    """
    Create a unique wallet address for token purchase
    Returns wallet address and payment instructions
    """
    try:
        user_id = get_authenticated_user_id(http_request)
        # Validate user exists
        user = await dbq.get_user_by_id(user_id)
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
            user_id=user_id,
            token_amount=request.token_amount
        )
        
        logging.info(f"Token purchase initiated: {user_id} -> {request.token_amount} tokens")
        
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
async def get_purchase_status(user_id: str, wallet_address: str, http_request: Request):
    """
    Get the status of a token purchase
    Shows payment detection, token crediting, and forwarding status
    """
    try:
        authenticated_user_id = get_authenticated_user_id(http_request)
        if str(user_id) != str(authenticated_user_id):
            raise HTTPException(status_code=403, detail="Authenticated user mismatch")
        # Get purchase status from Solana processor
        processor = get_processor(None)
        status_info = await processor.get_purchase_status(user_id, wallet_address)
        
        return {
            "status": "success",
            "purchase_status": status_info
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to get purchase status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get purchase status: {str(e)}")

@api_router.get("/purchase-history/{user_id}")
async def get_purchase_history(user_id: str, http_request: Request, limit: int = 5, offset: int = 0):
    """Get token purchase history for a user with pagination"""
    try:
        authenticated_user_id = get_authenticated_user_id(http_request)
        if str(user_id) != str(authenticated_user_id):
            raise HTTPException(status_code=403, detail="Authenticated user mismatch")
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        # Get Solana processor
        from solana_integration import get_processor
        processor = get_processor(None)
        
        logging.info(f" [Admin] Manually processing payment for wallet {wallet_address}")
        logging.info(f" [Admin] Transaction signature: {signature}")
        
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        from solana_integration import get_processor
        processor = get_processor(None)
        
        if wallet_address:
            logging.info(f" [Admin] Manual rescan for wallet: {wallet_address}")
            
            # Get specific wallet
            wallet_doc = await dbq.get_temporary_wallet(wallet_address)
            if not wallet_doc:
                raise HTTPException(status_code=404, detail=f"Wallet {wallet_address} not found")
            
            # Check balance
            from solders.pubkey import Pubkey
            from decimal import Decimal
            from solana.rpc.commitment import Confirmed
            from solana_integration import SOLANA_RPC_URL
            
            logging.info(f" [Admin] Using RPC URL: {SOLANA_RPC_URL}")
            logging.info(f" [Admin] Processor client: {processor.client._provider.endpoint_uri}")
            
            pubkey = Pubkey.from_string(wallet_address)
            balance_response = await processor.client.get_balance(pubkey, commitment=Confirmed)
            balance_lamports = balance_response.value if balance_response.value else 0
            
            logging.info(f" [Admin] Balance response: {balance_response}")
            logging.info(f" [Admin] Balance lamports: {balance_lamports}")
            
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
                logging.info(f" [Admin] Processing payment for wallet {wallet_address}")
                
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
            logging.info(" [Admin] Manual rescan of all pending payments")
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
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        from solana_integration import reset_processor, SOLANA_RPC_URL
        
        logging.info(" [Admin] Forcing processor reset...")
        reset_processor()
        logging.info(f" [Admin] Processor reset complete")
        logging.info(f" [Admin] Current RPC URL: {SOLANA_RPC_URL}")
        
        return {
            "status": "success",
            "message": "Processor reset successfully",
            "rpc_url": SOLANA_RPC_URL
        }
        
    except Exception as e:
        logging.error(f"Error resetting processor: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to reset processor: {str(e)}")

@api_router.get("/me")
async def get_current_user(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    user_doc = await dbq.get_user_by_id(user_id)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    character_build = _character_build_for_user_payload(user_doc)
    preview_fields = await _character_preview_fields_for_user(user_doc)
    battle_fields = await _runtime_character_sprite_payload_for_user(user_id)
    return {
        "id": user_doc.get("id"),
        "telegram_id": user_doc.get("telegram_id"),
        "first_name": user_doc.get("first_name"),
        "last_name": user_doc.get("last_name", ""),
        "username": user_doc.get("telegram_username", ""),
        "photo_url": user_doc.get("photo_url", ""),
        "token_balance": user_doc.get("token_balance", 0),
        "diamonds": user_doc.get("diamonds", 0),
        "xp": user_doc.get("xp", 0),
        "level": user_doc.get("level", 1),
        "class_name": user_doc.get("class_name"),
        "character_build_json": character_build,
        **preview_fields,
        "battle_spritesheet_path": battle_fields.get("battle_spritesheet_path", ""),
        "battle_spritesheet_hash": battle_fields.get("battle_spritesheet_hash", ""),
        "is_admin": user_doc.get("is_admin", False),
        "is_owner": user_doc.get("is_owner", False),
        "role": user_doc.get("role", "user"),
    }

def _is_admin_user_doc(user_doc: Optional[Dict[str, Any]]) -> bool:
    return bool(
        user_doc
        and (
            user_doc.get("is_admin")
            or user_doc.get("is_owner")
            or user_doc.get("role") in ("admin", "owner")
        )
    )


async def _require_self_or_admin(http_request: Request, target_user_id: str) -> Dict[str, Any]:
    authenticated_user_id = get_authenticated_user_id(http_request)
    requester = await dbq.get_user_by_id(authenticated_user_id)
    if str(authenticated_user_id) != str(target_user_id) and not _is_admin_user_doc(requester):
        raise HTTPException(status_code=403, detail="Authenticated user mismatch")
    return requester or {}


@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str, http_request: Request):
    await _require_self_or_admin(http_request, user_id)
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
            "match_id": room.match_id,
            "arena_match_id": room.arena_match_id,
            "mode": "duel" if room.arena_match_id else None,
            "round_number": room.round_number,
            "settings": ROOM_SETTINGS.get(room.room_type, ROOM_SETTINGS["bronze"]),
            "is_locked": (room.room_type == RoomType.FREEROLL and freeroll_config.get('is_locked', False))
        }
        rooms_data.append(room_data)

    return {"rooms": rooms_data, "maintenance_mode": maintenance_mode}

@api_router.get("/user-room-status/{user_id}")
async def get_user_room_status(user_id: str, http_request: Request):
    """Check if user is currently in any active rooms (can be multiple)"""
    try:
        authenticated_user_id = get_authenticated_user_id(http_request)
        if str(user_id) != str(authenticated_user_id):
            raise HTTPException(status_code=403, detail="Authenticated user mismatch")
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
                        "match_id": room.match_id,
                        "arena_match_id": room.arena_match_id,
                        "mode": "duel" if room.arena_match_id else None,
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
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error checking user room status: {e}")
        raise HTTPException(status_code=500, detail="Failed to check room status")

@api_router.post("/join-room")
async def join_room(request: JoinRoomRequest, background_tasks: BackgroundTasks, http_request: Request):
    """Join a room with a bet"""
    logging.info(f"Join room request: {request.dict()}")
    authenticated_user_id = get_authenticated_user_id(http_request)
    if str(request.user_id) != str(authenticated_user_id):
        raise HTTPException(status_code=403, detail="Authenticated user mismatch")
    
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
        raise HTTPException(status_code=503, detail=" Maintenance in progress. Please try again later.")

    logging.info(f"User balance: {user_doc.get('token_balance', 0)}, Bet amount: {request.bet_amount}")

    if request.bet_amount > 0 and user_doc.get('token_balance', 0) < request.bet_amount:
        raise HTTPException(status_code=400, detail="Insufficient token balance")

    # Check if user is already in the room
    if any(p.user_id == request.user_id for p in target_room.players):
        raise HTTPException(status_code=400, detail="You are already in this room")

    # Check if room is full
    if len(target_room.players) >= target_room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")

    if (
        target_room.players
        and target_room.min_players == 2
        and target_room.max_players == 2
        and request.bet_amount > 0
        and target_room.players[0].bet_amount != request.bet_amount
    ):
        raise HTTPException(status_code=400, detail="Arena duel players must use the same bet amount")

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
    
    equipped = await _fetch_equipped_snapshot(request.user_id)
    character_preview = await _character_preview_fields_for_user(dict(user_doc))
    battle_sprite = await _battle_spritesheet_for_loadout(
        request.user_id,
        user_doc.get("class_name"),
        equipped,
        _character_build_for_user_payload(dict(user_doc)),
    )

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
            is_anonymous=True,
            level=int(user_doc.get('level') or 1),
            class_name=user_doc.get('class_name'),
            character_spritesheet_path=character_preview.get("character_spritesheet_path"),
            character_spritesheet_hash=character_preview.get("character_spritesheet_hash"),
            battle_spritesheet_path=battle_sprite.get("path"),
            battle_spritesheet_hash=battle_sprite.get("hash"),
            weapon=equipped.get('weapon'),
            armor=equipped.get('armor'),
            ability=equipped.get('ability'),
        )
    else:
        player = RoomPlayer(
            user_id=request.user_id,
            username=user_doc.get('telegram_username', ''),  # @username
            first_name=user_doc.get('first_name', 'Player'),
            last_name=user_doc.get('last_name', ''),
            photo_url=user_doc.get('photo_url', ''),
            bet_amount=request.bet_amount,
            is_anonymous=False,
            level=int(user_doc.get('level') or 1),
            class_name=user_doc.get('class_name'),
            character_spritesheet_path=character_preview.get("character_spritesheet_path"),
            character_spritesheet_hash=character_preview.get("character_spritesheet_hash"),
            battle_spritesheet_path=battle_sprite.get("path"),
            battle_spritesheet_hash=battle_sprite.get("hash"),
            weapon=equipped.get('weapon'),
            armor=equipped.get('armor'),
            ability=equipped.get('ability'),
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
    
    logging.info(f" Player {player.username} joined room {target_room.id} ({len(target_room.players)}/{target_room.max_players})")
    logging.info(f" Full participant list: {[p['username'] for p in serialized_players]}")

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
    logging.info(f" Emitted player_joined to room {target_room.id} with {len(serialized_players)} players")

    # Broadcast updated room states to all clients (global lobby update)
    await broadcast_room_updates()

    # Check if enough players to start game
    if len(target_room.players) >= target_room.min_players:
        logging.info(f" Enough players! Room {target_room.id} has {len(target_room.players)}/{target_room.min_players} players, starting game sequence...")

        # Emit room_full event to all participants in THIS room only
        await socket_rooms.broadcast_to_room(sio, target_room.id, 'room_full', {
            'room_id': target_room.id,
            'room_type': target_room.room_type,
            'players': serialized_players,
            'players_count': len(target_room.players),
            'message': ' GAME IS STARTING! GET READY FOR THE BATTLE!',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        logging.info(f" Emitted room_full to room {target_room.id}")

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
async def leave_room(request: LeaveRoomRequest, http_request: Request):
    """Remove player from a waiting room and refund their bet"""
    authenticated_user_id = get_authenticated_user_id(http_request)
    if str(request.user_id) != str(authenticated_user_id):
        raise HTTPException(status_code=403, detail="Authenticated user mismatch")
    async with room_locks[request.room_id]:
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
        serialized_players = []
        for p in room.players:
            pd = p.dict()
            if isinstance(pd.get("joined_at"), datetime):
                pd["joined_at"] = pd["joined_at"].isoformat()
            serialized_players.append(pd)

    # Notify socket
    sid = user_to_socket.get(request.user_id)
    if sid:
        await sio.emit("balance_updated", {"user_id": request.user_id, "new_balance": new_balance}, room=sid)

    # Broadcast updated room list to all clients
    await broadcast_room_updates()

    await sio.emit("player_left", {
        "room_type": room.room_type,
        "player": {"first_name": player.first_name, "username": player.username},
        "players_count": len(room.players),
        "all_players": serialized_players,
    })

    logging.info(f" Player {player.username or player.first_name} left room {room.id}, refunded {refund} tokens")
    return {"status": "left", "refund": refund, "new_balance": new_balance}

@api_router.get("/pending-result/{user_id}")
async def get_pending_result(user_id: str, http_request: Request):
    """Return and delete all missed game results for this user"""
    authenticated_user_id = get_authenticated_user_id(http_request)
    if str(user_id) != str(authenticated_user_id):
        raise HTTPException(status_code=403, detail="Authenticated user mismatch")
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
async def post_room_chat(room_id: str, http_request: Request, text: str = ""):
    """Post a chat message to a room (REST fallback when socket unreliable)"""
    text = text.strip()[:200]
    if not text or not room_id:
        raise HTTPException(status_code=400, detail="Missing room_id or text")
    user_id = get_authenticated_user_id(http_request)
    room = active_rooms.get(room_id)
    player = next((p for p in room.players if p.user_id == user_id), None) if room else None
    if not player:
        raise HTTPException(status_code=403, detail="Player is not in this room")
    if player.is_anonymous:
        raise HTTPException(status_code=403, detail="Anonymous players cannot chat")
    name = player.first_name or player.username or "Player"
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
    logging.info(f" REST Chat [{room_id[:8]}] {name}: {text[:40]}")
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
        "arena_match_id": room.arena_match_id,
        "mode": "duel" if room.arena_match_id else None,
        "round_number": room.round_number,
        "settings": ROOM_SETTINGS[room.room_type],
        "winner": serialize_player(room.winner) if room.winner else None,
        "finished_at": room.finished_at.isoformat() if room.finished_at else None,
    }

@api_router.get("/leaderboard/my-rank")
async def get_my_rank(request: Request):
    user_id = get_authenticated_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    async with get_pool().acquire() as conn:
        coins_rank = await conn.fetchval("""
            SELECT COUNT(*)+1 FROM users
            WHERE token_balance > (SELECT token_balance FROM users WHERE id=$1)
        """, user_id)
        wins_rank = await conn.fetchval("""
            SELECT COUNT(*)+1 FROM (
                SELECT u.id, COUNT(am.id) FILTER (WHERE am.winner_user_id = u.id) AS wins
                FROM users u
                LEFT JOIN arena_matches am ON am.status='finished'
                     AND (am.player_one_id=u.id OR am.player_two_id=u.id)
                GROUP BY u.id
            ) sub
            WHERE wins > (
                SELECT COUNT(am2.id) FILTER (WHERE am2.winner_user_id=$1)
                FROM arena_matches am2
                WHERE am2.status='finished'
                  AND (am2.player_one_id=$1 OR am2.player_two_id=$1)
            )
        """, user_id)
        level_rank = await conn.fetchval("""
            SELECT COUNT(*)+1 FROM users
            WHERE xp > (SELECT xp FROM users WHERE id=$1)
        """, user_id)
    return {
        "coins_rank": int(coins_rank or 1),
        "wins_rank": int(wins_rank or 1),
        "level_rank": int(level_rank or 1),
    }


@api_router.get("/leaderboard")
async def get_leaderboard(tab: str = "coins"):
    if tab not in ("coins", "wins", "level"):
        tab = "coins"
    leaderboard = await dbq.get_leaderboard(tab=tab, limit=20)
    return {"leaderboard": leaderboard, "tab": tab}


@api_router.get("/daily-quests")
async def get_daily_quests(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    quests = await _daily_quests.get_quests_for_user(user_id)
    return {"quests": quests, **_daily_quests.quest_timing()}


@api_router.post("/daily-quests/{quest_key}/claim")
async def claim_daily_quest(quest_key: str, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    try:
        async with get_pool().acquire() as conn:
            async with conn.transaction():
                return await _daily_quests.claim_quest_in_transaction(conn, user_id, quest_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/daily-chest")
async def get_daily_chest(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        return await _daily_chest.get_daily_chest_state(conn, user_id)


@api_router.post("/daily-chest/claim")
async def claim_daily_chest(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    try:
        async with get_pool().acquire() as conn:
            async with conn.transaction():
                return await _daily_chest.claim_daily_chest_in_transaction(conn, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/game-history")
async def get_game_history(http_request: Request, limit: int = 10, user_id: str = ""):
    """Get recent completed games. If user_id given, returns only that user's games."""
    if limit > 20:
        limit = 20
    if user_id:
        await _require_self_or_admin(http_request, user_id)
        games = await dbq.get_user_completed_games(user_id, limit)
    else:
        games = await dbq.get_recent_completed_games(limit)
    return {"games": games}

@api_router.get("/user-stats/{user_id}")
async def get_user_stats_endpoint(user_id: str, http_request: Request):
    """Return play statistics for a user (games played, win rate, profit, etc.)"""
    await _require_self_or_admin(http_request, user_id)
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
async def get_user_by_telegram_id(telegram_id: int, http_request: Request):
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

    await _require_self_or_admin(http_request, user_doc.get("id"))
    character_build = _character_build_for_user_payload(user_doc)
    preview_fields = await _character_preview_fields_for_user(user_doc)

    return {
        "id": user_doc.get('id'),
        "telegram_id": user_doc.get('telegram_id'),
        "first_name": user_doc.get('first_name'),
        "last_name": user_doc.get('last_name', ''),
        "username": user_doc.get('telegram_username', ''),
        "photo_url": user_doc.get('photo_url', ''),
        "token_balance": user_doc.get('token_balance', 0),
        "xp": user_doc.get('xp', 0),
        "level": user_doc.get('level', 1),
        "class_name": user_doc.get('class_name'),
        "character_build_json": character_build,
        **preview_fields,
        "created_at": user_doc.get('created_at'),
        "last_login": user_doc.get('last_login'),
        "last_daily_claim": user_doc.get('last_daily_claim'),
        "is_verified": user_doc.get('is_verified', False),
        "is_admin": user_doc.get('is_admin', False),
        "is_owner": user_doc.get('is_owner', False),
        "role": user_doc.get('role', 'user'),
        "current_win_streak": user_doc.get('current_win_streak', 0),
        "max_win_streak": user_doc.get('max_win_streak', 0),
    }

class ClassUpdateBody(BaseModel):
    class_name: str


class CharacterBuildUpdateBody(BaseModel):
    character_build: Dict[str, Any]


async def _ensure_can_change_character_setup(user_id: str) -> None:
    if any(any(player.user_id == user_id for player in room.players) for room in active_rooms.values()):
        raise HTTPException(status_code=409, detail="Cannot change character while in a room")
    async with get_pool().acquire() as conn:
        active_match = await conn.fetchval(
            """
            SELECT 1 FROM arena_matches
            WHERE status = 'active'
              AND (player_one_id = $1 OR player_two_id = $1)
            LIMIT 1
            """,
            user_id,
        )
        if active_match:
            raise HTTPException(status_code=409, detail="Cannot change character during an active arena match")

@api_router.post("/me/class")
async def set_my_class(body: ClassUpdateBody, http_request: Request):
    """Update the authenticated user's class (warrior / mage / rogue)."""
    class_name = body.class_name.strip().lower()
    if class_name not in VALID_CHARACTER_CLASSES:
        raise HTTPException(status_code=400, detail="class_name must be warrior, mage, or rogue")
    user_id = get_authenticated_user_id(http_request)
    await _ensure_can_change_character_setup(user_id)
    default_build = _default_character_build(class_name)
    async with get_pool().acquire() as conn:
        await conn.execute(
            "UPDATE users SET class_name = $2, character_build_json = $3::jsonb WHERE id = $1",
            user_id, class_name, json.dumps(default_build),
        )
    user_doc = await dbq.get_user_by_id(user_id)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    character_build = _character_build_for_user_payload(user_doc)
    preview_fields = await _character_preview_fields_for_user(user_doc)
    battle_fields = await _runtime_character_sprite_payload_for_user(user_id)
    return {
        "id": user_doc.get("id"),
        "class_name": user_doc.get("class_name"),
        "character_build_json": character_build,
        **preview_fields,
        "battle_spritesheet_path": battle_fields.get("battle_spritesheet_path", ""),
        "battle_spritesheet_hash": battle_fields.get("battle_spritesheet_hash", ""),
        "message": f"Class updated to {class_name}",
    }


@api_router.get("/me/character-build")
async def get_my_character_build(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    user_doc = await dbq.get_user_by_id(user_id)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    character_build = _character_build_for_user_payload(user_doc)
    preview_fields = await _character_preview_fields_for_user(user_doc)
    return {
        "class_name": user_doc.get("class_name"),
        "character_build_json": character_build,
        **preview_fields,
    }


@api_router.post("/me/character-build/preview")
async def preview_my_character_build(body: CharacterBuildUpdateBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        current_class = await conn.fetchval("SELECT class_name FROM users WHERE id = $1", user_id)
    validated = _validate_character_build(body.character_build, current_class)
    preview_fields = await _character_preview_spritesheet_for_user(user_id, validated["className"], validated)
    return {
        "class_name": validated["className"],
        "character_build_json": validated,
        **preview_fields,
    }


@api_router.post("/me/character-build")
async def update_my_character_build(body: CharacterBuildUpdateBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    await _ensure_can_change_character_setup(user_id)
    async with get_pool().acquire() as conn:
        current_class = await conn.fetchval("SELECT class_name FROM users WHERE id = $1", user_id)
        validated = _validate_character_build(body.character_build, current_class)
        class_name = current_class or validated["className"]
        await conn.execute(
            "UPDATE users SET class_name = $2, character_build_json = $3::jsonb WHERE id = $1",
            user_id, class_name, json.dumps(validated),
        )
    preview_fields = await _character_preview_spritesheet_for_user(user_id, class_name, validated)
    battle_fields = await _runtime_character_sprite_payload_for_user(user_id)
    return {
        "class_name": class_name,
        "character_build_json": validated,
        **preview_fields,
        "battle_spritesheet_path": battle_fields.get("battle_spritesheet_path", ""),
        "battle_spritesheet_hash": battle_fields.get("battle_spritesheet_hash", ""),
        "message": "Character build updated",
    }


@api_router.get("/user/{user_id}")
async def get_user_data(user_id: str, http_request: Request):
    """Get user data including current balance"""
    await _require_self_or_admin(http_request, user_id)
    try:
        user_doc = await dbq.get_user_by_id(user_id)
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")

        async with get_pool().acquire() as conn:
            energy_data = await _get_and_regen_energy(str(user_id), conn)

        character_build = _character_build_for_user_payload(user_doc)
        preview_fields = await _character_preview_fields_for_user(user_doc)
        return {
            "id": user_doc.get('id'),
            "telegram_id": user_doc.get('telegram_id'),
            "first_name": user_doc.get('first_name'),
            "last_name": user_doc.get('last_name', ''),
            "username": user_doc.get('telegram_username', ''),
            "photo_url": user_doc.get('photo_url', ''),
            "token_balance": user_doc.get('token_balance', 0),
            "xp": user_doc.get('xp', 0),
            "level": user_doc.get('level', 1),
            "class_name": user_doc.get('class_name'),
            "character_build_json": character_build,
            **preview_fields,
            "created_at": user_doc.get('created_at'),
            "last_login": user_doc.get('last_login'),
            "is_verified": user_doc.get('is_verified', False),
            "is_admin": user_doc.get('is_admin', False),
            "is_owner": user_doc.get('is_owner', False),
            "role": user_doc.get('role', 'user'),
            "current_win_streak": user_doc.get('current_win_streak', 0),
            "max_win_streak": user_doc.get('max_win_streak', 0),
            "energy": energy_data["energy"],
            "max_energy": energy_data["max_energy"],
            "next_energy_at": energy_data["next_energy_at"],
        }
    except Exception as e:
        logging.error(f"Failed to get user data: {e}")
        raise HTTPException(status_code=500, detail="Failed to get user data")

_DEFAULT_SETTINGS = {
    "notifications": {"battle": True, "daily_chest": True, "quests": True},
    "gameplay": {"remember_bet": True},
    "privacy": {"show_leaderboard": True, "show_stats": True},
    "responsible": {"daily_limit": 0, "session_reminder": "off"},
}

def _merge_settings(stored: dict) -> dict:
    result = copy.deepcopy(_DEFAULT_SETTINGS)
    for section, defaults in _DEFAULT_SETTINGS.items():
        if section in stored and isinstance(stored[section], dict):
            result[section].update(stored[section])
    return result

@api_router.get("/me/settings")
async def get_my_settings(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("SELECT settings FROM users WHERE id = $1", user_id)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        raw = row["settings"] or {}
        if isinstance(raw, str):
            try: raw = json.loads(raw)
            except Exception: raw = {}
    return _merge_settings(raw)

class SettingsUpdateBody(BaseModel):
    notifications: Optional[Dict[str, Any]] = None
    gameplay: Optional[Dict[str, Any]] = None
    privacy: Optional[Dict[str, Any]] = None
    responsible: Optional[Dict[str, Any]] = None

@api_router.post("/me/settings")
async def update_my_settings(body: SettingsUpdateBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("SELECT settings FROM users WHERE id = $1", user_id)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        raw = row["settings"] or {}
        if isinstance(raw, str):
            try: raw = json.loads(raw)
            except Exception: raw = {}
        merged = _merge_settings(raw)
        patch = body.dict(exclude_none=True)
        for section, values in patch.items():
            if section in merged and isinstance(values, dict):
                merged[section].update(values)
        await conn.execute(
            "UPDATE users SET settings = $2 WHERE id = $1",
            user_id, json.dumps(merged),
        )
    return merged

@api_router.get("/me/progress")
async def get_my_progress(http_request: Request):
    """Return the authenticated user's XP and level progression."""
    user_id = get_authenticated_user_id(http_request)
    user_doc = await dbq.get_user_by_id(user_id)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    xp = int(user_doc.get('xp') or 0)
    level = int(user_doc.get('level') or 1)
    return {
        "user_id": user_id,
        "xp": xp,
        "level": level,
        "xp_to_next_level": _progression.xp_to_next_level(xp),
        "xp_for_current_level": _progression.xp_for_level(level),
    }


@api_router.get("/user/{user_id}/prizes")
async def get_user_prizes(user_id: str, http_request: Request):
    """Get all prize links won by a specific user"""
    await _require_self_or_admin(http_request, user_id)
    prizes = await dbq.get_user_prizes(user_id)
    return {"prizes": prizes}


# 
# Shop endpoints
# 

_TIER_ORDER = {"common": 1, "uncommon": 2, "rare": 3, "epic": 4, "legendary": 5}


def _serialize_item_row(row: Any) -> Dict[str, Any]:
    item = dict(row)
    ability_key = item.get("ability_key")
    item["enchant_level"] = int(item.get("enchant_level", 0) or 0)
    item["ability_cooldown_ms"] = battle_ability_cooldown_ms(ability_key, int(item.get("ability_cooldown_ms", 0) or 0))
    item["battle_stats"] = battle_ability_stats(ability_key)
    item["item_id"] = item.get("item_id") or item.get("id")
    item["lpc_visual"] = _coerce_json_dict(item.get("lpc_visual")) or None
    item["rarity"] = tier_to_rarity(item.get("tier"))
    item["stats"] = stat_preview(item)
    item.update(item_stat_payload(item))
    return item


def _serialize_inventory_row(row: Any) -> Dict[str, Any]:
    item = dict(row)
    ability_key = item.get("ability_key")
    item["enchant_level"] = int(item.get("enchant_level", 0) or 0)
    item["ability_cooldown_ms"] = battle_ability_cooldown_ms(ability_key, int(item.get("ability_cooldown_ms", 0) or 0))
    item["battle_stats"] = battle_ability_stats(ability_key)
    item["inventory_id"] = item["id"]
    item["item_id"] = item["catalog_item_id"]
    item["type"] = item["slot"]
    item["category"] = item["slot"]
    item["lpc_visual"] = _coerce_json_dict(item.get("lpc_visual")) or None
    item["rarity"] = tier_to_rarity(item.get("tier"))
    item["stats"] = stat_preview(item)
    item.update(item_stat_payload(item))
    return item


def _serialize_equipped_row(row: Any) -> Dict[str, Any]:
    item = _serialize_item_row(row)
    item["inventory_id"] = item.get("inventory_id")
    item["id"] = item.get("inventory_id") or item["item_id"]
    return item


def _safe_generated_user_id(user_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(user_id or "user"))
    return safe[:80] or "user"


async def _ensure_runtime_character_sheet(
    user_id: str,
    character_build: Dict[str, Any],
    sheet_hash: str,
    enchant_level: int = 0,
) -> Optional[str]:
    safe_user_id = _safe_generated_user_id(user_id)
    if not SAFE_GENERATED_ID.match(safe_user_id) or not SAFE_GENERATED_ID.match(sheet_hash):
        return None

    out_path = GENERATED_CHARACTER_DIR / safe_user_id / f"{sheet_hash}.png"
    if out_path.exists():
        return f"/generated/characters/{safe_user_id}/{sheet_hash}.png"

    tools_dir = RISKARENA_ROOT / "tools"
    if not (tools_dir / "generate_character_build.py").exists():
        logging.warning("[character-build] generator missing at %s", tools_dir)
        return None

    def _run_generation():
        try:
            if str(tools_dir) not in sys.path:
                sys.path.insert(0, str(tools_dir))
            from generate_character_build import generate_user_sheet, load_json  # type: ignore
            catalog = load_json(tools_dir / "lpc_character_catalog.json")
            generate_user_sheet(
                f"{safe_user_id}_{sheet_hash}",
                character_build,
                catalog,
                out_path,
                enchant_level=max(0, min(10, int(enchant_level or 0))),
            )
            return f"/generated/characters/{safe_user_id}/{sheet_hash}.png"
        except Exception as exc:
            logging.warning("[character-build] failed to generate sheet for user=%s hash=%s: %s", user_id, sheet_hash, exc)
            return None

    return await asyncio.to_thread(_run_generation)


def _character_build_for_equipped_visuals(
    class_name: str,
    character_build: Optional[Dict[str, Any]],
    equipped: Dict[str, Any],
) -> Dict[str, Any]:
    build = copy.deepcopy(character_build or _default_character_build(class_name))
    build["className"] = class_name

    # Apply equipped armor: replace existing torso layer with equipped armor asset
    armor_visual = _coerce_json_dict((equipped.get("armor") or {}).get("lpc_visual"))
    armor_asset = str(armor_visual.get("asset") or "").strip()
    if armor_asset and armor_asset in ALLOWED_CHARACTER_BUILD_ASSETS:
        build["layers"] = [
            layer for layer in build.get("layers", [])
            if layer.get("slot") != "torso"
        ]
        build["layers"].append({"slot": "torso", "asset": armor_asset, "variant": None})

    # Apply equipped helmet: add helmet layer on top of hair/head
    helmet_visual = _coerce_json_dict((equipped.get("helmet") or {}).get("lpc_visual"))
    helmet_asset = str(helmet_visual.get("asset") or "").strip()
    if helmet_asset and helmet_asset in ALLOWED_CHARACTER_BUILD_ASSETS:
        build["layers"] = [
            layer for layer in build.get("layers", [])
            if layer.get("slot") != "helmet"
        ]
        build["layers"].append({"slot": "helmet", "asset": helmet_asset, "variant": None})

    weapon = build.get("weapon") if isinstance(build.get("weapon"), dict) else {}
    weapon_visual = _coerce_json_dict((equipped.get("weapon") or {}).get("lpc_visual"))
    weapon_asset = str(weapon_visual.get("asset") or "").strip()
    if equipped.get("weapon") is None or not weapon_asset:
        build["weapon"] = {**weapon, "enabled": False}
    else:
        build["weapon"] = {
            "asset": weapon_asset,
            "enabled": True,
        }
    try:
        return _validate_character_build(build, class_name)
    except HTTPException as exc:
        logging.warning("[character-build] invalid equipped LPC visual for class=%s: %s", class_name, exc.detail)
        fallback = copy.deepcopy(build)
        fallback["weapon"] = {**weapon, "enabled": False}
        return _validate_character_build(fallback, class_name)


async def _battle_spritesheet_for_loadout(
    user_id: str,
    class_name: Optional[str],
    equipped: Dict[str, Any],
    character_build: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    cls = (class_name or "").strip().lower()
    if cls not in {"warrior", "mage", "rogue"}:
        return {"path": "", "hash": ""}
    weapon = equipped.get("weapon") or {}
    armor = equipped.get("armor") or {}
    helmet = equipped.get("helmet") or {}
    weapon_key = weapon.get("inventory_id") or weapon.get("item_id") or "no-weapon"
    armor_key = armor.get("inventory_id") or armor.get("item_id") or "noarmor"
    helmet_key = helmet.get("inventory_id") or helmet.get("item_id") or "nohelm"
    enchant = int(weapon.get("enchant_level", 0) or 0)
    runtime_build = _character_build_for_equipped_visuals(cls, character_build, equipped)
    build_hash = _stable_character_build_hash(runtime_build)
    visual_hash = hashlib.sha1(json.dumps({
        "weapon": weapon.get("lpc_visual"),
        "armor": armor.get("lpc_visual"),
        "helmet": helmet.get("lpc_visual"),
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:10]
    sheet_hash = hashlib.sha1(f"lpc-v6:{cls}:{build_hash}:{visual_hash}:{weapon_key}:{enchant}:{armor_key}:{helmet_key}".encode("utf-8")).hexdigest()[:16]
    generated_path = await _ensure_runtime_character_sheet(user_id, runtime_build, sheet_hash, enchant_level=enchant)
    return {
        "path": generated_path or "",
        "hash": f"lpc-v5:{sheet_hash}",
    }


async def _runtime_character_sprite_payload_for_user(user_id: str) -> Dict[str, Any]:
    equipped_rows = await _fetch_equipped_snapshot(user_id)
    async with get_pool().acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT class_name, character_build_json FROM users WHERE id = $1",
            user_id,
        )
    class_name = user_row["class_name"] if user_row else None
    character_build = _character_build_for_user_payload(dict(user_row) if user_row else {"class_name": class_name})
    battle_sprite = await _battle_spritesheet_for_loadout(user_id, class_name, equipped_rows, character_build)
    return {
        "character_build_json": character_build,
        "battle_spritesheet_path": battle_sprite["path"],
        "battle_spritesheet_hash": battle_sprite["hash"],
    }


async def _character_preview_spritesheet_for_user(
    user_id: str,
    class_name: Optional[str],
    character_build: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    cls = (class_name or "").strip().lower()
    if cls not in VALID_CHARACTER_CLASSES:
        return {"character_spritesheet_path": "", "character_spritesheet_hash": ""}

    base_build = copy.deepcopy(character_build or _default_character_build(cls))
    base_build["className"] = cls
    weapon = base_build.get("weapon") if isinstance(base_build.get("weapon"), dict) else {}
    base_build["weapon"] = {**weapon, "enabled": False}

    build_hash = _stable_character_build_hash(base_build)
    sheet_hash = hashlib.sha1(f"{cls}:{build_hash}:base-preview".encode("utf-8")).hexdigest()[:16]
    generated_path = await _ensure_runtime_character_sheet(user_id, base_build, sheet_hash)
    return {
        "character_spritesheet_path": generated_path or "",
        "character_spritesheet_hash": f"lpc-base:{sheet_hash}" if generated_path else "",
    }


async def _character_preview_fields_for_user(user_doc: Dict[str, Any]) -> Dict[str, str]:
    if not user_doc or not user_doc.get("class_name"):
        return {"character_spritesheet_path": "", "character_spritesheet_hash": ""}
    character_build = _character_build_for_user_payload(user_doc)
    return await _character_preview_spritesheet_for_user(
        str(user_doc.get("id") or ""),
        user_doc.get("class_name"),
        character_build,
    )


@api_router.get("/shop/items")
async def get_shop_items():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM items
            WHERE tier IN ('common', 'uncommon', 'rare')
            ORDER BY
                CASE tier
                    WHEN 'common'    THEN 1
                    WHEN 'uncommon'  THEN 2
                    WHEN 'rare'      THEN 3
                    WHEN 'epic'      THEN 4
                    WHEN 'legendary' THEN 5
                    ELSE 6 END,
                class_name,
                slot
        """)
        return {"items": [_serialize_item_row(r) for r in rows]}


class ShopBuyBody(BaseModel):
    item_id: int


class ScrollBuyBody(BaseModel):
    scroll_type: str
    quantity: int = Field(default=1, ge=1, le=100)


@api_router.post("/shop/buy")
async def buy_shop_item(body: ShopBuyBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            item = await conn.fetchrow(
                "SELECT * FROM items WHERE id = $1", body.item_id
            )
            if not item or not is_shop_tier(item["tier"]):
                raise HTTPException(status_code=404, detail="Item not found or not purchasable")
            user_row = await conn.fetchrow("SELECT class_name FROM users WHERE id = $1", user_id)
            if not user_row or not can_user_equip_item(user_row["class_name"], item["class_name"], item["slot"]):
                raise HTTPException(status_code=400, detail="Item class does not match your class")
            updated = await conn.fetchrow(
                "UPDATE users SET token_balance = token_balance - $2 "
                "WHERE id = $1 AND token_balance >= $2 RETURNING id",
                user_id, item["price"],
            )
            if not updated:
                raise HTTPException(status_code=400, detail="Insufficient token balance")
            rarity = tier_to_rarity(item["tier"])
            await conn.execute(
                """
                INSERT INTO inventory
                    (id, user_id, item_type, item_name, item_rarity, equipped, item_id, source, acquired_at)
                VALUES ($1, $2, $3, $4, $5, FALSE, $6, 'shop', NOW())
                """,
                str(uuid.uuid4()), user_id, item["slot"], item["name"], rarity, item["id"],
            )
            new_balance = await conn.fetchval("SELECT token_balance FROM users WHERE id = $1", user_id)
            return {"success": True, "item": _serialize_item_row(item), "new_balance": int(new_balance or 0)}


@api_router.get("/shop/scrolls")
async def get_scroll_shop():
    return {"scrolls": [dict(scroll) for scroll in SCROLL_SHOP.values() if scroll["purchasable"]]}


@api_router.post("/shop/scrolls/buy")
async def buy_scroll(body: ScrollBuyBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    scroll = SCROLL_SHOP.get(body.scroll_type)
    if not scroll or not scroll["purchasable"]:
        raise HTTPException(status_code=404, detail="Scroll not found or not purchasable")
    total_price = scroll["price"] * body.quantity
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            updated = await conn.fetchrow(
                "UPDATE users SET token_balance = token_balance - $2 WHERE id = $1 AND token_balance >= $2 RETURNING token_balance",
                user_id,
                total_price,
            )
            if not updated:
                raise HTTPException(status_code=400, detail="Insufficient token balance")
            row = await conn.fetchrow(
                """
                INSERT INTO item_scrolls (user_id, scroll_type, quantity, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (user_id, scroll_type) DO UPDATE
                    SET quantity = item_scrolls.quantity + EXCLUDED.quantity,
                        updated_at = NOW()
                RETURNING quantity
                """,
                user_id,
                body.scroll_type,
                body.quantity,
            )
            return {
                "success": True,
                "scroll_type": body.scroll_type,
                "quantity": int(row["quantity"]),
                "new_balance": int(updated["token_balance"]),
            }


@api_router.get("/me/scrolls")
async def get_my_scrolls(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT scroll_type, quantity FROM item_scrolls WHERE user_id = $1",
            user_id,
        )
    by_type = {row["scroll_type"]: int(row["quantity"]) for row in rows}
    return {"scrolls": {scroll_type: by_type.get(scroll_type, 0) for scroll_type in sorted(SCROLL_TYPES)}}


@api_router.get("/me/upgrade")
async def get_upgrade_state(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        inventory_rows = await conn.fetch(
            """
            SELECT inv.id, inv.user_id, inv.item_type, inv.item_name, inv.item_rarity, inv.source, inv.acquired_at,
                   inv.enchant_level,
                   inv.item_id AS catalog_item_id,
                   i.name, i.description, i.class_name, i.slot, i.tier, i.price,
                   i.attack_bonus, i.ability_bonus, i.defend_reduction, i.hp_bonus,
                   i.risk_win_chance, i.passive_type, i.passive_value, i.image_path, i.lpc_visual,
                   i.ability_key, i.ability_cooldown_ms
            FROM inventory inv
            JOIN items i ON i.id = inv.item_id
            WHERE inv.user_id = $1 AND i.slot IN ('weapon', 'armor')
            ORDER BY inv.acquired_at DESC, inv.id DESC
            """,
            user_id,
        )
        equipped_rows = await conn.fetch(
            """
            SELECT ei.user_id, ei.slot, ei.inventory_id, ei.item_id
            FROM equipped_items ei
            JOIN users u ON u.id = ei.user_id
            WHERE ei.user_id = $1
              AND ei.class_name = u.class_name
            """,
            user_id,
        )
        scroll_rows = await conn.fetch(
            "SELECT scroll_type, quantity FROM item_scrolls WHERE user_id = $1",
            user_id,
        )
    scrolls = {row["scroll_type"]: int(row["quantity"]) for row in scroll_rows}
    equipped_inventory_ids = resolve_effective_equipped_inventory_ids(
        [dict(row) for row in inventory_rows],
        [dict(row) for row in equipped_rows],
    )
    items = []
    for row in inventory_rows:
        item = _serialize_inventory_row({**dict(row), "equipped": row["id"] in equipped_inventory_ids})
        item["max_enchant"] = max_enchant_for_tier(item["tier"])
        item["normal_success_chance"] = enchant_success_chance(item["tier"], item["enchant_level"], "normal_scroll")
        item["blessed_success_chance"] = enchant_success_chance(item["tier"], item["enchant_level"], "blessed_scroll")
        item["next_enchant_preview"] = {
            "normal_scroll": next_enchant_preview(item, "normal_scroll"),
            "blessed_scroll": next_enchant_preview(item, "blessed_scroll"),
        }
        items.append(item)
    return {
        "items": items,
        "scrolls": {scroll_type: scrolls.get(scroll_type, 0) for scroll_type in sorted(SCROLL_TYPES)},
    }


@api_router.get("/inventory")
@api_router.get("/me/inventory")
async def get_my_inventory(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT inv.id, inv.user_id, inv.item_type, inv.item_name, inv.item_rarity, inv.source, inv.acquired_at,
                   inv.enchant_level,
                   inv.item_id AS catalog_item_id,
                   i.name, i.description, i.class_name, i.slot, i.tier, i.price,
                   i.attack_bonus, i.ability_bonus, i.defend_reduction, i.hp_bonus,
                   i.risk_win_chance, i.passive_type, i.passive_value, i.image_path, i.lpc_visual,
                   i.ability_key, i.ability_cooldown_ms
            FROM inventory inv
            LEFT JOIN items i ON i.id = inv.item_id
            WHERE inv.user_id = $1
            ORDER BY inv.acquired_at DESC, inv.id DESC
            """,
            user_id,
        )
        equipped_rows = await conn.fetch(
            """
            SELECT ei.user_id, ei.slot, ei.inventory_id, ei.item_id
            FROM equipped_items ei
            JOIN users u ON u.id = ei.user_id
            WHERE ei.user_id = $1
              AND ei.class_name = u.class_name
            """,
            user_id,
        )
        equipped_inventory_ids = resolve_effective_equipped_inventory_ids(
            [dict(row) for row in rows],
            [dict(row) for row in equipped_rows],
        )
        return {
            "items": [
                _serialize_inventory_row({**dict(row), "equipped": row["id"] in equipped_inventory_ids})
                for row in rows
            ]
        }


# 
# Equipment endpoints
# 

@api_router.get("/me/equipped")
async def get_my_equipped(http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ei.slot, COALESCE(inv.id, ei.inventory_id) AS inventory_id,
                   COALESCE(inv.enchant_level, 0) AS enchant_level, i.*
            FROM equipped_items ei
            JOIN items i ON i.id = ei.item_id
            JOIN users u ON u.id = ei.user_id
                          AND (i.class_name = u.class_name OR i.class_name = 'any')
            LEFT JOIN LATERAL (
                SELECT id, enchant_level
                FROM inventory
                WHERE user_id = ei.user_id
                  AND item_id = ei.item_id
                  AND (ei.inventory_id IS NULL OR id = ei.inventory_id)
                ORDER BY
                    CASE WHEN id = ei.inventory_id THEN 0 ELSE 1 END,
                    acquired_at ASC,
                    id ASC
                LIMIT 1
            ) inv ON TRUE
            WHERE ei.user_id = $1
              AND ei.class_name = u.class_name
            """,
            user_id,
        )
        equipped: Dict[str, Any] = {"weapon": None, "armor": None, "ability": None, "helmet": None, "ability_2": None}
        equipped_items: List[Dict[str, Any]] = []
        for row in rows:
            slot = row["slot"]
            item = _serialize_equipped_row(row)
            if slot in equipped:
                equipped[slot] = item
            equipped_items.append({
                "id": row["inventory_id"] or row["id"],
                "inventory_id": row["inventory_id"],
                "item_id": row["id"],
                "slot": row["slot"],
            })
        user_row = await conn.fetchrow(
            "SELECT class_name, character_build_json FROM users WHERE id = $1",
            user_id,
        )
        class_name = user_row["class_name"] if user_row else None
        character_build = _character_build_for_user_payload(dict(user_row) if user_row else {"class_name": class_name})
    battle_sprite = await _battle_spritesheet_for_loadout(user_id, class_name, equipped, character_build)
    return {
        "equipped": equipped,
        "equipped_items": equipped_items,
        "character_build_json": character_build,
        "battle_spritesheet_path": battle_sprite["path"],
        "battle_spritesheet_hash": battle_sprite["hash"],
        "loadout_effective_stats": modifiers_to_dict(aggregate_item_modifiers([dict(row) for row in rows])),
    }


class EquipBody(BaseModel):
    item_id: Optional[int] = None
    inventory_id: Optional[str] = None


class EnchantBody(BaseModel):
    inventory_id: str
    scroll_type: str


@api_router.post("/me/equip")
async def equip_item(body: EquipBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        inv_row = None
        if body.inventory_id:
            inv_row = await conn.fetchrow(
                """
                SELECT inv.id AS inventory_id, inv.item_id, i.*
                FROM inventory inv
                JOIN items i ON i.id = inv.item_id
                WHERE inv.user_id = $1 AND inv.id = $2
                """,
                user_id,
                body.inventory_id,
            )
        elif body.item_id is not None:
            inv_rows = await conn.fetch(
                """
                SELECT inv.id AS inventory_id, inv.item_id, i.*
                FROM inventory inv
                JOIN items i ON i.id = inv.item_id
                WHERE inv.user_id = $1 AND inv.item_id = $2
                ORDER BY inv.acquired_at ASC, inv.id ASC
                """,
                user_id,
                body.item_id,
            )
            try:
                inv_row = choose_inventory_copy_for_equip([dict(row) for row in inv_rows])
            except LookupError:
                inv_row = None
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not inv_row:
            raise HTTPException(status_code=404, detail="Item not in your inventory")
        user_row = await conn.fetchrow("SELECT class_name FROM users WHERE id = $1", user_id)
        if not user_row or not can_user_equip_item(user_row["class_name"], inv_row["class_name"], inv_row["slot"]):
            raise HTTPException(status_code=400, detail="Item class does not match your class")
        await conn.execute(
            """
            INSERT INTO equipped_items (user_id, slot, inventory_id, item_id, equipped_at, class_name)
            VALUES ($1, $2, $3, $4, NOW(), $5)
            ON CONFLICT (user_id, slot, class_name) DO UPDATE
                SET inventory_id = EXCLUDED.inventory_id,
                    item_id = EXCLUDED.item_id,
                    equipped_at = NOW()
            """,
            user_id, inv_row["slot"], inv_row["inventory_id"], inv_row["item_id"], user_row["class_name"],
        )
        result = {
            "success": True,
            "equipped_slot": inv_row["slot"],
            "item_id": inv_row["item_id"],
            "inventory_id": inv_row["inventory_id"],
        }
    result.update(await _runtime_character_sprite_payload_for_user(user_id))
    return result


@api_router.post("/me/enchant")
async def enchant_item(body: EnchantBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    if body.scroll_type not in SCROLL_TYPES:
        raise HTTPException(status_code=400, detail="Invalid scroll type")

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT inv.id AS inventory_id, inv.user_id, inv.item_id, inv.enchant_level,
                       i.name, i.class_name, i.slot, i.tier
                FROM inventory inv
                JOIN items i ON i.id = inv.item_id
                WHERE inv.user_id = $1 AND inv.id = $2
                FOR UPDATE OF inv
                """,
                user_id,
                body.inventory_id,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Item not in your inventory")
            if not is_enchantable_slot(row["slot"]):
                raise HTTPException(status_code=400, detail="Only weapon and armor items can be enchanted")

            user_row = await conn.fetchrow("SELECT class_name FROM users WHERE id = $1", user_id)
            if not user_row or not can_user_equip_item(user_row["class_name"], row["class_name"], row["slot"]):
                raise HTTPException(status_code=400, detail="Item class does not match your class")

            current_level = int(row["enchant_level"] or 0)
            max_level = max_enchant_for_tier(row["tier"])
            if current_level >= max_level:
                raise HTTPException(status_code=400, detail="Item is already at max enchant")

            scroll_row = await conn.fetchrow(
                """
                SELECT quantity
                FROM item_scrolls
                WHERE user_id = $1 AND scroll_type = $2
                FOR UPDATE
                """,
                user_id,
                body.scroll_type,
            )
            if not scroll_row or int(scroll_row["quantity"] or 0) <= 0:
                raise HTTPException(status_code=400, detail="Scroll unavailable")

            await conn.execute(
                """
                UPDATE item_scrolls
                SET quantity = quantity - 1,
                    updated_at = NOW()
                WHERE user_id = $1 AND scroll_type = $2
                """,
                user_id,
                body.scroll_type,
            )

            roll = random.SystemRandom().random()
            result = resolve_enchant_attempt(row["tier"], current_level, body.scroll_type, roll)

            if result["success"]:
                await conn.execute(
                    "UPDATE inventory SET enchant_level = $3 WHERE user_id = $1 AND id = $2",
                    user_id,
                    body.inventory_id,
                    result["new_enchant_level"],
                )
            remaining_scrolls = await conn.fetchval(
                "SELECT quantity FROM item_scrolls WHERE user_id = $1 AND scroll_type = $2",
                user_id,
                body.scroll_type,
            )

            return {
                "success": result["success"],
                "destroyed": result["destroyed"],
                "inventory_id": body.inventory_id,
                "item_id": row["item_id"],
                "slot": row["slot"],
                "tier": row["tier"],
                "scroll_type": body.scroll_type,
                "previous_enchant_level": result["previous_enchant_level"],
                "new_enchant_level": result["new_enchant_level"],
                "max_enchant": max_level,
                "success_chance": result["success_chance"],
                "roll": result["roll"],
                "remaining_scrolls": int(remaining_scrolls or 0),
            }


class UnequipBody(BaseModel):
    slot: str


SELL_PRICES = {
    "common": 5,
    "uncommon": 100,
    "rare": 300,
    "epic": 500,
    "legendary": 1200,
}


class SellBody(BaseModel):
    inventory_id: str


@api_router.post("/me/unequip")
async def unequip_item(body: UnequipBody, http_request: Request):
    if body.slot not in ("weapon", "armor", "ability", "helmet", "ability_2"):
        raise HTTPException(status_code=400, detail="slot must be weapon, armor, ability, ability_2, or helmet")
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        user_row = await conn.fetchrow("SELECT class_name FROM users WHERE id = $1", user_id)
        await conn.execute(
            "DELETE FROM equipped_items WHERE user_id = $1 AND slot = $2 AND class_name = $3",
            user_id, body.slot, user_row["class_name"] if user_row else "",
        )
    result = {"success": True}
    result.update(await _runtime_character_sprite_payload_for_user(user_id))
    return result


@api_router.post("/me/sell")
async def sell_item(body: SellBody, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # 1. Fetch inventory row (lock for update)
            row = await conn.fetchrow(
                """
                SELECT inv.id AS inventory_id, inv.user_id, inv.item_id,
                       i.name AS item_name, i.tier
                FROM inventory inv
                JOIN items i ON i.id = inv.item_id
                WHERE inv.user_id = $1 AND inv.id = $2
                FOR UPDATE OF inv
                """,
                user_id, body.inventory_id,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Item not in your inventory")

            # 2. Block sale only if equipped in current class loadout; auto-clean
            # orphan rows from old class loadouts (users cannot unequip those via UI).
            user_class = await conn.fetchval(
                "SELECT class_name FROM users WHERE id = $1", user_id
            )
            equipped_current = await conn.fetchval(
                "SELECT 1 FROM equipped_items"
                " WHERE user_id = $1 AND inventory_id = $2 AND class_name = $3",
                user_id, body.inventory_id, user_class or "",
            )
            if equipped_current:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot sell an equipped item - unequip it first",
                )
            await conn.execute(
                "DELETE FROM equipped_items WHERE user_id = $1 AND inventory_id = $2",
                user_id, body.inventory_id,
            )

            # 3. Sell price
            tier = (row["tier"] or "common").lower()
            sell_price = SELL_PRICES.get(tier, 5)

            # 4. Credit tokens
            new_balance = await conn.fetchval(
                "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1 RETURNING token_balance",
                user_id, sell_price,
            )

            # 5. Delete from inventory
            await conn.execute(
                "DELETE FROM inventory WHERE user_id = $1 AND id = $2",
                user_id, body.inventory_id,
            )

            return {"new_balance": int(new_balance or 0), "sell_price": sell_price, "item_name": row["item_name"]}


# 
# Admin: give items
# 

@api_router.post("/admin/give-all-items")
async def admin_give_all_items(admin_key: str, telegram_id: int):
    """ADMIN: Insert every item from the catalog into a user's inventory (once per item)."""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    async with get_pool().acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT id FROM users WHERE telegram_id = $1", telegram_id
        )
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user_row["id"]
        all_items = await conn.fetch("SELECT id, slot, name, tier FROM items ORDER BY id")
        added = 0
        for item in all_items:
            rarity = {"common": "Common", "uncommon": "Uncommon", "rare": "Rare",
                      "epic": "Epic", "legendary": "Legendary"}.get(
                (item["tier"] or "common").lower(), "Common"
            )
            await conn.execute(
                """
                INSERT INTO inventory (id, user_id, item_type, item_name, item_rarity, source, item_id, acquired_at)
                VALUES ($1, $2, $3, $4, $5, 'admin_grant', $6, NOW())
                """,
                str(uuid.uuid4()), user_id, item["slot"], item["name"], rarity, item["id"],
            )
            added += 1
        return {"added": added, "user_id": user_id, "telegram_id": telegram_id}


@api_router.post("/admin/grant-item")
async def admin_grant_item(telegram_id: int, item_id: int, admin_key: str, http_request: Request):
    """ADMIN: Grant a specific item (by items.id) to a user."""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    async with get_pool().acquire() as conn:
        user_row = await conn.fetchrow("SELECT id FROM users WHERE telegram_id = $1", telegram_id)
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        item_row = await conn.fetchrow("SELECT id, slot, name, tier FROM items WHERE id = $1", item_id)
        if not item_row:
            raise HTTPException(status_code=404, detail="Item not found")
        rarity_map = {"common": "Common", "uncommon": "Uncommon", "rare": "Rare",
                      "epic": "Epic", "legendary": "Legendary"}
        rarity = rarity_map.get((item_row["tier"] or "common").lower(), "Common")
        inv_id = str(uuid.uuid4())
        await conn.execute(
            "INSERT INTO inventory (id, user_id, item_type, item_name, item_rarity, source, item_id, acquired_at) "
            "VALUES ($1, $2, $3, $4, $5, 'admin_grant', $6, NOW())",
            inv_id, user_row["id"], item_row["slot"], item_row["name"], rarity, item_row["id"],
        )
        return {"ok": True, "inventory_id": inv_id, "item_name": item_row["name"],
                "item_tier": item_row["tier"], "telegram_id": telegram_id}


@api_router.get("/admin/items-catalog")
async def admin_items_catalog(admin_key: str, http_request: Request):
    """ADMIN: Return all items for the grant-item picker."""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, slot, tier, class_name FROM items ORDER BY tier, class_name, slot, name"
        )
    return [dict(r) for r in rows]


#
# Starter items
#

@api_router.get("/me/starter-items")
async def get_starter_items(http_request: Request):
    """Give the 3 common items for the user's class if not already in inventory."""
    user_id = get_authenticated_user_id(http_request)
    async with get_pool().acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT class_name FROM users WHERE id = $1", user_id
        )
        if not user_row or not user_row["class_name"]:
            raise HTTPException(status_code=400, detail="Set your class before claiming starter items")
        class_name = user_row["class_name"]
        starter_items = await conn.fetch(
            "SELECT * FROM items WHERE class_name = $1 AND tier = 'common' ORDER BY slot ASC", class_name
        )
        given = []
        for item in starter_items:
            already = await conn.fetchval(
                "SELECT 1 FROM inventory WHERE user_id = $1 AND item_id = $2",
                user_id, item["id"],
            )
            if not already:
                await conn.execute(
                    """
                    INSERT INTO inventory
                        (id, user_id, item_type, item_name, item_rarity, equipped, item_id, source, acquired_at)
                    VALUES ($1, $2, $3, $4, $5, FALSE, $6, 'starter', NOW())
                    """,
                    str(uuid.uuid4()), user_id, item["slot"], item["name"], tier_to_rarity(item["tier"]), item["id"],
                )
                given.append(_serialize_item_row(item))
        return {"given": given, "class_name": class_name}

@api_router.get("/check-winner/{user_id}")
async def check_if_winner(user_id: str, http_request: Request):
    """Check if user has any unclaimed prizes"""
    await _require_self_or_admin(http_request, user_id)
    recent_prizes = await dbq.get_user_prizes(user_id)
    return {"recent_prizes": recent_prizes[:5]}


@api_router.post("/admin/adjust-tokens/{telegram_id}")
async def adjust_tokens(telegram_id: int, tokens: int, admin_key: str = ""):
    """Add or remove tokens from a user by Telegram ID. Use negative tokens to remove."""
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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
            'message': ' GAME IS STARTING! GET READY FOR THE BATTLE!',
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    user = await dbq.get_user_by_telegram_id(telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await dbq.ban_user(telegram_id)
    return {"success": True, "message": f"User {telegram_id} banned"}


@api_router.post("/admin/unban/{telegram_id}")
async def unban_user_endpoint(telegram_id: int, admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    await dbq.unban_user(telegram_id)
    return {"success": True, "message": f"User {telegram_id} unbanned"}


@api_router.post("/admin/set-role/{telegram_id}")
async def set_role_endpoint(telegram_id: int, is_admin: bool = False, is_owner: bool = False, admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    user = await dbq.get_user_by_telegram_id(telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await dbq.set_user_role(telegram_id, is_admin, is_owner)
    role = "owner" if is_owner else ("admin" if is_admin else "user")
    return {"success": True, "telegram_id": telegram_id, "role": role}


@api_router.get("/admin/stats")
async def get_admin_stats_endpoint(admin_key: str = ""):
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        games = await dbq.get_recent_completed_games(limit)
        return {"games": games, "count": len(games)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/admin/wallets")
async def get_wallets(admin_key: str = "", limit: int = 10):
    """ADMIN: View recent temporary wallets  public key, private key, sweep status"""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        async with dbq.get_pool().acquire() as conn:
            rows = await conn.fetch(
                """SELECT wallet_address, user_id, required_sol, token_amount,
                          status, payment_detected, tokens_credited, sol_forwarded,
                          private_key IS NOT NULL AS has_private_key, created_at
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
            w["public_key"] = w["wallet_address"]
            wallets.append(w)
        return {"wallets": wallets, "count": len(wallets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/admin/broadcast")
async def broadcast_message(message: str, admin_key: str = ""):
    if not verify_admin_key(admin_key):
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
                            logging.info(f" Broadcast skipped {tg_id} (unreachable): {tg_err}")
                        else:
                            failed += 1
                            errors.append(f"{tg_id}: {tg_err}")
                            logging.warning(f" Broadcast to {tg_id} failed: {tg_err}")
                    await asyncio.sleep(0.05)
                except Exception as ex:
                    failed += 1
                    errors.append(f"{tg_id}: {ex}")
        logging.info(f" Broadcast done: sent={sent}, skipped={skipped}, failed={failed}, total={len(tg_ids)}")
        # Push in-app broadcast to all connected socket clients
        await sio.emit('admin_broadcast', {'message': message, 'ts': datetime.now(timezone.utc).isoformat()})
        return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(tg_ids), "errors": errors[:5]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/admin/force-start/{room_type}")
async def force_start_room(room_type: str, admin_key: str = "", background_tasks: BackgroundTasks = None):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    target_room = None
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == "waiting":
            target_room = room
            break
    if not target_room:
        raise HTTPException(status_code=404, detail=f"No waiting {room_type} room")
    if len(target_room.players) == 0:
        raise HTTPException(status_code=400, detail="Room has no players  add at least one first")
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
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    maintenance_mode = not maintenance_mode
    logging.info(f" Maintenance mode {'ON' if maintenance_mode else 'OFF'}")
    # Notify all connected clients immediately
    await broadcast_room_updates()
    return {"maintenance_mode": maintenance_mode}


@api_router.get("/admin/maintenance-status")
async def get_maintenance_status_endpoint(admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    return {"maintenance_mode": maintenance_mode}


@api_router.get("/admin/daily-stats")
async def get_daily_stats_endpoint(admin_key: str = "", days: int = 7):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        return {"days": await dbq.get_daily_stats(days)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/admin/promo-codes")
async def create_promo_code_endpoint(code: str, token_amount: int, max_uses: int = 1, unlimited: bool = False, admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    ok = await dbq.create_promo_code(code, token_amount, max_uses, unlimited=unlimited)
    if not ok:
        raise HTTPException(status_code=400, detail="Code already exists or failed to create")
    return {"success": True, "code": code.upper(), "token_amount": token_amount, "max_uses": max_uses, "unlimited": unlimited}


@api_router.get("/admin/promo-codes")
async def list_promo_codes_endpoint(admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    return {"codes": await dbq.get_promo_codes()}


@api_router.delete("/admin/promo-codes/{code}")
async def delete_promo_code_endpoint(code: str, admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    ok = await dbq.delete_promo_code(code)
    if not ok:
        raise HTTPException(status_code=404, detail="Code not found")
    return {"success": True}


@api_router.post("/use-promo")
async def use_promo_code_endpoint(code: str, http_request: Request):
    user_id = get_authenticated_user_id(http_request)
    user_doc = await dbq.get_user_by_id(user_id)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    telegram_id = int(user_doc["telegram_id"])
    result = await dbq.use_promo_code(code, telegram_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


#  Early Access / Waitlist 

EARLY_ACCESS_BONUS_TOKENS = int(os.environ.get("EARLY_ACCESS_BONUS_TOKENS", "500"))

_WAITLIST_CONFIRM_MSG = (
    " <b>You're on the RiskArena waitlist!</b>\n\n"
    "You've secured your spot as a <b>Founding Warrior</b>.\n\n"
    "What you'll receive on launch day:\n"
    " <b>500 bonus tokens</b>\n"
    " <b>Founding Warrior</b> badge in your profile\n\n"
    "We'll notify you here when the arena opens.\n"
    "Stay ready, warrior. "
)

_WAITLIST_ALREADY_MSG = (
    " You're already on the waitlist, warrior!\n\n"
    "Your <b>Founding Warrior</b> spot is secured. "
    "We'll message you when the arena opens."
)


@api_router.post("/bot/webhook")
async def telegram_bot_webhook(request: Request):
    """Receives Telegram bot updates for waitlist /start and /waitlist commands."""
    try:
        update = await request.json()
    except Exception:
        return {"ok": True}

    message = update.get("message") or update.get("edited_message")
    if not message:
        return {"ok": True}

    text: str = message.get("text", "")
    from_user = message.get("from", {})
    telegram_id: int = from_user.get("id")
    if not telegram_id or not text:
        return {"ok": True}

    if not (text.startswith("/start") or text.startswith("/waitlist")):
        return {"ok": True}

    username = from_user.get("username")
    first_name = from_user.get("first_name", "Warrior")

    try:
        async with get_pool().acquire() as conn:
            existing = await conn.fetchrow(
                "SELECT id, tokens_awarded FROM early_access WHERE telegram_id = $1",
                telegram_id,
            )
            if existing:
                await send_telegram_message(telegram_id, _WAITLIST_ALREADY_MSG)
                return {"ok": True}

            await conn.execute(
                """INSERT INTO early_access (telegram_id, username, first_name)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (telegram_id) DO NOTHING""",
                telegram_id, username, first_name,
            )
        await send_telegram_message(telegram_id, _WAITLIST_CONFIRM_MSG)
        logging.info(f"Early access registered: {telegram_id} (@{username})")
    except Exception as e:
        logging.error(f"Early access webhook error: {e}")

    return {"ok": True}


@api_router.get("/admin/early-access")
async def list_early_access(admin_key: str = ""):
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT telegram_id, username, first_name, registered_at, tokens_awarded, awarded_at "
            "FROM early_access ORDER BY registered_at ASC"
        )
    entries = [dict(r) for r in rows]
    for e in entries:
        if e.get("registered_at"):
            e["registered_at"] = e["registered_at"].isoformat()
        if e.get("awarded_at"):
            e["awarded_at"] = e["awarded_at"].isoformat()
    return {"total": len(entries), "entries": entries}


@api_router.post("/admin/early-access/award-tokens")
async def award_early_access_tokens(admin_key: str = "", tokens: int = EARLY_ACCESS_BONUS_TOKENS):
    """Award bonus tokens to all early access users who have a game account and haven't been awarded yet."""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    if tokens <= 0:
        raise HTTPException(status_code=400, detail="tokens must be positive")

    import httpx as _httpx

    async with get_pool().acquire() as conn:
        pending = await conn.fetch(
            "SELECT telegram_id, username, first_name FROM early_access WHERE tokens_awarded = FALSE"
        )

    awarded, skipped, notified = 0, 0, 0
    errors = []

    async with get_pool().acquire() as conn:
        for row in pending:
            tg_id = row["telegram_id"]
            try:
                user_row = await conn.fetchrow(
                    "SELECT id, token_balance FROM users WHERE telegram_id = $1", tg_id
                )
                if not user_row:
                    skipped += 1
                    continue

                await conn.execute(
                    "UPDATE users SET token_balance = token_balance + $1 WHERE id = $2",
                    tokens, user_row["id"],
                )
                await conn.execute(
                    "UPDATE early_access SET tokens_awarded = TRUE, awarded_at = NOW() WHERE telegram_id = $1",
                    tg_id,
                )
                awarded += 1

                launch_msg = (
                    f" <b>The arena is open, Founding Warrior!</b>\n\n"
                    f" <b>{tokens} bonus tokens</b> have been added to your account.\n"
                    f" Your <b>Founding Warrior</b> badge is waiting in your profile.\n\n"
                    f"Open RiskArena and claim your glory!"
                )
                ok = await send_telegram_message(tg_id, launch_msg)
                if ok:
                    notified += 1
            except Exception as e:
                errors.append(f"{tg_id}: {e}")
                logging.error(f"Early access award error for {tg_id}: {e}")

    logging.info(f"Early access award done: awarded={awarded}, skipped={skipped}, notified={notified}")
    return {
        "awarded": awarded,
        "skipped_no_account": skipped,
        "notified": notified,
        "errors": errors[:10],
        "tokens_per_user": tokens,
    }


@api_router.post("/admin/early-access/set-webhook")
async def set_bot_webhook(admin_key: str = "", webhook_url: str = ""):
    """Register the Telegram bot webhook. webhook_url should be https://yourdomain.com/api/bot/webhook"""
    if not verify_admin_key(admin_key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    if not webhook_url:
        raise HTTPException(status_code=400, detail="webhook_url is required")
    if not TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN == "YOUR_TELEGRAM_BOT_TOKEN_HERE":
        raise HTTPException(status_code=400, detail="TELEGRAM_BOT_TOKEN not configured")
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
            json={"url": webhook_url, "allowed_updates": ["message"]},
        )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(status_code=400, detail=data.get("description", "Failed"))
    return {"ok": True, "description": data.get("description"), "webhook_url": webhook_url}


@api_router.get("/admin/export-users")
async def export_users_csv(admin_key: str = ""):
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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
    """Public endpoint  no auth required. Returns current room bet limits."""
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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
    if not verify_admin_key(admin_key):
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


#  Arena energy endpoints 

@api_router.post("/arena/energy/spend")
async def spend_energy(request: Request):
    user_id = get_authenticated_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    async with get_pool().acquire() as conn:
        energy_data = await _get_and_regen_energy(str(user_id), conn)
        if energy_data["energy"] < 1:
            raise HTTPException(status_code=400, detail={
                "message": "Not enough energy",
                "next_energy_at": energy_data["next_energy_at"]
            })
        new_energy = energy_data["energy"] - 1
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        await conn.execute(
            "UPDATE users SET energy = $1, energy_last_regen = COALESCE(energy_last_regen, $2) WHERE id = $3",
            new_energy, now, str(user_id)
        )
        next_at = None
        if new_energy < 10:
            row = await conn.fetchrow("SELECT energy_last_regen FROM users WHERE id = $1", str(user_id))
            lr = row["energy_last_regen"]
            if lr.tzinfo is None:
                lr = lr.replace(tzinfo=timezone.utc)
            next_at = (lr + timedelta(hours=1)).isoformat()
        return {"ok": True, "energy": new_energy, "max_energy": 10, "next_energy_at": next_at}


@api_router.post("/arena/energy/buy")
async def buy_energy(request: Request):
    # TODO: implement token purchase of energy
    raise HTTPException(status_code=501, detail="Coming soon")


#  Real-time arena: internal match result endpoint (called by Colyseus) 
import os as _os

INTERNAL_SECRET = _os.environ.get("INTERNAL_SECRET", "")
RT_WINNER_COINS = 100
RT_LOSER_COINS  = 20
RT_WINNER_XP    = 120
RT_LOSER_XP     = 30
_RT_STREAK_MILESTONES = {3: 50, 5: 100, 7: 200}
_processed_realtime_result_rooms: set[str] = set()
_realtime_result_lock = asyncio.Lock()
def _clamp_number(value: Any, minimum: float, maximum: float, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return max(minimum, min(maximum, number))


def _battle_ability_payload(class_name: Optional[str], ability_item: Dict[str, Any]) -> Dict[str, Any]:
    cls = (class_name or "").lower()
    ability_key = str(ability_item.get("ability_key") or "")
    if not battle_ability_allowed_for_class(cls, ability_key):
        return {
            "active_ability_key": None,
            "active_ability_name": None,
            "active_ability_icon": None,
            "active_ability_cooldown_ms": 0,
            "active_ability_stats": None,
        }
    default_cooldown = battle_ability_cooldown_ms(ability_key)
    requested_cooldown = int(_clamp_number(ability_item.get("ability_cooldown_ms"), 0, 30000, 0))
    cooldown = max(requested_cooldown or default_cooldown, default_cooldown)
    return {
        "active_ability_key": ability_key,
        "active_ability_name": ability_item.get("name"),
        "active_ability_icon": ability_item.get("image_path"),
        "active_ability_cooldown_ms": cooldown,
        "active_ability_stats": battle_ability_stats(ability_key),
    }

class RealtimeMatchResultBody(BaseModel):
    winner_user_id: str
    loser_user_id: str
    by_disconnect: bool = False
    room_id: str = ""
    winner_stats: Optional[Dict[str, Any]] = None
    loser_stats: Optional[Dict[str, Any]] = None

@api_router.post("/internal/match-result")
async def realtime_match_result(body: RealtimeMatchResultBody, http_request: Request):
    secret = http_request.headers.get("x-internal-secret", "")
    if not INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="INTERNAL_SECRET is not configured")
    if not secrets.compare_digest(secret, INTERNAL_SECRET):
        raise HTTPException(status_code=403, detail="Unauthorized")
    if not body.room_id:
        raise HTTPException(status_code=400, detail="room_id is required")
    if body.winner_user_id == body.loser_user_id:
        raise HTTPException(status_code=400, detail="winner and loser must differ")
    try:
        winner_uuid = uuid.UUID(body.winner_user_id)
        loser_uuid  = uuid.UUID(body.loser_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid participant id")
    winner_id = str(winner_uuid)
    loser_id = str(loser_uuid)

    async with _realtime_result_lock:
        if body.room_id in _processed_realtime_result_rooms:
            raise HTTPException(status_code=409, detail="Match result already processed")

        async with get_pool().acquire() as conn:
            async with conn.transaction():
                xp_multiplier = await event_effects.multiplier(conn, "xp_multiplier")
                coin_multiplier = await event_effects.multiplier(conn, "coin_multiplier")
                winner_coins = round(RT_WINNER_COINS * coin_multiplier)
                loser_coins = round(RT_LOSER_COINS * coin_multiplier)
                winner_xp = round(RT_WINNER_XP * xp_multiplier)
                loser_xp = round(RT_LOSER_XP * xp_multiplier)
                participant_rows = await conn.fetch(
                    "SELECT id, xp FROM users WHERE id = ANY($1::text[]) FOR UPDATE",
                    [winner_id, loser_id],
                )
                participants = {str(row["id"]): row for row in participant_rows}
                if winner_id not in participants or loser_id not in participants:
                    raise HTTPException(status_code=404, detail="Match participant not found")

                w_row = participants[winner_id]
                w_xp_res = _progression.award_xp_result(int(w_row["xp"]), winner_xp)
                await conn.execute(
                    """UPDATE users
                       SET token_balance = token_balance + $2,
                           xp            = $3,
                           level         = $4,
                           wins          = wins + 1
                       WHERE id = $1""",
                    winner_id,
                    winner_coins,
                    w_xp_res["new_xp"],
                    w_xp_res["new_level"],
                )

                streak_row = await conn.fetchrow(
                    """UPDATE users
                       SET current_win_streak = current_win_streak + 1,
                           max_win_streak     = GREATEST(max_win_streak, current_win_streak + 1)
                       WHERE id = $1
                       RETURNING current_win_streak""",
                    winner_id,
                )
                new_streak = streak_row["current_win_streak"] if streak_row else 0
                streak_bonus = round(_RT_STREAK_MILESTONES.get(new_streak, 0) * coin_multiplier)
                if streak_bonus:
                    await conn.execute(
                        "UPDATE users SET token_balance = token_balance + $2 WHERE id = $1",
                        winner_id, streak_bonus,
                    )

                l_row = participants[loser_id]
                l_xp_res = _progression.award_xp_result(int(l_row["xp"]), loser_xp)
                await conn.execute(
                    """UPDATE users
                       SET token_balance      = token_balance + $2,
                           xp                 = $3,
                           level              = $4,
                           losses             = losses + 1,
                           current_win_streak = 0
                       WHERE id = $1""",
                    loser_id,
                    loser_coins,
                    l_xp_res["new_xp"],
                    l_xp_res["new_level"],
                )

        _processed_realtime_result_rooms.add(body.room_id)

    #  Daily quest hooks (outside transaction  non-fatal) 
    await asyncio.gather(
        _daily_quests.increment_quest(body.winner_user_id, "play_match"),
        _daily_quests.increment_quest(body.loser_user_id,  "play_match"),
        _daily_quests.increment_quest(body.winner_user_id, "win_arena"),
        return_exceptions=True,
    )

    return {
        "ok": True,
        "winner_coins": winner_coins,
        "winner_xp": winner_xp,
        "winner_level": w_xp_res["new_level"],
        "winner_leveled_up": w_xp_res["leveled_up"],
        "winner_streak": new_streak,
        "streak_bonus": streak_bonus,
    }


@api_router.get("/internal/user-loadout/{user_id}")
async def get_user_loadout_internal(user_id: str, request: Request):
    secret = request.headers.get("x-internal-secret", "")
    if not INTERNAL_SECRET:
        raise HTTPException(status_code=500, detail="INTERNAL_SECRET is not configured")
    if not secrets.compare_digest(secret, INTERNAL_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")
    equipped_rows = await _fetch_equipped_snapshot(user_id)
    async with get_pool().acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT class_name, character_build_json FROM users WHERE id = $1",
            user_id,
        )
    class_name = user_row["class_name"] if user_row else None
    character_build = _character_build_for_user_payload(dict(user_row) if user_row else {"class_name": class_name})
    battle_sprite = await _battle_spritesheet_for_loadout(user_id, class_name, equipped_rows, character_build)
    # aggregate_item_modifiers expects a list of row dicts; _fetch_equipped_snapshot returns a dict of slotitem
    item_list = [v for v in equipped_rows.values() if v is not None]
    stats = modifiers_to_dict(aggregate_item_modifiers(item_list))
    attack_bonus = float(stats.get("attack_bonus", 0) or 0)
    ability_bonus = float(stats.get("ability_bonus", 0) or 0)
    attack_bonus *= 1 + float(stats.get("bonus_attack_percent", 0) or 0)
    ability_bonus *= 1 + float(stats.get("bonus_ability_percent", 0) or 0)
    ability_item = equipped_rows.get("ability") or {}
    ability_payload = _battle_ability_payload(class_name, ability_item)
    return {
        "user_id": user_id,
        "attack_bonus": int(_clamp_number(round(attack_bonus), 0, 500, 0)),
        "ability_bonus": int(_clamp_number(round(ability_bonus), 0, 500, 0)),
        "defend_reduction": _clamp_number(
            float(stats.get("defend_reduction", 0) or 0) + float(stats.get("damage_reduction_percent", 0) or 0),
            0,
            0.85,
            0,
        ),
        "hp_bonus": int(_clamp_number(stats.get("hp_bonus", 0), 0, 1000, 0)),
        "has_weapon": equipped_rows.get("weapon") is not None,
        "weapon_enchant": int(_clamp_number((equipped_rows.get("weapon") or {}).get("enchant_level", 0), 0, 10, 0)),
        **ability_payload,
        "character_build_json": character_build,
        "battle_spritesheet_path": battle_sprite["path"],
        "battle_spritesheet_hash": battle_sprite["hash"],
    }

# 

# Include Arena MVP routes before mounting the API router.
from arena_api import router as arena_router
api_router.include_router(arena_router)

# Include Boss Raid routes.
import boss_api as _boss_api_module
from boss_api import router as boss_router
api_router.include_router(boss_router)
_boss_api_module.set_sio(sio)  # give boss_api access to the Socket.IO server

GENERATED_ASSET_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=str(GENERATED_ASSET_ROOT)), name="generated")

# Include the router
@api_router.get("/events")
async def get_active_events():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, event_type, description, config, starts_at, ends_at
            FROM game_events
            WHERE is_active = TRUE
              AND starts_at <= NOW()
              AND (ends_at IS NULL OR ends_at > NOW())
            ORDER BY starts_at DESC
            """
        )
    return {"events": [json.loads(json.dumps(dict(row), default=str)) for row in rows]}


api_router.include_router(admin_gm.router)
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
        logger.info(" DB migrations applied on startup")
    except Exception as e:
        logger.error(f" DB migrations warning: {e}")

    await initialize_rooms()

    # Start Solana payment monitoring
    await payment_monitor.start_monitoring()

    # Run payment auto-recovery system (scans last 24 hours for missed payments)
    logger.info(" Running payment auto-recovery on startup...")
    try:
        processor = get_processor(None)
        recovery_result = await run_startup_recovery(None, processor)
        logger.info(f" Auto-recovery complete: {recovery_result}")
    except Exception as e:
        logger.error(f" Auto-recovery failed: {e}")

    # Start redundant payment scanner (backup detection system)
    asyncio.create_task(redundant_payment_scanner())

    # Start wallet cleanup scheduler with grace period
    asyncio.create_task(wallet_cleanup_scheduler())

    # Start Arena Duel timeout resolver
    asyncio.create_task(arena_timeout_resolver())

    # Start Boss Raid spawner / expiry settler
    asyncio.create_task(boss_raid_spawner())

    # Do not delete game history on startup in production.
    try:
        deleted_count = 0
        logging.info("[Startup] Game history cleanup disabled")
    except Exception as e:
        logging.error(f" [Startup] Failed to clear game history: {e}")

    logging.info("RiskArena API started")
    logging.info(f" Active rooms: {len(active_rooms)}")
    logging.info(f"Solana monitoring: {'Enabled' if RISKARENA_WALLET_ADDRESS != 'YourWalletAddressHere12345678901234567890123456789' else 'Disabled (set RISKARENA_WALLET_ADDRESS)'}")
    logging.info(" Redundant payment scanner: Enabled (15s interval - FAST detection)")
    logging.info(" Wallet cleanup scheduler: Enabled (72h grace period)")

async def redundant_payment_scanner():
    """
    Background task that periodically rescans all pending payments
    This catches payments missed by the real-time monitoring system
    Runs every 15 seconds for fast detection
    """
    from solana_integration import get_processor
    
    # Wait a bit before starting to ensure DB is ready
    await asyncio.sleep(10)
    
    logging.info(" [Scanner] Redundant payment scanner started (15s interval)")
    
    while True:
        try:
            processor = get_processor(None)
            await processor.rescan_pending_payments()
        except Exception as e:
            logging.error(f" [Scanner] Error in redundant payment scanner: {e}")
            import traceback
            logging.error(traceback.format_exc())
        
        # Wait 15 seconds before next scan (faster detection)
        await asyncio.sleep(15)


async def arena_timeout_resolver():
    await asyncio.sleep(5)
    logging.info("[Arena] Timeout resolver started")
    while True:
        try:
            resolved = await arena_repo.resolve_expired_rounds()
            if resolved:
                logging.info(f"[Arena] Resolved {resolved} expired round(s)")
        except Exception as e:
            logging.error(f"[Arena] Timeout resolver error: {e}")
            import traceback
            logging.error(traceback.format_exc())
        await asyncio.sleep(5)


async def boss_raid_spawner():
    """
    Background task (60s interval) that:
    1. Settles any active raids whose deadline has passed.
    2. Spawns a new boss when no active raid exists.
    """
    import boss_repo as _boss_repo
    import boss_domain as _boss_domain

    await asyncio.sleep(10)
    logging.info("[BossRaid] Spawner started (60s interval)")

    while True:
        try:
            # Settle expired raids in the DB. Client notification (raid_finished) is
            # handled by the Colyseus BossRaidRoom, which detects expiry on its liveness
            # poll and broadcasts settled rewards  no Socket.IO emit needed here (Phase 6).
            settled = await _boss_repo.settle_expired_raids()
            for s in settled:
                logging.info(f"[BossRaid] Settled expired raid {s['raid_id']}: {s['name']}")

            # Spawn a new boss if none is active AND the 1h respawn grid allows it.
            # next_spawn_at() = previous raid's created_at + RESPAWN_INTERVAL, so an early
            # kill does NOT instantly respawn  the next boss waits for its hourly slot.
            active = await _boss_repo.get_active_raid()
            if not active and datetime.now(timezone.utc) >= await _boss_repo.next_spawn_at():
                name = random.choice(_boss_domain.BOSS_NAMES)
                level = random.randint(1, 5)
                raid = await _boss_repo.spawn_raid(name, level)
                logging.info(
                    f"[BossRaid] Spawned '{name}' level {level} "
                    f"(HP {raid['max_hp']}, ends {raid['raid_end_at']})"
                )
                await sio.emit("boss_spawned", {
                    "id": raid["id"],
                    "name": raid["name"],
                    "level": raid["level"],
                    "max_hp": raid["max_hp"],
                    "current_hp": raid["current_hp"],
                    "phase": raid["phase"],
                    "raid_end_at": raid["raid_end_at"],
                    "status": "active",
                })
        except Exception as exc:
            logging.error(f"[BossRaid] Spawner error: {exc}")
            import traceback
            logging.error(traceback.format_exc())

        await asyncio.sleep(60)


async def wallet_cleanup_scheduler():
    """
    Background task that periodically cleans up old completed wallets
    Runs every 24 hours with 72-hour grace period
    SAFETY: Only removes private keys from wallets that have been successfully swept
    """
    from solana_integration import get_processor
    
    # Wait 1 hour after startup before first cleanup
    await asyncio.sleep(3600)
    
    logging.info(" [Cleanup Scheduler] Wallet cleanup scheduler started (24h interval, 72h grace period)")
    
    while True:
        try:
            processor = get_processor(None)
            result = await processor.cleanup_old_wallets_with_grace_period(grace_period_hours=120)
            
            logging.info(f" [Cleanup Scheduler] Cleanup complete:")
            logging.info(f"   Cleaned: {result.get('cleaned', 0)} wallets")
            logging.info(f"   Blocked: {result.get('blocked', 0)} wallets (funds still present)")
            logging.info(f"   Flagged: {result.get('flagged_for_review', 0)} wallets need manual review")
            
        except Exception as e:
            logging.error(f" [Cleanup Scheduler] Error: {e}")
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
            logging.info(f" [Game History] {total_games} games in history (limit 5); old entries managed by DB retention policy")

    except Exception as e:
        logging.error(f" [Game History Cleanup] Error: {e}")
    
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    payment_monitor.monitoring = False
    await close_pool()
    logging.info("RiskArena API shutting down")

# Export the socket app for uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
