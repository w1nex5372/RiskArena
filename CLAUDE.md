# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Workflow

Before task work, read `AGENTS.md` and the relevant files in `engineering/`.
Use those docs as the project-local Engineering OS for focused audits, implementation,
review, playtesting, token discipline, and log/task updates. Do not duplicate the
full workflow here.

## Commands

### Backend
```bash
# Run dev server (from backend/)
cd backend && python server.py
# or
cd backend && uvicorn server:socket_app --host 0.0.0.0 --port 8001 --reload

# Initialize database tables (run once)
cd backend && python init_db.py

# Run all tests
cd backend && pytest

# Run a single test file
cd backend && pytest tests/test_arena_domain.py -v
```

### Frontend
```bash
cd frontend && yarn start      # dev server on :3000
cd frontend && yarn build      # production build
cd frontend && yarn test
```

### Docker (full stack)
```bash
docker-compose up              # requires .env with ADMIN_KEY, SESSION_SECRET
```

## Environment Variables

Backend (`.env` in `backend/`):
- `DATABASE_URL` — full Postgres URL (Render style), OR use `PG_HOST/PG_PORT/PG_DB/PG_USER/PG_PASSWORD`
- `SESSION_SECRET` — **required** for signing session tokens
- `ADMIN_KEY` — **required** for admin endpoints (sent as `x-admin-key` header)
- `TELEGRAM_BOT_TOKEN` — for Mini App auth and bot messaging
- `SOLANA_RPC_URL`, `RISKARENA_WALLET_PRIVATE_KEY`, `RISKARENA_WALLET_ADDRESS`
- `ALLOW_INSECURE_DEV_AUTH=true` — allows skipping Telegram hash verification in local dev

Frontend (`.env` in `frontend/`):
- `REACT_APP_BACKEND_URL` — backend origin; falls back to `window.location.origin`

## Architecture

### Backend Layer Separation

The backend follows a deliberate layering that keeps domain logic independently testable:

```
server.py          — FastAPI app, Socket.IO server, all HTTP route handlers, in-memory rate limiter
arena_api.py       — APIRouter for /arena/* (delegated from server.py)
boss_api.py        — APIRouter for /boss-raid/* — uses set_sio() to receive the sio instance after creation
arena_repo.py      — DB persistence: reads/writes arena matches, calls domain functions
boss_repo.py       — DB persistence for boss raids
arena_domain.py    — Pure Python combat rules (NO FastAPI/DB imports) — unit-testable
boss_domain.py     — Pure Python boss raid rules (NO FastAPI/DB imports)
progression.py     — Pure Python XP/level math (NO FastAPI/DB imports)
arena_view.py      — Response shaping: redacts opponent actions for the current open round
auth.py            — Custom HMAC-signed session tokens (not JWT); Telegram InitData verification
database.py        — asyncpg connection pool singleton
db_queries.py      — Raw SQL query functions used by server.py
solana_integration.py — Solana payment processor, RPC fallback manager
socket_rooms.py    — Socket.IO room membership tracking (sid ↔ room_id maps)
rpc_monitor.py     — Solana RPC health alerting
payment_recovery.py — Startup sweep recovery for missed SOL payments
```

**Critical invariant**: `arena_domain.py`, `boss_domain.py`, and `progression.py` must stay free of FastAPI and DB imports — they are tested without a running server.

**Circular import pattern**: `boss_api.py` exposes `set_sio(sio_instance)` which `server.py` calls after creating the Socket.IO server to inject the `sio` instance. Same pattern would apply for any new API module that needs to emit Socket.IO events.

### Authentication

Session tokens are custom HMAC-SHA256 signed (not JWT). The token is stored two ways:
- As an `arena_session` HTTP cookie (set by the auth endpoint)
- In `localStorage` as `riskarena_user.session_token` (read by the axios interceptor)

Auth flow: Telegram Mini App sends `initData` → backend verifies HMAC using `TELEGRAM_BOT_TOKEN` → issues session token. `get_authenticated_user_id(request)` in `auth.py` checks Bearer header first, then cookie.

Admin endpoints require `x-admin-key` header matching `ADMIN_KEY` env var.

### Frontend

`App.jsx` is the root component — it holds nearly all top-level state (user, rooms, socket, active screen) and the Socket.IO event subscription logic. Navigation between screens (`home`, `rooms`, `arena`, `boss-raid`, `tournament`, `inventory`, `shop`, `profile`, `admin`) is managed by a `currentScreen` state, not a router.

API calls go through `src/api/client.js` (axios instance with base URL from `constants.js`). The interceptor automatically attaches the session token from localStorage.

Socket.IO client is created via `src/socket/socketClient.js` and the connection is managed in `App.jsx`.

### Room Types and Game Modes

| Room | Game mode | Players | Bet range |
|------|-----------|---------|-----------|
| free | roulette | 2–3 | 0 tokens |
| bronze | **duel** (Arena 1v1) | 2 | 200–450 |
| silver | roulette | 2–3 | 350–800 |
| gold | roulette | 2–3 | 650–1200 |
| freeroll | roulette | 2–30 | 0 tokens |

Bronze room triggers the full Arena combat system (`arena_domain` → `arena_repo` → `arena_api`). Other rooms use the roulette spin flow in `server.py`.

### Arena Combat (1v1 Duel)

Each match has rounds. Players submit one of: `attack`, `defend`, `ability`, `risk`. Both actions are held until both players submit, then `arena_domain.resolve_round()` is called server-side. `arena_view.redact_match_for_user()` hides the opponent's action for the current open round before sending the response.

- `ability` is single-use per match; second use falls back to attack
- `risk` is a coin flip (50% + weapon bonus) — win deals 35 damage, lose deals 15 self-damage
- Winner receives 90% of the pot (`WINNER_PAYOUT_BPS = 9000`); 10% is burned

### Solana Payments

Each user gets a deterministic derived Solana address (SHA256 of `riskarena_user_{id}_{telegram_id}`). The `SolanaPaymentProcessor` monitors these addresses for incoming SOL, converts to tokens at `SOL_TO_TOKEN_RATE`, and sweeps funds to the main RiskArena wallet.

### Testing

Tests in `backend/tests/` are pure-Python unit tests (no running server or DB needed for domain tests):
- `test_arena_domain.py` — combat resolution, payout math
- `test_auth.py` — token sign/verify
- `test_arena_api_redaction.py` — action redaction logic

Run from the `backend/` directory so imports resolve correctly.
