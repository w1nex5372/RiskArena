# Solana Casino Battle Royale

A real-time multiplayer casino game built with React, FastAPI, Socket.IO, and Solana blockchain integration.

## Tech Stack

**Frontend:**
- React 18
- Socket.IO Client
- Axios
- Tailwind CSS
- Radix UI Components

**Backend:**
- FastAPI
- Socket.IO (AsyncServer)
- MongoDB
- Solana Web3.js
- Python 3.9+

## Quick Start

### Prerequisites
- Node.js 16+
- Python 3.9+
- MongoDB
- Yarn

### Installation

**Frontend:**
```bash
cd frontend
yarn install
yarn start
```

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python server.py
```

### Environment Variables

**Frontend (.env):**
```
REACT_APP_BACKEND_URL=https://your-domain.com
```

**Backend (.env):**
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=casino_db
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_MAIN_WALLET_ADDRESS=your_wallet
CASINO_WALLET_PRIVATE_KEY=your_private_key
```

## Features

- Real-time multiplayer rooms (Bronze, Silver, Gold)
- Solana payment integration
- Socket.IO for live game synchronization
- Daily free token bonus
- Winner announcements with prize distribution
- Mobile-responsive PWA

## Production Deployment

1. Build frontend: `cd frontend && yarn build`
2. Backend runs on port 8001
3. Frontend serves from port 3000
4. All API routes prefixed with `/api`

## Current Version

v9.8 - Production Ready
- Cross-device synchronization
- Sequential event flow
- Bonus always visible
- Lobby state management

## Support

For issues or questions, check the archived documentation in `/app/archive_docs/`
