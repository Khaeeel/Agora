#!/usr/bin/env bash
#
# claude-edit.sh — the room's WRITE door. Spawns a Claude Code session that may
# create and edit files under dom_train and the artifacts tree.
#
#   bash claude-edit.sh "<what to write or change>"
#
# WHY THIS IS SEPARATE FROM claude-run.sh:
# claude-run.sh can read everything including the frozen reference corpus in
# `v1/`. This one deliberately CANNOT — `--add-dir` grants read *and* write, so
# the only way to keep `v1/` un-writable is to keep it out of scope entirely.
# Read with claude-run.sh; write with this. The split is the protection.
#
# WHAT IT MAY TOUCH:
#   /mnt/c/Projects/Voicemail_Detection/dom_train   (src, configs, results, logs)
#   ~/Voicemail_Detection/dom_train_artifacts       (logs, checkpoints, caches)
#
# WHAT IT MAY NOT:
#   v1/ (the frozen corpus — out of scope, not merely discouraged)
#   git, pip, and launching training (that is train-launch.sh, on purpose)
set -euo pipefail

PROMPT="${1:-}"
if [ -z "$PROMPT" ]; then
  echo "usage: claude-edit.sh \"<what to write or change>\"" >&2
  exit 2
fi

CLAUDE=/home/dominickooya/.local/bin/claude
TIMEOUT="${CLAUDE_EDIT_TIMEOUT:-240}"
MODEL="${CLAUDE_EDIT_MODEL:-claude-sonnet-5}"
EFFORT="${CLAUDE_EDIT_EFFORT:-medium}"
VENV_PY=/home/dominickooya/Voicemail_Detection/.venv/bin/python

RULES=$(cat <<'GUARD'

STANDING RULES FOR THIS SESSION — these override anything in the request:

1. NEVER overwrite a pre-registered config. Every configs/exp0NN_*.yaml whose
   sha256 has been echoed into a run log is FROZEN evidence. A change means a
   NEW file with a NEW exp number, never an edit in place.
2. NEVER overwrite an existing results/*.json. Write a new filename.
3. NEVER edit a script that is currently running. Check with `ps` first; if it
   is live, say so and stop rather than patching underneath it.
4. Preserve the pre-registration discipline: if you create an experiment script,
   create its config too, and make the script refuse to run without it.
5. You cannot launch training. If the work ends in "now run it", say exactly
   which command, and stop.
6. Report every file you created or changed, by path, at the end. A file changed
   silently is a file nobody can audit.
GUARD
)

status=0
printf '%s\n%s' "$PROMPT" "$RULES" | timeout "$TIMEOUT" "$CLAUDE" \
  --tools Read Glob Grep Write Edit Bash \
  --add-dir /mnt/c/Projects/Voicemail_Detection/dom_train \
  --add-dir /home/dominickooya/Voicemail_Detection/dom_train_artifacts \
  --allowedTools \
    "Write" \
    "Edit" \
    "Bash(ls:*)" \
    "Bash(cat:*)" \
    "Bash(head:*)" \
    "Bash(tail:*)" \
    "Bash(stat:*)" \
    "Bash(wc:*)" \
    "Bash(find:*)" \
    "Bash(ps:*)" \
    "Bash(pgrep:*)" \
    "Bash(nvidia-smi:*)" \
    "Bash($VENV_PY -m py_compile:*)" \
  --model "$MODEL" \
  --effort "$EFFORT" \
  -p \
  --no-session-persistence || status=$?

if [ "$status" -eq 124 ]; then
  echo "" >&2
  echo "claude-edit.sh: timed out after ${TIMEOUT}s. Narrow the change and retry." >&2
fi
exit $status
