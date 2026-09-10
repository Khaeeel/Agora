#!/usr/bin/env bash
#
# erasr-edit.sh — the Trunks room's write path into C:\Projects\erasr.
#
#   bash erasr-edit.sh "<what to change and why>"
#
# Spawns a Claude Code session that may READ AND WRITE the harness. Held only by
# the agents who own a lane that changes code — Collapse, Yatoro, Ana, Topson.
# Ceb does not hold it: whoever builds a thing does not also grade it.
#
# It still may NOT submit a job to ComfyUI. Running is governed by the engine
# lease, which is granted per assignment; a script that could both edit and run
# would hand every holder a permanent lease.
set -uo pipefail

CLAUDE="${CLAUDE_BIN:-/home/dominickooya/.local/bin/claude}"
MODEL="${ERASR_EDIT_MODEL:-claude-sonnet-5}"
EFFORT="${ERASR_EDIT_EFFORT:-medium}"
TIMEOUT="${ERASR_EDIT_TIMEOUT:-1200}"
PROJECT=/mnt/c/Projects/erasr

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  echo "usage: bash erasr-edit.sh \"<what to change and why>\"" >&2
  exit 64
fi
PROMPT="$1"

RULES=$(cat <<'GUARD'

--- HARD RULES FOR THIS SESSION ---
These were each learned by breaking this codebase, and each presents as
something else entirely. Violating one does not look like a violation.

I1. ONE number owns concurrency: `ERASR_WORKERS` in `.env.local`, read once in
    `queue.ts`. Never hardcode a second concurrency value anywhere.
I2. The pool is cached on `globalThis`. Editing `queue.ts` leaves the old
    instance in memory and new fields arrive as `undefined`. If a change to the
    pool appears to do nothing, say so and tell the caller to restart
    `pnpm dev` before debugging further.
I3. Node ids are a contract: RESULT_NODE, MASK_NODE, VIDEO_RESULT_NODE,
    GENERATE_RESULT_NODE. Renumbering a graph node without updating these fails
    SILENTLY with "engine returned no image."
I4. `freeVram()` must stay in the `finally` block. Two large models resident for
    even an instant is an out-of-memory crash on a 12 GB card.
I5. Do not "clean up" user prompts. Measured: `remove anything found` reached
    54.6% coverage, the bare noun `anything` reached 0%. Send what was typed.
I6. Empty means zero pixels, not a small percentage. A correctly-selected small
    object measured 0.16% of the frame. Never introduce a coverage floor above
    zero.
I7. The folder is `C:\Projects`, capital P.

You may NOT start `pnpm dev` or submit a job to ComfyUI. If the work ends in
"now run it", say exactly which command, and stop.
Report every file you created or changed, by path, at the end. A file changed
silently is a file nobody can audit.
GUARD
)

# Run FROM the project. The spawned session inherits this directory as its
# implicit write scope — grants Write/Edit, so this one is load-bearing. Left at the caller's
# cwd that scope is ~/agora, which is where these wrappers live,
# and an agent that can rewrite its own wrapper has no boundary at all.
cd "$PROJECT" || { echo "$0: cannot enter $PROJECT" >&2; exit 70; }

status=0
printf '%s\n%s' "$PROMPT" "$RULES" | timeout "$TIMEOUT" "$CLAUDE" \
  --tools Read Glob Grep Write Edit Bash \
  --add-dir "$PROJECT" \
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
  --model "$MODEL" \
  --effort "$EFFORT" \
  -p || status=$?

if [ "$status" -eq 124 ]; then
  echo "erasr-edit.sh: timed out after ${TIMEOUT}s" >&2
fi
exit "$status"
