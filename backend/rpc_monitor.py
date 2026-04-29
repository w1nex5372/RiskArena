"""
RPC Monitoring and Alert System
Tracks RPC health and logs failures
"""

import logging
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger(__name__)

class RPCAlertSystem:
    """Monitors RPC health and logs critical failures"""
    
    def __init__(self):
        logs_root = os.environ.get("CASINO_LOG_DIR")
        if logs_root:
            self.logs_dir = Path(logs_root)
        else:
            self.logs_dir = Path(__file__).resolve().parent / "logs"
        self.alert_log_path = self.logs_dir / "rpc_alerts.log"
        self.failure_counts = {}
        self.last_alert_times = {}
        self.alert_cooldown = 300  # 5 minutes between alerts for same endpoint
        
    def log_alert(self, message: str):
        """Log RPC alert to dedicated file"""
        timestamp = datetime.now(timezone.utc).isoformat()
        log_entry = f"[{timestamp}] {message}\n"
        
        try:
            self.logs_dir.mkdir(parents=True, exist_ok=True)

            with open(self.alert_log_path, 'a') as f:
                f.write(log_entry)
                
            logger.error(f"🚨 RPC ALERT: {message}")
            
        except Exception as e:
            logger.error(f"Failed to write RPC alert log: {e}")
    
    def report_failure(self, endpoint: str, error_code: Optional[int], 
                      error_message: str, error_type: str = "unknown"):
        """
        Report an RPC endpoint failure
        
        Args:
            endpoint: The RPC endpoint URL
            error_code: HTTP error code (401, 403, 429, etc.)
            error_message: Full error message
            error_type: Type of error (auth, rate_limit, connection, etc.)
        """
        current_time = datetime.now(timezone.utc)
        endpoint_key = endpoint[:50]  # Truncate for logging
        
        # Track failure count
        self.failure_counts[endpoint_key] = self.failure_counts.get(endpoint_key, 0) + 1
        
        # Check if we should send alert (cooldown)
        last_alert = self.last_alert_times.get(endpoint_key)
        if last_alert and (current_time - last_alert).total_seconds() < self.alert_cooldown:
            return  # Skip alert due to cooldown
        
        # Determine severity
        severity = self._determine_severity(error_code, error_type)
        
        # Create alert message
        alert_message = (
            f"[{severity}] RPC Failure\n"
            f"  Endpoint: {endpoint_key}...\n"
            f"  Error Code: {error_code or 'N/A'}\n"
            f"  Error Type: {error_type}\n"
            f"  Message: {error_message[:200]}\n"
            f"  Failure Count: {self.failure_counts[endpoint_key]}\n"
            f"  Timestamp: {current_time.isoformat()}"
        )
        
        # Log the alert
        self.log_alert(alert_message)
        
        # Update last alert time
        self.last_alert_times[endpoint_key] = current_time
        
        # Special handling for auth errors
        if error_code in [401, 403]:
            self._handle_auth_error(endpoint_key, error_message)
        
        # Special handling for rate limits
        elif error_code == 429 or 'rate limit' in error_message.lower():
            self._handle_rate_limit(endpoint_key)
    
    def _determine_severity(self, error_code: Optional[int], error_type: str) -> str:
        """Determine alert severity based on error"""
        if error_code in [401, 403]:
            return "CRITICAL"  # Auth errors are critical
        elif error_code == 429:
            return "WARNING"  # Rate limits are warnings
        elif error_code in [500, 502, 503, 504]:
            return "ERROR"  # Server errors
        elif error_type == "connection":
            return "WARNING"  # Connection issues
        else:
            return "INFO"
    
    def _handle_auth_error(self, endpoint: str, error_message: str):
        """Special handling for authentication errors"""
        alert = (
            f"⚠️ CRITICAL: RPC Authentication Failed\n"
            f"  Endpoint: {endpoint}\n"
            f"  Action Required: Check API key in .env\n"
            f"  Payment monitoring may be down!\n"
            f"  Error: {error_message[:100]}"
        )
        self.log_alert(alert)
        
        # In production, you could send Telegram notification here
        # await send_telegram_alert_to_admin(alert)
    
    def _handle_rate_limit(self, endpoint: str):
        """Special handling for rate limit errors"""
        alert = (
            f"⚠️ WARNING: RPC Rate Limit Reached\n"
            f"  Endpoint: {endpoint}\n"
            f"  System will automatically switch to fallback RPC\n"
            f"  Consider upgrading to premium RPC tier"
        )
        self.log_alert(alert)
    
    def get_health_report(self) -> Dict:
        """Get current RPC health status"""
        return {
            "failure_counts": self.failure_counts.copy(),
            "last_alert_times": {
                k: v.isoformat() 
                for k, v in self.last_alert_times.items()
            },
            "total_failures": sum(self.failure_counts.values())
        }
    
    def reset_failure_count(self, endpoint: str):
        """Reset failure count for an endpoint (after successful recovery)"""
        endpoint_key = endpoint[:50]
        if endpoint_key in self.failure_counts:
            old_count = self.failure_counts[endpoint_key]
            self.failure_counts[endpoint_key] = 0
            logger.info(f"✅ RPC recovered: {endpoint_key} (was {old_count} failures)")


# Global RPC alert system instance
rpc_alert_system = RPCAlertSystem()
