# Solana Casino - Mainnet Production Guide

## ✅ Current Configuration

### Network Settings
- **Network:** Solana Mainnet-Beta
- **RPC URL:** `https://api.mainnet-beta.solana.com`
- **Main Wallet:** `EC2cPxi4VbyzGoWMucHQ6LwkWz1W9vZE7ZApcY9PFsMy`
- **Status:** Production - Real SOL transactions

### 2. Payment Features Re-enabled
- **File:** `/app/frontend/src/App.js`
- **Changes:**
  - Re-enabled "Add Tokens" button
  - Re-enabled token purchase quick-select buttons (500, 1000, 2000, 5000)
  - Updated messaging to indicate Devnet testing
  - Removed "under maintenance" warnings

### 3. UI Updates
- Added visual indicators that app is on Devnet
- Changed warning messages from red to blue (testing mode)
- Updated button text and colors to reflect active status

---

## 🧪 How to Test Payment Flow on Devnet

### Prerequisites
1. Access the app via Telegram Web App (mini-app interface)
2. Have a Solana wallet app or browser extension ready

### Step 1: Get Free Devnet SOL
Use any of these devnet faucets to get free test SOL:

**Option A - Web Faucets:**
- https://faucet.solana.com/
- https://solfaucet.com/

**Option B - CLI (if you have Solana CLI installed):**
```bash
solana airdrop 1 <YOUR_WALLET_ADDRESS> --url devnet
```

### Step 2: Initiate Payment
1. Open the app in Telegram
2. Navigate to "Tokens" tab
3. Click "Add Tokens" button OR select a quick amount (500, 1000, 2000, 5000 tokens)
4. Payment modal will open showing:
   - EUR amount
   - Calculated SOL amount (based on live price)
   - Temporary devnet wallet address
   - Payment ID
   - 20-minute countdown timer

### Step 3: Send Devnet SOL
1. Copy the wallet address from the payment modal
2. Open your Solana wallet
3. **IMPORTANT:** Switch your wallet to **Devnet** network
4. Send the exact SOL amount (or slightly more) to the address
5. Confirm the transaction

### Step 4: Wait for Confirmation
- Payment detection: ~10 seconds after transaction confirms
- Token crediting: Automatic within 1-2 minutes
- SOL forwarding: Happens after tokens are credited
- Modal status will update automatically through these stages:
  - "Pending" → "Processing" → "Crediting" → "Completed"

### Step 5: Verify
1. Check your token balance in the app increases
2. Modal should auto-close and page should refresh
3. Verify in MongoDB:
   ```bash
   mongosh mongodb://localhost:27017/test_database --eval "db.users.findOne({telegram_id: YOUR_TELEGRAM_ID})"
   ```

---

## 📊 Database Collections

### Users Collection
```javascript
db.users.findOne({telegram_id: YOUR_ID})
// Shows: token_balance, created_at, last_login, etc.
```

### Temporary Wallets Collection
```javascript
db.temporary_wallets.find({user_id: YOUR_USER_ID}).sort({created_at: -1})
// Shows: wallet_address, status, payment_detected, tokens_credited, sol_forwarded
```

### Token Purchases Collection
```javascript
db.token_purchases.find({user_id: YOUR_USER_ID}).sort({purchase_date: -1})
// Shows: transaction history, SOL amount, EUR value, tokens purchased
```

---

## 🔍 Monitoring Payment Processing

### Backend Logs
```bash
# Watch live backend logs
tail -f /var/log/supervisor/backend.*.log

# Filter for payment-related logs
tail -f /var/log/supervisor/backend.*.log | grep -E "payment|wallet|SOL|credit"
```

### Key Log Messages to Look For:
- `✅ Created payment wallet [ADDRESS] for user [ID]`
- `🔍 Starting payment monitoring for wallet: [ADDRESS]`
- `💰 Payment detected: X SOL received`
- `✅ Credited X tokens to user [ID]`
- `🚀 SOL forwarded to main wallet: X SOL`

---

## 🐛 Troubleshooting

### Issue: Payment not detected
**Check:**
1. Transaction confirmed on devnet? → https://explorer.solana.com/?cluster=devnet
2. Sent to correct address?
3. Backend monitoring running? → Check logs
4. Network is devnet in both app and wallet?

### Issue: Tokens not credited
**Check:**
1. User exists in database?
2. Wallet document shows `payment_detected: true`?
3. Check backend logs for errors during crediting
4. Sufficient SOL sent? (must be >= required amount)

### Issue: "User not found" error
**Solution:**
- Access app through Telegram mini-app (not direct browser)
- Or use fallback authentication in frontend

---

## 🔄 Switching Back to Mainnet

When ready to go live (after all tests pass):

### 1. Update Backend Configuration
```bash
# Edit /app/backend/.env
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
```

### 2. Restart Backend
```bash
sudo supervisorctl restart backend
```

### 3. Update Frontend Messaging
In `/app/frontend/src/App.js`, change:
- "💎 Testing on Solana Devnet" → "💰 Live on Solana Mainnet"
- Blue styling → Green/production styling
- Warning: "Test mode" → Warning: "Real SOL transactions"

### 4. Clear Test Data (Optional)
```bash
# Remove devnet test wallets
mongosh mongodb://localhost:27017/test_database --eval "db.temporary_wallets.deleteMany({sol_eur_price_at_creation: {$lt: 200}})"
```

---

## 📝 Current Configuration Summary

| Setting | Value |
|---------|-------|
| Network | Solana Devnet |
| RPC URL | `https://api.devnet.solana.com` |
| Main Wallet | `EC2cPxi4VbyzGoWMucHQ6LwkWz1W9vZE7ZApcY9PFsMy` |
| Token Rate | 1 EUR = 100 tokens |
| Price Source | CoinGecko API (live SOL/EUR) |
| Payment Timeout | 20 minutes |
| Monitoring Frequency | Every 10 seconds |

---

## ⚠️ Important Notes

1. **Devnet SOL has no real value** - Safe for unlimited testing
2. **Mainnet switch required** before production launch
3. **Test all edge cases** on devnet:
   - Overpayment
   - Underpayment
   - Multiple simultaneous purchases
   - Timeout scenarios
   - Network congestion simulation

4. **Monitor gas costs** on devnet to estimate mainnet costs
5. **Wallet addresses are different** between devnet and mainnet

---

## 🎯 Testing Checklist

- [ ] Get devnet SOL from faucet
- [ ] Create payment wallet (click "Add Tokens")
- [ ] Send devnet SOL to temporary wallet
- [ ] Verify payment detection in logs
- [ ] Confirm tokens credited to user balance
- [ ] Verify SOL forwarded to main wallet
- [ ] Check transaction history in database
- [ ] Test multiple payment amounts
- [ ] Test concurrent payments
- [ ] Monitor backend logs for errors
- [ ] Verify frontend updates correctly

---

**Ready to test!** The payment system is now active on Devnet for safe testing. 🚀
