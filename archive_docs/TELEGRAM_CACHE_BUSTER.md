# 🔧 Telegram WebApp Cache Busting Guide

## 🚨 Problem
Telegram WebApp is showing old cached version even though preview shows the new version.

## ✅ What Was Fixed (v7.0 - October 13, 2024)

### 1. Version Bumped to v7.0
- **index.html**: Updated version meta tags to `v7.0-DEVNET-PAYMENT-20241013131800`
- **App.js**: Added `APP_VERSION` constant with automatic cache clearing
- **manifest.json**: Updated start_url with version parameter `?v=20241013131800`
- **sw.js**: Updated service worker version to v7

### 2. Automatic Version Check & Cache Clear
Added to App.js:
```javascript
const APP_VERSION = 'v7.0-DEVNET-PAYMENT-20241013131800';

// Automatically clears localStorage when version changes
// Forces page reload on version mismatch
// Keeps only essential data (EUR amount, SOL price)
```

### 3. Visual Version Indicator
- **NEW**: Blue badge in bottom-right corner showing current version
- Displays: `v7.0-DEVNET-PAYMENT-20241013131800 💎 Devnet`
- Confirms which version is loaded in Telegram

### 4. Aggressive Cache Busting Already Active
- Service worker disabled and all caches cleared
- Meta tags prevent all browser caching
- Service worker unregisters itself on load
- All existing service workers forcefully removed

---

## 📱 How to Force Telegram to Load New Version

### Method 1: Update Bot URL with Version Parameter (RECOMMENDED)

1. Go to **@BotFather** in Telegram
2. Send: `/mybots`
3. Select your bot
4. Go to: `Bot Settings` → `Menu Button` → `Edit Menu Button URL`
5. **Update URL to:**
   ```
   https://telebet-2.preview.emergentagent.com?v=20241013131800
   ```

**OR use API:**
```bash
curl -X POST "https://api.telegram.org/bot8366450667:AAEAOR3ea5BXBMumyS2Mz9g9svfvr7n-mk0/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{
    "menu_button": {
      "type": "web_app",
      "text": "🎰 Play Casino",
      "web_app": {
        "url": "https://telebet-2.preview.emergentagent.com?v=20241013131800"
      }
    }
  }'
```

### Method 2: Clear Telegram Cache (User Side)

**iOS:**
1. Settings → Data and Storage → Storage Usage
2. Clear Telegram cache

**Android:**
1. Settings → Data and Storage → Storage Usage → Clear Cache
2. Or: Long press Telegram app → App Info → Storage → Clear Cache

**Desktop:**
1. Settings → Advanced → Manage local storage → Clear All

### Method 3: Force Hard Reload in Telegram WebApp

**When inside the WebApp:**
1. Close the WebApp completely
2. Force close Telegram app
3. Reopen Telegram
4. Open the bot again

### Method 4: Reinstall Telegram (Nuclear Option)
Only if nothing else works:
1. Uninstall Telegram
2. Reinstall Telegram
3. Open bot → WebApp should load fresh

---

## 🔍 How to Verify New Version is Loaded

### Check 1: Version Badge
Look for blue badge in **bottom-right corner** of the app:
- Should show: `v7.0-DEVNET-PAYMENT-20241013131800 💎 Devnet`
- If you see this → New version is loaded! ✅

### Check 2: Payment Buttons
- "Add Tokens" button should be **GREEN** and **ACTIVE**
- Should say "💎 Testing on Solana Devnet"
- Old version shows "Temporarily Unavailable" in **GREY**

### Check 3: Browser Console
Open Telegram Desktop → F12 → Console:
```
Should see:
"🔄 Version changed from ... to v7.0-DEVNET-PAYMENT-20241013131800"
"SW: All service workers unregistered - NO CACHING"
"SW: All caches cleared"
```

### Check 4: Network Tab
F12 → Network tab → Reload:
- All requests should have `?v=...` parameter
- No "(from service worker)" or "(from cache)" labels
- All resources loaded fresh from server

---

## 🎯 Quick Verification Checklist

- [ ] Version badge shows v7.0 in bottom-right corner
- [ ] "Add Tokens" button is green and clickable
- [ ] Says "💎 Testing on Solana Devnet" (blue text)
- [ ] Payment modal opens when clicking "Add Tokens"
- [ ] Token quick-buy buttons (500, 1000, 2000, 5000) are active
- [ ] No "under maintenance" red warnings
- [ ] Console shows service worker unregistered
- [ ] localStorage has `app_version = v7.0-DEVNET-PAYMENT-20241013131800`

---

## 🔧 Technical Details

### Cache Clearing Strategy
1. **Service Worker**: Completely disabled, unregisters all instances
2. **Browser Cache**: Meta tags prevent all caching
3. **localStorage**: Cleared on version change (except price/EUR data)
4. **Version Check**: Runs on every app load
5. **Hard Reload**: Automatic reload when version changes

### Files Modified
- `/app/frontend/public/index.html` → Version v7.0 meta tags
- `/app/frontend/public/sw.js` → Version v7 console log
- `/app/frontend/public/manifest.json` → Start URL with v= parameter
- `/app/frontend/src/App.js` → APP_VERSION constant + auto cache clear + version badge

### Version History
- v5.0 → Previous version (payments disabled)
- v7.0 → Current version (payments enabled on Devnet)

---

## 🆘 Still Seeing Old Version?

If you've tried everything and still see the old version:

### Diagnostic Steps:
1. **Check if you're in the right place:**
   - Preview URL: `https://telebet-2.preview.emergentagent.com`
   - Are you opening the bot in Telegram or browser directly?

2. **Check browser console for errors:**
   - F12 → Console
   - Look for JavaScript errors
   - Check network tab for failed requests

3. **Verify bot URL in BotFather:**
   - Send `/mybots` to @BotFather
   - Check what URL is configured
   - Should match: `https://telebet-2.preview.emergentagent.com?v=20241013131800`

4. **Try different device:**
   - Test on another phone/computer
   - Fresh install of Telegram
   - Should load new version immediately

---

## 📊 Changes in v7.0

### Features Enabled:
✅ Solana payment system (on Devnet)
✅ "Add Tokens" button active
✅ Payment modal functional
✅ Quick-buy token buttons (500, 1000, 2000, 5000)
✅ Live SOL/EUR price fetching
✅ Payment wallet generation
✅ Automatic token crediting

### Configuration:
- Network: **Solana Devnet**
- RPC: `https://api.devnet.solana.com`
- Testing: Free devnet SOL from faucets
- Status: All payment features active for testing

---

**If the version badge shows v7.0, you're good to go!** 🚀

Everything should work now. The new version includes all the latest updates with payment features enabled on Devnet for safe testing.
