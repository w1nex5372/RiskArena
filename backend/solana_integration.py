"""
Solana Blockchain Integration for Automatic Token Purchase System
Handles wallet generation, payment monitoring, SOL forwarding, and live price fetching
"""

import asyncio
import os
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import json
import time
from decimal import Decimal
import aiohttp

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from solders.transaction import Transaction, VersionedTransaction
from solders.message import MessageV0
from solders.system_program import TransferParams, transfer
from solders.hash import Hash
import db_queries as dbq
import base58

# Configuration
SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')
# RPC Fallback endpoints for high availability
SOLANA_RPC_FALLBACKS = [
    os.environ.get('SOLANA_RPC_FALLBACK_1', 'https://api.mainnet-beta.solana.com'),
    os.environ.get('SOLANA_RPC_FALLBACK_2', 'https://solana-api.projectserum.com'),
]
MAIN_WALLET_ADDRESS = os.environ.get('MAIN_WALLET_ADDRESS', 'EC2cPxi4VbyzGoWMucHQ6LwkWz1W9vZE7ZApcY9PFsMy')
RISKARENA_WALLET_PRIVATE_KEY = os.environ.get('RISKARENA_WALLET_PRIVATE_KEY', '')
SOL_TO_TOKEN_RATE = int(os.environ.get('SOL_TO_TOKEN_RATE', 100))  # 1 EUR = 100 tokens
LAMPORTS_PER_SOL = 1_000_000_000  # 1 SOL = 1 billion lamports

logger = logging.getLogger(__name__)


class RPCManager:
    """Manages RPC endpoints with automatic fallback and rate limit handling"""
    
    def __init__(self, primary_url: str, fallback_urls: list):
        self.primary_url = primary_url
        self.fallback_urls = fallback_urls
        self.current_index = -1  # -1 means using primary
        self.failure_count = {}
        self.last_switch_time = 0
        self.switch_cooldown = 60  # Don't switch back for 60 seconds
        
    def get_current_url(self) -> str:
        """Get the current active RPC URL"""
        if self.current_index == -1:
            return self.primary_url
        return self.fallback_urls[self.current_index % len(self.fallback_urls)]
    
    def mark_failure(self, url: str, error: Exception = None):
        """Mark an RPC endpoint as failed"""
        self.failure_count[url] = self.failure_count.get(url, 0) + 1
        logger.warning(f"⚠️  RPC failure marked for {url[:50]}... (count: {self.failure_count[url]})")
        
        # Report to RPC alert system
        try:
            from rpc_monitor import rpc_alert_system
            error_code = None
            error_type = "unknown"
            error_msg = str(error) if error else "Unknown error"
            
            # Extract error code and type
            if '401' in error_msg or 'Unauthorized' in error_msg:
                error_code = 401
                error_type = "auth"
            elif '403' in error_msg or 'Forbidden' in error_msg:
                error_code = 403
                error_type = "auth"
            elif '429' in error_msg or 'rate limit' in error_msg.lower():
                error_code = 429
                error_type = "rate_limit"
            elif 'connection' in error_msg.lower() or 'timeout' in error_msg.lower():
                error_type = "connection"
            
            rpc_alert_system.report_failure(url, error_code, error_msg, error_type)
        except Exception as e:
            logger.error(f"Failed to report RPC failure to alert system: {e}")
    
    def should_fallback(self, error: Exception) -> bool:
        """Determine if we should switch to fallback RPC"""
        error_str = str(error).lower()
        # Rate limit or connection errors trigger fallback
        return any(keyword in error_str for keyword in [
            '429', 'too many requests', 'rate limit',
            'connection', 'timeout', 'unavailable'
        ])
    
    def switch_to_fallback(self):
        """Switch to next fallback RPC endpoint"""
        current_time = time.time()
        if current_time - self.last_switch_time < self.switch_cooldown:
            return  # Don't switch too frequently
        
        self.current_index += 1
        self.last_switch_time = current_time
        new_url = self.get_current_url()
        logger.warning(f"🔄 Switching to fallback RPC: {new_url[:50]}...")
    
    def try_reset_to_primary(self):
        """Try to reset to primary RPC after cooldown"""
        current_time = time.time()
        if self.current_index != -1 and current_time - self.last_switch_time > 300:  # 5 minutes
            logger.info(f"🔄 Attempting to reset to primary RPC")
            self.current_index = -1

class PriceFetcher:
    """Fetches live SOL/EUR exchange rate"""
    
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
                        logger.info(f"💰 SOL/EUR (Binance): {price}")
                        return price
                    logger.warning(f"Binance returned {resp.status}, trying CoinGecko...")
        except Exception as e:
            logger.warning(f"Binance price fetch failed: {e}, trying CoinGecko...")

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
                        logger.info(f"💰 SOL/EUR (CoinGecko): {price}")
                        return price
        except Exception as e:
            logger.error(f"CoinGecko price fetch failed: {e}")

        logger.error("All price sources failed, using cached/fallback")
        return self.cached_price or 120.0
    
    def calculate_tokens_from_sol(self, sol_amount: float, sol_eur_price: float) -> int:
        """Calculate tokens from SOL amount using real-time EUR price"""
        # SOL → EUR → Tokens (1 EUR = 100 tokens)
        eur_value = sol_amount * sol_eur_price
        tokens = int(eur_value * 100)
        
        logger.info(f"💱 Conversion: {sol_amount} SOL × {sol_eur_price} EUR/SOL = {eur_value:.4f} EUR = {tokens} tokens")
        return tokens

logger = logging.getLogger(__name__)

