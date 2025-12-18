#!/bin/bash
set -e

LOCKFILE="/tmp/discord-bot-deploy.lock"
BOT_DIR="$HOME/discord-bot"

# Exit if already deploying
if [ -f "$LOCKFILE" ]; then
  exit 0
fi

# Create lock, ensure cleanup on exit
trap "rm -f $LOCKFILE" EXIT
touch "$LOCKFILE"

cd "$BOT_DIR"
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "$(date): Deploying update..."
  git pull origin main
  npm install
  pm2 restart discord-bot
  echo "$(date): Deploy complete"
fi
