#!/bin/bash
#
# verdict-check.sh — the Verdict Checker's one door (Voicemail Detection room).
#
#   verdict-check.sh <file in dom_train/results/>
#
# Runs dom_train/src/evaluate_verdict.py on ONE metrics file already on disk and
# prints its JSON report: derived ADOPT / NOT ADOPT / INSUFFICIENT, the rule it
# applied, the contract fields that are missing, and the input's sha256.
#
# Why a wrapper: Oslo is granted exactly Bash(bash .../verdict-check.sh:*), so
# this file is the boundary. It accepts only a .json under dom_train/results/,
# never passes --json (the script's only write), and runs under a timeout. The
# script itself is arithmetic on the file: no model, no RNG, no network.
#
# Exit: the script's own exit is the number of FAILed checks (0 = all pass),
# so 1 is a finding, not a crash. 64 usage, 77 refused, 70 could not run.
set -uo pipefail

PROJECT=/mnt/c/Projects/Voicemail_Detection/dom_train
RESULTS=$PROJECT/results
SCRIPT=$PROJECT/src/evaluate_verdict.py
PY=/home/dominickooya/Voicemail_Detection/.venv/bin/python

usage() { sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
refuse() { echo "verdict-check.sh: $*" >&2; exit 77; }

[ $# -eq 1 ] || usage
ARG="$1"
case "$ARG" in
  /*)        F="$ARG" ;;
  results/*) F="$RESULTS/${ARG#results/}" ;;
  *)         F="$RESULTS/$ARG" ;;
esac

REAL=$(realpath -e -- "$F" 2>/dev/null) || refuse "no such file: $ARG (looked in $RESULTS)"
case "$REAL" in
  "$RESULTS"/*.json) ;;
  *) refuse "only a .json under $RESULTS may be checked, not $REAL" ;;
esac

[ -x "$PY" ]     || { echo "verdict-check.sh: python venv missing at $PY" >&2; exit 70; }
[ -f "$SCRIPT" ] || { echo "verdict-check.sh: $SCRIPT is missing" >&2; exit 70; }

cd "$PROJECT" || exit 70
timeout 60 "$PY" "$SCRIPT" "$REAL"
status=$?
[ "$status" -eq 124 ] && echo "verdict-check.sh: timed out after 60s" >&2
exit "$status"
