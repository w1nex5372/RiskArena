# Casino Web App with Telegram Authentication

A web-based Progressive Web App (PWA) casino application with Telegram authentication and Solana token integration.

## Features

### 🎰 Casino Rooms
- **Bronze Room**: 150-450 Tokens
- **Silver Room**: 500-1500 Tokens  
- **Gold Room**: 2000-8000 Tokens
- 2-player battles with weighted winner selection
- Real-time room status and player updates

### 🔐 Authentication
- Secure Telegram Web App authentication
- User profile integration with Telegram data
- Private prize delivery via Telegram messages

### 💰 Token System
- Solana-based token exchange (currently mock implementation)
- Real-time balance updates
- Purchase history tracking

### 🏆 Game Mechanics
- Weighted winner selection (higher bettors have better odds)
- Unique prize links per room
- Real-time game updates via WebSocket
- Comprehensive game history

### 📱 Progressive Web App
- Mobile and desktop responsive design
- Installable as native app
- Offline capabilities via Service Worker
- Professional UI with Tailwind CSS

## Tech Stack

### Backend
- **FastAPI** - Python web framework
- **MongoDB** - NoSQL database
- **WebSocket** - Real-time communication
- **Telegram Bot API** - Authentication and messaging

### Frontend
- **React.js** - UI framework
- **Tailwind CSS** - Styling
- **Shadcn UI** - Component library
- **WebSocket** - Real-time updates

## Getting Started

### Prerequisites
- Node.js and Yarn
- Python 3.8+
- MongoDB
- Telegram Bot Token

### Installation

1. **Backend Setup**
```bash
cd backend
pip install -r requirements.txt
```

2. **Frontend Setup**
```bash
cd frontend
yarn install
```

3. **Environment Configuration**
Configure `.env` files in both backend and frontend directories with appropriate values.

4. **Start Services**
```bash
sudo supervisorctl restart all
```

## Environment Variables

### Backend (.env)
- `MONGO_URL` - MongoDB connection string
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `DB_NAME` - Database name

### Frontend (.env)
- `REACT_APP_BACKEND_URL` - Backend API URL

## API Routes

All backend routes are prefixed with `/api`:
- `/api/auth/*` - Authentication endpoints
- `/api/rooms/*` - Room management
- `/api/tokens/*` - Token operations
- `/api/prizes/*` - Prize management
- `/api/history/*` - Game history

## Development Status

### Completed ✅
- Telegram Web App authentication
- Casino room system with betting mechanics
- Real-time WebSocket communication
- PWA capabilities
- Responsive mobile/desktop UI
- Mock Solana token integration
- Prize delivery system

### Pending 🚧
- Real Solana payment detection and balance monitoring
- Live Solana blockchain integration

## Contributing

This is a private development project. Contact the repository owner for collaboration.

## License

Private License - All rights reserved.
