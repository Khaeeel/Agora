#!/bin/bash
# Start both dev servers.
#   bash ~/.openclaw/agora/scripts/start-dev.sh
#
# Caveat: launched from a one-shot `wsl.exe -- bash ...`, these get reaped when
# that session exits. For servers that outlive the shell, run `pnpm dev` from a
# terminal you keep open.
ROOT="$HOME/.openclaw/agora"
cd "$ROOT" || exit 1

# Kill by port — pkill on the path is unreliable, the server runs with a
# relative script path.
fuser -k 8787/tcp 2>/dev/null
fuser -k 5183/tcp 2>/dev/null
sleep 1

mkdir -p /tmp/agora-logs
nohup node --env-file-if-exists=.env apps/server/src/index.ts \
  > /tmp/agora-logs/server.log 2>&1 &
( cd apps/web && nohup ./node_modules/.bin/vite --port 5183 --host \
  > /tmp/agora-logs/web.log 2>&1 & )

sleep 4
echo "--- server ---"; tail -12 /tmp/agora-logs/server.log
echo "--- web ---";    tail -8  /tmp/agora-logs/web.log
