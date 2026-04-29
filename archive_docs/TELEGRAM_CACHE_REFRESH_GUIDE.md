# Telegram WebApp Cache Refresh Guide - v8.0

## What We've Done (Backend/Deployment Side)

### ✅ Version Bump - Complete Cache Invalidation
Updated all version identifiers to force cache refresh:

1. **App.js Version**: `v7.0` → `v8.0-WINNER-FIX-20250114`
2. **index.html Metadata**:
   - `version`: `TELEGRAM-WINNER-FIX-v8-20250114`
   - `build-timestamp`: Updated to new timestamp
   - `app-version`: `8.0-WINNER-FIX-ACTIVE-20250114120000`
3. **Service Worker**: Updated to v8 with new timestamp
4. **manifest.json**: Updated start_url parameter: `v=20250114120000`

### ✅ Aggressive Cache Clearing
Enhanced cache-busting script in `index.html`:
- **Version Detection**: Automatically detects version mismatch
- **localStorage Clear**: Removes old cached data (keeps only essential keys)
- **sessionStorage Clear**: Clears all session data
- **Service Worker Unregister**: Removes all service workers
- **Cache API Clear**: Deletes all cached resources
- **Detailed Logging**: Console shows every step for debugging

### ✅ Meta Tags for Maximum No-Cache
```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate, max-age=0" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="-1" />
<meta name="cache-control" content="no-cache" />
<meta name="telegram-cache" content="none" />
```

---

## What You Need to Do (Client Side)

### Method 1: Force Telegram to Refresh (Recommended)

#### Step 1: Update Bot Menu URL with New Timestamp
```
Old: https://telebet-2.preview.emergentagent.com?v=1401
New: https://telebet-2.preview.emergentagent.com?v=8001
```

**Why this works**: Telegram treats URLs with different query parameters as completely different apps.

#### Step 2: Clear Telegram's App Cache
**On Mobile (iOS/Android)**:
1. Go to Telegram Settings
2. Data and Storage → Storage Usage → Clear Cache
3. Select "Clear Cache" and confirm
4. Restart Telegram app completely (force close and reopen)

**On Desktop**:
1. Close Telegram completely
2. Clear cache:
   - **Windows**: Delete `%APPDATA%\Telegram Desktop\tdata\user_data\cache`
   - **macOS**: Delete `~/Library/Application Support/Telegram Desktop/tdata/user_data/cache`
   - **Linux**: Delete `~/.local/share/TelegramDesktop/tdata/user_data/cache`
3. Restart Telegram

#### Step 3: Open Bot with New URL
1. Open your bot
2. Click Menu → Casino Battle (or your menu button)
3. The WebApp should now load with the new version

---

### Method 2: Force Reload in WebApp (While App is Open)

If the old version is already loaded:

