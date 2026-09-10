#!/bin/bash
#
# Bring KooyaPedia (Dominic's internal wiki) up if it is down.
#
#   kooyapedia-start.sh          start it unless it already answers
#   kooyapedia-start.sh status   say whether it answers, start nothing
#
# Why a wrapper: the wiki lives on the Windows side (C:\Projects\KooyaPedia,
# port 4711) and agents run inside WSL. WSL can launch Windows programs through
# interop, so this script starts `node server.js` there as a detached process
# that outlives the calling shell and the agent's turn. Nothing else on the
# Windows side is reachable through it. Idempotent: a wiki that is already up
# is left alone, never restarted.
#
# Log of the started server: C:\Users\domin\AppData\Local\Temp\kooyapedia.log
# Exit 0 up, 70 could not start or reach it, 64 usage.
set -uo pipefail

KP_WIN='C:\Projects\KooyaPedia'
KP_WSL=/mnt/c/Projects/KooyaPedia
NODE_WIN='C:\Program Files\nodejs\node.exe'
PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
LOG_WIN='C:\Users\domin\AppData\Local\Temp\kooyapedia.log'

usage() { sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
[ $# -le 1 ] || usage
CMD="${1:-start}"
case "$CMD" in start|status) ;; *) usage ;; esac

if [ -z "${KOOYAPEDIA_URL:-}" ]; then
  GW=$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')
  KOOYAPEDIA_URL="http://${GW:-172.31.224.1}:4711"
fi

up() { curl -s -m 3 -o /dev/null -w '%{http_code}' "$KOOYAPEDIA_URL/" 2>/dev/null | grep -q '^[23]'; }

if up; then
  echo "KooyaPedia is up at $KOOYAPEDIA_URL (http://localhost:4711 on Windows)."
  exit 0
fi
if [ "$CMD" = status ]; then
  echo "KooyaPedia is DOWN: $KOOYAPEDIA_URL does not answer. Run kooyapedia-start.sh to bring it up."
  exit 70
fi

[ -x "$PS" ] || { echo "kooyapedia-start.sh: cannot reach the Windows side (powershell.exe missing)." >&2; exit 70; }
[ -f "$KP_WSL/server.js" ] || { echo "kooyapedia-start.sh: $KP_WIN\server.js not found." >&2; exit 70; }

# Start-Process returns at once and the server is its own Windows process, so
# it survives this shell, the agent's turn and the WSL session that spawned it.
# The interop bridge, though, keeps THIS shell waiting until every handle the
# Windows side inherited is closed — which is never, for a server. So the
# launch runs detached (setsid, every fd closed) and we poll the port instead.
# cd to a Windows-mounted path first: interop from a Linux cwd prints a UNC
# warning on every call.
(
  cd /mnt/c && setsid "$PS" -NoProfile -NonInteractive -Command \
    "Start-Process -FilePath '$NODE_WIN' -ArgumentList 'server.js' -WorkingDirectory '$KP_WIN' -WindowStyle Hidden -RedirectStandardOutput '$LOG_WIN' -RedirectStandardError '${LOG_WIN%.log}.err.log'" \
    </dev/null >/dev/null 2>&1 &
) 2>/dev/null

for _ in $(seq 1 20); do
  sleep 1
  if up; then
    echo "KooyaPedia started — $KOOYAPEDIA_URL (http://localhost:4711 on Windows). Log: $LOG_WIN"
    exit 0
  fi
done
echo "kooyapedia-start.sh: launched node but $KOOYAPEDIA_URL did not answer within 20s. Check $LOG_WIN" >&2
exit 70
