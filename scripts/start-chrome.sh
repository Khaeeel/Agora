#!/bin/bash
# The browser T-Bag drives.
#
#   bash ~/.openclaw/agora/scripts/start-chrome.sh            # visible window
#   bash ~/.openclaw/agora/scripts/start-chrome.sh --headless # no window
#
# The chrome-devtools MCP server ATTACHES to an existing Chrome over CDP — it
# never launches one. Without this running, T-Bag's browser tools exist but every
# call fails with "Could not connect to Chrome".
#
# Visible by default, via WSLg. The profile is persistent, so signing in once by
# hand keeps the session across restarts and T-Bag never needs the password.
#
# Run this from a terminal you keep open. Launched from a one-shot
# `wsl.exe -- bash ...` it gets reaped the moment that call returns.
PORT="${AGORA_CDP_PORT:-9222}"
PROFILE="$HOME/.openclaw/agora/.chrome-profile"
BIN=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1)

if [ -z "$BIN" ]; then
  echo "No chromium under ~/.cache/ms-playwright. Install one:"
  echo "  npx playwright install chromium"
  exit 1
fi

if curl -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "Chrome is already on CDP port $PORT — leaving it alone."
  echo "Kill it with:  pkill -f 'remote-debugging-port=$PORT'"
  exit 0
fi

MODE=()
[ "$1" = "--headless" ] && MODE=(--headless=new --disable-gpu)

mkdir -p "$PROFILE"
exec "$BIN" \
  "${MODE[@]}" \
  --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  --window-size=1440,900 \
  https://dev-app.helloalex.ai/
