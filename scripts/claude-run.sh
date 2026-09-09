#!/usr/bin/env bash
#
# claude-run.sh — the Voicemail Detection room's only way to execute anything.
#
#   bash claude-run.sh "<investigation prompt>"
#
# Runs a FRESH Claude Code session over this project and prints what it found.
# The point is budget: the room gets 12 speaking turns total, and a real
# investigation needs more than one. This spawns a session with its own turn
# budget, so an agent can hand off a whole line of enquiry and get findings back
# without spending the room's transcript on it.
#
# WHY A WRAPPER AND NOT PLAIN Bash:
# The agents are granted exactly `Bash(bash .../claude-run.sh:*)` and nothing
# else, so any other command is a permission denial rather than a judgement
# call. This file is therefore the whole security boundary — everything the room
# can cause to happen is decided here, not in a prompt that a model may reason
# its way around.
#
# WHAT THE SPAWNED SESSION MAY DO:
#   read       Read/Glob/Grep over the code and the artifacts
#   inspect    ls, cat, head, tail, stat, wc, du, find, nvidia-smi
#   audit      audit_protocol.py, which is read-only by construction
# It may NOT write, edit, git, pip, or launch a training run. Those are
# multi-hour GPU jobs and stay Dominic's to start.
set -euo pipefail

PROMPT="${1:-}"
if [ -z "$PROMPT" ]; then
  echo "usage: claude-run.sh \"<investigation prompt>\"" >&2
  exit 2
fi

CLAUDE=/home/dominickooya/.local/bin/claude
# 240s, deliberately under AGORA_TURN_TIMEOUT_MS (300s): the calling agent is
# inside a turn, and a nested call that outlives the turn is killed mid-flight
# and its work is lost. Raise both together or not at all.
TIMEOUT="${CLAUDE_RUN_TIMEOUT:-240}"
MODEL="${CLAUDE_RUN_MODEL:-claude-sonnet-5}"
EFFORT="${CLAUDE_RUN_EFFORT:-medium}"

VENV_PY=/home/dominickooya/Voicemail_Detection/.venv/bin/python
AUDIT=/mnt/c/Projects/Voicemail_Detection/dom_train/src/audit_protocol.py

# The prompt travels on stdin: --tools/--add-dir/--allowedTools are variadic and
# would swallow a positional prompt as an argument. Every variadic option below
# is followed by another flag for the same reason.
# `|| status=$?` rather than a bare pipeline: under `set -e` a non-zero exit
# would kill the script before the timeout check below ever ran.
status=0
printf '%s' "$PROMPT" | timeout "$TIMEOUT" "$CLAUDE" \
  --tools Read Glob Grep Bash \
  --add-dir /mnt/c/Projects/Voicemail_Detection \
  --add-dir /home/dominickooya/Voicemail_Detection \
  --allowedTools \
    "Bash(ls:*)" \
    "Bash(cat:*)" \
    "Bash(head:*)" \
    "Bash(tail:*)" \
    "Bash(stat:*)" \
    "Bash(wc:*)" \
    "Bash(du:*)" \
    "Bash(find:*)" \
    "Bash(nvidia-smi:*)" \
    "Bash($VENV_PY $AUDIT:*)" \
  --model "$MODEL" \
  --effort "$EFFORT" \
  -p \
  --no-session-persistence || status=$?

if [ "$status" -eq 124 ]; then
  echo "" >&2
  echo "claude-run.sh: timed out after ${TIMEOUT}s. Narrow the question and ask again." >&2
fi
exit $status
