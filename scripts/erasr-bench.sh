#!/usr/bin/env bash
#
# erasr-bench.sh — the Erasr room's measurement door.
#
#   bash erasr-bench.sh
#   bash erasr-bench.sh --only small-blob-fast
#   bash erasr-bench.sh --against baseline
#   bash erasr-bench.sh --save baseline
#   bash erasr-bench.sh --video
#   bash erasr-bench.sh --repeat 3
#
# WHY THIS EXISTS
# The README calls `pnpm bench` "how a change gets proven instead of argued
# about", and until now no wrapper in this system could run it. erasr-run.sh
# refuses pnpm by design and erasr-job.sh only submits single jobs, so a room
# that owns the app could edit it but never measure whether the edit helped.
# That is the gap this closes, and nothing more: it measures, it never writes.
#
# WHY A WRAPPER AND NOT PLAIN Bash
# Agents are granted exactly `Bash(bash .../erasr-bench.sh:*)` and nothing else,
# so any other command is a permission denial rather than a judgement call. This
# file is therefore the whole security boundary. Every flag is spelled out and
# validated below; anything unrecognised is a usage error, not a pass-through.
# In particular no argument ever reaches a shell unquoted, so a case id cannot
# smuggle a second command.
#
# WHAT IT DELIBERATELY CANNOT DO
# It cannot write project files, touch git, install anything, submit a one-off
# job, or start ComfyUI. Saving a baseline is the single write it performs, it
# lands only under bench/runs/, and the name is validated.
#
# WHY EVERYTHING GOES THROUGH powershell.exe
# The metrics need PIL and numpy, which live in ComfyUI's embedded Python — a
# Windows interpreter. The benchmark also drives the RUNNING app on Windows
# loopback, and WSL sits behind NAT, so from here 127.0.0.1 is a different
# machine. Driving the Windows side through powershell.exe is not a workaround;
# it is the only address that reaches either one.
set -uo pipefail

PROJECT_WIN='C:\Projects\erasr'
BASE='http://127.0.0.1:3000'
PS='/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe'

# A full six-case run is minutes, and --video or --repeat multiplies it.
TIMEOUT="${ERASR_BENCH_TIMEOUT:-3600}"

die() { echo "erasr-bench: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage:
  erasr-bench.sh [flags]

      Runs the benchmark against the RUNNING app, so it measures the pipeline
      as a person meets it. The engine and `pnpm dev` must both be up.

      flags:
        --only <case>      run one case by id, e.g. small-blob-fast
        --against <name>   compare this run to a saved run and show what moved
        --save <name>      save this run under that name
        --video            include the slow video case
        --repeat <n>       repeat each case n times (1-10) for spread

      No flags runs every non-video case and prints the table.

      The five metrics, and which direction is bad:
        coverage   fraction of frame the mask selected. 0 means nothing found
        residual   pixel change INSIDE the mask. LOW IS BAD — the model
                   rebuilt the object instead of removing it
        drift      pixel change OUTSIDE the mask. Above ~0 means the pipeline
                   damaged pixels nobody asked it to touch
        seam       edge energy where the repair meets the original
        seconds    wall clock, engine warm

Anything not listed above is a usage error. This script measures; it does not
edit, submit, install, or start anything.
USAGE
  exit 64
}

[ "$#" -eq 0 ] && set -- # no args is a valid full run

# ── validate, then rebuild the argument list ourselves ──────────────────────
# Nothing from the caller is ever concatenated into the command line as-is.
ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      [ "$#" -ge 2 ] || die "--only needs a case id"
      case "$2" in
        *[!a-zA-Z0-9._-]*|'') die "case id may only contain letters, digits, dot, dash, underscore: $2" ;;
      esac
      ARGS+=(--only "$2"); shift 2 ;;
    --against|--save)
      flag="$1"
      [ "$#" -ge 2 ] || die "$flag needs a name"
      case "$2" in
        *[!a-zA-Z0-9._-]*|'') die "run name may only contain letters, digits, dot, dash, underscore: $2" ;;
      esac
      ARGS+=("$flag" "$2"); shift 2 ;;
    --video)
      ARGS+=(--video); shift ;;
    --repeat)
      [ "$#" -ge 2 ] || die "--repeat needs a number"
      case "$2" in
        ''|*[!0-9]*) die "--repeat takes a whole number: $2" ;;
      esac
      [ "$2" -ge 1 ] && [ "$2" -le 10 ] || die "--repeat must be 1-10, got $2"
      ARGS+=(--repeat "$2"); shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown flag: $1 (run --help for the list)" ;;
  esac
done

[ -x "$PS" ] || die "powershell.exe not found at $PS"

# ── the app must actually be serving, or every case fails for one reason ────
ps_run() { "$PS" -NoProfile -ExecutionPolicy Bypass -Command "$1" 2>&1 | tr -d '\r'; }

app_state=$(ps_run "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 '$BASE/api/jobs').StatusCode } catch { 'ERR' }")
case "$app_state" in
  200) ;;
  *)
    echo "erasr-bench: the app is not answering on $BASE." >&2
    echo "             the benchmark drives the running app, so there is" >&2
    echo "             nothing to measure until it is up." >&2
    echo "             run: bash erasr-job.sh --restart" >&2
    exit 1 ;;
esac

engine=$(ps_run "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 '$BASE/api/engine').Content } catch { 'ERR' }")
case "$engine" in
  # /api/engine answers {"up":true,"vramFree":...,"workers":1,...}. Match the
  # field the route actually returns, not a plausible-looking one.
  *'"up":true'*) ;;
  ERR*|'')
    echo "erasr-bench: could not read the engine state; continuing anyway." >&2 ;;
  *)
    echo "erasr-bench: the engine looks offline. Every case will fail on the" >&2
    echo "             same cause, which is a wasted run, not a measurement." >&2
    echo "             start ComfyUI first — that stays Dominic's to start." >&2
    exit 1 ;;
esac

# ── run it ─────────────────────────────────────────────────────────────────
# Each argument is passed as its own single-quoted PowerShell token, built from
# values this script has already validated against a character whitelist.
psq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

cmd="Set-Location -LiteralPath '$PROJECT_WIN'; pnpm bench"
for a in ${ARGS+"${ARGS[@]}"}; do
  cmd="$cmd $(psq "$a")"
done

echo "erasr-bench: pnpm bench ${ARGS[*]-} (timeout ${TIMEOUT}s)" >&2
echo >&2

timeout "$TIMEOUT" "$PS" -NoProfile -ExecutionPolicy Bypass -Command "$cmd" 2>&1 | tr -d '\r'
rc=${PIPESTATUS[0]}

if [ "$rc" -eq 124 ]; then
  echo >&2
  echo "erasr-bench: timed out after ${TIMEOUT}s. A full run with --video or a" >&2
  echo "             high --repeat can legitimately exceed this; raise" >&2
  echo "             ERASR_BENCH_TIMEOUT rather than assuming a hang." >&2
fi
exit "$rc"
