#!/usr/bin/env bash
#
# agora-watchdog.sh — keeps the Agora server alive AND serving.
#
# WHY THIS EXISTS
# The server has died twice with no crash in the log — the whole pnpm/vite/node
# tree simply gone — and each time it took a run with it. A run that dies this
# way does not fail cleanly: it leaves a goal half-done with steps still marked
# active, and nothing restarts a stopped room on its own. The two casualties so
# far were Ceb's blinded scoring pass and the prompt-guardrail plan, which was
# killed 2s in with all six steps never reached.
#
# It checks a ROUTE, not a port. erasr's watchdog originally only asked whether
# something was listening, and sat quiet through a real outage where the process
# was bound and every request returned 500. Same mistake is not repeated here.

set -uo pipefail

ROOT=/home/dominickooya/agora
PROBE='http://127.0.0.1:8787/api/state'
LOG="$ROOT/data/watchdog.log"
START_LOCK="$ROOT/data/.watchdog.start.lock"
SICK_LOCK="$ROOT/data/.watchdog.sick.lock"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

serving() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PROBE" 2>/dev/null)
  [ "$code" = "200" ]
}

# 1. Healthy. The common path, and it stays silent.
if serving; then
  rm -f "$SICK_LOCK"
  exit 0
fi

# 2. Cooldown, so a slow boot is not relaunched on top of itself.
if [ -f "$START_LOCK" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$START_LOCK") ))
  if [ "$age" -lt 180 ]; then
    log "not serving, but a start was attempted ${age}s ago - letting it finish"
    exit 0
  fi
fi

# 3. Do not thrash. If a restart already failed to fix this recently, the fault
#    is not something restarting cures — say so once and stop.
if [ -f "$SICK_LOCK" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$SICK_LOCK") ))
  [ "$age" -lt 1800 ] && exit 1
fi

log "$PROBE not returning 200 - recovering"
touch "$START_LOCK"

# 4. Clear whatever is left, by port owner rather than by name — a half-dead
#    tree still holding 8787 makes the replacement fail with EADDRINUSE and the
#    web side silently moves to 5184, which looks like a working app on the
#    wrong port.
for port in 8787 5183; do
  for pid in $(ss -ltnp 2>/dev/null | grep ":$port " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    log "stopping pid $pid (port $port)"
    kill -9 "$pid" 2>/dev/null
  done
done
sleep 3

cd "$ROOT" || { log "ABORT: $ROOT is gone"; touch "$SICK_LOCK"; exit 1; }
# `pnpm` on this box resolves ONLY to the Windows binary under /mnt/c, and a
# Windows interop process is owned by the WSL session that spawned it. Under
# cron that session exits seconds later and takes both servers with it —
# which presents as an empty dev.log and a watchdog that reports "restarted
# but never returned 200". Launching the two workspace commands with the
# LINUX node keeps them out of interop, so they survive the launcher.
( cd "$ROOT/apps/server" && setsid nohup /usr/bin/node --watch \
    --env-file-if-exists=../../.env src/index.ts \
    > "$ROOT/data/server.log" 2>&1 < /dev/null & )
( cd "$ROOT/apps/web" && setsid nohup /usr/bin/node \
    node_modules/vite/bin/vite.js --port 5183 --host \
    > "$ROOT/data/web.log" 2>&1 < /dev/null & )

# 5. Confirm it SERVES, not merely that it started.
for _ in $(seq 1 30); do
  sleep 3
  if serving; then
    log "recovered - $PROBE returns 200"
    rm -f "$SICK_LOCK"
    exit 0
  fi
done

log "WARNING: restarted but $PROBE never returned 200 - not retrying for 30 minutes"
touch "$SICK_LOCK"
exit 1