1. **Open Browser DevTools** (if possible in Telegram's WebView):
   - Long press on the WebApp screen
   - Look for "Inspect" or "Developer Tools" option

2. **Hard Reload**:
   - Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - Or right-click reload button → "Empty Cache and Hard Reload"

3. **Check Console for Version**:
   - Look for: `🔄 CACHE BUSTER v8.0: Starting aggressive cache clear...`
   - Should show: `📦 Version check: v7.0... -> 8.0-WINNER-FIX-20250114`
   - Confirm: `✅ CACHE BUSTER v8.0: Complete!`

---

### Method 3: Nuclear Option - Remove and Re-add Bot

If methods 1 and 2 don't work:

1. **Remove Bot Completely**:
   - Find your bot in chats
   - Delete conversation
   - Block the bot
   - Unblock the bot

2. **Update Bot Menu URL** (via BotFather):
   ```
   /mybots
   [Select your bot]
   Bot Settings → Menu Button → Edit Menu Button URL
   Enter: https://telebet-2.preview.emergentagent.com?v=8001
   ```

3. **Start Fresh**:
   - Start conversation with bot again
   - Click Menu button
   - Should load v8.0 now

---

## How to Verify You're on v8.0

### Visual Indicators:
1. ✅ **No Version Label**: Bottom-right corner should be empty (no "v7.0-MAINNET-PRODUCTION" text)
2. ✅ **Winner Screen**: When you win, title says "Congratulations, You Won!" (not "You Won!")
3. ✅ **Loser Screen**: When you lose, NO Prize Pool section visible

### Console Checks:
Open browser console and look for:
```
🔄 CACHE BUSTER v8.0: Starting aggressive cache clear...
📦 Version check: [old_version] -> 8.0-WINNER-FIX-20250114
✅ CACHE BUSTER v8.0: Complete!
🚫 Service Worker registration DISABLED for fresh updates
✅ All service workers unregistered - NO CACHING
✅ All caches cleared
```

### JavaScript Check:
Run in console:
```javascript
localStorage.getItem('app_version')
// Should return: "8.0-WINNER-FIX-20250114"
```

---

## Troubleshooting

### Still Seeing Old Version?

**Problem**: Telegram is VERY aggressive with caching
**Solutions**:
1. Try all 3 methods above in sequence
2. Wait 5-10 minutes after updating bot URL (Telegram may have server-side cache)
3. Try on a different device first to confirm new version is working
4. Use incognito/private mode in regular browser to test the URL directly

### Different Versions on Different Devices?

This is normal. Each device has its own cache. Repeat the cache clearing process on each device.

### Emergent Preview Shows New, Telegram Shows Old?

This confirms the issue is Telegram's cache, not deployment. The new version IS deployed correctly. Follow Method 1 with the new URL parameter.

---

## Technical Details

### Why Telegram Caches So Aggressively

Telegram WebApps are designed for speed and offline use:
- **HTTP Caching**: Respects Cache-Control headers (we've disabled this)
- **WebView Cache**: Built-in browser cache in Telegram's WebView
- **Service Worker**: PWA caching (we've disabled and unregistered)
- **Telegram CDN**: May cache initial HTML for faster loading
- **URL-based Caching**: Different URLs bypass all caches

### Our Cache-Busting Strategy

1. **Version Bump**: Forces localStorage clear on first load
2. **Query Parameter**: `?v=8001` makes Telegram treat it as new URL
3. **Meta Tags**: Instructs browsers not to cache
4. **Service Worker Disabled**: No PWA caching
5. **Cache API Clear**: Removes all cached resources
6. **localStorage Clear**: Removes stale application data

---

## Expected Behavior After Update

### Winner Screen:
- ✅ Title: "Congratulations, You Won!"
- ✅ Animated gold trophy
- ✅ Prize section showing tokens won
- ✅ No version label at bottom
- ✅ Responsive on mobile and PC

### Loser Screen:
- ✅ Title: "Better Luck Next Time!"
- ✅ Gray trophy
- ✅ Winner announcement with name
- ✅ **NO Prize Pool section**
- ✅ No version label at bottom
- ✅ Responsive on mobile and PC

### Game History:
- ✅ Won games: "🏆 Won" badge (gold)
- ✅ Lost games: "Lost" badge (gray)

---

## Support Checklist

When asking for help, provide:
1. ✅ Device type (iOS/Android/Desktop)
2. ✅ Telegram version
3. ✅ Bot URL being used
4. ✅ Console logs (especially version check lines)
5. ✅ Screenshot showing version label or lack thereof
6. ✅ Which cache clearing methods you tried

---

## Summary

**What Changed**: Winner screen messages, prize visibility, version label removed, badge logic fixed

**Why Telegram Doesn't Update**: Aggressive caching for speed and offline use

**Solution**: Update bot URL with new query parameter (`?v=8001`) and clear Telegram cache

**Verification**: Check for absence of version label, correct winner messages, and console showing v8.0

**Time to Propagate**: 5-10 minutes after clearing cache (Telegram's server-side CDN may cache)

---

## Quick Commands for Testing

```bash
# Check what version is deployed (from command line)
curl -s https://telebet-2.preview.emergentagent.com | grep -o 'app-version.*8.0'

# Should output: app-version" content="8.0-WINNER-FIX-ACTIVE-20250114120000
```

```javascript
// Check version in browser console
console.log('Version:', localStorage.getItem('app_version'));
console.log('Should be: 8.0-WINNER-FIX-20250114');

// Force version check
localStorage.removeItem('app_version');
window.location.reload();
// Should see cache clearing logs
```

---

**Status**: ✅ All backend changes deployed. v8.0 is live and ready. Telegram clients need cache refresh to see changes.
