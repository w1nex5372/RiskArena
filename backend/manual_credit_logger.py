"""
Manual Token Credit Logging System
Tracks all manual token adjustments for audit purposes
"""

import logging
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import db_queries as dbq

logger = logging.getLogger(__name__)

class ManualCreditLogger:
    """Logs all manual token credits for audit trail"""

    def __init__(self, db=None):
        logs_root = os.environ.get("CASINO_LOG_DIR")
        if logs_root:
            self.logs_dir = Path(logs_root)
        else:
            self.logs_dir = Path(__file__).resolve().parent / "logs"
        self.log_path = self.logs_dir / "manual_credits.log"

    async def log_manual_credit(self,
                               user_id: str,
                               telegram_id: int,
                               amount: int,
                               reason: str,
                               admin_id: Optional[str] = None,
                               transaction_reference: Optional[str] = None):
        try:
            timestamp = datetime.now(timezone.utc)
            log_message = (
                f"[{timestamp.isoformat()}] MANUAL CREDIT\n"
                f"  User ID: {user_id}\n"
                f"  Telegram ID: {telegram_id}\n"
                f"  Amount: {amount} tokens\n"
                f"  Reason: {reason}\n"
                f"  Admin: {admin_id or 'system'}\n"
                f"  Transaction Ref: {transaction_reference or 'N/A'}\n"
                "  " + "-" * 60
            )
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            with open(self.log_path, 'a') as f:
                f.write(log_message + "\n")
            logger.info(f"📝 Manual credit logged: {amount} tokens to user {telegram_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to log manual credit: {e}")
            return False

    async def get_user_manual_credits(self, user_id: str, limit: int = 10):
        return []

    async def get_recent_manual_credits(self, limit: int = 50):
        return []


async def credit_tokens_manually(db=None,
                                 telegram_id: int = 0,
                                 amount: int = 0,
                                 reason: str = "",
                                 transaction_signature: Optional[str] = None):
    try:
        user = await dbq.get_user_by_telegram_id(telegram_id)
        if not user:
            return {"success": False, "error": f"User with Telegram ID {telegram_id} not found"}

        user_id = user.get('id')
        old_balance = user.get('token_balance', 0)

        updated = await dbq.increment_user_tokens_by_telegram_id(telegram_id, amount)
        if updated is None:
            return {"success": False, "error": "Failed to update user balance"}

        new_balance = updated.get('token_balance', 0)

        credit_logger = ManualCreditLogger()
        await credit_logger.log_manual_credit(
            user_id=user_id,
            telegram_id=telegram_id,
            amount=amount,
            reason=reason,
            admin_id="system",
            transaction_reference=transaction_signature
        )

        logger.info(f"✅ Manual credit: {amount} tokens to {telegram_id} ({old_balance} → {new_balance})")
        return {
            "success": True,
            "user_id": user_id,
            "telegram_id": telegram_id,
            "tokens_credited": amount,
            "old_balance": old_balance,
            "new_balance": new_balance,
            "reason": reason
        }
    except Exception as e:
        logger.error(f"❌ Manual credit failed: {e}")
        return {"success": False, "error": str(e)}
