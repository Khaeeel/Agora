#!/bin/bash
#
# Measure one agent: run the fixed eval tasks through the Eval room and read
# the live length/cost/marker numbers for its current prompt.
#
# Why a wrapper: the mechanic must be able to prove an edit helped, and the
# only honest proof is the same tasks before and after. This script pins the
# repo, validates the agent id, and hands off to scripts/agora-eval.mjs, which
# talks to the local server exactly as the browser does.
#
#   agora-eval.sh --agent <id> [--task <task-id>]
#
# WHAT IT MAY DO: start runs in the room named "Eval" (WhatsApp is off there:
# AGORA_NOTIFY_JID_EVAL=off), read data/agora.db read-only, append one line to
# eval/results.jsonl and commit it.
# WHAT IT MAY NOT: touch any other room, edit any agent, or send anything.
set -uo pipefail

AGORA_ROOT=/home/dominickooya/agora
SLUG='^[a-z0-9][a-z0-9-]{0,40}$'

usage() { sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
refuse() { echo "agora-eval.sh: $*" >&2; exit 77; }

AGENT=""; TASK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) [ $# -ge 2 ] || usage; AGENT="$2"; shift 2 ;;
    --task)  [ $# -ge 2 ] || usage; TASK="$2";  shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$AGENT" ] || usage
[[ "$AGENT" =~ $SLUG ]] || refuse "bad agent id '$AGENT'"
[ -z "$TASK" ] || [[ "$TASK" =~ $SLUG ]] || refuse "bad task id '$TASK'"

cd "$AGORA_ROOT" || { echo "agora-eval.sh: cannot cd to $AGORA_ROOT" >&2; exit 70; }
# Three tasks at ~40s each fits under the 300s turn timeout with room to spare.
exec timeout 235 node --env-file-if-exists=.env scripts/agora-eval.mjs --agent "$AGENT" ${TASK:+--task "$TASK"}
