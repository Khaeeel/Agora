#!/usr/bin/env bash
#
# train-launch.sh — start a training run and come straight back.
#
#   bash train-launch.sh exp038_hyperparam_sweep.py [args...]
#   bash train-launch.sh --status
#   bash train-launch.sh --stop
#
# WHY A LAUNCHER AND NOT PLAIN python:
# A training run here takes hours; an agent's turn is capped at 300 seconds.
# Anything started inside a turn dies with it — that is exactly how 43 minutes
# of exp036 were lost. So a run MUST be detached from whoever started it. This
# launches with setsid, writes to a log in the artifacts tree, and returns the
# pid immediately.
#
# ONE AT A TIME. Two runs on one GPU means both are slower and neither number is
# comparable to anything. A second launch is refused, not queued.
set -euo pipefail

SRC=/mnt/c/Projects/Voicemail_Detection/dom_train/src
ART=/home/dominickooya/Voicemail_Detection/dom_train_artifacts
VENV_PY=/home/dominickooya/Voicemail_Detection/.venv/bin/python
PATTERN='\.venv/bin/python .*exp[0-9]'

running_pid() { pgrep -f "$PATTERN" 2>/dev/null | head -1; }

case "${1:-}" in
  --status)
    PID=$(running_pid || true)
    if [ -z "$PID" ]; then
      echo "No training run in flight."
      LATEST=$(ls -t "$ART"/exp*.log 2>/dev/null | head -1 || true)
      [ -n "$LATEST" ] && { echo "Most recent log: $LATEST"; tail -4 "$LATEST"; }
      exit 0
    fi
    echo "RUNNING — pid $PID"
    ps -o pid,etime,cmd -p "$PID" | tail -1
    LATEST=$(ls -t "$ART"/exp*.log 2>/dev/null | head -1 || true)
    if [ -n "$LATEST" ]; then
      echo "log: $LATEST (last written $(stat -c %y "$LATEST"))"
      tail -4 "$LATEST"
    fi
    exit 0
    ;;
  --stop)
    PID=$(running_pid || true)
    [ -z "$PID" ] && { echo "Nothing to stop."; exit 0; }
    kill "$PID" && echo "Sent TERM to $PID. Checkpointed runs resume; others restart from zero."
    exit 0
    ;;
  "")
    echo "usage: train-launch.sh <script.py> [args...] | --status | --stop" >&2
    exit 2
    ;;
esac

SCRIPT="$1"; shift
case "$SCRIPT" in
  */*) echo "Give the script NAME only, it is resolved inside src/." >&2; exit 2 ;;
  *.py) ;;
  *) echo "Only .py training scripts can be launched." >&2; exit 2 ;;
esac

[ -f "$SRC/$SCRIPT" ] || { echo "No such script: $SRC/$SCRIPT" >&2; exit 1; }

EXISTING=$(running_pid || true)
if [ -n "$EXISTING" ]; then
  echo "REFUSED — a training run is already in flight (pid $EXISTING)." >&2
  ps -o pid,etime,cmd -p "$EXISTING" | tail -1 >&2
  echo "One run at a time. Use --status to watch it, --stop to end it." >&2
  exit 1
fi

LOG="$ART/${SCRIPT%.py}.log"
cd "$SRC"
setsid nohup "$VENV_PY" "$SCRIPT" "$@" >> "$LOG" 2>&1 < /dev/null &
PID=$!
disown 2>/dev/null || true

echo "Launched $SCRIPT (pid $PID)."
echo "log: $LOG"
echo "It is detached and survives this turn. Do NOT wait for it — check back with"
echo "  bash train-launch.sh --status"
