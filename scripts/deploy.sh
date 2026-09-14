#!/bin/bash
# Deploy the bot on the pi. Cron runs this every ten minutes and appends to
# deploy.log, so a push to origin/main is a production deploy.
#
# Two guards, each for something that bit:
# - This npm rewrites package-lock.json on install (it drops fields a newer
#   npm wrote), and a dirty lockfile makes the next pull that touches it abort
#   with nothing in the log a person reads. The lockfile is reset before the
#   pull and again after the install, so the tree is always clean.
# - A failure at any step is one dated line naming the line it failed on.
set -euo pipefail

LOCKFILE="/tmp/discord-bot-deploy.lock"
BOT_DIR="$HOME/discord-bot"

# Exit if already deploying
if [ -f "$LOCKFILE" ]; then
  exit 0
fi

# Create lock, ensure cleanup on exit
trap 'rm -f "$LOCKFILE"' EXIT
trap 'echo "$(date): Deploy FAILED at line $LINENO"' ERR
touch "$LOCKFILE"

cd "$BOT_DIR"
# Quiet: the fetch's two progress lines every ten minutes were the whole log.
git fetch -q origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "$(date): Deploying update ${LOCAL:0:7} -> ${REMOTE:0:7}..."
  git checkout -- package-lock.json
  git pull -q --ff-only origin main
  npm install
  git checkout -- package-lock.json
  pm2 restart discord-bot
  echo "$(date): Deploy complete"
fi
