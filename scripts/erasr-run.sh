#!/usr/bin/env bash
#
# erasr-run.sh — the Trunks room's read-and-inspect execution path.
#
#   bash erasr-run.sh "<investigation prompt>"
#
# Runs a FRESH Claude Code session over C:\Projects\erasr and prints what it
# found. The point is budget: the room gets a limited number of speaking turns,
# and a real investigation needs more than one. This spawns a session with its
# own turn budget, so an agent can hand off a whole line of enquiry and get
# findings back without spending the room's transcript on it.
#
# WHY A WRAPPER AND NOT PLAIN Bash:
# The agents are granted exactly `Bash(bash .../erasr-run.sh:*)` and nothing
# else, so any other command is a permission denial rather than a judgement
# call. This file is therefore the whole security boundary — everything the room
# can cause to happen is decided here, not in a prompt a model may reason its
# way around.
#
# WHAT THE SPAWNED SESSION MAY DO:
#   read      Read/Glob/Grep over the code and the artifacts
#   inspect   ls, cat, head, tail, stat, wc, du, find, ps, nvidia-smi
# It may NOT write, edit, git, pnpm, or submit a job to ComfyUI. Submitting is
# what the engine lease governs, and a lease is granted per assignment — not
# baked into a script that anyone holding this grant could call.
set -uo pipefail

CLAUDE="${CLAUDE_BIN:-/home/dominickooya/.local/bin/claude}"
MODEL="${ERASR_RUN_MODEL:-claude-sonnet-5}"
EFFORT="${ERASR_RUN_EFFORT:-medium}"
TIMEOUT="${ERASR_RUN_TIMEOUT:-900}"
PROJECT=/mnt/c/Projects/erasr

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  echo "usage: bash erasr-run.sh \"<investigation prompt>\"" >&2
  exit 64
fi
PROMPT="$1"

RULES=$(cat <<'GUARD'

--- HARD RULES FOR THIS SESSION ---
1. You are READ-ONLY. Do not write, edit, or create any file.
2. You may NOT submit a job to ComfyUI or start `pnpm dev`. One GPU means one
   process; a job you start is indistinguishable from one somebody else is
   running, and its timing will be read as theirs.
3. Report file paths and line numbers for every claim. A claim about this
   codebase with no path attached is an opinion.
4. If a question can only be settled by running something, say exactly what
   would need to run and stop. Do not approximate it by reading.
5. Report what you did NOT check. An unstated gap reads as coverage.
GUARD
)

# Run FROM the project. The spawned session inherits this directory as its
# implicit write scope — read-only, but same rule so the two cannot drift. Left at the caller's
# cwd that scope is ~/agora, which is where these wrappers live,
# and an agent that can rewrite its own wrapper has no boundary at all.
cd "$PROJECT" || { echo "$0: cannot enter $PROJECT" >&2; exit 70; }

status=0
printf '%s\n%s' "$PROMPT" "$RULES" | timeout "$TIMEOUT" "$CLAUDE" \
  --tools Read Glob Grep Bash \
  --add-dir "$PROJECT" \
  --allowedTools \
    "Bash(ls:*)" \
    "Bash(cat:*)" \
    "Bash(head:*)" \
    "Bash(tail:*)" \
    "Bash(stat:*)" \
    "Bash(wc:*)" \
    "Bash(du:*)" \
    "Bash(find:*)" \
    "Bash(ps:*)" \
    "Bash(pgrep:*)" \
    "Bash(nvidia-smi:*)" \
  --model "$MODEL" \
  --effort "$EFFORT" \
  -p || status=$?

if [ "$status" -eq 124 ]; then
  echo "erasr-run.sh: timed out after ${TIMEOUT}s" >&2
fi
exit "$status"
