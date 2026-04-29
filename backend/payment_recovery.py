"""
Payment Auto-Recovery System
Handles missed payment detection and automatic crediting
"""

import asyncio
import logging
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict
import db_queries as dbq

logger = logging.getLogger(__name__)

class PaymentRecoverySystem:
    """Automatically recovers missed payments on startup"""
    
    def __init__(self, db=None, processor=None):
        self.processor = processor
        logs_root = os.environ.get("CASINO_LOG_DIR")
        if logs_root:
            self.logs_dir = Path(logs_root)
        else:
            self.logs_dir = Path(__file__).resolve().parent / "logs"
        self.recovery_log_path = self.logs_dir / "payment_recovery.log"

    async def initialize_logging(self):
        """Ensure recovery log directory exists"""
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
    def log_recovery(self, message: str):
        """Log recovery actions to dedicated file"""
        timestamp = datetime.now(timezone.utc).isoformat()
        log_entry = f"[{timestamp}] {message}\n"
        
        try:
            with open(self.recovery_log_path, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            logger.error(f"Failed to write recovery log: {e}")
    
    async def scan_missed_payments(self, hours: int = 24):
        """
        Scan for payments that were missed in the last N hours
        
        Args:
            hours: How many hours back to scan
        """
        try:
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=hours)
            
            logger.info(f"🔍 [Recovery] Scanning for missed payments since {cutoff_time.isoformat()}")
            self.log_recovery(f"Starting recovery scan for last {hours} hours")
            
            # Find all users with derived addresses
            users_with_addresses = await dbq.get_users_with_derived_address()
            
            logger.info(f"📊 [Recovery] Found {len(users_with_addresses)} users with derived addresses")
            
            recovered_count = 0
            failed_count = 0
            
            for user in users_with_addresses:
                try:
                    # Check if this user has any unprocessed transactions
                    result = await self._check_user_transactions(user, cutoff_time)
                    if result:
                        recovered_count += result
                except Exception as e:
                    logger.error(f"❌ [Recovery] Error checking user {user.get('telegram_id')}: {e}")
                    failed_count += 1
            
            summary = f"Recovery complete: {recovered_count} payments recovered, {failed_count} errors"
            logger.info(f"✅ [Recovery] {summary}")
            self.log_recovery(summary)
            
            return {
                "recovered": recovered_count,
                "failed": failed_count,
                "scanned_users": len(users_with_addresses)
            }
            
        except Exception as e:
            logger.error(f"❌ [Recovery] Scan failed: {e}")
            self.log_recovery(f"ERROR: Scan failed - {str(e)}")
            return {"error": str(e)}
    
    async def _check_user_transactions(self, user: Dict, cutoff_time: datetime) -> int:
        """Check a specific user for missed transactions"""
        try:
            derived_address = user.get('derived_solana_address')
            if not derived_address:
                return 0
            
            user_id = user.get('user_id')
            telegram_id = user.get('telegram_id')
            
            # Get recent transactions from Solana
            from solana.rpc.async_api import AsyncClient
            from solders.pubkey import Pubkey
            
            client = AsyncClient(self.processor.rpc_manager.get_current_url())
            pubkey = Pubkey.from_string(derived_address)
            
            # Get signatures for this address
            response = await client.get_signatures_for_address(pubkey, limit=10)
            
            if not response.value:
                return 0
            
            recovered = 0
            
            for sig_info in response.value:
                sig = str(sig_info.signature)
                block_time = sig_info.block_time
                
                if not block_time:
                    continue
                
                tx_time = datetime.fromtimestamp(block_time, tz=timezone.utc)
                
                # Only process transactions after cutoff
                if tx_time < cutoff_time:
                    continue
                
                # (processed_transactions tracking skipped — recovery logs handle deduplication)
                
                # Get transaction details
                tx_response = await client.get_transaction(
                    Signature.from_string(sig),
                    max_supported_transaction_version=0
                )
                
                if not tx_response.value:
                    continue
                
                # Extract SOL amount
                sol_amount = await self._extract_sol_amount(tx_response.value, derived_address)
                
                if sol_amount and sol_amount > 0:
                    # This is a missed payment - recover it
                    logger.info(f"💰 [Recovery] Found missed payment: {sol_amount} SOL to {derived_address}")
                    
                    await self._credit_recovered_payment(
                        user_id=user_id,
                        telegram_id=telegram_id,
                        sol_amount=sol_amount,
                        signature=sig,
                        tx_time=tx_time
                    )
                    
                    recovered += 1
            
            await client.close()
            return recovered
            
        except Exception as e:
            logger.error(f"Error checking transactions for user: {e}")
            return 0
    
    async def _extract_sol_amount(self, transaction, receiving_address: str) -> float:
        """Extract SOL amount sent to receiving address"""
        try:
            meta = transaction.transaction.meta
            if not meta:
                return 0.0
            
            # Find the receiving address in post_balances
            account_keys = transaction.transaction.transaction.message.account_keys
            
            for idx, account in enumerate(account_keys):
                if str(account) == receiving_address:
                    pre_balance = meta.pre_balances[idx] if idx < len(meta.pre_balances) else 0
                    post_balance = meta.post_balances[idx] if idx < len(meta.post_balances) else 0
                    balance_change = post_balance - pre_balance
                    
                    if balance_change > 0:
                        return balance_change / 1_000_000_000  # Convert lamports to SOL
            
            return 0.0
            
        except Exception as e:
            logger.error(f"Error extracting SOL amount: {e}")
            return 0.0
    
    async def _credit_recovered_payment(self, user_id: str, telegram_id: int, 
                                       sol_amount: float, signature: str, tx_time: datetime):
        """Credit a recovered payment to user"""
        try:
            # Get current SOL/EUR price
            sol_eur_price = await self.processor.price_fetcher.get_sol_eur_price()
            
            # Calculate tokens
            eur_value = sol_amount * sol_eur_price
            tokens = int(eur_value * 100)  # 1 EUR = 100 tokens
            
            if tokens <= 0:
                logger.warning(f"⚠️ [Recovery] Calculated 0 tokens for {sol_amount} SOL")
                return
            
            # Credit tokens to user
            result = await dbq.increment_user_tokens(user_id, tokens)

            if result is not None:
                log_msg = f"RECOVERED: User {telegram_id} - {sol_amount} SOL -> {tokens} tokens (tx: {signature[:16]}...)"
                logger.info(f"✅ [Recovery] {log_msg}")
                self.log_recovery(log_msg)
            else:
                logger.error(f"❌ [Recovery] Failed to credit user {telegram_id}")
                
        except Exception as e:
            logger.error(f"❌ [Recovery] Failed to credit recovered payment: {e}")
            self.log_recovery(f"ERROR crediting user {telegram_id}: {str(e)}")


async def run_startup_recovery(db=None, processor=None):
    """Run payment recovery on backend startup"""
    try:
        logger.info("🚀 [Recovery] Starting payment auto-recovery system...")
        
        recovery_system = PaymentRecoverySystem(db, processor)
        await recovery_system.initialize_logging()
        
        # Scan last 24 hours
        result = await recovery_system.scan_missed_payments(hours=24)
        
        logger.info(f"✅ [Recovery] Startup recovery complete: {result}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ [Recovery] Startup recovery failed: {e}")
        return {"error": str(e)}
