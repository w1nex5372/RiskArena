# RiskArena

RiskArena is a real-time multiplayer arena game with Telegram Mini App authentication, character progression, Socket.IO lobby sync, Colyseus arena battles, and Solana-based token payments.

## Stack

- Frontend: React, CRACO, Tailwind CSS, Radix UI, Phaser, Colyseus client
- Backend: FastAPI, Socket.IO, PostgreSQL, Solana payment monitoring
- Game server: Node.js, Colyseus
- Runtime: Docker Compose for local services

## Local Development

```bash
docker compose up -d postgres backend gameserver
cd frontend
yarn install
yarn start
```

The frontend dev server runs on `http://localhost:3000`. If an old project appears on that port, stop any stale WSL or Docker process using port `3000` before starting the frontend.

## Environment

Root `.env`:

```env
ADMIN_KEY=replace-with-a-long-random-admin-key
ALLOW_INSECURE_DEV_AUTH=false
CORS_ORIGINS=http://localhost:3000
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
SOLANA_RPC_URL=https://api.devnet.solana.com
RISKARENA_WALLET_PRIVATE_KEY=
RISKARENA_WALLET_ADDRESS=YourWalletAddressHere12345678901234567890123456789
```

Frontend `.env`:

```env
REACT_APP_BACKEND_URL=http://localhost:8001
REACT_APP_GAME_SERVER_URL=ws://localhost:2567
REACT_APP_TELEGRAM_BOT_USERNAME=RiskArenaBot
```

## Useful Commands

```bash
docker compose ps
docker compose logs backend --tail=80
docker compose up --build -d backend gameserver
cd frontend && yarn build
```

## Notes

Some legacy storage keys are still read for migration so existing users do not lose sessions or payment preferences. New code writes RiskArena-prefixed keys.