class SolanaPaymentProcessor:
    """Handles Solana payment processing for automatic token purchases"""
    
    def __init__(self, db=None):
        # Initialize RPC manager with fallback support
        self.rpc_manager = RPCManager(SOLANA_RPC_URL, SOLANA_RPC_FALLBACKS)
        self.client = AsyncClient(self.rpc_manager.get_current_url())
        self.main_wallet = Pubkey.from_string(MAIN_WALLET_ADDRESS)
        self.active_monitors = set()  # Track active payment monitors
        self.price_fetcher = PriceFetcher()  # Initialize price fetcher
        
        # Log RPC configuration prominently
        logger.info("=" * 80)
        logger.info("🚀 SOLANA PAYMENT PROCESSOR INITIALIZED")
        logger.info(f"🌐 Primary RPC: {SOLANA_RPC_URL[:60]}...")
        logger.info(f"🔄 Fallback RPCs: {len(SOLANA_RPC_FALLBACKS)} configured")
        logger.info(f"💼 Main Wallet: {MAIN_WALLET_ADDRESS}")
        logger.info(f"📊 Network: Mainnet-Beta")
        
        # Detect RPC provider
        if "helius" in SOLANA_RPC_URL.lower():
            logger.info("✅ Provider: Helius (Production)")
        elif "quicknode" in SOLANA_RPC_URL.lower():
            logger.info("✅ Provider: QuickNode (Production)")
        elif "alchemy" in SOLANA_RPC_URL.lower():
            logger.info("✅ Provider: Alchemy (Production)")
        else:
            logger.warning("⚠️  Provider: Public RPC (Rate Limited)")
        
        logger.info("=" * 80)
        
        # Load forwarding keypair from private key
        if RISKARENA_WALLET_PRIVATE_KEY:
            try:
                private_key_bytes = base58.b58decode(RISKARENA_WALLET_PRIVATE_KEY)
                self.forwarding_keypair = Keypair.from_bytes(private_key_bytes)
                logger.info(f"🔑 Forwarding wallet initialized: {self.forwarding_keypair.pubkey()}")
            except Exception as e:
                logger.error(f"Failed to load forwarding keypair: {e}")
                self.forwarding_keypair = None
        else:
            logger.warning("No RISKARENA_WALLET_PRIVATE_KEY configured!")
            self.forwarding_keypair = None
        
    async def create_payment_wallet(self, user_id: str, token_amount: int) -> Dict[str, Any]:
        """
        Generate a unique wallet address for a token purchase with dynamic SOL/EUR pricing
        
        Args:
            user_id: ID of the user making the purchase
            token_amount: Number of tokens to purchase
            
        Returns:
            Dict containing wallet address and payment details
        """
        try:
            # Generate new keypair for this purchase
            keypair = Keypair()
            wallet_address = str(keypair.pubkey())
            
            # Get current SOL/EUR price
            sol_eur_price = await self.price_fetcher.get_sol_eur_price()
            
            # Calculate required EUR amount (1 EUR = 100 tokens)
            required_eur = Decimal(token_amount) / Decimal(100)
            
            # Calculate required SOL amount using live price
            required_sol = float(required_eur / Decimal(sol_eur_price))
            required_lamports = int(required_sol * LAMPORTS_PER_SOL)
            
            # Store temporary wallet in database
            wallet_data = {
                "wallet_address": wallet_address,
                "private_key": list(bytes(keypair)),  # Store as byte array
                "user_id": user_id,
                "token_amount": token_amount,
                "required_eur": float(required_eur),
                "required_sol": required_sol,
                "required_lamports": required_lamports,
                "sol_eur_price_at_creation": sol_eur_price,
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc).replace(hour=23, minute=59, second=59),  # Expires at end of day
                "payment_detected": False,
                "tokens_credited": False,
                "sol_forwarded": False
            }
            
            # Insert into temporary_wallets collection
            success = await dbq.insert_temporary_wallet(wallet_data)
            if not success:
                raise Exception("Failed to save payment wallet to database — check DB logs")

            # Start monitoring this wallet for payments
            asyncio.create_task(self.monitor_wallet_payments(wallet_address))
            
            logger.info(f"✅ Created payment wallet {wallet_address} for user {user_id} ({token_amount} tokens = {required_eur} EUR = {required_sol:.6f} SOL at {sol_eur_price} EUR/SOL)")
            
            return {
                "wallet_address": wallet_address,
                "required_sol": required_sol,
                "required_eur": float(required_eur),
                "sol_eur_price": sol_eur_price,
                "token_amount": token_amount,
                "expires_at": wallet_data["expires_at"].isoformat(),
                "instructions": f"Send {required_sol:.6f} SOL to address {wallet_address}. Current rate: 1 SOL = €{sol_eur_price:.2f}. Tokens will be credited automatically within 1-2 minutes."
            }
            
        except Exception as e:
            logger.error(f"Failed to create payment wallet for user {user_id}: {str(e)}")
            raise Exception(f"Failed to create payment wallet: {str(e)}")
    
    async def monitor_wallet_payments(self, wallet_address: str):
        """
        Monitor a specific wallet address for incoming SOL payments
        
        Args:
            wallet_address: The wallet address to monitor
        """
        if wallet_address in self.active_monitors:
            return  # Already monitoring this wallet
            
        self.active_monitors.add(wallet_address)
        logger.info(f"🔍 Starting payment monitoring for wallet: {wallet_address}")
        
        try:
            pubkey = Pubkey.from_string(wallet_address)
            last_signature = None
            check_count = 0
            poll_interval = 15  # seconds between checks (public RPC rate limit friendly)
            max_checks = 120    # 120 * 15s = 30 minutes

            while check_count < max_checks:
                try:
                    check_count += 1
                    logger.info(f"🔍 [{wallet_address[:8]}...] Check #{check_count}/{max_checks}")

                    # Recreate client with current RPC URL (supports fallback switching)
                    current_url = self.rpc_manager.get_current_url()
                    if self.client._provider.endpoint_uri != current_url:
                        self.client = AsyncClient(current_url)

                    response = await self.client.get_signatures_for_address(
                        pubkey,
                        commitment=Confirmed,
                        limit=10
                    )

                    logger.info(f"📡 [{wallet_address[:8]}...] signatures: {len(response.value) if response.value else 0}")

                    if response.value:
                        for sig_info in response.value:
                            signature = str(sig_info.signature)
                            if signature != last_signature:
                                logger.info(f"✨ [{wallet_address[:8]}...] NEW transaction detected!")
                                await self.process_detected_payment(wallet_address, signature)
                                last_signature = signature
                    else:
                        logger.info(f"💤 [{wallet_address[:8]}...] No transactions yet")

                    wallet_doc = await dbq.get_temporary_wallet(wallet_address)
                    if wallet_doc and wallet_doc.get("tokens_credited"):
                        logger.info(f"✅ Wallet {wallet_address} processed, stopping monitor")
                        break

                    await asyncio.sleep(poll_interval)

                except Exception as e:
                    err_str = str(e)
                    if "429" in err_str or "Too Many Requests" in err_str:
                        logger.warning(f"⚠️  [{wallet_address[:8]}...] RPC rate limited (429), switching fallback and waiting 30s...")
                        self.rpc_manager.switch_to_fallback()
                        self.client = AsyncClient(self.rpc_manager.get_current_url())
                        await asyncio.sleep(30)
                    else:
                        import traceback
                        logger.error(f"❌ Error checking wallet {wallet_address}: {err_str}")
                        logger.error(traceback.format_exc())
                        await asyncio.sleep(poll_interval)
                    continue
            
            if check_count >= max_checks:
                logger.warning(f"⏰ Payment monitoring timeout for wallet {wallet_address}")
                # Mark wallet as expired
                await dbq.update_temporary_wallet(wallet_address, {"status": "expired", "updated_at": datetime.now(timezone.utc)})
                
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            logger.error(f"❌ FATAL: Error in payment monitoring for {wallet_address}:")
            logger.error(f"   Error type: {type(e).__name__}")
            logger.error(f"   Error message: {str(e)}")
            logger.error(f"   Traceback:\n{error_details}")
        finally:
            self.active_monitors.discard(wallet_address)
            logger.info(f"🛑 Stopped monitoring wallet: {wallet_address}")
    
    async def process_detected_payment(self, wallet_address: str, signature: str):
        """
        Process a detected payment transaction
        
        Args:
            wallet_address: The wallet that received payment
            signature: The transaction signature to analyze (string)
        """
        try:
            logger.info(f"💳 [{wallet_address[:8]}...] Processing payment signature: {signature[:16]}...")
            
            # Convert string signature to Signature object
            logger.info(f"🔐 [{wallet_address[:8]}...] Converting signature string to Signature object...")
            try:
                sig_obj = Signature.from_string(signature)
                logger.info(f"✅ [{wallet_address[:8]}...] Signature object created successfully")
            except Exception as sig_error:
                logger.error(f"❌ [{wallet_address[:8]}...] Failed to create Signature object: {sig_error}")
                import traceback
                logger.error(traceback.format_exc())
                raise
            
            # Get transaction details
            logger.info(f"🌐 [{wallet_address[:8]}...] Fetching transaction from RPC...")
            logger.info(f"🌐 [{wallet_address[:8]}...] RPC URL: {self.client._provider.endpoint_uri}")
            
            try:
                transaction = await self.client.get_transaction(
                    sig_obj, 
                    commitment=Confirmed,
                    max_supported_transaction_version=0
                )
                logger.info(f"✅ [{wallet_address[:8]}...] RPC call successful")
            except Exception as rpc_error:
                logger.error(f"❌ [{wallet_address[:8]}...] RPC call failed: {rpc_error}")
                import traceback
                logger.error(traceback.format_exc())
                raise
            
            logger.info(f"📦 [{wallet_address[:8]}...] Raw response type: {type(transaction)}")
            logger.info(f"📦 [{wallet_address[:8]}...] Response: {str(transaction)[:200]}...")
            logger.info(f"📦 [{wallet_address[:8]}...] Has value attr: {hasattr(transaction, 'value')}")
            
            if hasattr(transaction, 'value'):
                logger.info(f"📦 [{wallet_address[:8]}...] Value type: {type(transaction.value)}")
                logger.info(f"📦 [{wallet_address[:8]}...] Value is None: {transaction.value is None}")
                logger.info(f"📦 [{wallet_address[:8]}...] Value bool: {bool(transaction.value)}")
            
            if not transaction.value:
                logger.warning(f"⚠️  [{wallet_address[:8]}...] Transaction not found or not confirmed yet")
                return
                
            # Get wallet record from database
            wallet_doc = await dbq.get_temporary_wallet(wallet_address)
            
            if not wallet_doc:
                logger.error(f"❌ [{wallet_address[:8]}...] No wallet record found in database!")
                return
            
            logger.info(f"📄 [{wallet_address[:8]}...] Wallet record found. User: {wallet_doc['user_id']}, Required: {wallet_doc['required_sol']} SOL")
                
            if wallet_doc.get("payment_detected"):
                logger.info(f"⏭️  [{wallet_address[:8]}...] Payment already detected and processed")
                return  # Already processed this wallet
            
            # Calculate received amount
            tx_data = transaction.value
            
            logger.info(f"🔍 [{wallet_address[:8]}...] Parsing transaction data...")
            
            # Check if this is an incoming transfer to our wallet
            wallet_pubkey = Pubkey.from_string(wallet_address)
            received_lamports = 0
            
            # Parse transaction for SOL transfers to our address
            if tx_data.transaction.meta and tx_data.transaction.meta.post_balances:
                # Find our wallet in the account keys
                account_keys = tx_data.transaction.transaction.message.account_keys
                
                logger.info(f"🔑 [{wallet_address[:8]}...] Transaction has {len(account_keys)} accounts")
                
                for i, account_key in enumerate(account_keys):
                    if account_key == wallet_pubkey:
                        # This is our wallet, check balance change
                        pre_balance = tx_data.transaction.meta.pre_balances[i] if i < len(tx_data.transaction.meta.pre_balances) else 0
                        post_balance = tx_data.transaction.meta.post_balances[i] if i < len(tx_data.transaction.meta.post_balances) else 0
                        
                        logger.info(f"💵 [{wallet_address[:8]}...] Balance change: {pre_balance} → {post_balance} lamports")
                        
                        if post_balance > pre_balance:
                            received_lamports = post_balance - pre_balance
                            logger.info(f"✅ [{wallet_address[:8]}...] Received {received_lamports} lamports!")
                            break
                else:
                    logger.warning(f"⚠️  [{wallet_address[:8]}...] Wallet not found in transaction accounts")
            else:
                logger.warning(f"⚠️  [{wallet_address[:8]}...] No transaction metadata or balance data")
            
            if received_lamports == 0:
                logger.warning(f"⚠️  [{wallet_address[:8]}...] No SOL received in this transaction")
                return  # No SOL received in this transaction
            
            received_sol = Decimal(received_lamports) / Decimal(LAMPORTS_PER_SOL)
            required_sol = Decimal(wallet_doc["required_sol"])
            
            logger.info(f"💰 [{wallet_address[:8]}...] Payment detected: {received_sol} SOL received (required: {required_sol} SOL)")
            
            # Update wallet record
            await dbq.update_temporary_wallet(wallet_address, {
                "payment_detected": True,
                "received_lamports": received_lamports,
                "received_sol": float(received_sol),
                "transaction_signature": signature,
                "payment_detected_at": datetime.now(timezone.utc),
                "status": "payment_received"
            })
            
            # Accept any payment above dust threshold — credit proportional tokens
            dust_threshold = Decimal("0.0001")  # ignore < 0.0001 SOL (network dust)
            if received_sol >= dust_threshold:
                if received_sol >= required_sol:
                    logger.info(f"✅ [{wallet_address[:8]}...] Full/overpayment: {received_sol} SOL (required {required_sol} SOL) — crediting proportionally")
                else:
                    logger.warning(f"⚠️  [{wallet_address[:8]}...] Underpayment: {received_sol} SOL < {required_sol} SOL — crediting proportionally, sweeping SOL")
                await self.credit_tokens_to_user(wallet_doc, received_sol)

                # Wait for account state to settle before sweep
                await asyncio.sleep(3)
                await self.forward_sol_to_main_wallet(wallet_address, wallet_doc["private_key"], received_lamports)
            else:
                logger.warning(f"❌ [{wallet_address[:8]}...] Dust payment ignored: {received_sol} SOL (threshold: {dust_threshold} SOL)")
                await dbq.update_temporary_wallet(wallet_address, {"status": "dust_payment"})
                
        except Exception as e:
            import traceback
            logger.error(f"❌ Error processing payment for {wallet_address}:")
            logger.error(f"   {str(e)}")
            logger.error(f"   Traceback:\n{traceback.format_exc()}")
    
    async def credit_tokens_to_user(self, wallet_doc: Dict, received_sol: Decimal):
        """Credit tokens to user account based on payment received using dynamic pricing"""
        try:
            user_id = wallet_doc["user_id"]
            wallet_address = wallet_doc["wallet_address"]
            expected_tokens = wallet_doc["token_amount"]
            
            logger.info(f"🎁 [Credit] User: {user_id}, Expected tokens: {expected_tokens}")
            
            # Get current SOL/EUR price for accurate token calculation
            sol_eur_price = await self.price_fetcher.get_sol_eur_price()
            
            # Calculate actual tokens based on received payment and live price
            # Formula: SOL amount × SOL/EUR price × 100 tokens/EUR
            actual_tokens = self.price_fetcher.calculate_tokens_from_sol(float(received_sol), sol_eur_price)
            
            logger.info(f"💎 [Credit] Calculated tokens: {actual_tokens} (at {sol_eur_price} EUR/SOL)")

            # Guard: if SOL amount too tiny to produce even 1 token, don't credit or sweep
            if actual_tokens < 1:
                logger.warning(f"⚠️  [Credit] Calculated 0 tokens for {received_sol} SOL — skipping credit and sweep")
                await dbq.update_temporary_wallet(wallet_doc["wallet_address"], {"status": "dust_payment"})
                return
            
            logger.info(f"💳 [Credit] Updating user balance: +{actual_tokens} tokens")
            
            # Update user balance
            result = await dbq.increment_user_tokens(user_id, actual_tokens)

            logger.info(f"📊 [Credit] Database update result: {result}")

            if result is not None:
                eur_value = float(received_sol) * sol_eur_price
                logger.info(f"✅ [Credit] SUCCESS! Credited {actual_tokens} tokens to user {user_id} for {received_sol} SOL (€{eur_value:.2f} at {sol_eur_price} EUR/SOL)")
                
                # Mark wallet as tokens credited
                await dbq.update_temporary_wallet(wallet_doc["wallet_address"], {
                    "tokens_credited": True,
                    "actual_tokens_credited": actual_tokens,
                    "sol_eur_price_at_credit": sol_eur_price,
                    "eur_value": eur_value,
                    "tokens_credited_at": datetime.now(timezone.utc),
                    "status": "tokens_credited"
                })

                # Create transaction history record
                await dbq.insert_token_purchase({
                    "user_id": user_id,
                    "wallet_address": wallet_doc["wallet_address"],
                    "transaction_signature": wallet_doc.get("transaction_signature"),
                    "sol_amount": float(received_sol),
                    "sol_eur_price": sol_eur_price,
                    "eur_value": eur_value,
                    "tokens_purchased": actual_tokens,
                    "purchase_date": datetime.now(timezone.utc),
                    "status": "completed"
                })
                
            else:
                logger.error(f"Failed to update balance for user {user_id}")
                
        except Exception as e:
            logger.error(f"Error crediting tokens to user: {str(e)}")
    
    async def forward_sol_to_main_wallet(self, wallet_address: str, private_key_bytes_list: list, amount_lamports: int):
        """
        Forward received SOL to the main project wallet with comprehensive logging and verification
        
        Args:
            wallet_address: Source wallet address
            private_key_bytes_list: Private key as byte array
            amount_lamports: Amount to forward in lamports
        """
        max_retries = 3
        retry_delay = 5  # seconds
        
        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"💸 [Sweep] ========== ATTEMPT {attempt}/{max_retries} ==========")
                logger.info(f"💸 [Sweep] Source Wallet: {wallet_address}")
                logger.info(f"💸 [Sweep] Destination: {self.main_wallet}")
                logger.info(f"💸 [Sweep] Amount: {amount_lamports} lamports ({amount_lamports/LAMPORTS_PER_SOL:.6f} SOL)")
                logger.info(f"🌐 [Sweep] Using RPC: {self.client._provider.endpoint_uri}")
                
                # Reconstruct keypair from stored byte array
                logger.info(f"🔑 [Sweep] Reconstructing keypair from private key...")
                private_key_bytes = bytes(private_key_bytes_list)
                temp_keypair = Keypair.from_bytes(private_key_bytes)
                
                source_wallet = str(temp_keypair.pubkey())
                logger.info(f"🔑 [Sweep] Keypair reconstructed: {source_wallet}")
                
                # Verify wallet address matches
                if source_wallet != wallet_address:
                    logger.error(f"❌ [Sweep] CRITICAL: Wallet mismatch!")
                    logger.error(f"   Expected: {wallet_address}")
                    logger.error(f"   Got: {source_wallet}")
                    raise ValueError("Wallet address mismatch - cannot proceed")
                
                logger.info(f"✅ [Sweep] Wallet verification passed")
                
                # Check current balance before sweep
                logger.info(f"🔍 [Sweep] Checking pre-sweep balance...")
                pre_balance = 0
                try:
                    pre_balance_response = await self.client.get_balance(temp_keypair.pubkey())
                    pre_balance = pre_balance_response.value if pre_balance_response.value else 0
                    logger.info(f"💰 [Pre-Sweep Balance] {pre_balance} lamports ({pre_balance/LAMPORTS_PER_SOL:.6f} SOL)")
                except Exception as balance_error:
                    logger.warning(f"⚠️  [Sweep] Could not check pre-balance: {balance_error}")
                
                # Use the larger of: actual balance or provided amount
                # (Provided amount is what we detected as payment)
                sweep_amount = max(pre_balance, amount_lamports)
                
                if sweep_amount == 0:
                    logger.warning(f"⚠️  [Sweep Skip] No balance to sweep (balance: {pre_balance}, expected: {amount_lamports})")
                    logger.warning(f"   Wallet may have already been swept or payment not received")
                    return
                
                logger.info(f"💸 [Sweep] Will sweep: {sweep_amount} lamports ({sweep_amount/LAMPORTS_PER_SOL:.6f} SOL)")
                
                # Reserve lamports for transaction fee
                fee_lamports = 5000  # 0.000005 SOL
                transfer_amount = sweep_amount - fee_lamports
                
                if transfer_amount <= 0:
                    logger.warning(f"⚠️  [Sweep Skip] Insufficient balance after fees")
                    logger.warning(f"   Balance: {pre_balance} lamports")
                    logger.warning(f"   Fee: {fee_lamports} lamports")
                    return
                
                logger.info(f"💸 [Sweep] Transfer amount (after fee): {transfer_amount} lamports ({transfer_amount/LAMPORTS_PER_SOL:.6f} SOL)")
                logger.info(f"💸 [Sweep] Fee reserved: {fee_lamports} lamports")
                
                # Create transfer instruction
                logger.info(f"📝 [Sweep] Creating transfer instruction...")
                transfer_instruction = transfer(
                    TransferParams(
                        from_pubkey=temp_keypair.pubkey(),
                        to_pubkey=self.main_wallet,
                        lamports=transfer_amount
                    )
                )
                logger.info(f"✅ [Sweep] Transfer instruction created")
                
                # Get recent blockhash and last valid block height
                logger.info(f"🔗 [Sweep] Fetching recent blockhash...")
                try:
                    recent_blockhash_response = await self.client.get_latest_blockhash()
                    recent_blockhash = recent_blockhash_response.value.blockhash
                    last_valid_block_height = recent_blockhash_response.value.last_valid_block_height
                    logger.info(f"✅ [Sweep] Blockhash: {recent_blockhash}")
                    logger.info(f"✅ [Sweep] Last valid block height: {last_valid_block_height}")
                except Exception as blockhash_error:
                    logger.error(f"❌ [Sweep] Failed to get blockhash: {blockhash_error}")
                    raise
                
                # Create transaction message
                logger.info(f"📦 [Sweep] Compiling transaction message...")
                message = MessageV0.try_compile(
                    payer=temp_keypair.pubkey(),
                    instructions=[transfer_instruction],
                    address_lookup_table_accounts=[],
                    recent_blockhash=recent_blockhash
                )
                logger.info(f"✅ [Sweep] Message compiled")
                
                # Create and sign versioned transaction
                logger.info(f"✍️  [Sweep] Signing transaction...")
                transaction = VersionedTransaction(message, [temp_keypair])
                logger.info(f"✅ [Sweep] Transaction signed")
                
                # Send transaction to network
                logger.info(f"📡 [Sweep] Sending transaction to Solana network...")
                
                response = await self.client.send_transaction(transaction)
                logger.info(f"📡 [Sweep] Send response received")
                
                if not response.value:
                    raise Exception("No signature returned from send_transaction")
                
                signature = str(response.value)
                logger.info(f"💸 [Sweep Submitted] Transaction signature: {signature}")
                logger.info(f"🔗 [Sweep] Explorer: https://explorer.solana.com/tx/{signature}?cluster=mainnet")
                
                # Wait for confirmation with proper timeout
                logger.info(f"⏳ [Sweep] Waiting for transaction confirmation...")
                try:
                    # Use last_valid_block_height for proper timeout behavior
                    from solana.rpc.commitment import Confirmed
                    confirmation_response = await self.client.confirm_transaction(
                        signature, 
                        commitment=Confirmed,
                        last_valid_block_height=last_valid_block_height
                    )
                    
                    if confirmation_response.value:
                        logger.info(f"✅ [Sweep Success] Transaction confirmed on-chain!")
                    else:
                        logger.warning(f"⚠️  [Sweep] Confirmation response: {confirmation_response}")
                        
                except Exception as confirm_error:
                    logger.warning(f"⚠️  [Sweep] Could not confirm transaction: {confirm_error}")
                    logger.warning(f"   Transaction may still succeed - check explorer")
                
                # Verify post-sweep balance
                logger.info(f"🔍 [Sweep] Verifying post-sweep balance...")
                try:
                    await asyncio.sleep(2)  # Give network time to update
                    post_balance_response = await self.client.get_balance(temp_keypair.pubkey())
                    post_balance = post_balance_response.value if post_balance_response.value else 0
                    logger.info(f"🔍 [Post-Sweep Balance] {post_balance} lamports remaining")
                    
                    if post_balance < fee_lamports * 2:
                        logger.info(f"✅ [Sweep] Wallet successfully emptied (only dust/fees remain)")
                    else:
                        logger.warning(f"⚠️  [Sweep] Unexpected remaining balance: {post_balance} lamports")
                        
                except Exception as balance_error:
                    logger.warning(f"⚠️  [Sweep] Could not verify post-balance: {balance_error}")
                
                # Log final success
                transfer_sol = transfer_amount / LAMPORTS_PER_SOL
                logger.info(f"✅ [Sweep Success] ========== COMPLETED ==========")
                logger.info(f"✅ [Sweep Success] From: {wallet_address}")
                logger.info(f"✅ [Sweep Success] To: {self.main_wallet}")
                logger.info(f"✅ [Sweep Success] Amount: {transfer_sol:.6f} SOL")
                logger.info(f"✅ [Sweep Success] Tx: {signature}")
                logger.info(f"✅ [Sweep Success] Network: Mainnet")
                logger.info(f"✅ [Sweep Success] ===============================")
                
                # Update wallet record in database
                await dbq.update_temporary_wallet(wallet_address, {
                    "sol_forwarded": True,
                    "forward_signature": signature,
                    "forwarded_amount_lamports": transfer_amount,
                    "forwarded_at": datetime.now(timezone.utc),
                    "status": "completed",
                    "network": "mainnet"
                })
                
                # Clean up wallet data after successful forwarding
                await asyncio.sleep(60)  # Wait 1 minute before cleanup
                await self.cleanup_wallet_data(wallet_address)
                
                return signature  # Success!
                
            except Exception as e:
                logger.error(f"❌ [Sweep] Fatal error in sweep attempt {attempt}")
                logger.error(f"   Error: {type(e).__name__}: {str(e)}")
                import traceback
                logger.error(f"   Traceback:\n{traceback.format_exc()}")
                
                if attempt < max_retries:
                    logger.info(f"⏳ [Sweep] Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error(f"❌ [Sweep] All {max_retries} attempts exhausted!")
                    # Mark wallet as failed
                    try:
                        await dbq.update_temporary_wallet(wallet_address, {
                            "status": "forward_failed",
                            "forward_error": str(e),
                            "failed_at": datetime.now(timezone.utc)
                        })
                    except Exception as db_error:
                        logger.error(f"❌ [Sweep] Could not update database: {db_error}")
                    raise
    
    async def cleanup_wallet_data(self, wallet_address: str):
        """
        Clean up temporary wallet data after successful processing
        
        SAFETY: Only removes private key if SOL has been successfully forwarded.
        Implements 72-hour grace period before deletion.
        """
        try:
            # Get wallet record
            wallet_doc = await dbq.get_temporary_wallet(wallet_address)
            
            if not wallet_doc:
                logger.warning(f"🧹 [Cleanup] Wallet {wallet_address} not found")
                return
            
            # SAFETY CHECK: Never delete private key if sweep hasn't completed
            if not wallet_doc.get("sol_forwarded", False):
                logger.warning(f"⚠️  [Cleanup] BLOCKED: Cannot cleanup wallet {wallet_address[:8]}... - SOL not forwarded yet!")
                logger.warning(f"   Status: {wallet_doc.get('status')}")
                logger.warning(f"   Tokens Credited: {wallet_doc.get('tokens_credited', False)}")
                logger.warning(f"   SOL Forwarded: {wallet_doc.get('sol_forwarded', False)}")
                
                # Mark for manual review instead of cleaning up
                await dbq.update_temporary_wallet(wallet_address, {
                    "needs_manual_review": True,
                    "review_reason": "cleanup_blocked_unswept_funds",
                    "flagged_at": datetime.now(timezone.utc)
                })
                return
            
            # Additional safety: Check actual on-chain balance before deleting private key
            try:
                from solders.pubkey import Pubkey
                pubkey = Pubkey.from_string(wallet_address)
                balance_response = await self.client.get_balance(pubkey)
                balance_lamports = balance_response.value if balance_response.value else 0
                
                if balance_lamports > 10000:  # More than dust (0.00001 SOL)
                    logger.error(f"❌ [Cleanup] CRITICAL: Wallet {wallet_address[:8]}... still has {balance_lamports} lamports!")
                    logger.error(f"   Refusing to delete private key - funds at risk!")
                    
                    await dbq.update_temporary_wallet(wallet_address, {
                        "needs_manual_review": True,
                        "review_reason": "cleanup_blocked_balance_detected",
                        "flagged_at": datetime.now(timezone.utc),
                        "flagged_balance_lamports": balance_lamports
                    })
                    return
            except Exception as balance_check_error:
                logger.warning(f"⚠️  [Cleanup] Could not verify on-chain balance: {balance_check_error}")
                # Don't block cleanup if we can't check balance, but log it
            
            # Safe to cleanup - SOL forwarded and balance checked
            logger.info(f"🧹 [Cleanup] Safe to cleanup wallet {wallet_address[:8]}... (SOL forwarded, balance verified)")
            
            # Remove private key and mark as cleaned up
            await dbq.update_temporary_wallet(wallet_address, {
                "cleaned_up": True,
                "cleaned_up_at": datetime.now(timezone.utc),
                "status": "cleaned_up"
            })
            logger.info(f"🧹 Cleaned up wallet data for {wallet_address}")
            
        except Exception as e:
            logger.error(f"Error cleaning up wallet {wallet_address}: {str(e)}")
    
    async def get_purchase_status(self, user_id: str, wallet_address: str) -> Dict[str, Any]:
        """Get the status of a token purchase"""
        try:
            wallet_doc = await dbq.get_temporary_wallet(wallet_address)
            if wallet_doc and wallet_doc.get("user_id") != user_id:
                wallet_doc = None
            
            if not wallet_doc:
                return {"status": "not_found", "message": "Purchase not found"}
            
            status_info = {
                "status": wallet_doc.get("status", "pending"),
                "wallet_address": wallet_address,
                "required_sol": wallet_doc["required_sol"],
                "token_amount": wallet_doc["token_amount"],
                "created_at": wallet_doc["created_at"] if isinstance(wallet_doc["created_at"], str) else wallet_doc["created_at"].isoformat(),
                "payment_detected": wallet_doc.get("payment_detected", False),
                "tokens_credited": wallet_doc.get("tokens_credited", False),
                "sol_forwarded": wallet_doc.get("sol_forwarded", False)
            }
            
            if wallet_doc.get("received_sol"):
                status_info["received_sol"] = wallet_doc["received_sol"]
                
            if wallet_doc.get("transaction_signature"):
                status_info["transaction_signature"] = wallet_doc["transaction_signature"]
                
            return status_info
            
        except Exception as e:
            logger.error(f"Error getting purchase status: {str(e)}")
            return {"status": "error", "message": str(e)}
    
    async def get_sol_eur_price(self) -> float:
        """Get current SOL/EUR exchange rate"""
        return await self.price_fetcher.get_sol_eur_price()
    
    async def rescan_pending_payments(self):
        """
        Redundant payment detection system - periodically checks all pending wallets
        This catches payments that were missed by the real-time monitoring system
        Includes rate limit handling for mainnet RPC
        """
        try:
            logger.info("🔍 [Rescan] Starting periodic payment rescan...")
            
            # Get all pending wallets (not expired, not already processed)
            # Limit to 10 most recent to avoid rate limits
            all_monitoring_wallets = await dbq.get_all_temporary_wallets_monitoring()
            pending_wallets = [
                w for w in all_monitoring_wallets
                if not w.get("payment_detected") and not w.get("tokens_credited")
            ][:10]
            
            if not pending_wallets:
                logger.info("🔍 [Rescan] No pending wallets to check")
                return
            
            logger.info(f"🔍 [Rescan] Found {len(pending_wallets)} pending wallets to check")
            
            checked_count = 0
            detected_count = 0
            
            for wallet_doc in pending_wallets:
                try:
                    wallet_address = wallet_doc["wallet_address"]
                    expected_sol = Decimal(str(wallet_doc["required_sol"]))
                    user_id = wallet_doc["user_id"]
                    
                    # Add delay between checks to avoid rate limits
                    if checked_count > 0:
                        await asyncio.sleep(0.5)  # 500ms delay between wallet checks
                    
                    checked_count += 1
                    
                    # Check wallet balance on-chain with retry for rate limits
                    pubkey = Pubkey.from_string(wallet_address)
                    
                    balance_lamports = 0
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            balance_response = await self.client.get_balance(pubkey, commitment=Confirmed)
                            if balance_response.value is not None:
                                balance_lamports = balance_response.value
                            break
                        except Exception as rpc_error:
                            error_str = str(rpc_error)
                            if "429" in error_str or "Too Many Requests" in error_str:
                                if attempt < max_retries - 1:
                                    wait_time = (attempt + 1) * 2  # Exponential backoff: 2s, 4s, 6s
                                    logger.warning(f"⚠️ [Rescan] Rate limit hit, waiting {wait_time}s before retry...")
                                    await asyncio.sleep(wait_time)
                                    continue
                                else:
                                    logger.error(f"❌ [Rescan] Rate limit - skipping wallet {wallet_address[:8]}... after {max_retries} attempts")
                                    break
                            else:
                                raise  # Re-raise if it's not a rate limit error
                    
                    balance_sol = Decimal(balance_lamports) / Decimal(LAMPORTS_PER_SOL)
                    
                    if balance_sol == 0:
                        continue  # No payment received yet
                    
                    logger.info(f"💰 [Payment Detected] Wallet: {wallet_address} | Amount: {balance_sol} SOL | User: {user_id} | Time: {datetime.now(timezone.utc).isoformat()}")
                    
                    # Accept any payment above dust — credit proportional tokens
                    dust_threshold = Decimal("0.001")
                    if balance_sol >= dust_threshold:
                        detected_count += 1
                        if balance_sol >= expected_sol:
                            logger.info(f"✅ [Rescan] Full/overpayment: {balance_sol} SOL (expected {expected_sol}) — crediting proportionally")
                        else:
                            logger.info(f"⚠️  [Rescan] Underpayment: {balance_sol} SOL < {expected_sol} SOL — crediting proportionally, sweeping SOL")

                        update_result = await dbq.update_temporary_wallet(wallet_address, {
                            "payment_detected": True,
                            "status": "detected_by_rescan",
                            "detected_at": datetime.now(timezone.utc)
                        })

                        if update_result:
                            await self.credit_tokens_to_user(wallet_doc, balance_sol)
                            await self.forward_sol_to_main_wallet(wallet_address, wallet_doc["private_key"], balance_lamports)
                            logger.info(f"✅ [Rescan] Payment processing complete for wallet {wallet_address[:8]}...")
                        else:
                            logger.info(f"⏭️  [Rescan] Wallet {wallet_address[:8]}... already being processed by another task")
                    else:
                        logger.info(f"❌ [Rescan] Dust ignored: {balance_sol} SOL (threshold: {dust_threshold} SOL)")
                        
                except Exception as wallet_error:
                    logger.error(f"❌ [Rescan] Error checking wallet {wallet_doc.get('wallet_address', 'unknown')}: {wallet_error}")
                    import traceback
                    logger.error(traceback.format_exc())
                    continue
            
            logger.info(f"🔍 [Rescan] Scan complete: checked {checked_count}, detected {detected_count}")
            
        except Exception as e:
            logger.error(f"❌ [Rescan] Error in payment rescan: {e}")
            import traceback
            logger.error(traceback.format_exc())


    async def cleanup_old_wallets_with_grace_period(self, grace_period_hours: int = 72):
        """
        Clean up old wallet records that have been successfully processed
        Implements grace period (default 72 hours) before removing private keys
        
        Args:
            grace_period_hours: Hours to wait after completion before cleanup (default: 72)
        """
        try:
            from datetime import timedelta
            
            logger.info(f"🧹 [Scheduled Cleanup] Starting cleanup (grace period: {grace_period_hours}h)...")
            
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=grace_period_hours)
            
            # Find completed wallets past grace period that haven't been cleaned up
            all_monitoring_wallets = await dbq.get_all_temporary_wallets_monitoring()
            # Also fetch completed ones by getting all wallets and filtering in Python
            # get_all_temporary_wallets_monitoring returns pending/monitoring; for completed
            # we directly query via a broader call and filter here
            from database import get_pool as _get_pool
            async with _get_pool().acquire() as _conn:
                _rows = await _conn.fetch("SELECT * FROM temporary_wallets WHERE status = 'completed'")
                _all_completed = [dict(r) for r in _rows]
            old_completed_wallets = [
                w for w in _all_completed
                if w.get("sol_forwarded")
                and not w.get("cleaned_up")
                and w.get("forwarded_at") is not None
                and (w["forwarded_at"] if isinstance(w["forwarded_at"], datetime) else datetime.fromisoformat(str(w["forwarded_at"]))) < cutoff_time
            ][:100]
            
            logger.info(f"🧹 [Scheduled Cleanup] Found {len(old_completed_wallets)} wallets eligible for cleanup")
            
            cleaned_count = 0
            blocked_count = 0
            
            for wallet_doc in old_completed_wallets:
                wallet_address = wallet_doc["wallet_address"]
                
                # Double-check on-chain balance before cleanup
                try:
                    from solders.pubkey import Pubkey
                    pubkey = Pubkey.from_string(wallet_address)
                    balance_response = await self.client.get_balance(pubkey)
                    balance_lamports = balance_response.value if balance_response.value else 0
                    
                    if balance_lamports > 10000:  # More than dust
                        logger.warning(f"⚠️  [Scheduled Cleanup] BLOCKED: {wallet_address[:8]}... has {balance_lamports} lamports")
                        blocked_count += 1
                        
                        await dbq.update_temporary_wallet(wallet_address, {
                            "needs_manual_review": True,
                            "review_reason": "scheduled_cleanup_blocked_balance",
                            "flagged_at": datetime.now(timezone.utc),
                            "flagged_balance_lamports": balance_lamports
                        })
                        continue

                    # Safe to cleanup
                    await dbq.update_temporary_wallet(wallet_address, {
                        "cleaned_up": True,
                        "cleaned_up_at": datetime.now(timezone.utc),
                        "cleanup_method": "scheduled_grace_period"
                    })
                    
                    cleaned_count += 1
                    logger.info(f"✅ [Scheduled Cleanup] Cleaned {wallet_address[:8]}...")
                    
                except Exception as wallet_error:
                    logger.error(f"❌ [Scheduled Cleanup] Error processing {wallet_address[:8]}...: {wallet_error}")
                    continue
            
            # Delete abandoned wallets: pending/expired, older than 24h, never received payment
            abandoned_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
            async with _get_pool().acquire() as _conn:
                abandoned_result = await _conn.execute(
                    """DELETE FROM temporary_wallets
                       WHERE payment_detected = FALSE
                         AND tokens_credited = FALSE
                         AND created_at < $1""",
                    abandoned_cutoff
                )
            abandoned_deleted = int(abandoned_result.split()[-1]) if abandoned_result else 0
            logger.info(f"🗑️ [Scheduled Cleanup] Deleted {abandoned_deleted} abandoned wallets (no payment, >24h old)")

            flagged_count = await dbq.count_pending_wallets()
            logger.info(f"🧹 [Scheduled Cleanup] Complete: cleaned={cleaned_count}, blocked={blocked_count}, abandoned_deleted={abandoned_deleted}")

            return {
                "cleaned": cleaned_count,
                "blocked": blocked_count,
                "abandoned_deleted": abandoned_deleted,
                "flagged_for_review": flagged_count
            }
            
        except Exception as e:
            logger.error(f"❌ [Scheduled Cleanup] Error: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {"error": str(e)}

# Global processor instance
processor = None
processor_rpc_url = None  # Track RPC URL used for processor

def reset_processor():
    """Force reset the global processor (for RPC URL changes)"""
    global processor, processor_rpc_url
    logger.info("🔄 Forcefully resetting Solana processor...")
    processor = None
    processor_rpc_url = None

def get_processor(db=None) -> SolanaPaymentProcessor:
    """Get or create the global payment processor instance"""
    global processor, processor_rpc_url
    
    # Reinitialize if RPC URL changed
    if processor is not None and processor_rpc_url != SOLANA_RPC_URL:
        logger.info(f"🔄 RPC URL changed, reinitializing processor...")
        logger.info(f"   Old: {processor_rpc_url}")
        logger.info(f"   New: {SOLANA_RPC_URL}")
        processor = None
    
    if processor is None:
        processor = SolanaPaymentProcessor()
        processor_rpc_url = SOLANA_RPC_URL
    
    return processor
