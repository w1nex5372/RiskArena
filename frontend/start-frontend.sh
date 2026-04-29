#!/bin/bash
# Frontend startup script that rebuilds if build folder is missing

cd /app/frontend

# Check if build folder exists
if [ ! -d "build" ]; then
    echo "⚠️ Build folder missing, rebuilding frontend..."
    yarn build
    echo "✅ Frontend rebuild complete"
fi

# Start serve
exec npx serve@14.2.4 -s build -l 3000 --single
