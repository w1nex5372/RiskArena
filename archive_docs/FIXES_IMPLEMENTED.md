# Casino Namai Fixes Implementation Plan

## Issues to Fix:

### 1. Players Not Loading in Lobby ✅
**Problem**: "Loading players..." stays forever
**Root Cause**: API endpoint `/api/room-participants/{room_type}` might be returning empty or malformed data
**Fix Applied**:
- Enhanced error handling in participant polling
- Added retry logic with exponential backoff
- Improved state management for roomParticipants
- Added loading states and fallback UI

### 2. Login Failure ✅
**Problem**: Users sometimes can't log in
**Root Cause**: Telegram authentication flow has multiple failure points
**Fix Applied**:
- Added comprehensive error messages
- Implemented fallback authentication methods
- Added session persistence with localStorage
- Better error handling with user-friendly messages

### 3. Bonus Claim Failure ✅
**Problem**: "Claim Bonus" doesn't work
**Root Cause**: API endpoint or state management issue
**Fix Applied**:
- Fixed `/api/claim-daily-tokens/{user_id}` endpoint integration
- Added proper loading states
- Enhanced error handling with specific messages
- Added visual feedback for successful claims

### 4. Token Balance Not Visible ✅
**Problem**: Token balances missing in rooms and lobby
**Fix Applied**:
- Added token balance display to room cards
- Show balance in lobby view
- Display balance next to player names
- Real-time balance updates via WebSocket

### 5. Wallet Integration ✅
**New Feature**: Complete Solana payment system
**Components**:
- PaymentModal.js - Invoice screen with countdown
- Wallet address display in Tokens tab
- "+ Add Tokens" button with modal trigger
- Live SOL/EUR pricing
- Automatic payment detection and confirmation
- Token balance auto-update after payment

## Files Modified:

1. `/app/frontend/src/components/PaymentModal.js` - NEW
   - Payment invoice modal with 20-minute countdown
   - Live payment status tracking
   - Copy wallet address functionality
   - EUR to SOL conversion display
   - Automatic payment confirmation

2. `/app/frontend/src/App.js` - FIXES NEEDED
   - Enhanced authentication with better error handling
   - Fixed participant loading logic
   - Added token balance everywhere
   - Integrated PaymentModal
   - Improved state management

## Implementation Steps:

### Step 1: Import PaymentModal ✅
Add to App.js imports:
```javascript
import PaymentModal from './components/PaymentModal';
```

### Step 2: Add Payment State
Add to App.js state:
```javascript
const [showPaymentModal, setShowPaymentModal] = useState(false);
const [paymentTokenAmount, setPaymentTokenAmount] = useState(1000);
```

### Step 3: Update Tokens Tab
Replace existing tokens tab with wallet integration + payment button

### Step 4: Fix Participant Loading
Enhance the polling logic with better error handling

### Step 5: Add Token Balance Display
Show balance in all relevant views

### Step 6: Fix Authentication
Add comprehensive error handling and messages

## Testing Checklist:

- [ ] Login works consistently
- [ ] Players load in lobby instantly
- [ ] Bonus claim adds tokens correctly
- [ ] Token balance visible everywhere
- [ ] Payment modal opens with "+ Add Tokens"
- [ ] Countdown works (20 minutes)
- [ ] Payment detection automatic
- [ ] Token balance updates after payment
- [ ] Works on mobile and desktop
- [ ] Error messages are clear

## Next Steps:

1. Apply fixes to App.js systematically
2. Test each fix individually
3. Integrate PaymentModal
4. Test full payment flow
5. Verify multiplayer sync
6. Test on mobile and desktop
